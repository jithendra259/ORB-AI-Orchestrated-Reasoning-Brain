import * as vscode from 'vscode';
import type { ChatMessage, LLMProvider } from '../types';

export class AnthropicProvider implements LLMProvider {
  private apiKey: string | undefined;
  private baseUrl: string;
  private model: string;

  constructor(modelName?: string) {
    const config = vscode.workspace.getConfiguration('orb-ai');
    this.apiKey = config.get<string>('anthropicApiKey');
    this.baseUrl = config.get<string>('anthropicBaseUrl', 'https://api.anthropic.com');
    this.model = modelName || config.get<string>('anthropicModel', 'claude-3-5-sonnet-latest');
  }

  async *chat(messages: ChatMessage[]): AsyncGenerator<string> {
    if (!this.apiKey) {
      throw new Error('Anthropic API Key not configured in ORB AI settings');
    }

    // Anthropic expects the system prompt as a separate top-level field
    const systemMsg = messages.find((m) => m.role === 'system');
    const userAssistantMsgs = messages.filter((m) => m.role !== 'system');

    const body: any = {
      model: this.model,
      messages: userAssistantMsgs.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      max_tokens: 4096,
      stream: true,
    };

    if (systemMsg) {
      body.system = systemMsg.content;
    }

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok || !response.body) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`Anthropic API error: ${response.status} - ${errorText}`);
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
        if (!line) continue;

        if (line.startsWith('data: ')) {
          try {
            const dataStr = line.substring(6).trim();
            if (dataStr === '[DONE]') continue;
            const json = JSON.parse(dataStr);
            if (json.type === 'content_block_delta' && json.delta?.text) {
              yield json.delta.text;
            }
          } catch {
            // skip malformed chunks
          }
        }
      }
    }
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }
}
