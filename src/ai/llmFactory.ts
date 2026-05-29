import * as vscode from 'vscode';
import type { LLMProvider } from './types';
import { OllamaProvider } from './providers/ollamaProvider';
import { CloudProvider } from './providers/cloudProvider';
import { NvidiaProvider } from './providers/nvidiaProvider';
import { AnthropicProvider } from './providers/anthropicProvider';

export function getLLMProvider(providerType?: string, modelName?: string): LLMProvider {
  const config = vscode.workspace.getConfiguration('orb-ai');
  const provider = providerType || config.get<string>('provider', 'nvidia');

  switch (provider) {
    case 'cloud':
      return new CloudProvider(modelName);
    case 'ollama':
      return new OllamaProvider(modelName);
    case 'anthropic':
      return new AnthropicProvider(modelName);
    case 'nvidia':
    default:
      return new NvidiaProvider();
  }
}
