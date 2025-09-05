# Model Reasoning Support

**Languages:** English | [简体中文](MODEL_REASONING_SUPPORT.zh.md)

This document outlines the reasoning capabilities and supported parameter formats for different model families when using the Ollama2OpenAI gateway.

## 🎯 Recommended Parameter Formats

When making requests to the **OpenAI-compatible gateway**, use these parameter formats:

### **✅ Primary (OpenAI Format)**
```json
{
  "reasoning_effort": "high"
}
```

### **✅ Alternative (OpenRouter Format)**  
```json
{
  "reasoning": {
    "effort": "high"
  }
}
```

### **🔧 Compatibility (Ollama Format)**
```json
{
  "think": "high"
}
```
*Note: `think` parameter is supported for compatibility but not recommended for new integrations.*

## Reasoning Parameter Support by Model Family

### 🧠 Full Reasoning Models (Support Effort Levels)

These models support fine-grained reasoning effort control with `"low"`, `"medium"`, and `"high"` levels:

| Model Family | Supported Values | Notes |
|--------------|------------------|-------|
| **GPT-OSS** | `"low"`, `"medium"`, `"high"` | Confirmed: Native support for reasoning effort levels |
| **Mistral Magistral** | `"low"`, `"medium"`, `"high"` | Confirmed: Via API system prompt integration |

**📋 Research Findings**:
- **DeepSeek-R1**: Uses automatic reasoning depth based on question complexity. No explicit effort levels found in documentation
- **QwQ**: Has `/think` and `/no_think` soft switches for reasoning control, but no effort levels documented

**Example Usage (OpenAI-Compatible Format):**
```python
# High effort reasoning - OpenAI format (RECOMMENDED)
response = client.chat.completions.create(
    model="gpt-oss:120b",
    reasoning_effort="high",  # Primary OpenAI format
    messages=[{"role": "user", "content": "Solve this complex problem"}]
)

# Alternative OpenRouter format
response = client.chat.completions.create(
    model="gpt-oss:120b", 
    reasoning={"effort": "high"},  # OpenRouter format
    messages=[{"role": "user", "content": "Complex analysis"}]
)

# Compatibility format (not recommended for new code)
response = client.chat.completions.create(
    model="gpt-oss:120b",
    think="high",  # Ollama compatibility format
    messages=[{"role": "user", "content": "Simple question"}]
)
```

### ⚡ Advanced Reasoning Models (Special Controls)

These models have sophisticated reasoning but use their own parameter systems:

| Model Family | Supported Values | Control Method |
|--------------|------------------|----------------|
| **DeepSeek-R1** | `true`, `false` | Automatic depth adjustment based on complexity |
| **QwQ** | `true`, `false`, `/think`, `/no_think` | Soft switches in prompts for reasoning control |

### 🔄 Basic Reasoning Models (True/False Only)

These models support reasoning but only in binary on/off mode:

| Model Family | Supported Values | Notes |
|--------------|------------------|-------|
| **Qwen3** | `true`, `false` | Confirmed: Binary reasoning control only |

**📋 Research Findings**:
- **Llama3 Base**: No native reasoning parameters. Reasoning achieved through specialized fine-tuning or system prompts
- **Standard Mistral Models**: No built-in reasoning (only Magistral series has reasoning)

**Example Usage:**
```python
# Enable reasoning (basic)
response = client.chat.completions.create(
    model="qwen3:32b",
    think=True,  # Only true/false supported
    messages=[{"role": "user", "content": "Think about this problem"}]
)
```

### 🚫 Non-Reasoning Models

These models do not support reasoning parameters:

| Model Family | Reasoning Support | Notes |
|--------------|-------------------|-------|
| **Llama2** | None | Standard completion model |
| **Code Llama** | None | Focused on code generation |
| **Embedding Models** | None | Text embedding models |

## Parameter Mapping Reference

### Gateway Mapping (All Models)

The gateway uses a **pass-through approach** for maximum flexibility:

