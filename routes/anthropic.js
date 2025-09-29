const express = require('express');
const axios = require('axios');
const config = require('../config/config');

const router = express.Router();

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
            } catch (error) {
                buffer = line + '\n' + buffer;
                break;
            }
        }
    };
}

const validateApiKey = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            type: 'error',
            error: {
                type: 'authentication_error',
                message: 'You must provide a valid API key',
                param: null,
                code: 'missing_api_key'
            }
        });
    }

    const apiKey = authHeader.substring(7);
    const keyData = config.findApiKey(apiKey);

    if (!keyData) {
        return res.status(401).json({
            type: 'error',
            error: {
                type: 'authentication_error',
                message: 'Invalid API key provided',
                param: null,
                code: 'invalid_api_key'
            }
        });
    }

    req.apiKeyData = keyData;
    req.apiKey = apiKey;
    next();
};

const checkModelAccess = (req, res, next) => {
    const requestedModel = (req.body.model || req.query.model || '').trim();
    if (!requestedModel) {
        return res.status(400).json({
            type: 'error',
            error: {
                type: 'invalid_request_error',
                message: 'No model specified',
                param: 'model',
                code: 'missing_model'
            }
        });
    }

    const keyData = req.apiKeyData;
    const allowedModels = keyData.allowedModels;

    const hasAccess = allowedModels.includes('*') ||
                     allowedModels.includes(requestedModel) ||
                     (requestedModel.endsWith(':latest') && allowedModels.includes(requestedModel.slice(0, -7))) ||
                     (!requestedModel.includes(':') && allowedModels.includes(requestedModel + ':latest'));

    if (!hasAccess) {
        return res.status(403).json({
            type: 'error',
            error: {
                type: 'permission_error',
                message: `Access denied for model: ${requestedModel}`,
                param: 'model',
                code: 'model_access_denied'
            }
        });
    }

    req.requestedModel = requestedModel;
    next();
};

router.post('/messages', validateApiKey, checkModelAccess, async (req, res) => {
    const startTime = Date.now();

    if (!Array.isArray(req.body?.messages)) {
        return res.status(400).json({
            type: 'error',
            error: {
                type: 'invalid_request_error',
                message: 'The request body must include a messages array',
                param: 'messages',
                code: 'missing_messages'
            }
        });
    }

    const anthropicVersion = req.headers['anthropic-version'] || '2023-06-01';
    res.setHeader('Anthropic-Version', anthropicVersion);

    try {
        config.updateApiKeyUsage(req.apiKey);

        const trimmedModel = req.requestedModel.trim();
        const modelMapping = getModelMapping(trimmedModel);
        const actualModel = (modelMapping || trimmedModel).trim();
        const overrides = config.getModelOverrides(trimmedModel);

        const ollamaRequest = await convertAnthropicToOllamaRequest(req.body, actualModel, overrides);
        const wantsStream = req.body.stream === true || req.body.stream === 'true';

        const requestTimeout = resolveRequestTimeout({
            wantsStream,
            overrides,
            anthropicRequest: req.body
        });

        const ollamaResponse = await axios.post(
            `${config.config.ollamaUrl}/api/chat`,
            ollamaRequest,
            {
                timeout: requestTimeout,
                responseType: wantsStream ? 'stream' : 'json'
            }
        );

        if (wantsStream) {
            handleStreamingAnthropicResponse({
                req,
                res,
                ollamaStream: ollamaResponse.data,
                startTime,
                requestedModel: req.requestedModel
            });
        } else {
            const data = ollamaResponse.data;
            const responseContent = data?.message?.content || '';
            const thinkingContent = data?.message?.thinking || '';
            const toolCalls = Array.isArray(data?.message?.tool_calls) ? data.message.tool_calls : [];

            const anthropicResponse = convertOllamaToAnthropicResponse(
                data,
                req.requestedModel,
                responseContent,
                thinkingContent,
                toolCalls
            );

            const tokenUsage = {
                prompt_tokens: Number(data?.prompt_eval_count) || 0,
                completion_tokens: Number(data?.eval_count) || 0,
                total_tokens: (Number(data?.prompt_eval_count) || 0) + (Number(data?.eval_count) || 0)
            };

            logRequestWithTokens(req, responseContent, Date.now() - startTime, 'success', tokenUsage);

            res.json(anthropicResponse);
        }
    } catch (error) {
        console.error('Anthropic endpoint error:', error.message);
        console.error('Error details:', {
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data,
            model: req.requestedModel
        });

        logRequestWithTokens(req, '', Date.now() - startTime, 'error', {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0
        });

        const anthropicError = createAnthropicError(error, req.requestedModel);
        res.status(anthropicError.status).json({ type: 'error', error: anthropicError.error });
    }
});

