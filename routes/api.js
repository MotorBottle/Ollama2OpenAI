const express = require('express');
const axios = require('axios');
const config = require('../config/config');

const router = express.Router();

// Helper function for robust NDJSON parsing
function createNdjsonParser(onObject) {
    let buffer = '';
    return (chunk) => {
        buffer += chunk.toString('utf8');
        let idx;
        while ((idx = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line) continue;
            try {
                onObject(JSON.parse(line));
            } catch (e) {
                // If parse fails, re-append and wait for more
                buffer = line + '\n' + buffer;
                break;
            }
        }
    };
}

// Middleware to validate API key and check model access
const validateApiKey = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            error: {
                message: 'You must provide a valid API key',
                type: 'invalid_request_error',
                code: 'invalid_api_key'
            }
        });
    }
    
    const apiKey = authHeader.substring(7);
    const keyData = config.findApiKey(apiKey);
    
    if (!keyData) {
        return res.status(401).json({
            error: {
                message: 'Invalid API key provided',
                type: 'invalid_request_error',
                code: 'invalid_api_key'
            }
        });
    }
    
    req.apiKeyData = keyData;
    req.apiKey = apiKey;
    next();
};

// Middleware to check model access permissions
const checkModelAccess = (req, res, next) => {
    const requestedModel = (req.body.model || req.query.model)?.trim();
    if (!requestedModel) {
        return res.status(400).json({
            error: {
                message: 'No model specified',
                type: 'invalid_request_error',
                code: 'missing_model'
            }
        });
    }
    
    const keyData = req.apiKeyData;
    const allowedModels = keyData.allowedModels;
    
    // Check if user has access to all models or specific model
    if (!allowedModels.includes('*') && !allowedModels.includes(requestedModel)) {
        return res.status(403).json({
            error: {
                message: `Access denied for model: ${requestedModel}`,
                type: 'permission_error',
                code: 'model_access_denied'
            }
        });
    }
    
    req.requestedModel = requestedModel;
    next();
};

