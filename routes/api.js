const express = require('express');
const axios = require('axios');
const config = require('../config/config');

const router = express.Router();

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
    const requestedModel = req.body.model || req.query.model;
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
        
        // Get model mapping from display name to actual ollama model
        const modelMapping = getModelMapping(req.requestedModel);
        const actualModel = modelMapping || req.requestedModel;
        
        // Get parameter overrides for this model
        const overrides = config.getModelOverrides(req.requestedModel);
        
        // Convert OpenAI request to Ollama format
        const ollamaRequest = convertToOllamaRequest(req.body, actualModel, overrides);
        
        // Forward request to Ollama
        const ollamaResponse = await axios.post(
            `${config.config.ollamaUrl}/api/chat`,
            ollamaRequest,
            { 
                timeout: 120000,
                responseType: 'stream'
            }
        );
        
        // Handle streaming response
        if (req.body.stream) {
            res.setHeader('Content-Type', 'text/plain');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            
            let responseContent = '';
            let thinkingContent = '';
            
            ollamaResponse.data.on('data', (chunk) => {
                try {
                    const lines = chunk.toString().split('\n').filter(line => line.trim());
                    for (const line of lines) {
                        const data = JSON.parse(line);
                        if (data.message) {
                            if (data.message.content) {
                                responseContent += data.message.content;
                            }
                            if (data.message.thinking) {
                                thinkingContent += data.message.thinking;
                            }
                        }
                        
                        // Convert to OpenAI streaming format
                        const openaiChunk = convertToOpenAIStreamResponse(data, req.requestedModel, thinkingContent);
                        res.write(`data: ${JSON.stringify(openaiChunk)}\n\n`);
                        
                        if (data.done) {
                            res.write('data: [DONE]\n\n');
                            res.end();
                            
                            // Log the request
                            logRequest(req, responseContent, Date.now() - startTime, 'success');
                        }
                    }
                } catch (err) {
                    console.error('Error processing chunk:', err);
                }
            });
            
            ollamaResponse.data.on('error', (error) => {
                console.error('Stream error:', error);
                logRequest(req, '', Date.now() - startTime, 'error');
                if (!res.headersSent) {
                    res.status(500).json({
                        error: {
                            message: 'Stream processing error',
                            type: 'server_error'
                        }
                    });
                }
            });
        } else {
            // Handle non-streaming response
            let fullResponse = '';
            let fullThinking = '';
            let responseData = {};
            
            ollamaResponse.data.on('data', (chunk) => {
                try {
                    const lines = chunk.toString().split('\n').filter(line => line.trim());
                    for (const line of lines) {
                        const data = JSON.parse(line);
                        if (data.message) {
                            if (data.message.content) {
                                fullResponse += data.message.content;
                            }
                            if (data.message.thinking) {
                                fullThinking += data.message.thinking;
                            }
                        }
                        if (data.done) {
                            responseData = data;
                        }
                    }
                } catch (err) {
                    console.error('Error processing response:', err);
                }
            });
            
            ollamaResponse.data.on('end', () => {
                const openaiResponse = convertToOpenAIResponse(responseData, req.requestedModel, fullResponse, fullThinking);
                logRequest(req, fullResponse, Date.now() - startTime, 'success');
                res.json(openaiResponse);
            });
            
            ollamaResponse.data.on('error', (error) => {
                console.error('Response error:', error);
                logRequest(req, '', Date.now() - startTime, 'error');
                res.status(500).json({
                    error: {
                        message: 'Request processing error',
                        type: 'server_error'
                    }
                });
            });
        }
        
    } catch (error) {
        console.error('Chat completion error:', error.message);
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

function convertToOllamaRequest(openaiRequest, model, overrides) {
    const ollamaRequest = {
        model: model,
        messages: openaiRequest.messages,
        stream: openaiRequest.stream || false,
        options: {
            ...overrides
        }
    };
    
    // Map OpenAI parameters to Ollama
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
    
    // Handle Ollama-specific parameters passed through
    if (openaiRequest.num_ctx !== undefined) {
        ollamaRequest.options.num_ctx = openaiRequest.num_ctx;
    }
    if (openaiRequest.think !== undefined) {
        ollamaRequest.options.think = openaiRequest.think;
    }
    if (openaiRequest.num_predict !== undefined) {
        ollamaRequest.options.num_predict = openaiRequest.num_predict;
    }
    
    return ollamaRequest;
}

function convertToOpenAIResponse(ollamaResponse, modelName, content, thinking) {
    const message = {
        role: 'assistant',
        content: content
    };
    
    // Add thinking content if present
    if (thinking && thinking.trim()) {
        message.reasoning_content = thinking;
    }
    
    return {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: modelName,
        choices: [{
            index: 0,
            message: message,
            finish_reason: ollamaResponse.done ? 'stop' : null
        }],
        usage: {
            prompt_tokens: ollamaResponse.prompt_eval_count || 0,
            completion_tokens: ollamaResponse.eval_count || 0,
            total_tokens: (ollamaResponse.prompt_eval_count || 0) + (ollamaResponse.eval_count || 0)
        }
    };
}

function convertToOpenAIStreamResponse(ollamaChunk, modelName, accumulatedThinking) {
    if (ollamaChunk.done) {
        // For the final chunk, include reasoning content if available
        const finalDelta = {};
        if (accumulatedThinking && accumulatedThinking.trim()) {
            finalDelta.reasoning_content = accumulatedThinking;
        }
        
        return {
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: modelName,
            choices: [{
                index: 0,
                delta: finalDelta,
                finish_reason: 'stop'
            }]
        };
    }
    
    const delta = {};
    
    // Add content if present
    if (ollamaChunk.message?.content) {
        delta.content = ollamaChunk.message.content;
    }
    
    // Add thinking content if present (for streaming thinking)
    if (ollamaChunk.message?.thinking) {
        delta.reasoning_content = ollamaChunk.message.thinking;
    }
    
    return {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: modelName,
        choices: [{
            index: 0,
            delta: delta,
            finish_reason: null
        }]
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