function handleStreamingAnthropicResponse({ req, res, ollamaStream, startTime, requestedModel }) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const messageId = `msg_${Date.now()}`;
    const sendEvent = (event, payload) => {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    sendEvent('message_start', {
        type: 'message_start',
        message: {
            id: messageId,
            type: 'message',
            role: 'assistant',
            model: requestedModel
        }
    });

    let responseContent = '';
    let thinkingContent = '';
    let toolCalls = [];
    let promptTokens = 0;
    let completionTokens = 0;
    let nextContentIndex = 0;
    let thinkingBlockIndex = null;
    let textBlockIndex = null;
    let thinkingBlockOpen = false;
    let thinkingBlockStarted = false;
    let textBlockOpen = false;
    let textBlockStarted = false;

    const ensureThinkingBlock = () => {
        if (!thinkingBlockStarted) {
            thinkingBlockIndex = nextContentIndex++;
            sendEvent('content_block_start', {
                type: 'content_block_start',
                index: thinkingBlockIndex,
                content_block: {
                    type: 'thinking',
                    thinking: ''
                }
            });
            thinkingBlockOpen = true;
            thinkingBlockStarted = true;
        }
    };

    const ensureTextBlock = () => {
        if (!textBlockStarted) {
            textBlockIndex = nextContentIndex++;
            sendEvent('content_block_start', {
                type: 'content_block_start',
                index: textBlockIndex,
                content_block: {
                    type: 'text',
                    text: ''
                }
            });
            textBlockOpen = true;
            textBlockStarted = true;
        }
    };

    const closeThinkingBlock = () => {
        if (thinkingBlockOpen) {
            sendEvent('content_block_stop', {
                type: 'content_block_stop',
                index: thinkingBlockIndex
            });
            thinkingBlockOpen = false;
        }
    };

    const closeTextBlock = () => {
        if (textBlockOpen) {
            sendEvent('content_block_stop', {
                type: 'content_block_stop',
                index: textBlockIndex
            });
            textBlockOpen = false;
        }
    };

    const parser = createNdjsonParser((data) => {
        if (data.message?.content) {
            responseContent += data.message.content;
            if (data.message.content) {
                ensureTextBlock();
                sendEvent('content_block_delta', {
                    type: 'content_block_delta',
                    index: textBlockIndex,
                    delta: {
                        type: 'text_delta',
                        text: data.message.content
                    }
                });
            }
        }

        if (data.message?.thinking) {
            thinkingContent += data.message.thinking;
            if (data.message.thinking) {
                ensureThinkingBlock();
                sendEvent('content_block_delta', {
                    type: 'content_block_delta',
                    index: thinkingBlockIndex,
                    delta: {
                        type: 'thinking_delta',
                        thinking: data.message.thinking
                    }
                });
            }
        }

        if (data.message?.signature) {
            ensureThinkingBlock();
            sendEvent('content_block_delta', {
                type: 'content_block_delta',
                index: thinkingBlockIndex,
                delta: {
                    type: 'signature_delta',
                    signature: data.message.signature
                }
            });
        }

        if (Array.isArray(data.message?.tool_calls) && data.message.tool_calls.length) {
            toolCalls = data.message.tool_calls;
        }

        if (data.prompt_eval_count !== undefined) {
            promptTokens = data.prompt_eval_count;
        }
        if (data.eval_count !== undefined) {
            completionTokens = data.eval_count;
        }

        if (data.done) {
            if (thinkingBlockOpen) {
                closeThinkingBlock();
            }

            if (textBlockOpen) {
                closeTextBlock();
            }

            if (toolCalls.length) {
                toolCalls.forEach((toolCall, idx) => {
                    const blockIndex = nextContentIndex++;
                    const toolUsePayload = convertToolCallToAnthropicBlock(toolCall, idx);
                    sendEvent('content_block_start', {
                        type: 'content_block_start',
                        index: blockIndex,
                        content_block: toolUsePayload
                    });
                    sendEvent('content_block_stop', {
                        type: 'content_block_stop',
                        index: blockIndex
                    });
                });
            }

            const deltaPayload = {
                type: 'message_delta',
                delta: {
                    stop_reason: toolCalls.length ? 'tool_use' : 'end_turn',
                    stop_sequence: null
                },
                usage: {
                    input_tokens: promptTokens,
                    output_tokens: completionTokens
                }
            };

            sendEvent('message_delta', deltaPayload);
            sendEvent('message_stop', { type: 'message_stop' });
            sendEvent('done', { type: 'done' });

            logRequestWithTokens(req, responseContent, Date.now() - startTime, 'success', {
                prompt_tokens: promptTokens || 0,
                completion_tokens: completionTokens || 0,
                total_tokens: (promptTokens || 0) + (completionTokens || 0)
            });

            res.end();
        }
    });

    ollamaStream.on('data', parser);
    ollamaStream.on('error', (err) => {
        console.error('Anthropic stream error:', err);
        if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'text/event-stream; charset=utf-8' });
            sendEvent('error', {
                type: 'error',
                error: {
                    type: 'server_error',
                    message: 'Stream processing error'
                }
            });
        }
        res.end();
        logRequestWithTokens(req, '', Date.now() - startTime, 'error', {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0
        });
    });

    req.on('close', () => {
        try { ollamaStream?.destroy(); } catch (error) {}
    });
}

