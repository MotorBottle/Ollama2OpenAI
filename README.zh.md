# Ollama2OpenAI 网关

**语言版本:** [English](README.md) | 简体中文

一个增强版的 Ollama OpenAI 兼容网关，具备管理界面和高级参数控制功能。

## 🚀 为什么选择这个而不是 Ollama 内置的 OpenAI 接口？

- **🖼️ 多模态图像支持** - 完全支持视觉模型，使用 OpenAI 格式的 base64 和 URL 图像
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

# 启动网关（确保 OLLAMA_URL 指向你的 Ollama 实例）
docker compose up -d
```

> 该 compose 文件仅启动网关容器。请通过环境变量或 `.env` 配置 `OLLAMA_URL` 以连接现有的 Ollama 实例，完成后可使用 `docker compose down` 停止。

**🎯 访问管理界面：** `http://localhost:3000`
- **用户名：** admin  
- **密码：** admin

**⚡ 快速设置：**
1. 在设置中配置 Ollama URL
2. 刷新模型以从 Ollama 加载
3. 创建具有模型权限的 API 密钥
4. 使用 OpenAI 兼容端点：`http://localhost:3000/v1/chat/completions`

## 🖼️ 多模态图像支持

完全支持视觉模型，使用 OpenAI 格式传递图像：

```python
from openai import OpenAI
import base64

client = OpenAI(
    api_key="sk-your-api-key-here",
    base_url="http://localhost:3000/v1"
)

# 使用 base64 编码的图像
with open("image.jpg", "rb") as image_file:
    base64_image = base64.b64encode(image_file.read()).decode('utf-8')

response = client.chat.completions.create(
    model="llama3.2-vision:11b",  # 或任何视觉模型
    messages=[{
        "role": "user",
        "content": [
            {"type": "text", "text": "这张图片里有什么？"},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}}
        ]
    }]
)

# 也支持 HTTP/HTTPS 图像 URL
response = client.chat.completions.create(
    model="llama3.2-vision:11b",
    messages=[{
        "role": "user",
        "content": [
            {"type": "text", "text": "描述这张图片"},
            {"type": "image_url", "image_url": {"url": "https://example.com/image.jpg"}}
        ]
    }]
)
```

**支持的格式：**
- ✅ Base64 编码的图像（`data:image/jpeg;base64,...`）
- ✅ HTTP/HTTPS 图像 URL（自动获取并转换）
- ✅ 单条消息中的多张图像
- ✅ 支持流式和非流式响应

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

## 🔍 嵌入向量支持

完全兼容 OpenAI 的嵌入向量，用于相似性搜索和向量操作：

```python
from openai import OpenAI

client = OpenAI(
    api_key="sk-your-api-key-here",
    base_url="http://localhost:3000/v1"
)

# 单个文本嵌入
response = client.embeddings.create(
    model="mxbai-embed-large",  # 或任何嵌入模型
    input="快速的棕色狐狸跳过懒惰的狗"
)

embedding = response.data[0].embedding
print(f"嵌入维度: {len(embedding)}")

# 一次请求多个文本
response = client.embeddings.create(
    model="mxbai-embed-large",
    input=[
        "你好世界",
        "今天怎么样？",
        "这是一个测试文档"
    ]
)

for i, embedding_obj in enumerate(response.data):
    print(f"文本 {i+1} 嵌入: {len(embedding_obj.embedding)} 维度")
```

**支持的功能：**
- ✅ 单个和批量文本处理
- ✅ 自定义维度参数（取决于模型）
- ✅ 使用量令牌追踪
- ✅ 完全兼容 OpenAI 客户端库

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
docker compose up -d
docker compose down

# 查看日志
docker compose logs -f gateway

# 更改后重新构建  
docker compose up -d --build
```

## API 端点

- **POST** `/v1/chat/completions` - OpenAI 兼容的聊天完成，完全支持 Ollama 参数
- **POST** `/v1/embeddings` - OpenAI 兼容的嵌入向量，用于文本相似性和搜索
- **GET** `/v1/models` - 列出模型（按 API 密钥权限过滤）
- **管理界面** - `http://localhost:3000` 用于配置和监控

## 主要功能

✅ **完整的推理模型支持**，支持 `think` 参数和推理内容  
✅ **特定模型参数覆盖**，使用 Ollama 格式  
✅ **多 API 密钥管理**，支持每个密钥的模型访问控制  
✅ **使用追踪和分析**，全面日志记录  
✅ **自定义模型名称映射**，用户友好的名称  
✅ **Web 管理界面**，轻松配置  

## 推理模型配置

对于支持推理/思考的模型（如 qwen3、deepseek-r1 等），您需要设置 `think: true` 来获取正确分离的推理内容：

```json
{
  "model": "qwen3:32b",
  "messages": [...],
  "think": true  // 启用分离的推理输出
}
```

### 预配置模型推理功能

您可以通过管理界面配置模型始终输出分离的推理内容：

1. 在管理仪表板中进入**模型**标签
2. 点击模型（如 qwen3）的**编辑**按钮
3. 添加参数覆盖：
```json
{
  "think": true
}
```
4. 点击**保存**

现在所有对该模型的请求都会自动启用推理功能，客户端无需指定 `think: true`。

## 故障排除

- **无法连接到 Ollama**：检查管理设置中的 Ollama URL
- **无效的 API 密钥**：通过管理界面创建密钥
- **模型未找到**：在管理界面刷新模型并检查 API 密钥权限

## 许可证

MIT 许可证
