import * as vscode from 'vscode';
import type { LLMProvider } from './types';
import { OllamaProvider } from './providers/ollamaProvider';
import { CloudProvider } from './providers/cloudProvider';
import { NvidiaProvider } from './providers/nvidiaProvider';

export function getLLMProvider(): LLMProvider {
  const config = vscode.workspace.getConfiguration('orb-ai');
  const provider = config.get<'ollama' | 'cloud' | 'nvidia'>('provider', 'nvidia');

  switch (provider) {
    case 'cloud':
      return new CloudProvider();
    case 'ollama':
      return new OllamaProvider();
    case 'nvidia':
    default:
      return new NvidiaProvider();
  }
}