async function convertAnthropicToOllamaRequest(anthropicRequest, model, overrides) {
    const { think: overrideThink, ...rawOverrides } = overrides || {};
    const {
        timeout,
        timeout_ms,
        timeoutMs,
        request_timeout,
        requestTimeout,
        ...optionsOverrides
    } = rawOverrides;

    const messages = [];

    if (anthropicRequest.system) {
        const systemContent = await convertSystemPrompt(anthropicRequest.system);
        if (systemContent) {
            messages.push({ role: 'system', content: systemContent });
        }
    }

    for (const message of anthropicRequest.messages) {
        const converted = await convertAnthropicMessage(message);
        converted.forEach(convertedMessage => {
            if (convertedMessage.content !== undefined || convertedMessage.images || convertedMessage.tool_calls) {
                messages.push(convertedMessage);
            }
        });
    }

    const request = {
        model: model,
        messages: messages,
        stream: anthropicRequest.stream === true || anthropicRequest.stream === 'true',
        options: {
            ...optionsOverrides
        }
    };

    const transformedTools = transformAnthropicToolsToOpenAI(anthropicRequest.tools);
    if (transformedTools) {
        request.tools = transformedTools;
    }

    const toolChoice = transformAnthropicToolChoice(anthropicRequest.tool_choice);
    if (toolChoice) {
        request.tool_choice = toolChoice;
    }

    if (overrideThink !== undefined) {
        request.think = overrideThink;
    }

    const requestedThink = extractAnthropicThinkingPreference(anthropicRequest);
    if (requestedThink !== undefined) {
        request.think = requestedThink;
    }

    if (anthropicRequest.response_format?.type === 'json') {
        request.format = 'json';
    }

    if (anthropicRequest.temperature !== undefined) {
        request.options.temperature = anthropicRequest.temperature;
    }
    if (anthropicRequest.max_tokens !== undefined) {
        request.options.num_predict = anthropicRequest.max_tokens;
    }
    if (anthropicRequest.max_output_tokens !== undefined) {
        request.options.num_predict = anthropicRequest.max_output_tokens;
    }
    if (anthropicRequest.top_p !== undefined) {
        request.options.top_p = anthropicRequest.top_p;
    }
    if (anthropicRequest.top_k !== undefined) {
        request.options.top_k = anthropicRequest.top_k;
    }
    if (anthropicRequest.presence_penalty !== undefined) {
        request.options.presence_penalty = anthropicRequest.presence_penalty;
    }
    if (anthropicRequest.frequency_penalty !== undefined) {
        request.options.frequency_penalty = anthropicRequest.frequency_penalty;
    }
    if (Array.isArray(anthropicRequest.stop_sequences) && anthropicRequest.stop_sequences.length) {
        request.options.stop = anthropicRequest.stop_sequences;
    }

    if (anthropicRequest.extra_body?.ollama_options && typeof anthropicRequest.extra_body.ollama_options === 'object') {
        Object.assign(request.options, anthropicRequest.extra_body.ollama_options);
    }

    if (anthropicRequest.extra_body && typeof anthropicRequest.extra_body === 'object') {
        const passthrough = { ...anthropicRequest.extra_body };
        delete passthrough.think;
        delete passthrough.tool_choice;
        delete passthrough.ollama_options;

        if (Object.keys(passthrough).length) {
            Object.assign(request.options, passthrough);
        }
    }

    if (anthropicRequest.metadata?.user_id) {
        request.options.user = anthropicRequest.metadata.user_id;
    }

    return request;
}