// OpenAI compatible chat completions endpoint
router.post('/chat/completions', validateApiKey, checkModelAccess, async (req, res) => {
    const startTime = Date.now();
    
    try {
        // Update API key usage
        config.updateApiKeyUsage(req.apiKey);
        
        // Get model mapping from display name to actual ollama model (trim whitespace)
        const trimmedModel = req.requestedModel.trim();
        const modelMapping = getModelMapping(trimmedModel);
        const actualModel = (modelMapping || trimmedModel).trim();
        
        // Get parameter overrides for this model
        const overrides = config.getModelOverrides(trimmedModel);
        
        // Convert OpenAI request to Ollama format
        const ollamaRequest = await convertToOllamaRequest(req.body, actualModel, overrides);
        
        // Store reasoning preferences for response processing
        req.reasoningPreferences = extractReasoningPreferences(req.body);
        
        // Debug: Log the final request being sent to Ollama (remove in production)
        // console.log('Ollama Request:', JSON.stringify(ollamaRequest, null, 2));
        // console.log('Original Request body:', JSON.stringify(req.body, null, 2));
        
        // Select appropriate response type based on streaming preference
        const wantsStream = !!req.body.stream;
        const ollamaResponse = await axios.post(
            `${config.config.ollamaUrl}/api/chat`,
            ollamaRequest,
            {
                timeout: 120000,
                responseType: wantsStream ? 'stream' : 'json'
            }
        );

        // Handle streaming response with proper SSE format
        if (wantsStream) {
            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache, no-transform');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('Access-Control-Allow-Origin', '*');

            let sentRole = false;
            let responseContent = '';
            let thinkingContent = '';
            let sawToolCalls = false;

            const pump = createNdjsonParser((data) => {
                // Accumulate text
                if (data.message) {
                    if (data.message.content) responseContent += data.message.content;
                    if (data.message.thinking) thinkingContent += data.message.thinking;
                }

                // OpenAI-style chunk to emit
                const chunk = {
                    id: `chatcmpl-${Date.now()}`,
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: req.requestedModel,
                    choices: [{ index: 0, delta: {}, finish_reason: null }]
                };

                // First role delta
                if (!sentRole) {
                    chunk.choices[0].delta.role = 'assistant';
                    sentRole = true;
                    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                    // After the role preface, we continue to emit content/tool/think deltas below
                    chunk.choices[0].delta = {};
                }

                // Content / thinking - handle separated reasoning and response phases
                if (data.message && 'content' in data.message && data.message.content !== '') {
                    chunk.choices[0].delta.content = data.message.content;
                }
                if (data.message?.thinking && req.reasoningPreferences?.shouldIncludeReasoning !== false) {
                    chunk.choices[0].delta.reasoning_content = data.message.thinking;
                }

                // Tool calls (emit as a single delta; mark that we saw them)
                if (Array.isArray(data.message?.tool_calls) && data.message.tool_calls.length) {
                    sawToolCalls = true;
                    chunk.choices[0].delta.tool_calls = data.message.tool_calls.map((tc, i) => ({
                        index: i,
                        id: `call_${Date.now()}_${i}`,
                        type: 'function',
                        function: {
                            name: tc.function?.name,
                            arguments: typeof tc.function?.arguments === 'string'
                                ? tc.function.arguments
                                : JSON.stringify(tc.function?.arguments ?? {})
                        }
                    }));
                }

                // Write delta if anything meaningful
                const d = chunk.choices[0].delta;
                if (d.content || d.reasoning_content || d.tool_calls || d.role) {
                    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                }

                // Finalization
                if (data.done) {
                    // If this turn was a tool-call turn, finish_reason should be "tool_calls";
                    // otherwise "stop".
                    const fin = {
                        id: chunk.id,
                        object: 'chat.completion.chunk',
                        created: chunk.created,
                        model: chunk.model,
                        choices: [{
                            index: 0,
                            delta: {},
                            finish_reason: sawToolCalls ? 'tool_calls' : 'stop'
                        }]
                    };
                    res.write(`data: ${JSON.stringify(fin)}\n\n`);
                    res.write('data: [DONE]\n\n');
                    logRequest(req, responseContent, Date.now() - startTime, 'success');
                    res.end();
                }
            });

            ollamaResponse.data.on('data', pump);
            ollamaResponse.data.on('error', (err) => {
                console.error('Stream error:', err);
                if (!res.headersSent) {
                    res.writeHead(500, { 'Content-Type': 'text/event-stream; charset=utf-8' });
                    res.write(`data: ${JSON.stringify({ error: { message: 'Stream processing error', type: 'server_error' } })}\n\n`);
                }
                res.end();
                logRequest(req, '', Date.now() - startTime, 'error');
            });

            req.on('close', () => {
                try { ollamaResponse.data?.destroy(); } catch {}
            });
        } else {
            // With responseType:'json', Ollama already returned the final JSON object
            const data = ollamaResponse.data;

            const fullResponse = data?.message?.content || '';
            const fullThinking = data?.message?.thinking || '';

            const openaiResponse = convertToOpenAIResponse(
                data,
                req.requestedModel,
                fullResponse,
                fullThinking,
                req.reasoningPreferences
            );

            logRequest(req, fullResponse, Date.now() - startTime, 'success');
            res.json(openaiResponse);
        }
        
    } catch (error) {
        console.error('Chat completion error:', error.message);
        console.error('Error details:', {
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data,
            model: req.requestedModel,
            actualModel: getModelMapping(req.requestedModel) || req.requestedModel
        });
        logRequest(req, '', Date.now() - startTime, 'error');
        
        if (error.response) {
            res.status(error.response.status).json({
                error: {
                    message: error.response.data?.error || error.message,
                    type: 'server_error'
                }
            });
        } else {
            res.status(500).json({
                error: {
                    message: 'Internal server error',
                    type: 'server_error'
                }
            });
        }
    }
});

// Models endpoint - return available models for this API key
router.get('/models', validateApiKey, (req, res) => {
    const keyData = req.apiKeyData;
    const availableModels = config.getEnabledModels();
    
    let filteredModels = availableModels;
    
    // Filter models based on API key permissions
    if (!keyData.allowedModels.includes('*')) {
        filteredModels = availableModels.filter(model => 
            keyData.allowedModels.includes(model.displayName) || 
            keyData.allowedModels.includes(model.originalName)
        );
    }
    
    const openaiFormat = {
        object: 'list',
        data: filteredModels.map(model => ({
            id: model.displayName,
            object: 'model',
            created: Math.floor(new Date(model.modified).getTime() / 1000),
            owned_by: 'ollama',
            permission: [],
            root: model.displayName,
            parent: null
        }))
    };
    
    res.json(openaiFormat);
});

