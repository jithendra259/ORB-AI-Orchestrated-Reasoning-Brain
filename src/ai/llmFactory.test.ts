import { getLLMProvider } from './llmFactory';
import { OllamaProvider } from './providers/ollamaProvider';
import { CloudProvider } from './providers/cloudProvider';
import { NvidiaProvider } from './providers/nvidiaProvider';
import { AnthropicProvider } from './providers/anthropicProvider';

jest.mock('./providers/ollamaProvider');
jest.mock('./providers/cloudProvider');
jest.mock('./providers/nvidiaProvider');
jest.mock('./providers/anthropicProvider');

describe('getLLMProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns OllamaProvider when providerType is ollama', () => {
    const provider = getLLMProvider('ollama', 'test-model');
    expect(OllamaProvider).toHaveBeenCalledWith('test-model');
    expect(provider).toBeInstanceOf(OllamaProvider);
  });

  it('returns CloudProvider when providerType is cloud', () => {
    const provider = getLLMProvider('cloud');
    expect(CloudProvider).toHaveBeenCalledWith(undefined);
    expect(provider).toBeInstanceOf(CloudProvider);
  });

  it('returns AnthropicProvider when providerType is anthropic', () => {
    const provider = getLLMProvider('anthropic');
    expect(AnthropicProvider).toHaveBeenCalledWith(undefined);
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });

  it('returns NvidiaProvider when providerType is nvidia', () => {
    const provider = getLLMProvider('nvidia');
    expect(NvidiaProvider).toHaveBeenCalledWith(undefined);
    expect(provider).toBeInstanceOf(NvidiaProvider);
  });

  it('falls back to default provider (nvidia via mock) if providerType is unknown', () => {
    const provider = getLLMProvider('unknown-provider');
    expect(NvidiaProvider).toHaveBeenCalledWith(undefined);
    expect(provider).toBeInstanceOf(NvidiaProvider);
  });

  it('uses configuration provider if providerType is not provided', () => {
    // mock implementation of vscode.workspace.getConfiguration returns 'nvidia' for 'provider' key
    const provider = getLLMProvider();
    expect(NvidiaProvider).toHaveBeenCalledWith(undefined);
    expect(provider).toBeInstanceOf(NvidiaProvider);
  });
});