async function convertSystemPrompt(systemPrompt) {
    if (typeof systemPrompt === 'string') {
        return systemPrompt;
    }

    if (Array.isArray(systemPrompt)) {
        const textParts = [];
        for (const part of systemPrompt) {
            if (typeof part === 'string') {
                textParts.push(part);
            } else if (part?.type === 'text') {
                textParts.push(part.text || '');
            }
        }
        return textParts.join('\n');
    }

    return undefined;
}

async function convertAnthropicMessage(message) {
    const parts = Array.isArray(message.content) ? message.content : [{ type: 'text', text: message.content }];
    const textParts = [];
    const images = [];
    const toolCalls = [];
    const extraMessages = [];

    for (const part of parts) {
        const handled = await convertAnthropicContentPart(part);
        if (!handled) {
            continue;
        }

        if (handled.type === 'text') {
            textParts.push(handled.value);
        } else if (handled.type === 'image') {
            images.push(handled.value);
        } else if (handled.type === 'tool_call') {
            toolCalls.push(handled.value);
        } else if (handled.type === 'tool_result') {
            extraMessages.push(handled.value);
        }
    }

    const baseMessage = {
        role: message.role,
        content: textParts.join('\n')
    };

    if (images.length) {
        baseMessage.images = images;
    }

    if (toolCalls.length) {
        baseMessage.tool_calls = toolCalls;
    }

    const results = [];

    if (baseMessage.content || images.length || toolCalls.length || message.role !== 'user') {
        results.push(baseMessage);
    }

    extraMessages.forEach(extra => results.push(extra));

    return results;
}

