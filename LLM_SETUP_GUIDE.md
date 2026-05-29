# ORB AI LLM Provider Setup Guide

## Quick Start

### Option 1: NVIDIA API (Default - Recommended) ⭐

1. **Get NVIDIA API Key**
   - Go to https://integrate.api.nvidia.com
   - Sign up for free account
   - Generate API key from dashboard

2. **VS Code Settings** (Cmd+Shift+P → "Preferences: Open User Settings (JSON)")
   ```json
   {
     "orb-ai.provider": "nvidia",
     "orb-ai.nvidiaApiKey": "nvapi-YOUR-KEY-HERE",
     "orb-ai.nvidiaModel": "qwen/qwen3.5-397b-a17b",
     "orb-ai.nvidiaBaseUrl": "https://integrate.api.nvidia.com/v1"
   }
   ```

3. **Test**: Press F5, open the chat, and type "Hello"
   - Watch **Qwen 3.5** with extended thinking provide intelligent responses
   - Model supports up to 16,384 tokens per response

### Option 2: Local Ollama (For Development)

1. **Install Ollama** (if not already installed)
   - Download from https://ollama.ai
   - Run: `ollama serve`

2. **Pull the Model**
   ```bash
   ollama pull qwen2.5-coder:7b
   ```

3. **VS Code Settings**
   ```json
   {
     "orb-ai.provider": "ollama",
     "orb-ai.ollamaUrl": "http://localhost:11434",
     "orb-ai.ollamaModel": "qwen2.5-coder:7b"
   }
   ```

### Option 3: Cloud API (OpenAI, Groq, DeepSeek, etc.)

1. **Get an API Key**
   - OpenAI: https://platform.openai.com/api-keys
   - Groq: https://console.groq.com
   - DeepSeek: https://platform.deepseek.com

2. **VS Code Settings**
   ```json
   {
     "orb-ai.provider": "cloud",
     "orb-ai.cloudBaseUrl": "https://api.openai.com/v1",
     "orb-ai.cloudModel": "gpt-4o-mini",
     "orb-ai.apiKey": "sk-..."
   }
   ```

3. **For Non-OpenAI Providers**:
   - **Groq**: Set `cloudBaseUrl` to `https://api.groq.com/openai/v1` and use model `mixtral-8x7b-32768`
   - **DeepSeek**: Set `cloudBaseUrl` to `https://api.deepseek.com` and use model `deepseek-coder`

## Architecture

### File Structure
```
src/ai/
├── types.ts                      # Core interfaces (ChatMessage, LLMProvider)
├── llmFactory.ts                 # getLLMProvider() factory
├── providers/
│   ├── nvidiaProvider.ts         # NVIDIA Qwen API (default)
│   ├── ollamaProvider.ts         # Local Ollama implementation
│   └── cloudProvider.ts          # OpenAI-compatible cloud API
└── index.ts                      # Public exports
```

### Message Flow
1. User types message → Send button clicked
2. `sidebarProvider.ts` → `handleUserMessage()`
3. Gets provider via `getLLMProvider()`
4. Streams response tokens via async generator
5. Each token sent to webview via `onStreamToken` message
6. Webview appends tokens to message in real-time

### Streaming Implementation
- Uses native Node.js `fetch()` API
- AsyncGenerator pattern for clean streaming
- SSE parsing (all providers)
- No external dependencies (no OpenAI SDK, axios, etc.)

## Configuration Properties

All properties can be set in VS Code Settings UI or directly in `settings.json`:

| Property | Default | Type | Notes |
|----------|---------|------|-------|
| `orb-ai.provider` | `nvidia` | string | `nvidia`, `ollama`, or `cloud` |
| `orb-ai.nvidiaApiKey` | `` | string | API key from https://integrate.api.nvidia.com |
| `orb-ai.nvidiaBaseUrl` | `https://integrate.api.nvidia.com/v1` | string | NVIDIA API endpoint |
| `orb-ai.nvidiaModel` | `qwen/qwen3.5-397b-a17b` | string | NVIDIA Qwen model with extended thinking |
| `orb-ai.ollamaUrl` | `http://localhost:11434` | string | Ollama server URL |
| `orb-ai.ollamaModel` | `qwen2.5-coder:7b` | string | Model name in Ollama |
| `orb-ai.cloudBaseUrl` | `https://api.openai.com/v1` | string | OpenAI-compatible endpoint |
| `orb-ai.cloudModel` | `gpt-4o-mini` | string | Cloud model name |
| `orb-ai.apiKey` | `` | string | API key for cloud provider |

## Security Notes

⚠️ **Development**: API keys stored in `settings.json` are fine for local development.

🔐 **Production**: When publishing, migrate to VS Code SecretStorage API:
```typescript
// Use this pattern for production
context.secrets.store('orb-ai.apiKey', apiKey);
const apiKey = await context.secrets.get('orb-ai.apiKey');
```

## Testing the Integration

1. **Press F5** to launch Extension Development Host
2. Open the ORB AI chat panel
3. Type a message like "Write a hello world function"
4. Watch tokens stream in real-time

### Troubleshooting

**Issue**: "LLM provider unavailable"
- **Ollama**: Make sure `ollama serve` is running on the configured URL
- **Cloud**: Check that `apiKey` is set and provider/baseUrl are correct

**Issue**: Chat doesn't respond
- Check VS Code Output → "ORB AI Logs" for error messages
- Verify network connectivity to the LLM endpoint
- Try switching providers to test

**Issue**: Tokens appear slowly
- This is normal for large models
- Local Ollama on CPU is slower than GPU
- Cloud APIs depend on internet speed and model load

## Next Steps

Once this is working, integrate repository context:
1. Build Phase 3: Graph-filtered context retrieval
2. Build Phase 4: System prompt injection with codebase awareness
3. Users can ask: "Refactor this function" with full codebase context
