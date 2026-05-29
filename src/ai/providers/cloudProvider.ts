import * as vscode from 'vscode';
import type { ChatMessage, LLMProvider } from '../types';

export class CloudProvider implements LLMProvider {
  private apiKey: string | undefined;
  private baseUrl: string;
  private model: string;

  constructor() {
    const config = vscode.workspace.getConfiguration('orb-ai');
    this.apiKey = config.get<string>('apiKey');
    this.baseUrl = config.get<string>('cloudBaseUrl', 'https://api.openai.com/v1');
    this.model = config.get<string>('cloudModel', 'gpt-4o-mini');
  }

  async *chat(messages: ChatMessage[]): AsyncGenerator<string> {
    if (!this.apiKey) throw new Error('API Key not configured in ORB AI settings');

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
        temperature,
        stream: true,
      }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`Cloud API error: ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk
        .split('\n')
        .filter((l) => l.startsWith('data: ') && l !== 'data: [DONE]');

      for (const line of lines) {
        try {
          const json = JSON.parse(line.replace('data: ', ''));
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          // skip malformed chunks
        }
      }
    }
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }
}
