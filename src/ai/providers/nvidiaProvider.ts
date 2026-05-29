import * as vscode from 'vscode';
import type { ChatMessage, LLMProvider, ToolDefinition, ToolCall } from '../types';

export class NvidiaProvider implements LLMProvider {
  private apiKey: string | undefined;
  private baseUrl: string;
  private model: string;

  constructor(modelName?: string) {
    const config = vscode.workspace.getConfiguration('orb-ai');
    this.apiKey = config.get<string>('nvidiaApiKey');
    this.baseUrl = config.get<string>('nvidiaBaseUrl', 'https://integrate.api.nvidia.com/v1');
    this.model = modelName || config.get<string>('nvidiaModel', 'qwen/qwen3.5-397b-a17b');
  }

  async *chat(messages: ChatMessage[]): AsyncGenerator<string> {
    if (!this.apiKey) throw new Error('NVIDIA API Key not configured in ORB AI settings');
    const config = vscode.workspace.getConfiguration('orb-ai');
    const temperature = config.get<number>('temperature', 0.5);

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        max_tokens: 16384,
        temperature,
        top_p: 0.95,
        stream: true,
      }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`NVIDIA API error: ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines[lines.length - 1];
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i].trim();
        if (!line || line === '[DONE]') continue;
        if (line.startsWith('data: ')) {
          try {
            const json = JSON.parse(line.slice(6));
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) yield delta;
          } catch { /* skip */ }
        }
      }
    }

    if (buffer.trim() && buffer.trim() !== '[DONE]' && buffer.trim().startsWith('data: ')) {
      try {
        const json = JSON.parse(buffer.trim().slice(6));
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch { /* skip */ }
    }
  }

  /**
   * NVIDIA is OpenAI-compatible so we use the same tool calling format.
   */
  async chatWithTools(messages: ChatMessage[], tools: ToolDefinition[]): Promise<{ content: string; toolCalls: ToolCall[] }> {
    if (!this.apiKey) throw new Error('NVIDIA API Key not configured in ORB AI settings');
    const config = vscode.workspace.getConfiguration('orb-ai');
    const temperature = config.get<number>('temperature', 0.5);

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        tools,
        tool_choice: 'auto',
        max_tokens: 16384,
        temperature,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);
      throw new Error(`NVIDIA tool call error: ${errText}`);
    }

    const json = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{
            id: string;
            function: { name: string; arguments: string };
          }>;
        };
      }>;
    };

    const msg = json.choices?.[0]?.message;
    const content = msg?.content ?? '';
    const toolCalls: ToolCall[] = (msg?.tool_calls ?? []).map(tc => ({
      id: tc.id,
      name: tc.function.name,
      arguments: (() => {
        try { return JSON.parse(tc.function.arguments); }
        catch { return {}; }
      })(),
    }));

    return { content, toolCalls };
  }

  async isAvailable(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(2000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
