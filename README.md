# Ollama2OpenAI Gateway

An enhanced OpenAI-compatible gateway for Ollama with admin interface and advanced parameter control.

## 🚀 Why Use This Instead of Ollama's Built-in OpenAI Endpoint?

- **🧠 Full Thinking Model Support** - Complete `think` parameter support with reasoning content in responses (not supported by Ollama's built-in endpoint)
- **⚙️ Advanced Parameter Control** - Set model-specific parameter overrides with full Ollama parameter support (`num_ctx`, `num_predict`, `think`, etc.)
- **🔑 Multi-API Key Management** - Create and manage multiple API keys with per-key model access control
- **📊 Usage Tracking & Analytics** - Comprehensive logging and monitoring of API usage
- **🎛️ Admin Web Interface** - Easy configuration and management through a web dashboard
- **🏷️ Model Name Mapping** - Custom display names for your models

## Quick Start (Docker Only)

```bash
# Clone the repository
git clone https://github.com/MotorBottle/Ollama2OpenAI.git
cd Ollama2OpenAI

# Option 1: With included Ollama service
docker-compose up -d

# Option 2: With external Ollama instance 
docker-compose -f docker-compose.external.yml up -d
```

**🎯 Access Admin Interface:** `http://localhost:3000`
- **Username:** admin  
- **Password:** admin

**⚡ Quick Setup:**
1. Configure Ollama URL in Settings
2. Refresh Models to load from Ollama
3. Create API keys with model permissions
4. Use OpenAI-compatible endpoint: `http://localhost:3000/v1/chat/completions`

## 🧠 Enhanced Thinking Model Support

Unlike Ollama's built-in OpenAI endpoint, this gateway fully supports reasoning models:

```python
from openai import OpenAI

client = OpenAI(
    api_key="sk-your-api-key-here",
    base_url="http://localhost:3000/v1"
)

# Full thinking model support with reasoning content
response = client.chat.completions.create(
    model="deepseek-r1",
    messages=[{"role": "user", "content": "Solve this math problem step by step"}],
    think=True,  # Enable reasoning 
    num_ctx=32768  # Extended context
)

# Access reasoning content (not available in Ollama's OpenAI endpoint)
reasoning = response.choices[0].message.reasoning_content
answer = response.choices[0].message.content
```

## ⚙️ Advanced Parameter Control

Set model-specific parameter overrides in the admin interface using **Ollama format**:

```json
{
  "deepseek-r1": {
    "think": true,
    "num_ctx": 32768,
    "temperature": 0.8
  },
  "llama3.2:3b": {
    "num_ctx": 8192,
    "num_predict": 1000
  }
}
```

**Parameter Precedence:** User API params → Model overrides → System defaults

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
docker-compose up -d
docker-compose down

# View logs
docker-compose logs -f gateway

# Rebuild after changes  
docker-compose up -d --build
```

## API Endpoints

- **POST** `/v1/chat/completions` - OpenAI-compatible with full Ollama parameter support
- **GET** `/v1/models` - List models (filtered by API key permissions)
- **Admin Interface** - `http://localhost:3000` for configuration and monitoring

## Key Features

✅ **Full reasoning model support** with `think` parameter and reasoning content  
✅ **Model-specific parameter overrides** using Ollama format  
✅ **Multi-API key management** with per-key model access control  
✅ **Usage tracking and analytics** with comprehensive logging  
✅ **Custom model name mapping** for user-friendly names  
✅ **Web admin interface** for easy configuration  

## Troubleshooting

- **Cannot connect to Ollama**: Check Ollama URL in admin settings
- **Invalid API key**: Create keys through admin interface
- **Model not found**: Refresh models in admin interface and check API key permissions

## License

MIT License