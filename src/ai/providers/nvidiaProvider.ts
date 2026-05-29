import * as vscode from 'vscode';
import type { ChatMessage, LLMProvider } from '../types';

export class NvidiaProvider implements LLMProvider {
  private apiKey: string | undefined;
  private baseUrl: string;
  private model: string;

  constructor() {
    const config = vscode.workspace.getConfiguration('orb-ai');
    this.apiKey = config.get<string>('nvidiaApiKey');
    this.baseUrl = config.get<string>('nvidiaBaseUrl', 'https://integrate.api.nvidia.com/v1');
    this.model = config.get<string>('nvidiaModel', 'qwen/qwen3.5-397b-a17b');
  }

  async *chat(messages: ChatMessage[]): AsyncGenerator<string> {
    if (!this.apiKey) throw new Error('NVIDIA API Key not configured in ORB AI settings');

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
        temperature: 0.6,
        top_p: 0.95,
        top_k: 20,
        presence_penalty: 0,
        repetition_penalty: 1,
        stream: true,
        chat_template_kwargs: { enable_thinking: true },
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

      // Keep the last incomplete line in the buffer
      buffer = lines[lines.length - 1];

      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i].trim();

        // Skip empty lines and stream markers
        if (!line || line === '[DONE]') continue;

        // Parse SSE format: "data: {...json...}"
        if (line.startsWith('data: ')) {
          try {
            const json = JSON.parse(line.slice(6));
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) yield delta;
          } catch {
            // skip malformed chunks
          }
        }
      }
    }

    // Process any remaining buffer content
    if (buffer.trim() && buffer.trim() !== '[DONE]') {
      if (buffer.trim().startsWith('data: ')) {
        try {
          const json = JSON.parse(buffer.trim().slice(6));
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          // skip malformed chunks
        }
      }
    }
  }

  async isAvailable(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
        signal: AbortSignal.timeout(2000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
