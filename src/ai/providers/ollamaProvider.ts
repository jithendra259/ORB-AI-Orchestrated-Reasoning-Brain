import * as vscode from 'vscode';
import type { ChatMessage, LLMProvider, ToolDefinition, ToolCall } from '../types';

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
      body: JSON.stringify({ model: this.model, messages, stream: true, options: { temperature } }),
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
      for (const line of chunk.split('\n').filter(l => l.trim())) {
        try {
          const json = JSON.parse(line);
          if (json.message?.content) { yield json.message.content; }
        } catch { /* skip malformed */ }
      }
    }
  }

  /**
   * Non-streaming tool call — Ollama native /api/chat tools format.
   * Returns the full assistant content and any tool calls requested.
   */
  async chatWithTools(messages: ChatMessage[], tools: ToolDefinition[]): Promise<{ content: string; toolCalls: ToolCall[] }> {
    const config = vscode.workspace.getConfiguration('orb-ai');
    const temperature = config.get<number>('temperature', 0.5);

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages,
        tools,
        stream: false,
        options: { temperature },
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);
      throw new Error(`Ollama tool call error: ${errText}`);
    }

    const json = (await response.json()) as {
      message?: {
        content?: string;
        tool_calls?: Array<{
          function: { name: string; arguments: Record<string, any> };
        }>;
      };
    };

    const content = json.message?.content ?? '';
    const toolCalls: ToolCall[] = (json.message?.tool_calls ?? []).map((tc, i) => ({
      id: `ollama-tool-${Date.now()}-${i}`,
      name: tc.function.name,
      arguments: tc.function.arguments ?? {},
    }));

    return { content, toolCalls };
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  }
}
