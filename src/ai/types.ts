export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, {
        type: string;
        description: string;
        enum?: string[];
      }>;
      required?: string[];
    };
  };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export type ChatChunk =
  | { type: 'token'; value: string }
  | { type: 'toolCall'; call: ToolCall }
  | { type: 'done' };

export interface LLMProvider {
  chat(messages: ChatMessage[]): AsyncGenerator<string>;
  chatWithTools?(messages: ChatMessage[], tools: ToolDefinition[]): Promise<{ content: string; toolCalls: ToolCall[] }>;
  isAvailable(): Promise<boolean>;
}

export type ProviderType = 'ollama' | 'cloud' | 'nvidia' | 'anthropic';