// Helper functions
function getModelMapping(displayName) {
    const model = config.models.find(m => m.displayName === displayName);
    return model ? model.originalName : displayName;
}

function extractReasoningPreferences(openaiRequest) {
    if (openaiRequest.reasoning !== undefined) {
        return {
            hasReasoningRequest: true,
            shouldIncludeReasoning: openaiRequest.reasoning.exclude !== true, // Only exclude if explicitly set to true
            effort: openaiRequest.reasoning.effort || 'medium'
        };
    }
    return {
        hasReasoningRequest: false,
        shouldIncludeReasoning: true, // Default to include if think: true is used
        effort: 'medium'
    };
}

async function convertToOllamaRequest(openaiRequest, model, overrides) {
    // Separate root-level parameters from options parameters
    const { think: overrideThink, ...optionsOverrides } = overrides;

    // Process messages to handle tool responses and image content
    const messages = await Promise.all(openaiRequest.messages.map(async (msg) => {
        // OpenAI sends tool responses with role: "tool"
        if (msg.role === 'tool') {
            // OpenAI format: { role: "tool", content: "result", tool_call_id: "call_123" }
            // Ollama expects similar format, so pass through
            return msg;
        }

        // Handle content that could be string or array (with text/image parts)
        if (Array.isArray(msg.content)) {
            // OpenAI multimodal format with text and/or images
            const ollamaMsg = { role: msg.role };
            let textParts = [];
            let images = [];

            for (const part of msg.content) {
                if (part.type === 'text') {
                    textParts.push(part.text);
                } else if (part.type === 'image_url') {
                    const imageUrl = part.image_url?.url || part.image_url;
                    // Extract base64 data or URL
                    if (typeof imageUrl === 'string') {
                        if (imageUrl.startsWith('data:image')) {
                            // Extract base64 from data URL
                            const base64Match = imageUrl.match(/^data:image\/[^;]+;base64,(.+)$/);
                            if (base64Match) {
                                images.push(base64Match[1]);
                            }
                        } else if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
                            // Fetch image from URL and convert to base64
                            try {
                                const imageResponse = await axios.get(imageUrl, {
                                    responseType: 'arraybuffer',
                                    timeout: 10000,
                                    maxContentLength: 10 * 1024 * 1024 // 10MB limit
                                });
                                const base64Image = Buffer.from(imageResponse.data).toString('base64');
                                images.push(base64Image);
                            } catch (error) {
                                console.error('Failed to fetch image from URL:', imageUrl, error.message);
                            }
                        } else {
                            // Assume it's already base64
                            images.push(imageUrl);
                        }
                    }
                }
            }

            // Combine text parts
            ollamaMsg.content = textParts.join('\n');

            // Add images array if we have any
            if (images.length > 0) {
                ollamaMsg.images = images;
            }

            return ollamaMsg;
        }

        // Simple string content
        return msg;
    }));

    const ollamaRequest = {
        model: model,
        messages: messages,
        stream: openaiRequest.stream || false,
        options: {
            ...optionsOverrides // Start with options overrides as base
        }
    };

    // Pass through tools if provided (both OpenAI format and Ollama format are the same)
    if (openaiRequest.tools) {
        ollamaRequest.tools = openaiRequest.tools;
    }

    // Pass through tool_choice if provided
    if (openaiRequest.tool_choice) {
        ollamaRequest.tool_choice = openaiRequest.tool_choice;
    }
    
    // Apply think parameter from overrides first (if set)
    if (overrideThink !== undefined) {
        ollamaRequest.think = overrideThink;
    }
    
    // Handle thinking/reasoning parameters from user request (user params override model defaults)
    if (openaiRequest.think !== undefined) {
        // Direct Ollama format: {"think": true/false/"low"/"medium"/"high"}
        ollamaRequest.think = openaiRequest.think;
    } else if (openaiRequest.reasoning_effort !== undefined) {
        // OpenAI reasoning_effort format: "minimal", "low", "medium", "high"
        const effort = openaiRequest.reasoning_effort;
        if (effort === "minimal") {
            // Minimal not supported in Ollama, use false
            ollamaRequest.think = false;
        } else if (["low", "medium", "high"].includes(effort)) {
            ollamaRequest.think = effort;
        } else {
            ollamaRequest.think = true; // Default fallback
        }
    } else if (openaiRequest.reasoning !== undefined) {
        // Validate no conflicting reasoning parameters
        const reasoning = openaiRequest.reasoning;
        if (reasoning.enabled !== undefined && reasoning.effort !== undefined) {
            throw new Error("Cannot specify both reasoning.enabled and reasoning.effort in the same request");
        }
        
        if (reasoning.effort !== undefined) {
            // OpenRouter reasoning.effort format
            const effort = reasoning.effort;
            if (effort === "minimal") {
                ollamaRequest.think = false;
            } else if (["low", "medium", "high"].includes(effort)) {
                ollamaRequest.think = effort;
            } else {
                ollamaRequest.think = true; // Default fallback
            }
        } else if (reasoning.enabled === false) {
            // enabled: false → disable thinking entirely
            ollamaRequest.think = false;
        } else {
            // enabled: true OR exclude: true/false → enable thinking, handle exclude in response
            ollamaRequest.think = true;
        }
    }
    
    // Map OpenAI parameters to Ollama (user params override pre-set overrides)
    if (openaiRequest.temperature !== undefined) {
        ollamaRequest.options.temperature = openaiRequest.temperature;
    }
    if (openaiRequest.max_tokens !== undefined) {
        ollamaRequest.options.num_predict = openaiRequest.max_tokens;
    }
    if (openaiRequest.top_p !== undefined) {
        ollamaRequest.options.top_p = openaiRequest.top_p;
    }
    if (openaiRequest.frequency_penalty !== undefined) {
        ollamaRequest.options.frequency_penalty = openaiRequest.frequency_penalty;
    }
    if (openaiRequest.presence_penalty !== undefined) {
        ollamaRequest.options.presence_penalty = openaiRequest.presence_penalty;
    }
    
    // Handle Ollama-specific parameters passed through (user params override pre-set overrides)
    if (openaiRequest.num_ctx !== undefined) {
        ollamaRequest.options.num_ctx = openaiRequest.num_ctx;
    }
    if (openaiRequest.num_predict !== undefined) {
        ollamaRequest.options.num_predict = openaiRequest.num_predict;
    }
    
    // Handle stream parameter (already set in main structure, but ensure consistency)
    if (openaiRequest.stream !== undefined) {
        ollamaRequest.stream = openaiRequest.stream;
    }
    
    return ollamaRequest;
}

