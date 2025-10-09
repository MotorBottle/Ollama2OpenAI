# Ollama2OpenAI Gateway

**Languages:** English | [简体中文](README.zh.md)

An enhanced OpenAI-compatible gateway for Ollama with admin interface and advanced parameter control.

## 🚀 Why Use This Instead of Ollama's Built-in OpenAI Endpoint?

- **🖼️ Multimodal Image Support** - Full support for vision models with base64 and URL images in OpenAI format
- **🧠 Full Thinking Model Support** - Complete `think` parameter support with reasoning content in responses (not supported by Ollama's built-in endpoint)
- **⚙️ Advanced Parameter Control** - Set model-specific parameter overrides with full Ollama parameter support (`num_ctx`, `num_predict`, `think`, etc.)
- **🔑 Multi-API Key Management** - Create and manage multiple API keys with per-key model access control
- **📊 Usage Tracking & Analytics** - Comprehensive logging and monitoring of API usage
- **🎛️ Admin Web Interface** - Easy configuration and management through a web dashboard
- **🏷️ Model Name Mapping** - Custom display names for your models

<img width="1916" height="922" alt="image" src="https://github.com/user-attachments/assets/92d5e667-c157-485a-b1d2-8064d8f99c0f" />
<img width="1913" height="922" alt="image" src="https://github.com/user-attachments/assets/00f44958-c0ff-4f34-926f-eb5096ce4f4c" />
<img width="1917" height="922" alt="image" src="https://github.com/user-attachments/assets/51d90c12-8e32-4ba2-b603-f7a2060edf44" />



## Quick Start (Docker Only)

```bash
# Clone the repository
git clone https://github.com/MotorBottle/Ollama2OpenAI.git
cd Ollama2OpenAI

# Start the gateway (ensure OLLAMA_URL points at your Ollama host)
docker compose up -d
```

> The compose file only starts the gateway container. Configure `OLLAMA_URL` via environment or `.env` so it can reach your existing Ollama instance. Stop the stack with `docker compose down` when finished.

**🎯 Access Admin Interface:** `http://localhost:3000`
- **Username:** admin  
- **Password:** admin

**⚡ Quick Setup:**
1. Configure Ollama URL in Settings
2. Refresh Models to load from Ollama
3. Create API keys with model permissions
4. Use OpenAI-compatible endpoint: `http://localhost:3000/v1/chat/completions`

## 🖼️ Multimodal Image Support

Full support for vision models with images in OpenAI format:

```python
from openai import OpenAI
import base64

client = OpenAI(
    api_key="sk-your-api-key-here",
    base_url="http://localhost:3000/v1"
)

# Using base64 encoded images
with open("image.jpg", "rb") as image_file:
    base64_image = base64.b64encode(image_file.read()).decode('utf-8')

response = client.chat.completions.create(
    model="llama3.2-vision:11b",  # Or any vision model
    messages=[{
        "role": "user",
        "content": [
            {"type": "text", "text": "What's in this image?"},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}}
        ]
    }]
)

# Also supports HTTP/HTTPS image URLs
response = client.chat.completions.create(
    model="llama3.2-vision:11b",
    messages=[{
        "role": "user",
        "content": [
            {"type": "text", "text": "Describe this image"},
            {"type": "image_url", "image_url": {"url": "https://example.com/image.jpg"}}
        ]
    }]
)
```

**Supported formats:**
- ✅ Base64 encoded images (`data:image/jpeg;base64,...`)
- ✅ HTTP/HTTPS image URLs (automatically fetched and converted)
- ✅ Multiple images in a single message
- ✅ Works with both streaming and non-streaming responses

## 🧠 Enhanced Thinking Model Support

Unlike Ollama's built-in OpenAI endpoint, this gateway fully supports reasoning models:

```python
from openai import OpenAI

client = OpenAI(
    api_key="sk-your-api-key-here",
    base_url="http://localhost:3000/v1"
)

# Full thinking model support with reasoning content and effort control
response = client.chat.completions.create(
    model="gpt-oss:120b",
    messages=[{"role": "user", "content": "Solve this math problem step by step"}],
    reasoning_effort="high",  # OpenAI format: "minimal", "low", "medium", "high"
    # OR use OpenRouter format:
    # reasoning={"effort": "high"}
    num_ctx=32768  # Extended context
)

# Access reasoning content (not available in Ollama's OpenAI endpoint)
reasoning = response.choices[0].message.reasoning_content
answer = response.choices[0].message.content
```

## 🔍 Embeddings Support

Full OpenAI-compatible embeddings for similarity search and vector operations:

```python
from openai import OpenAI

client = OpenAI(
    api_key="sk-your-api-key-here",
    base_url="http://localhost:3000/v1"
)

# Single text embedding
response = client.embeddings.create(
    model="mxbai-embed-large",  # Or any embedding model
    input="The quick brown fox jumps over the lazy dog"
)

embedding = response.data[0].embedding
print(f"Embedding dimensions: {len(embedding)}")

# Multiple texts in one request
response = client.embeddings.create(
    model="mxbai-embed-large",
    input=[
        "Hello world",
        "How are you today?",
        "This is a test document"
    ]
)

for i, embedding_obj in enumerate(response.data):
    print(f"Text {i+1} embedding: {len(embedding_obj.embedding)} dimensions")
```

**Supported features:**
- ✅ Single and batch text processing
- ✅ Custom dimensions parameter (model dependent)
- ✅ Usage token tracking
- ✅ Full OpenAI client library compatibility

## ⚙️ Advanced Parameter Control

Set model-specific parameter overrides in the admin interface using **Ollama format**:

```json
{
  "deepseek-r1": {
    "think": "high",
    "num_ctx": 32768,
    "temperature": 0.8,
    "request_timeout": 600000
  },
  "llama3.2:3b": {
    "num_ctx": 8192,
    "num_predict": 1000
  }
}
```

**Parameter Precedence:** User API params → Model overrides → System defaults

### Parameter Overrides Examples (Ollama Format)

Add overrides in the admin UI (`Models` tab) using standard JSON:

```json
{
  "qwen3-coder": {
    "num_ctx": 163840,
    "request_timeout": 99999999,
    "exclude_reasoning": true,
    "think": true
  }
}
```

- `request_timeout` / `timeout_ms` are in milliseconds. Set a high value to prevent long reasoning generations from hitting the default 120 s Axios timeout.
- `exclude_reasoning` hides reasoning content by default while still letting callers opt back in via request parameters.
- `num_ctx` expands the context window for repositories or long chats.
- Any Ollama `parameter` (temperature, top_p, etc.) can be expressed here and is merged into the request automatically.

## Environment Variables

```bash
# Create .env file for Docker
PORT=3000
OLLAMA_URL=http://localhost:11434  # or http://ollama:11434 for Docker
SESSION_SECRET=your-secret-key
```

## Docker Commands

```bash
# Start/stop services
docker compose up -d
docker compose down

# View logs
docker compose logs -f gateway

# Rebuild after changes  
docker compose up -d --build
```

## API Endpoints

- **POST** `/v1/chat/completions` - OpenAI-compatible chat completions with full Ollama parameter support
- **POST** `/v1/embeddings` - OpenAI-compatible embeddings for text similarity and search
- **POST** `/v1/messages` - Anthropic-compatible Messages API with thinking/tool streaming (legacy `/anthropic/v1/messages` still supported)
- **GET** `/v1/models` - List models (filtered by API key permissions)
- **Admin Interface** - `http://localhost:3000` for configuration and monitoring

## 🤖 Anthropic-Compatible API

Use the Anthropic Messages endpoint to serve Claude-style clients directly from Ollama:

```bash
curl http://localhost:3000/v1/messages \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -H "Anthropic-Version: 2023-06-01" \
  -d '{
    "model": "qwen3-coder",
    "messages": [{"role": "user", "content": "Explain async/await in Python"}],
    "stream": true,
    "think": true
  }'
```

**Highlights:**
- Streams `thinking_delta`, `signature_delta`, `text_delta`, and tool blocks according to the latest Anthropic spec
- Automatically maps Ollama tool calls to `tool_use` content blocks and forwards tool call inputs back to your client
- Supports `think`/reasoning controls and per-model overrides (context, timeouts, etc.)
- Works with Anthropic SDKs—specify the `Anthropic-Version` header or accept the default `2023-06-01`

Provide tools in the Anthropic request (`tools` array) and the gateway will expose them to Ollama. When Ollama decides on a tool, the response streams back as Anthropic `tool_use` blocks with properly parsed JSON arguments, ready to execute in your application.

On the OpenAI side, keep using the standard `tools` / `tool_calls` fields in `/v1/chat/completions`. The gateway forwards those definitions to Ollama and converts the model's function calls back into OpenAI-compatible tool call payloads automatically.

**Anthropic request with tools**

```bash
curl http://localhost:3000/v1/messages \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "model": "qwen3-coder",
    "messages": [{"role": "user", "content": "查一下旧金山的天气"}],
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "get_weather",
          "parameters": {
            "type": "object",
            "properties": {"city": {"type": "string"}},
            "required": ["city"]
          }
        }
      }
    ]
  }'
```

When the model invokes a tool you’ll receive a streamed block such as:

```json
event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_01...","name":"get_weather","input":{"city":"旧金山"}}}
```

**OpenAI-compatible example (Python)**

```python
from openai import OpenAI

client = OpenAI(api_key="YOUR_KEY", base_url="http://localhost:3000/v1")

response = client.chat.completions.create(
    model="qwen3-coder",
    messages=[{"role": "user", "content": "Call the lookup tool for Paris"}],
    tools=[{
        "type": "function",
        "function": {
            "name": "lookup_city",
            "parameters": {
                "type": "object",
                "properties": {"city": {"type": "string"}},
                "required": ["city"]
            }
        }
    }]
)

tool_call = response.choices[0].message.tool_calls[0]
print(tool_call.function.name, tool_call.function.arguments)
```

## Key Features

✅ **Full reasoning model support** with `think` parameter and reasoning content  
✅ **Model-specific parameter overrides** using Ollama format  
✅ **Anthropic Messages endpoint** with full thinking/tool streaming  
✅ **Bi-directional tool call support** for both Anthropic and OpenAI-compatible clients  
✅ **Multi-API key management** with per-key model access control  
✅ **Usage tracking and analytics** with comprehensive logging  
✅ **Custom model name mapping** for user-friendly names  
✅ **Web admin interface** for easy configuration  

## Reasoning Models Configuration

For models that support reasoning/thinking (like qwen3, deepseek-r1, etc.), you need to set `think: true` to get properly separated reasoning content:

```json
{
  "model": "qwen3:32b",
  "messages": [...],
  "think": true  // Enables separated reasoning output
}
```

Need the model to think but keep the reasoning hidden? Add `"exclude_reasoning": true` in a request (or set `"exclude_reasoning": true` in the model overrides) and clients will receive the final answer without the `reasoning_content` field.

### Pre-configuring Models for Reasoning

You can configure models to always output separated reasoning content through the admin interface:

1. Go to **Models** tab in the admin dashboard
2. Click **Edit** on the model (e.g., qwen3)
3. Add parameter override:
```json
{
  "think": true
}
```
4. Click **Save**

Now all requests to this model will automatically have reasoning enabled without clients needing to specify `think: true`.

## Troubleshooting

- **Cannot connect to Ollama**: Check Ollama URL in admin settings
- **Invalid API key**: Create keys through admin interface
- **Model not found**: Refresh models in admin interface and check API key permissions

## License

MIT License