function resolveRequestTimeout({ wantsStream, overrides, anthropicRequest }) {
    const candidateTimeouts = [
        overrides && overrides.timeout,
        overrides && overrides.timeout_ms,
        overrides && overrides.timeoutMs,
        overrides && overrides.request_timeout,
        overrides && overrides.requestTimeout,
        anthropicRequest?.timeout_ms,
        anthropicRequest?.timeoutMs,
        anthropicRequest?.timeout,
        anthropicRequest?.request_timeout,
        anthropicRequest?.requestTimeout,
        anthropicRequest?.metadata?.timeout_ms,
        anthropicRequest?.metadata?.timeoutMs,
        anthropicRequest?.metadata?.timeout,
        anthropicRequest?.metadata?.request_timeout,
        anthropicRequest?.metadata?.requestTimeout,
        anthropicRequest?.extra_body?.timeout_ms,
        anthropicRequest?.extra_body?.timeoutMs,
        anthropicRequest?.extra_body?.timeout,
        anthropicRequest?.extra_body?.request_timeout,
        anthropicRequest?.extra_body?.requestTimeout,
        config.config?.requestTimeout
    ];

    for (const value of candidateTimeouts) {
        const normalized = normalizeTimeoutValue(value);
        if (normalized !== undefined) {
            return normalized;
        }
    }

    return 0;
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

async function convertAnthropicContentPart(part) {
    if (!part) {
        return null;
    }

    if (part.type === 'text') {
        return { type: 'text', value: part.text || '' };
    }

    if (part.type === 'tool_use') {
        return {
            type: 'tool_call',
            value: {
                id: part.id || `call_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
                type: 'function',
                function: {
                    name: part.name || 'tool',
                    arguments: part.input || {}
                }
            }
        };
    }

    if (part.type === 'tool_result') {
        const content = Array.isArray(part.content)
            ? part.content.map(item => item.text || '').join('\n')
            : (typeof part.content === 'string'
                ? part.content
                : JSON.stringify(part.content || {}));

        return {
            type: 'tool_result',
            value: {
                role: 'tool',
                content: content,
                tool_call_id: part.tool_use_id || part.id
            }
        };
    }

    if (part.type === 'image' || part.type === 'input_image') {
        const image = await extractAnthropicImage(part);
        if (image) {
            return { type: 'image', value: image };
        }
    }

    return null;
}

async function extractAnthropicImage(part) {
    const source = part.source || part;
    if (!source) {
        return null;
    }

    if (source.type === 'base64') {
        return source.data;
    }

    if (source.type === 'url' && source.url) {
        try {
            const response = await axios.get(source.url, {
                responseType: 'arraybuffer',
                timeout: 10000,
                maxContentLength: 10 * 1024 * 1024
            });
            return Buffer.from(response.data).toString('base64');
        } catch (error) {
            console.error('Failed to fetch image for anthropic request:', source.url, error.message);
        }
    }

    if (source.data) {
        return source.data;
    }

    return null;
}

function transformAnthropicToolsToOpenAI(tools) {
    if (!Array.isArray(tools)) {
        return undefined;
    }

    return tools.map(tool => ({
        type: 'function',
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.input_schema || tool.parameters || {}
        }
    }));
}

function transformAnthropicToolChoice(toolChoice) {
    if (!toolChoice) {
        return undefined;
    }

    if (toolChoice === 'auto' || toolChoice === 'any') {
        return 'auto';
    }

    if (toolChoice === 'none') {
        return 'none';
    }

    if (typeof toolChoice === 'object' && toolChoice.type === 'tool' && toolChoice.name) {
        return {
            type: 'function',
            function: {
                name: toolChoice.name
            }
        };
    }

    return undefined;
}

function extractAnthropicThinkingPreference(request) {
    if (request.thinking !== undefined) {
        return mapThinkingValue(request.thinking);
    }

    if (request.extra_body && request.extra_body.think !== undefined) {
        return mapThinkingValue(request.extra_body.think);
    }

    return undefined;
}

function mapThinkingValue(value) {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'string') {
        const normalized = value.toLowerCase();
        if (['low', 'medium', 'high'].includes(normalized)) {
            return normalized;
        }
        if (normalized === 'minimal') {
            return false;
        }
    }

    return undefined;
}

function convertOllamaToAnthropicResponse(ollamaFinal, modelName, content, thinking, toolCalls) {
    const promptTokens = Number(ollamaFinal?.prompt_eval_count) || 0;
    const completionTokens = Number(ollamaFinal?.eval_count) || 0;

    const contentBlocks = [];

    if (content && content.length) {
        contentBlocks.push({
            type: 'text',
            text: content
        });
    }

    if (Array.isArray(toolCalls) && toolCalls.length) {
        toolCalls.forEach((toolCall, idx) => {
            contentBlocks.push(convertToolCallToAnthropicBlock(toolCall, idx));
        });
    }

    if (thinking && thinking.trim()) {
        contentBlocks.unshift({
            type: 'thinking',
            thinking: thinking
        });
    }

    const response = {
        id: `msg_${Date.now()}`,
        type: 'message',
        role: 'assistant',
        model: modelName,
        content: contentBlocks,
        stop_reason: Array.isArray(toolCalls) && toolCalls.length ? 'tool_use' : 'end_turn',
        stop_sequence: null,
        usage: {
            input_tokens: promptTokens,
            output_tokens: completionTokens
        }
    };

    return response;
}

function convertToolCallToAnthropicBlock(toolCall, index) {
    return {
        type: 'tool_use',
        id: toolCall.id || `toolu_${Date.now()}_${index}`,
        name: toolCall.function?.name || 'function',
        input: safeJsonParse(toolCall.function?.arguments) || toolCall.function?.arguments || {}
    };
}

function safeJsonParse(value) {
    if (typeof value !== 'string') {
        return value || null;
    }

    try {
        return JSON.parse(value);
    } catch (error) {
        return null;
    }
}

function getModelMapping(requestedName) {
    let model = config.models.find(m => m.displayName === requestedName);

    if (!model && !requestedName.includes(':')) {
        model = config.models.find(m => m.originalName === requestedName + ':latest');
    }

    if (!model) {
        model = config.models.find(m => m.originalName === requestedName);
    }

    return model ? model.originalName : requestedName;
}

function logRequestWithTokens(req, responseContent, responseTime, status, tokenUsage) {
    if (!req.apiKeyData) {
        return;
    }

    config.addLog({
        apiKeyId: req.apiKeyData.id,
        apiKeyName: req.apiKeyData.name,
        model: req.requestedModel,
        tokens: tokenUsage.total_tokens || responseContent.length,
        promptTokens: tokenUsage.prompt_tokens || 0,
        completionTokens: tokenUsage.completion_tokens || 0,
        responseTime: responseTime,
        status: status,
        endpoint: req.path,
        userAgent: req.get('User-Agent') || '',
        ip: req.ip
    });
}

function createAnthropicError(error, model) {
    if (error.response) {
        const status = error.response.status;
        const data = error.response.data;

        switch (status) {
            case 400:
                return {
                    status: 400,
                    error: {
                        type: 'invalid_request_error',
                        message: data?.error?.message || 'Invalid request',
                        param: data?.error?.param || null,
                        code: data?.error?.code || 'invalid_request'
                    }
                };
            case 401:
                return {
                    status: 401,
                    error: {
                        type: 'authentication_error',
                        message: 'Invalid credentials provided to Ollama',
                        param: null,
                        code: 'invalid_api_key'
                    }
                };
            case 403:
                return {
                    status: 403,
                    error: {
                        type: 'permission_error',
                        message: 'Ollama denied the request',
                        param: null,
                        code: 'forbidden'
                    }
                };
            case 404:
                if (data?.error?.includes('model') || error.message?.includes('model')) {
                    return {
                        status: 404,
                        error: {
                            type: 'invalid_request_error',
                            message: `Model '${model}' does not exist`,
                            param: 'model',
                            code: 'model_not_found'
                        }
                    };
                }
                return {
                    status: 404,
                    error: {
                        type: 'invalid_request_error',
                        message: 'Ollama endpoint not found',
                        param: null,
                        code: 'not_found'
                    }
                };
            case 429:
                return {
                    status: 429,
                    error: {
                        type: 'rate_limit_error',
                        message: 'Rate limit exceeded',
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
                        type: 'server_error',
                        message: 'Ollama server error',
                        param: null,
                        code: 'server_error'
                    }
                };
            default:
                return {
                    status: status,
                    error: {
                        type: 'server_error',
                        message: data?.error || error.message || 'Unknown error',
                        param: null,
                        code: 'unknown_error'
                    }
                };
        }
    }

    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        return {
            status: 503,
            error: {
                type: 'service_unavailable_error',
                message: 'Cannot connect to Ollama server',
                param: null,
                code: 'service_unavailable'
            }
        };
    }

    if (error.code === 'ETIMEDOUT' || error.message?.includes('timeout')) {
        return {
            status: 504,
            error: {
                type: 'timeout_error',
                message: 'Request timeout - Ollama server took too long to respond',
                param: null,
                code: 'timeout'
            }
        };
    }

    return {
        status: 500,
        error: {
            type: 'server_error',
            message: error.message || 'Internal server error',
            param: null,
            code: 'internal_error'
        }
    };
}

module.exports = router;
