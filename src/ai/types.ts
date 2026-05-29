export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMProvider {
  chat(messages: ChatMessage[]): AsyncGenerator<string>;
  isAvailable(): Promise<boolean>;
}

export type ProviderType = 'ollama' | 'cloud' | 'nvidia';
