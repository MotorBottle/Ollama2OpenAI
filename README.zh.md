# Ollama2OpenAI 网关

**语言版本:** [English](README.md) | 简体中文

一个增强版的 Ollama OpenAI 兼容网关，具备管理界面和高级参数控制功能。

## 🚀 为什么选择这个而不是 Ollama 内置的 OpenAI 接口？

- **🧠 完整的思考模型支持** - 完全支持 `think` 参数和响应中的推理内容（Ollama 内置端点不支持）
- **⚙️ 高级参数控制** - 设置特定模型的参数覆盖，完全支持 Ollama 参数（`num_ctx`、`num_predict`、`think` 等）
- **🔑 多 API 密钥管理** - 创建和管理多个 API 密钥，支持每个密钥的模型访问控制
- **📊 使用追踪和分析** - 全面的 API 使用日志记录和监控
- **🎛️ 管理 Web 界面** - 通过 Web 仪表板轻松配置和管理
- **🏷️ 模型名称映射** - 为模型自定义显示名称

<img width="1916" height="922" alt="image" src="https://github.com/user-attachments/assets/92d5e667-c157-485a-b1d2-8064d8f99c0f" />
<img width="1913" height="922" alt="image" src="https://github.com/user-attachments/assets/00f44958-c0ff-4f34-926f-eb5096ce4f4c" />
<img width="1917" height="922" alt="image" src="https://github.com/user-attachments/assets/51d90c12-8e32-4ba2-b603-f7a2060edf44" />

## 快速开始（仅 Docker）

```bash
# 克隆仓库
git clone https://github.com/MotorBottle/Ollama2OpenAI.git
cd Ollama2OpenAI

# 选项1：包含 Ollama 服务
docker-compose up -d

# 选项2：使用外部 Ollama 实例
docker-compose -f docker-compose.external.yml up -d
```

**🎯 访问管理界面：** `http://localhost:3000`
- **用户名：** admin  
- **密码：** admin

**⚡ 快速设置：**
1. 在设置中配置 Ollama URL
2. 刷新模型以从 Ollama 加载
3. 创建具有模型权限的 API 密钥
4. 使用 OpenAI 兼容端点：`http://localhost:3000/v1/chat/completions`

## 🧠 增强的思考模型支持

与 Ollama 内置 OpenAI 端点不同，此网关完全支持推理模型：

```python
from openai import OpenAI

client = OpenAI(
    api_key="sk-your-api-key-here",
    base_url="http://localhost:3000/v1"
)

# 完整的思考模型支持和推理内容，支持推理努力度控制
response = client.chat.completions.create(
    model="gpt-oss:120b",
    messages=[{"role": "user", "content": "一步步解决这个数学问题"}],
    reasoning_effort="high",  # OpenAI 格式: "minimal", "low", "medium", "high"
    # 或使用 OpenRouter 格式:
    # reasoning={"effort": "high"}
    num_ctx=32768  # 扩展上下文
)

# 访问推理内容（Ollama 的 OpenAI 端点中不可用）
reasoning = response.choices[0].message.reasoning_content
answer = response.choices[0].message.content
```

## ⚙️ 高级参数控制

在管理界面中使用 **Ollama 格式**设置特定模型的参数覆盖：

```json
{
  "deepseek-r1": {
    "think": "high",
    "num_ctx": 32768,
    "temperature": 0.8
  },
  "llama3.2:3b": {
    "num_ctx": 8192,
    "num_predict": 1000
  }
}
```

**参数优先级：** 用户 API 参数 → 模型覆盖 → 系统默认值

## 环境变量

```bash
# 为 Docker 创建 .env 文件
PORT=3000
OLLAMA_URL=http://localhost:11434  # 或 http://ollama:11434 用于 Docker
SESSION_SECRET=your-secret-key
```

## Docker 命令

```bash
# 启动/停止服务
docker-compose up -d
docker-compose down

# 查看日志
docker-compose logs -f gateway

# 更改后重新构建  
docker-compose up -d --build
```

## API 端点

- **POST** `/v1/chat/completions` - OpenAI 兼容，完全支持 Ollama 参数
- **GET** `/v1/models` - 列出模型（按 API 密钥权限过滤）
- **管理界面** - `http://localhost:3000` 用于配置和监控

## 主要功能

✅ **完整的推理模型支持**，支持 `think` 参数和推理内容  
✅ **特定模型参数覆盖**，使用 Ollama 格式  
✅ **多 API 密钥管理**，支持每个密钥的模型访问控制  
✅ **使用追踪和分析**，全面日志记录  
✅ **自定义模型名称映射**，用户友好的名称  
✅ **Web 管理界面**，轻松配置  

## 故障排除

- **无法连接到 Ollama**：检查管理设置中的 Ollama URL
- **无效的 API 密钥**：通过管理界面创建密钥
- **模型未找到**：在管理界面刷新模型并检查 API 密钥权限

## 许可证

MIT 许可证
