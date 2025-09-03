# Parameter Mapping Documentation

This document describes how parameters are mapped between OpenAI/OpenRouter format and Ollama format in the Ollama2OpenAI Gateway.

## Overview

The gateway accepts OpenAI-compatible requests and converts them to Ollama's native format, then converts the responses back to OpenAI format. This allows seamless integration with existing OpenAI-compatible clients while leveraging Ollama's capabilities.

## Standard Parameter Mapping

### OpenAI → Ollama Options

| OpenAI Parameter | Ollama Parameter | Location | Description |
|------------------|------------------|----------|-------------|
| `temperature` | `temperature` | `options.temperature` | Controls randomness (0.0-1.0) |
| `max_tokens` | `num_predict` | `options.num_predict` | Maximum tokens to generate |
| `top_p` | `top_p` | `options.top_p` | Nucleus sampling parameter |
| `frequency_penalty` | `frequency_penalty` | `options.frequency_penalty` | Penalize frequent tokens |
| `presence_penalty` | `presence_penalty` | `options.presence_penalty` | Penalize present tokens |
| `stream` | `stream` | Root level | Enable/disable streaming |

### Ollama-Specific Parameters (Pass-through)

| Parameter | Location | Description |
|-----------|----------|-------------|
| `num_ctx` | `options.num_ctx` | Context window size |
| `num_predict` | `options.num_predict` | Max tokens to predict (overrides `max_tokens`) |

## Reasoning/Thinking Parameter Mapping

The gateway supports multiple reasoning formats for compatibility with different AI platforms.

### Input Formats

#### 1. Direct Ollama Format
```json
{
  "think": true,    // Enable thinking
  "think": false    // Disable thinking
}
```

**Mapping**: Direct pass-through to Ollama's `think` parameter at root level.

#### 2. OpenRouter Format
```json
{
  "reasoning": {
    "effort": "high",      // Thinking effort level (preserved for future use)
    "exclude": false       // Include reasoning in response
  }
}
```

**Mapping**: 
- Always sends `think: true` to Ollama
- `exclude: false` → Include `reasoning_content` in response
- `exclude: true` → Exclude `reasoning_content` from response (but thinking still generated)

#### 3. OpenAI Format
```json
{
  "reasoning": {
    "enabled": true        // Enable reasoning
  }
}
```

**Mapping**:
- `enabled: true` → `think: true` + include `reasoning_content` in response
- `enabled: false` → `think: false` (disable thinking entirely)

### Reasoning Logic Summary

| Input | Ollama `think` | Response `reasoning_content` | Description |
|-------|----------------|------------------------------|-------------|
| `{"think": true}` | `true` | ✅ Included | Direct Ollama format |
| `{"think": false}` | `false` | ❌ Not generated | Direct Ollama format |
| `{"reasoning": {"enabled": true}}` | `true` | ✅ Included | OpenAI format - enable |
| `{"reasoning": {"enabled": false}}` | `false` | ❌ Not generated | OpenAI format - disable |
| `{"reasoning": {"exclude": false}}` | `true` | ✅ Included | OpenRouter format - include |
| `{"reasoning": {"exclude": true}}` | `true` | ❌ Excluded | OpenRouter format - exclude |
| `{"reasoning": {"exclude": true, "enabled": true}}` | `true` | ❌ Excluded | Exclude takes precedence |

## Response Format Mapping

### Standard Response Fields

#### Non-Streaming Response
```json
{
  "id": "chatcmpl-1234567890",
  "object": "chat.completion",
  "created": 1234567890,
  "model": "requested-model-name",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "Response content",
      "reasoning_content": "Thinking process..." // Only if reasoning enabled and not excluded
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 50,
    "total_tokens": 60
  }
}
```

#### Streaming Response
```json
{
  "id": "chatcmpl-1234567890",
  "object": "chat.completion.chunk",
  "created": 1234567890,
  "model": "requested-model-name",
  "choices": [{
    "index": 0,
    "delta": {
      "content": "Response content chunk",
      "reasoning_content": "Thinking chunk..." // Only if reasoning enabled and not excluded
    },
    "finish_reason": null
  }]
}
```

### Ollama Response Mapping

| Ollama Field | OpenAI Field | Location | Notes |
|--------------|--------------|----------|-------|
| `message.content` | `content` | `choices[0].message.content` or `choices[0].delta.content` | Main response content |
| `message.thinking` | `reasoning_content` | `choices[0].message.reasoning_content` or `choices[0].delta.reasoning_content` | Reasoning process (if enabled) |
| `prompt_eval_count` | `prompt_tokens` | `usage.prompt_tokens` | Input token count |
| `eval_count` | `completion_tokens` | `usage.completion_tokens` | Output token count |
| `done` | `finish_reason` | `choices[0].finish_reason` | "stop" when done |

## Parameter Precedence

The gateway follows this precedence order:

1. **User-provided parameters** (highest priority)
2. **Pre-configured overrides** (model-specific settings in admin)
3. **Default values** (lowest priority)

### Example Parameter Override Configuration

In the admin interface, you can set model-specific defaults:

```json
{
  "gpt-4": {
    "num_ctx": 8192,
    "temperature": 0.7
  },
  "qwen2.5:72b": {
    "num_ctx": 32768,
    "think": true
  }
}
```

These will be applied unless overridden by user parameters in the request.

## Usage Examples

### Example 1: Basic Request with Reasoning
```json
{
  "model": "deepseek-r1",
  "messages": [{"role": "user", "content": "Explain quantum computing"}],
  "reasoning": {"enabled": true},
  "max_tokens": 1000,
  "temperature": 0.7
}
```

**Converted to Ollama:**
```json
{
  "model": "deepseek-r1",
  "messages": [{"role": "user", "content": "Explain quantum computing"}],
  "think": true,
  "stream": false,
  "options": {
    "num_predict": 1000,
    "temperature": 0.7
  }
}
```

### Example 2: Exclude Reasoning from Response
```json
{
  "model": "deepseek-r1",
  "messages": [{"role": "user", "content": "Count to 5"}],
  "reasoning": {"exclude": true},
  "num_ctx": 4096
}
```

**Converted to Ollama:**
```json
{
  "model": "deepseek-r1",
  "messages": [{"role": "user", "content": "Count to 5"}],
  "think": true,
  "stream": false,
  "options": {
    "num_ctx": 4096
  }
}
```

**Response:** Will include thinking generation internally, but `reasoning_content` field will be excluded from the response.

### Example 3: Disable Reasoning Entirely
```json
{
  "model": "deepseek-r1",
  "messages": [{"role": "user", "content": "Hello"}],
  "reasoning": {"enabled": false}
}
```

**Converted to Ollama:**
```json
{
  "model": "deepseek-r1",
  "messages": [{"role": "user", "content": "Hello"}],
  "think": false,
  "stream": false,
  "options": {}
}
```

## Notes

1. **Token Limits with Reasoning**: When using thinking models, `max_tokens`/`num_predict` includes both thinking and content tokens. If thinking uses most tokens, the actual response content may be shorter than expected.

2. **Model Compatibility**: Not all Ollama models support the `think` parameter. Non-reasoning models will ignore this parameter.

3. **Streaming Behavior**: In streaming mode, both content and reasoning_content are streamed as separate delta chunks.

4. **Parameter Validation**: The gateway validates and logs all parameter conversions. Check the logs if parameters don't seem to take effect.

5. **Environment Variables**: Configuration settings can be overridden by environment variables (see main README.md for details).