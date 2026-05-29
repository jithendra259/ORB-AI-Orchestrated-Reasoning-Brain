import * as vscode from 'vscode';
import type { ChatMessage, LLMProvider, ToolDefinition, ToolCall } from '../types';

export class CloudProvider implements LLMProvider {
  private apiKey: string | undefined;
  private baseUrl: string;
  private model: string;

  constructor(modelName?: string) {
    const config = vscode.workspace.getConfiguration('orb-ai');
    this.apiKey = config.get<string>('apiKey');
    this.baseUrl = config.get<string>('cloudBaseUrl', 'https://api.openai.com/v1');
    this.model = modelName || config.get<string>('cloudModel', 'gpt-4o-mini');
  }

  async *chat(messages: ChatMessage[]): AsyncGenerator<string> {
    if (!this.apiKey) throw new Error('API Key not configured in ORB AI settings');
    const config = vscode.workspace.getConfiguration('orb-ai');
    const temperature = config.get<number>('temperature', 0.5);

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, messages, temperature, stream: true }),
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
      for (const line of chunk.split('\n').filter(l => l.startsWith('data: ') && l !== 'data: [DONE]')) {
        try {
          const json = JSON.parse(line.replace('data: ', ''));
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch { /* skip */ }
      }
    }
  }

  /**
   * OpenAI-compatible tool calling (non-streaming for reliability).
   * Compatible with OpenAI, DeepSeek, Groq, LM Studio, etc.
   */
  async chatWithTools(messages: ChatMessage[], tools: ToolDefinition[]): Promise<{ content: string; toolCalls: ToolCall[] }> {
    if (!this.apiKey) throw new Error('API Key not configured in ORB AI settings');
    const config = vscode.workspace.getConfiguration('orb-ai');
    const temperature = config.get<number>('temperature', 0.5);

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages,
        tools,
        tool_choice: 'auto',
        temperature,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);
      throw new Error(`Cloud API tool call error: ${errText}`);
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
    return !!this.apiKey;
  }
}
