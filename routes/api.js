const express = require('express');
const axios = require('axios');
const config = require('../config/config');
const { processOptions } = require('../utils/options-warning');

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
                type: 'authentication_error',
                param: null,
                code: 'missing_api_key'
            }
        });
    }

    const apiKey = authHeader.substring(7);
    const keyData = config.findApiKey(apiKey);

    if (!keyData) {
        return res.status(401).json({
            error: {
                message: 'Invalid API key provided',
                type: 'authentication_error',
                param: null,
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
                param: 'model',
                code: 'missing_model'
            }
        });
    }

    const keyData = req.apiKeyData;
    const allowedModels = keyData.allowedModels;

    // Check if user has access to all models or specific model
    // Support both clean names (minicpm-v) and :latest variants (minicpm-v:latest)
    const hasAccess = allowedModels.includes('*') ||
                     allowedModels.includes(requestedModel) ||
                     // Check if user has access to the clean name when requesting :latest variant
                     (requestedModel.endsWith(':latest') && allowedModels.includes(requestedModel.slice(0, -7))) ||
                     // Check if user has access to the :latest variant when requesting clean name
                     (!requestedModel.includes(':') && allowedModels.includes(requestedModel + ':latest'));

    if (!hasAccess) {
        return res.status(403).json({
            error: {
                message: `Access denied for model: ${requestedModel}`,
                type: 'permission_error',
                param: 'model',
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

        const modelExists = config.models.some(m =>
            m.originalName === actualModel ||
            m.displayName === trimmedModel
        );
        if (!modelExists) {
            return res.status(404).json({
                error: {
                    message: `Model '${req.requestedModel}' does not exist`,
                    type: 'invalid_request_error',
                    param: 'model',
                    code: 'model_not_found'
                }
            });
        }

        // Convert OpenAI request to Ollama format
        const ollamaRequest = await convertToOllamaRequest(req.body, actualModel, overrides);

        const keepAlive = resolveKeepAlive({
            openaiRequest: req.body,
            overrides
        });
        if (keepAlive !== undefined) {
            ollamaRequest.keep_alive = keepAlive;
        }
        
        // Store reasoning preferences for response processing
        req.reasoningPreferences = extractReasoningPreferences(req.body, overrides);
        
        // Debug: Log the final request being sent to Ollama (remove in production)
        // console.log('Ollama Request:', JSON.stringify(ollamaRequest, null, 2));
        // console.log('Original Request body:', JSON.stringify(req.body, null, 2));
        
        // Select appropriate response type based on streaming preference
        const wantsStream = !!req.body.stream;
        const requestTimeout = resolveOpenAIRequestTimeout({
            openaiRequest: req.body,
            overrides
        });

        const ollamaResponse = await axios.post(
            `${config.config.ollamaUrl}/api/chat`,
            ollamaRequest,
            {
                timeout: requestTimeout !== undefined ? requestTimeout : 120000,
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
            let tokenUsage = {
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0
            };

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

                // Collect token usage information
                if (data.prompt_eval_count !== undefined) {
                    tokenUsage.prompt_tokens = data.prompt_eval_count;
                }
                if (data.eval_count !== undefined) {
                    tokenUsage.completion_tokens = data.eval_count;
                }
                if (tokenUsage.prompt_tokens && tokenUsage.completion_tokens) {
                    tokenUsage.total_tokens = tokenUsage.prompt_tokens + tokenUsage.completion_tokens;
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
                        }],
                        usage: {
                            prompt_tokens: tokenUsage.prompt_tokens,
                            completion_tokens: tokenUsage.completion_tokens,
                            total_tokens: tokenUsage.total_tokens
                        }
                    };
                    res.write(`data: ${JSON.stringify(fin)}\n\n`);
                    res.write('data: [DONE]\n\n');
                    logRequestWithTokens(req, responseContent, Date.now() - startTime, 'success', tokenUsage);
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
                logRequestWithTokens(req, '', Date.now() - startTime, 'error', { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
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

            const tokenUsage = {
                prompt_tokens: Number(data?.prompt_eval_count) || 0,
                completion_tokens: Number(data?.eval_count) || 0,
                total_tokens: (Number(data?.prompt_eval_count) || 0) + (Number(data?.eval_count) || 0)
            };
            logRequestWithTokens(req, fullResponse, Date.now() - startTime, 'success', tokenUsage);
            res.json(openaiResponse);
        }
        
    } catch (error) {
        console.error('Chat completion error:', error.message);
        let parsedErrorData = error.response?.data;

        // If Ollama returned a streamed error body, read it so we can surface the actual message.
        if (parsedErrorData && typeof parsedErrorData.on === 'function') {
            try {
                const bodyText = await readStreamBody(parsedErrorData);
                parsedErrorData = tryParseJson(bodyText) ?? bodyText;
                error.response.data = parsedErrorData;
                error.response.dataRaw = bodyText;
            } catch (streamErr) {
                console.warn('Failed to read error stream from Ollama:', streamErr.message);
            }
        }

        console.error('Error details:', {
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: parsedErrorData,
            model: req.requestedModel,
            actualModel: getModelMapping(req.requestedModel) || req.requestedModel
        });
        logRequestWithTokens(req, '', Date.now() - startTime, 'error', { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });

        // Enhanced OpenAI-compatible error handling
        const openaiError = createOpenAIError(error, req.requestedModel);
        res.status(openaiError.status).json({ error: openaiError.error });
    }
});

// Embeddings endpoint - OpenAI compatible embeddings
router.post('/embeddings', validateApiKey, checkModelAccess, async (req, res) => {
    const startTime = Date.now();

    try {
        // Update API key usage
        config.updateApiKeyUsage(req.apiKey);

        // Get model mapping from display name to actual ollama model
        const trimmedModel = req.requestedModel.trim();
        const modelMapping = getModelMapping(trimmedModel);
        const actualModel = (modelMapping || trimmedModel).trim();

        // Get parameter overrides for this model
        const overrides = config.getModelOverrides(trimmedModel);

        // Convert OpenAI embeddings request to Ollama format
        const ollamaRequest = convertToOllamaEmbedRequest(req.body, actualModel);

        const keepAlive = resolveKeepAlive({
            openaiRequest: req.body,
            overrides
        });
        if (keepAlive !== undefined) {
            ollamaRequest.keep_alive = keepAlive;
        }

        const requestTimeout = resolveOpenAIRequestTimeout({
            openaiRequest: req.body,
            overrides
        });

        // Make request to Ollama
        const ollamaResponse = await axios.post(
            `${config.config.ollamaUrl}/api/embed`,
            ollamaRequest,
            {
                timeout: requestTimeout !== undefined ? requestTimeout : 120000,
                responseType: 'json'
            }
        );

        const data = ollamaResponse.data;
        const openaiResponse = convertToOpenAIEmbeddingResponse(data, req.requestedModel);

        logRequestWithTokens(req, '', Date.now() - startTime, 'success', {
            prompt_tokens: data.prompt_eval_count || 0,
            completion_tokens: 0,
            total_tokens: data.prompt_eval_count || 0
        });

        res.json(openaiResponse);

    } catch (error) {
        console.error('Embeddings error:', error.message);
        logRequestWithTokens(req, '', Date.now() - startTime, 'error', { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });

        // Enhanced OpenAI-compatible error handling
        const openaiError = createOpenAIError(error, req.requestedModel);
        res.status(openaiError.status).json({ error: openaiError.error });
    }
});

// Models endpoint - return available models for this API key
router.get('/models', validateApiKey, (req, res) => {
    const keyData = req.apiKeyData;
    const availableModels = config.getEnabledModels();
    
    let filteredModels = availableModels;
    
    // Filter models based on API key permissions
    if (!keyData.allowedModels.includes('*')) {
        filteredModels = availableModels.filter(model => {
            const allowedModels = keyData.allowedModels;
            return allowedModels.includes(model.displayName) ||
                   allowedModels.includes(model.originalName) ||
                   // Allow access if user has permission for the :latest variant but model shows clean name
                   (model.originalName.endsWith(':latest') && allowedModels.includes(model.originalName.slice(0, -7))) ||
                   // Allow access if user has permission for clean name but checking :latest variant
                   (allowedModels.some(allowed => allowed + ':latest' === model.originalName));
        });
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
function getModelMapping(requestedName) {
    // First try exact match with displayName
    let model = config.models.find(m => m.displayName === requestedName);

    // If no match and requested name doesn't end with :latest, try adding :latest
    if (!model && !requestedName.includes(':')) {
        model = config.models.find(m => m.originalName === requestedName + ':latest');
    }

    // If still no match, try exact match with originalName
    if (!model) {
        model = config.models.find(m => m.originalName === requestedName);
    }

    return model ? model.originalName : requestedName;
}

function parseBoolean(value) {
    if (value === undefined || value === null) {
        return undefined;
    }
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'on'].includes(normalized)) {
            return true;
        }
        if (['false', '0', 'no', 'off'].includes(normalized)) {
            return false;
        }
    }
    return Boolean(value);
}

function extractReasoningPreferences(openaiRequest, overrides = {}) {
    const overrideExclude = parseBoolean(overrides.exclude_reasoning);

    if (openaiRequest.reasoning !== undefined) {
        return {
            hasReasoningRequest: true,
            shouldIncludeReasoning: openaiRequest.reasoning.exclude !== true,
            effort: openaiRequest.reasoning.effort || 'medium'
        };
    }

    const requestExclude = parseBoolean(openaiRequest.exclude_reasoning);
    if (requestExclude !== undefined) {
        return {
            hasReasoningRequest: true,
            shouldIncludeReasoning: !requestExclude,
            effort: 'medium'
        };
    }

    if (overrideExclude !== undefined) {
        return {
            hasReasoningRequest: false,
            shouldIncludeReasoning: !overrideExclude,
            effort: 'medium'
        };
    }

    return {
        hasReasoningRequest: false,
        shouldIncludeReasoning: true,
        effort: 'medium'
    };
}

async function convertToOllamaRequest(openaiRequest, model, overrides) {
    // Separate root-level parameters from options parameters
    const {
        think: overrideThink,
        exclude_reasoning: _excludeReasoningOverride,
        keep_alive: _overrideKeepAlive,
        keepAlive: _overrideKeepAliveCamel,
        ...rawOptionsOverrides
    } = overrides || {};

    const allowUnverified = config.config.allowUnverifiedOptions !== false;

    const overrideOptionsResult = processOptions(
        rawOptionsOverrides,
        'model override options',
        { model, route: 'openai/chat' },
        allowUnverified
    );
    const requestOptionsResult = processOptions(
        openaiRequest.options,
        'OpenAI request.options',
        { model, route: 'openai/chat' },
        allowUnverified
    );
    const extraOptionsResult = processOptions(
        openaiRequest.extra_body?.options,
        'OpenAI request.extra_body.options',
        { model, route: 'openai/chat' },
        allowUnverified
    );

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

    const optionsPayload = {};

    mergePlainObject(optionsPayload, overrideOptionsResult.sanitized);
    mergePlainObject(optionsPayload, extraOptionsResult.sanitized);
    mergePlainObject(optionsPayload, requestOptionsResult.sanitized);

    const ollamaRequest = {
        model: model,
        messages: messages,
        stream: openaiRequest.stream || false,
        options: optionsPayload
    };

    // Pass through tools if provided (both OpenAI format and Ollama format are the same)
    if (openaiRequest.tools) {
        ollamaRequest.tools = openaiRequest.tools;
    }

    // Pass through tool_choice if provided
    if (openaiRequest.tool_choice) {
        ollamaRequest.tool_choice = openaiRequest.tool_choice;
    }

    // Handle response_format for JSON mode
    if (openaiRequest.response_format?.type === 'json_object') {
        ollamaRequest.format = 'json';
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

function resolveOpenAIRequestTimeout({ openaiRequest, overrides }) {
    const candidateTimeouts = [
        openaiRequest?.timeout,
        openaiRequest?.timeout_ms,
        openaiRequest?.timeoutMs,
        openaiRequest?.request_timeout,
        openaiRequest?.requestTimeout,
        openaiRequest?.metadata?.timeout,
        openaiRequest?.metadata?.timeout_ms,
        openaiRequest?.metadata?.timeoutMs,
        openaiRequest?.metadata?.request_timeout,
        openaiRequest?.metadata?.requestTimeout,
        openaiRequest?.extra_body?.timeout,
        openaiRequest?.extra_body?.timeout_ms,
        openaiRequest?.extra_body?.timeoutMs,
        openaiRequest?.extra_body?.request_timeout,
        openaiRequest?.extra_body?.requestTimeout,
        overrides?.timeout,
        overrides?.timeout_ms,
        overrides?.timeoutMs,
        overrides?.request_timeout,
        overrides?.requestTimeout,
        config.config?.requestTimeout
    ];

    for (const value of candidateTimeouts) {
        const normalized = normalizeTimeoutValue(value);
        if (normalized !== undefined) {
            return normalized;
        }
    }

    return undefined;
}

function resolveKeepAlive({ openaiRequest, overrides }) {
    const candidateValues = [
        openaiRequest?.keep_alive,
        openaiRequest?.keepAlive,
        openaiRequest?.metadata?.keep_alive,
        openaiRequest?.metadata?.keepAlive,
        openaiRequest?.extra_body?.keep_alive,
        openaiRequest?.extra_body?.keepAlive,
        overrides?.keep_alive,
        overrides?.keepAlive
    ];

    for (const value of candidateValues) {
        if (value === undefined || value === null) {
            continue;
        }

        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (trimmed === '') {
                continue;
            }
            return trimmed;
        }

        return value;
    }

    return undefined;
}

function mergePlainObject(target, source) {
    if (!target || !source) {
        return;
    }
    if (typeof source !== 'object' || Array.isArray(source)) {
        return;
    }
    Object.assign(target, source);
}

function normalizeTimeoutValue(value) {
    if (value === undefined || value === null) {
        return undefined;
    }

    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return undefined;
    }

    if (numeric <= 0) {
        return 0;
    }

    return numeric;
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


function createOpenAIError(error, model) {
    // Handle specific error types with OpenAI-compatible error codes
    if (error.response) {
        const status = error.response.status;
        const data = error.response.data;
        const errorMessage = extractOllamaErrorMessage(data, error.message || 'Bad request');

        switch (status) {
            case 400:
                if (errorMessage?.includes('model') || errorMessage?.includes('not found')) {
                    return {
                        status: 404,
                        error: {
                            message: `Model '${model}' does not exist`,
                            type: 'invalid_request_error',
                            param: 'model',
                            code: 'model_not_found'
                        }
                    };
                }
                return {
                    status: 400,
                    error: {
                        message: errorMessage,
                        type: 'invalid_request_error',
                        param: null,
                        code: 'invalid_request'
                    }
                };
            case 401:
                return {
                    status: 401,
                    error: {
                        message: 'Unauthorized access to Ollama server',
                        type: 'authentication_error',
                        param: null,
                        code: 'unauthorized'
                    }
                };
            case 404:
                if (data?.error?.includes('model') || error.message?.includes('model')) {
                    return {
                        status: 404,
                        error: {
                            message: `Model '${model}' does not exist`,
                            type: 'invalid_request_error',
                            param: 'model',
                            code: 'model_not_found'
                        }
                    };
                }
                return {
                    status: 404,
                    error: {
                        message: 'Ollama endpoint not found',
                        type: 'invalid_request_error',
                        param: null,
                        code: 'not_found'
                    }
                };
            case 429:
                return {
                    status: 429,
                    error: {
                        message: 'Rate limit exceeded',
                        type: 'rate_limit_error',
                        param: null,
                        code: 'rate_limit_exceeded'
                    }
                };
            case 500:
            case 502:
            case 503:
            case 504:
                return {
                    status: 500,
                    error: {
                        message: 'Ollama server error',
                        type: 'server_error',
                        param: null,
                        code: 'server_error'
                    }
                };
            default:
                return {
                    status: status,
                    error: {
                        message: errorMessage,
                        type: 'server_error',
                        param: null,
                        code: 'unknown_error'
                    }
                };
        }
    }

    // Handle network/connection errors
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        return {
            status: 503,
            error: {
                message: 'Cannot connect to Ollama server',
                type: 'service_unavailable_error',
                param: null,
                code: 'service_unavailable'
            }
        };
    }

    if (error.code === 'ETIMEDOUT' || error.message?.includes('timeout')) {
        return {
            status: 504,
            error: {
                message: 'Request timeout - Ollama server took too long to respond',
                type: 'timeout_error',
                param: null,
                code: 'timeout'
            }
        };
    }

    // Generic error fallback
    return {
        status: 500,
        error: {
            message: error.message || 'Internal server error',
            type: 'server_error',
            param: null,
            code: 'internal_error'
        }
    };
}

async function readStreamBody(stream) {
    return await new Promise((resolve, reject) => {
        const chunks = [];
        stream.setEncoding('utf8');
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('end', () => resolve(chunks.join('')));
        stream.on('error', reject);
    });
}

function tryParseJson(text) {
    if (typeof text !== 'string') return text;
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function extractOllamaErrorMessage(data, fallback = 'Invalid request') {
    if (!data) return fallback;
    if (typeof data === 'string') return data;
    if (typeof data.error === 'string') return data.error;
    if (data.error && typeof data.error.message === 'string') return data.error.message;
    if (typeof data.message === 'string') return data.message;
    return fallback;
}

function convertToOllamaEmbedRequest(openaiRequest, model) {
    // Handle input validation similar to Ollama's EmbeddingsMiddleware
    let input = openaiRequest.input;

    if (input === "" || input === undefined || input === null) {
        input = [""];
    }

    if (input === null || (Array.isArray(input) && input.length === 0)) {
        throw new Error("invalid input");
    }

    return {
        model: model,
        input: input,
        // Ollama supports dimensions parameter for some models
        ...(openaiRequest.dimensions && { dimensions: openaiRequest.dimensions })
    };
}

function convertToOpenAIEmbeddingResponse(ollamaResponse, modelName) {
    // Based on Ollama's toEmbeddingList function
    const embeddings = ollamaResponse.embeddings || ollamaResponse.embedding;

    if (!embeddings) {
        return {
            object: "list",
            data: [],
            model: modelName,
            usage: {
                prompt_tokens: ollamaResponse.prompt_eval_count || 0,
                total_tokens: ollamaResponse.prompt_eval_count || 0
            }
        };
    }

    let data = [];

    // Handle both single embedding and multiple embeddings
    if (Array.isArray(embeddings[0])) {
        // Multiple embeddings
        data = embeddings.map((embedding, index) => ({
            object: "embedding",
            embedding: embedding,
            index: index
        }));
    } else {
        // Single embedding
        data = [{
            object: "embedding",
            embedding: embeddings,
            index: 0
        }];
    }

    return {
        object: "list",
        data: data,
        model: modelName,
        usage: {
            prompt_tokens: ollamaResponse.prompt_eval_count || 0,
            total_tokens: ollamaResponse.prompt_eval_count || 0
        }
    };
}

function logRequestWithTokens(req, responseContent, responseTime, status, tokenUsage) {
    config.addLog({
        apiKeyId: req.apiKeyData.id,
        apiKeyName: req.apiKeyData.name,
        model: req.requestedModel,
        tokens: tokenUsage.total_tokens || responseContent.length, // Fallback to content length if no token count
        promptTokens: tokenUsage.prompt_tokens || 0,
        completionTokens: tokenUsage.completion_tokens || 0,
        responseTime: responseTime,
        status: status,
        endpoint: req.path,
        userAgent: req.get('User-Agent') || '',
        ip: req.ip
    });
}

// Legacy function for backwards compatibility
function logRequest(req, responseContent, responseTime, status) {
    logRequestWithTokens(req, responseContent, responseTime, status, {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: responseContent.length
    });
}

module.exports = router;