function convertToOpenAIResponse(ollamaFinal, modelName, content, thinking, reasoningPreferences = {}) {
    const message = { role: 'assistant', content: content || '' };

    if (thinking && thinking.trim() && reasoningPreferences.shouldIncludeReasoning !== false) {
        message.reasoning_content = thinking;
    }

    if (Array.isArray(ollamaFinal?.message?.tool_calls) && ollamaFinal.message.tool_calls.length) {
        message.tool_calls = ollamaFinal.message.tool_calls.map((tc, i) => ({
            id: `call_${Date.now()}_${i}`,
            type: 'function',
            function: {
                name: tc.function?.name,
                arguments: typeof tc.function?.arguments === 'string'
                    ? tc.function.arguments
                    : JSON.stringify(tc.function?.arguments ?? {})
            }
        }));
        // OpenAI often sets content to null in tool-call turns
        if (!content) message.content = null;
    }

    const promptTokens = Number(ollamaFinal?.prompt_eval_count) || 0;
    const completionTokens = Number(ollamaFinal?.eval_count) || 0;

    return {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: modelName,
        choices: [{
            index: 0,
            message,
            finish_reason: message.tool_calls ? 'tool_calls' : 'stop'
        }],
        usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens
        }
    };
}


function logRequest(req, responseContent, responseTime, status) {
    config.addLog({
        apiKeyId: req.apiKeyData.id,
        apiKeyName: req.apiKeyData.name,
        model: req.requestedModel,
        tokens: responseContent.length,
        responseTime: responseTime,
        status: status,
        endpoint: req.path,
        userAgent: req.get('User-Agent') || '',
        ip: req.ip
    });
}

module.exports = router;