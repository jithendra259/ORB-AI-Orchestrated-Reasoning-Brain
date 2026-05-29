import * as vscode from 'vscode';
import type { ChatMessage, LLMProvider } from '../types';

export class OllamaProvider implements LLMProvider {
  private baseUrl: string;
  private model: string;

  constructor(modelName?: string) {
    const config = vscode.workspace.getConfiguration('orb-ai');
    this.baseUrl = config.get<string>('ollamaUrl', 'http://localhost:11434');
    this.model = modelName || config.get<string>('ollamaModel', 'qwen2.5-coder:7b');
  }

  async *chat(messages: ChatMessage[]): AsyncGenerator<string> {
    const config = vscode.workspace.getConfiguration('orb-ai');
    const temperature = config.get<number>('temperature', 0.5);

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: true,
        options: {
          temperature,
        },
      }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`Ollama error: ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      // Ollama streams newline-delimited JSON
      const lines = chunk.split('\n').filter((line) => line.trim());

      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          if (json.message?.content) {
            yield json.message.content;
          }
        } catch {
          // skip malformed chunks
        }
      }
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(2000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