| Input Parameter | Gateway → Ollama Mapping | Notes |
|----------------|-------------------------|-------|
| `reasoning_effort: "minimal"` | `think: false` | Only exception (Ollama doesn't support "minimal") |
| `reasoning_effort: "low"` | `think: "low"` | **Passed through** - model decides compatibility |
| `reasoning_effort: "medium"` | `think: "medium"` | **Passed through** - model decides compatibility |
| `reasoning_effort: "high"` | `think: "high"` | **Passed through** - model decides compatibility |
| `reasoning: {effort: "X"}` | `think: "X"` | Same mapping as above |
| `reasoning: {enabled: true/false}` | `think: true/false` | Direct mapping |
| `think: "X"` | `think: "X"` | Direct pass-through |

### Model Behavior Examples

**What happens with different models:**
- **GPT-OSS**: All effort levels work as intended ✅
- **Qwen3**: May treat `"high"` as `true` or return error ⚠️  
- **DeepSeek-R1**: May ignore effort levels, use auto-depth ⚠️

**Philosophy**: Gateway doesn't restrict user choices - let the model handle unsupported parameters!

### Parameter Override Examples

```json
{
  "gpt-oss:120b": {
    "think": "high",
    "num_ctx": 32768,
    "temperature": 0.8
  },
  "qwen3:32b": {
    "think": true,
    "num_ctx": 8192,
    "temperature": 0.7
  },
  "llama2:7b": {
    "num_ctx": 4096,
    "temperature": 0.7
  }
}
```

## Best Practices

### 🎯 Choosing Reasoning Effort

- **High Effort** (`"high"`): Complex problems requiring deep analysis
- **Medium Effort** (`"medium"`): Balanced reasoning for most tasks  
- **Low Effort** (`"low"`): Quick responses with basic reasoning
- **Minimal/False** (`false`): Fastest responses, no reasoning overhead

### ⚙️ Performance Considerations

| Effort Level | Response Time | Token Usage | Best For |
|-------------|---------------|-------------|----------|
| `false` | Fastest | Lowest | Simple queries |
| `"low"` | Fast | Low | Quick reasoning tasks |
| `"medium"` | Moderate | Moderate | General problem solving |
| `"high"` | Slower | Higher | Complex analysis |

### 🔧 Model Selection Guide

1. **For Complex Reasoning**: Use GPT-OSS or DeepSeek-R1 with `"high"` effort
2. **For Simple Tasks**: Use Qwen3 with `true` for basic reasoning
3. **For Speed**: Use any model with `false` or no reasoning parameter
4. **For Code**: Use Code Llama (no reasoning needed)

## Troubleshooting

### Common Issues

- **Error: Invalid think parameter**: Model doesn't support effort levels, use `true`/`false`
- **No reasoning output**: Model doesn't support reasoning, or `think: false` is set
- **Slow responses**: High effort reasoning takes more time, consider lowering effort

### Testing Model Capabilities

**⚠️ Important**: Model capabilities may vary. Always test your specific models to confirm reasoning support.

```bash
# Test effort level support (try "low", "medium", "high")
curl -X POST http://localhost:22434/v1/chat/completions \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "your-model",
    "messages": [{"role": "user", "content": "Test reasoning"}],
    "think": "high"
  }'

# Test basic reasoning support (true/false)
curl -X POST http://localhost:22434/v1/chat/completions \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "your-model", 
    "messages": [{"role": "user", "content": "Test reasoning"}],
    "think": true
  }'
```

**How to Interpret Results**:
- ✅ **Success**: Model accepts parameter and provides reasoning content
- ❌ **Error 400**: Model doesn't support that parameter format
- ⚠️ **No reasoning content**: Model may not support reasoning even if parameter is accepted

## Version Notes

- **Gateway Version**: Latest
- **Last Updated**: 2025-09-05
- **Ollama Compatibility**: v0.1.0+

---

💡 **Tip**: Always check your specific model's documentation for the most up-to-date reasoning capabilities, as model support may vary with different versions.