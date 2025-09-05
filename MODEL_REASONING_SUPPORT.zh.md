# 模型推理支持

**语言版本:** [English](MODEL_REASONING_SUPPORT.md) | 简体中文

本文档说明了使用 Ollama2OpenAI 网关时，不同模型家族的推理能力和支持的 `think` 参数值。

## 按模型家族分类的推理参数支持

### 🧠 完整推理模型（支持努力级别）

这些模型支持细粒度推理努力控制，包含 `"low"`、`"medium"` 和 `"high"` 级别：

| 模型系列 | 支持的参数值 | 备注 |
|---------|------------|------|
| **GPT-OSS** | `"low"`, `"medium"`, `"high"` | 原生支持推理努力级别 |
| **DeepSeek-R1** | `"low"`, `"medium"`, `"high"` | 高级推理，支持努力度控制 |
| **QwQ** | `"low"`, `"medium"`, `"high"` | 问答推理模型 |

**使用示例：**
```python
# 高努力度推理
response = client.chat.completions.create(
    model="gpt-oss:120b",
    reasoning_effort="high",
    messages=[{"role": "user", "content": "解决这个复杂问题"}]
)

# 低努力度，更快响应
response = client.chat.completions.create(
    model="deepseek-r1:14b",
    think="low",  # 直接使用 Ollama 格式
    messages=[{"role": "user", "content": "简单问题"}]
)
```

### ⚡ 基础推理模型（仅支持真假值）

这些模型支持推理但仅支持二进制开/关模式：

| 模型系列 | 支持的参数值 | 备注 |
|---------|------------|------|
| **Qwen3** | `true`, `false` | 仅支持二进制推理控制 |
| **Llama3** | `true`, `false` | 基本思考模式支持 |
| **Mistral** | `true`, `false` | 简单推理开/关 |

**使用示例：**
```python
# 启用推理（基础）
response = client.chat.completions.create(
    model="qwen3:32b",
    think=True,  # 仅支持 true/false
    messages=[{"role": "user", "content": "思考这个问题"}]
)
```

### 🚫 非推理模型

这些模型不支持推理参数：

| 模型系列 | 推理支持 | 备注 |
|---------|---------|------|
| **Llama2** | 无 | 标准补全模型 |
| **Code Llama** | 无 | 专注于代码生成 |
| **嵌入模型** | 无 | 文本嵌入模型 |

## 参数映射参考

### OpenAI 格式 → Ollama 格式

| 输入参数 | 完整推理模型 | 基础推理模型 | 非推理模型 |
|---------|------------|------------|----------|
| `reasoning_effort: "minimal"` | `think: false` | `think: false` | 忽略 |
| `reasoning_effort: "low"` | `think: "low"` | `think: true` | 忽略 |
| `reasoning_effort: "medium"` | `think: "medium"` | `think: true` | 忽略 |
| `reasoning_effort: "high"` | `think: "high"` | `think: true` | 忽略 |

### 参数覆盖示例

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

## 最佳实践

### 🎯 选择推理努力度

- **高努力度** (`"high"`): 需要深入分析的复杂问题
- **中等努力度** (`"medium"`): 大多数任务的平衡推理  
- **低努力度** (`"low"`): 需要基础推理的快速响应
- **最小/关闭** (`false`): 最快响应，无推理开销

### ⚙️ 性能考虑

| 努力级别 | 响应时间 | Token 使用量 | 最适合 |
|---------|---------|-------------|-------|
| `false` | 最快 | 最低 | 简单查询 |
| `"low"` | 快 | 低 | 快速推理任务 |
| `"medium"` | 中等 | 中等 | 一般问题解决 |
| `"high"` | 较慢 | 较高 | 复杂分析 |

### 🔧 模型选择指南

1. **复杂推理**: 使用 GPT-OSS 或 DeepSeek-R1 配合 `"high"` 努力度
2. **简单任务**: 使用 Qwen3 配合 `true` 进行基础推理
3. **追求速度**: 使用任意模型配合 `false` 或不设置推理参数
4. **代码相关**: 使用 Code Llama（无需推理）

## 故障排除

### 常见问题

- **错误：无效的 think 参数**: 模型不支持努力级别，请使用 `true`/`false`
- **无推理输出**: 模型不支持推理，或设置了 `think: false`
- **响应慢**: 高努力度推理需要更多时间，考虑降低努力级别

### 测试模型能力

```bash
# 测试推理支持
curl -X POST http://localhost:22434/v1/chat/completions \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "your-model",
    "messages": [{"role": "user", "content": "测试推理"}],
    "think": "high"
  }'
```

## 版本说明

- **网关版本**: 最新版
- **最后更新**: 2025-09-05
- **Ollama 兼容性**: v0.1.0+

---

💡 **提示**: 请始终查阅您特定模型的文档以获取最新的推理能力信息，因为不同版本的模型支持可能有所不同。