# Ollama2OpenAI Gateway

A powerful gateway service that converts Ollama API into OpenAI-compatible endpoints with comprehensive admin features, API key management, and advanced parameter control.

## Features

- **OpenAI Compatible API** - Full compatibility with OpenAI's chat completions API
- **Admin Web Interface** - Comprehensive dashboard for configuration and monitoring
- **Multi-API Key Support** - Create and manage multiple API keys with individual permissions
- **Model Access Control** - Fine-grained control over which models each API key can access
- **Parameter Overrides** - Pre-configure model-specific parameters for consistent behavior
- **Ollama Parameter Support** - Pass through Ollama-specific parameters like `num_ctx`, `think`, `num_predict`
- **Usage Tracking** - Complete logging and analytics of API usage
- **Model Name Mapping** - Map Ollama model names to user-friendly display names
- **Streaming Support** - Full support for both streaming and non-streaming responses

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Start Ollama

Make sure Ollama is running on your system:
```bash
ollama serve
```

### 3. Run the Gateway

```bash
npm start
```

### 4. Access Admin Interface

Navigate to `http://localhost:3000` and login with:
- **Username:** admin
- **Password:** admin

### 5. Configure and Create API Keys

1. Go to Settings and configure your Ollama URL (default: `http://localhost:11434`)
2. Navigate to Models and refresh to load available models from Ollama
3. Create API keys in the API Keys section
4. Start using the OpenAI-compatible endpoint at `http://localhost:3000/v1/chat/completions`

## Configuration

### Environment Variables

```bash
export PORT=3000
export OLLAMA_URL=http://localhost:11434
export SESSION_SECRET=your-secret-key
```

### Admin Settings

Access the admin interface at `http://localhost:3000` to configure:

- **Ollama URL**: The URL where your Ollama server is running
- **Admin Password**: Change the default admin password
- **Model Mappings**: Configure display names for your models

## API Usage

### Using with OpenAI SDK

```python
from openai import OpenAI

client = OpenAI(
    api_key="sk-your-api-key-here",
    base_url="http://localhost:3000/v1"
)

response = client.chat.completions.create(
    model="llama3.2:3b",
    messages=[
        {"role": "user", "content": "Hello, how are you?"}
    ]
)
```

### Using with curl

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3.2:3b",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

### Ollama-Specific Parameters

You can pass Ollama-specific parameters directly in your requests:

```json
{
  "model": "llama3.2:3b",
  "messages": [{"role": "user", "content": "Hello!"}],
  "num_ctx": 8192,
  "think": true,
  "num_predict": 100,
  "temperature": 0.7
}
```

### Parameter Overrides

Configure default parameters for specific models in the admin interface:

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

## API Endpoints

### Chat Completions
- **POST** `/v1/chat/completions` - OpenAI-compatible chat completions
- Supports all OpenAI parameters plus Ollama-specific ones
- Supports streaming with `"stream": true`

### Models
- **GET** `/v1/models` - List available models (filtered by API key permissions)

### Admin API (requires admin authentication)
- **GET** `/admin/stats` - Get usage statistics
- **GET/POST** `/admin/settings` - Manage server settings
- **GET/POST/DELETE** `/admin/api-keys` - Manage API keys
- **GET/POST** `/admin/models` - Manage model configurations
- **GET/POST** `/admin/overrides` - Manage parameter overrides
- **GET** `/admin/logs` - View usage logs

## Features in Detail

### API Key Management

Create multiple API keys with different permissions:
- Assign specific models to each key
- Track usage per key
- Enable/disable keys
- View usage statistics

### Model Access Control

Fine-grained control over model access:
- Global access with `*` wildcard
- Specific model access by name
- Per-key model restrictions

### Usage Tracking

Comprehensive logging includes:
- Request timestamps
- API key used
- Model requested
- Response time
- Token usage
- Success/failure status

### Parameter Overrides

Set default parameters for specific models:
- Context length (`num_ctx`)
- Thinking mode (`think`)
- Token prediction limits (`num_predict`)
- Temperature, top_p, and other sampling parameters

## Directory Structure

```
ollama2openai/
├── server.js                 # Main server file
├── package.json              # Dependencies and scripts
├── config/
│   └── config.js             # Configuration management
├── routes/
│   ├── admin.js              # Admin interface routes
│   └── api.js                # OpenAI API routes
├── views/
│   ├── login.ejs             # Login page
│   └── dashboard.ejs         # Admin dashboard
├── public/
│   └── js/
│       └── dashboard.js      # Dashboard JavaScript
├── data/                     # Auto-created data directory
│   ├── config.json           # Server configuration
│   ├── api_keys.json         # API keys storage
│   ├── models.json           # Model configurations
│   ├── overrides.json        # Parameter overrides
│   └── logs.json             # Usage logs
└── logs/
    └── access.log            # HTTP access logs
```

## Development

### Development Mode

```bash
npm run dev
```

This uses nodemon to automatically restart the server when files change.

### Adding New Features

The modular structure makes it easy to extend:

1. **Add new admin API endpoints** in `routes/admin.js`
2. **Extend the configuration system** in `config/config.js`
3. **Add new OpenAI endpoints** in `routes/api.js`
4. **Update the dashboard** in `views/dashboard.ejs` and `public/js/dashboard.js`

## Troubleshooting

### Common Issues

1. **Cannot connect to Ollama**
   - Ensure Ollama is running: `ollama serve`
   - Check the Ollama URL in admin settings
   - Verify Ollama is accessible at the configured URL

2. **Invalid API key errors**
   - Create API keys through the admin interface
   - Ensure the API key format is correct (`Bearer sk-...`)
   - Check that the API key hasn't been deleted

3. **Model not found errors**
   - Refresh models from Ollama in the admin interface
   - Ensure the model is enabled
   - Check API key permissions for the model

4. **Permission denied errors**
   - Verify the API key has access to the requested model
   - Check if the model exists and is enabled
   - Review the API key's allowed models list

### Logs

Check the following log files for debugging:
- `logs/access.log` - HTTP access logs
- Console output - Application logs and errors
- Admin interface logs section - API usage logs

## Security Considerations

- Change the default admin password immediately
- Use strong session secrets in production
- Consider using HTTPS in production environments
- Regularly monitor API usage logs
- Implement rate limiting if needed for production use

## License

MIT License - feel free to use and modify as needed.