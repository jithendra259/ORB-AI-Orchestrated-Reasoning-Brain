import * as vscode from 'vscode';
import * as path from 'path';
import type { RepositoryIntelligenceService, RepositoryIntelligenceSnapshot } from '../scanner';
import type { OrbLogger } from '../utils/logger';
import { OrbAiChatHandler } from './chatHandler';
import { escapeHtml, formatPercent } from './html';
import { getLLMProvider } from '../ai';

export class OrbAiViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'orb-ai.repositoryView';

  private view: vscode.WebviewView | undefined;
  private snapshot: RepositoryIntelligenceSnapshot | undefined;
  private chatHandler: OrbAiChatHandler;
  private messageHistory: Array<{ role: string; content: string }> = [];

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly intelligenceService: RepositoryIntelligenceService,
    private readonly logger: OrbLogger,
  ) {
    this.chatHandler = new OrbAiChatHandler(logger);

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('orb-ai') && this.view) {
        this.pushConfigToWebview();
      }
    });
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    this.snapshot = this.intelligenceService.getSnapshot();
    this.chatHandler.setSnapshot(this.snapshot);

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.onDidReceiveMessage(async (message: { command?: string; text?: string; data?: any }) => {
      switch (message.command) {
        case 'scanRepository':
          await vscode.commands.executeCommand('orb-ai.scanRepository');
          break;
        case 'showGraph':
          await vscode.commands.executeCommand('orb-ai.showRepositoryGraph');
          break;
        case 'loadScan':
          try {
            const workspaceRoot = this.intelligenceService.getWorkspaceRoot();
            if (!workspaceRoot) {
              webviewView.webview.postMessage({ command: 'scanLoadError', text: 'No workspace root found' });
              break;
            }
            const scanPath = path.join(workspaceRoot, 'out', 'repository-scan.json');
            const uri = vscode.Uri.file(scanPath);
            const bytes = await vscode.workspace.fs.readFile(uri);
            const json = JSON.parse(Buffer.from(bytes).toString('utf8'));
            webviewView.webview.postMessage({ command: 'scanLoaded', data: json });
          } catch (err) {
            webviewView.webview.postMessage({ command: 'scanLoadError', text: String(err) });
          }
          break;
        case 'sendMessage':
          if (message.text) {
            await this.handleUserMessage(message.text, message.data?.sessionSettings);
          }
          break;
        case 'checkProviderStatus':
          await this.checkAndPushProviderStatus(message.data?.provider, message.data?.model);
          break;
        case 'getModels':
          if (message.data?.provider === 'ollama') {
            await this.fetchAndPushOllamaModels();
          }
          break;
        case 'openSettings':
          await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:orb-ai');
          break;
        case 'showUpgradeMessage':
          if (message.text) {
            vscode.window.showInformationMessage(message.text);
          }
          break;
        case 'clearHistory':
          this.messageHistory = [];
          break;
        case 'updateConfig':
          if (message.data) {
            try {
              const config = vscode.workspace.getConfiguration('orb-ai');
              const {
                provider, nvidiaApiKey, nvidiaModel, nvidiaBaseUrl,
                apiKey, cloudModel, cloudBaseUrl,
                ollamaUrl, ollamaModel,
                anthropicApiKey, anthropicBaseUrl, anthropicModel,
                toolsSafety, systemPrompt, temperature,
              } = message.data;

              if (provider !== undefined) { await config.update('provider', provider, vscode.ConfigurationTarget.Global); }
              if (nvidiaApiKey !== undefined) { await config.update('nvidiaApiKey', nvidiaApiKey, vscode.ConfigurationTarget.Global); }
              if (nvidiaModel !== undefined) { await config.update('nvidiaModel', nvidiaModel, vscode.ConfigurationTarget.Global); }
              if (nvidiaBaseUrl !== undefined) { await config.update('nvidiaBaseUrl', nvidiaBaseUrl, vscode.ConfigurationTarget.Global); }
              if (apiKey !== undefined) { await config.update('apiKey', apiKey, vscode.ConfigurationTarget.Global); }
              if (cloudModel !== undefined) { await config.update('cloudModel', cloudModel, vscode.ConfigurationTarget.Global); }
              if (cloudBaseUrl !== undefined) { await config.update('cloudBaseUrl', cloudBaseUrl, vscode.ConfigurationTarget.Global); }
              if (ollamaUrl !== undefined) { await config.update('ollamaUrl', ollamaUrl, vscode.ConfigurationTarget.Global); }
              if (ollamaModel !== undefined) { await config.update('ollamaModel', ollamaModel, vscode.ConfigurationTarget.Global); }
              if (anthropicApiKey !== undefined) { await config.update('anthropicApiKey', anthropicApiKey, vscode.ConfigurationTarget.Global); }
              if (anthropicBaseUrl !== undefined) { await config.update('anthropicBaseUrl', anthropicBaseUrl, vscode.ConfigurationTarget.Global); }
              if (anthropicModel !== undefined) { await config.update('anthropicModel', anthropicModel, vscode.ConfigurationTarget.Global); }
              if (toolsSafety !== undefined) { await config.update('toolsSafety', toolsSafety, vscode.ConfigurationTarget.Global); }
              if (systemPrompt !== undefined) { await config.update('systemPrompt', systemPrompt, vscode.ConfigurationTarget.Global); }
              if (temperature !== undefined) { await config.update('temperature', Number(temperature), vscode.ConfigurationTarget.Global); }

              vscode.window.showInformationMessage('ORB AI settings saved ✓');
              await this.checkAndPushProviderStatus();
            } catch (err) {
              this.logger.error('Failed to update config settings', err);
              vscode.window.showErrorMessage(`Failed to update settings: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
          break;
        default:
          this.logger.warn('Unknown ORB AI webview message', message);
      }
    });

    this.render();
    this.pushConfigToWebview();
  }

  public refresh(snapshot?: RepositoryIntelligenceSnapshot): void {
    this.snapshot = snapshot ?? this.intelligenceService.getSnapshot();
    this.chatHandler.setSnapshot(this.snapshot);
    this.render();
    this.pushConfigToWebview();
  }

  private pushConfigToWebview(): void {
    const config = vscode.workspace.getConfiguration('orb-ai');
    this.view?.webview.postMessage({
      type: 'configUpdated',
      config: {
        provider: config.get<string>('provider', 'nvidia'),
        nvidiaApiKey: config.get<string>('nvidiaApiKey', ''),
        nvidiaModel: config.get<string>('nvidiaModel', 'qwen/qwen3.5-397b-a17b'),
        nvidiaBaseUrl: config.get<string>('nvidiaBaseUrl', 'https://integrate.api.nvidia.com/v1'),
        apiKey: config.get<string>('apiKey', ''),
        cloudModel: config.get<string>('cloudModel', 'gpt-4o-mini'),
        cloudBaseUrl: config.get<string>('cloudBaseUrl', 'https://api.openai.com/v1'),
        ollamaUrl: config.get<string>('ollamaUrl', 'http://localhost:11434'),
        ollamaModel: config.get<string>('ollamaModel', 'qwen2.5-coder:7b'),
        anthropicApiKey: config.get<string>('anthropicApiKey', ''),
        anthropicBaseUrl: config.get<string>('anthropicBaseUrl', 'https://api.anthropic.com'),
        anthropicModel: config.get<string>('anthropicModel', 'claude-3-5-sonnet-latest'),
        toolsSafety: config.get<string>('toolsSafety', 'safe'),
        systemPrompt: config.get<string>('systemPrompt', 'You are ORB AI, a helpful and knowledgeable codebase reasoning assistant.'),
        temperature: config.get<number>('temperature', 0.5),
      },
    });
    this.checkAndPushProviderStatus();
  }

  private async checkAndPushProviderStatus(providerType?: string, modelName?: string): Promise<void> {
    try {
      const provider = getLLMProvider(providerType, modelName);
      const available = await provider.isAvailable();
      const config = vscode.workspace.getConfiguration('orb-ai');
      const providerTypeResolved = providerType || config.get<string>('provider', 'nvidia');
      this.view?.webview.postMessage({
        type: 'providerStatus',
        status: available ? 'connected' : 'error',
        provider: providerTypeResolved,
      });
    } catch {
      this.view?.webview.postMessage({ type: 'providerStatus', status: 'error', provider: 'unknown' });
    }
  }

  private async fetchAndPushOllamaModels(): Promise<void> {
    try {
      const config = vscode.workspace.getConfiguration('orb-ai');
      const ollamaUrl = config.get<string>('ollamaUrl', 'http://localhost:11434');
      const response = await fetch(`${ollamaUrl}/api/tags`);
      if (response.ok) {
        const json = (await response.json()) as { models?: Array<{ name: string }> };
        const models = json.models?.map((m) => m.name) || [];
        this.view?.webview.postMessage({ type: 'ollamaModelsLoaded', models });
      } else {
        throw new Error(`Failed to fetch Ollama models: ${response.statusText}`);
      }
    } catch (err) {
      this.view?.webview.postMessage({ type: 'ollamaModelsError', error: String(err) });
    }
  }

  private async handleUserMessage(userMessage: string, sessionSettings?: any): Promise<void> {
    try {
      this.messageHistory.push({ role: 'user', content: userMessage });

      // Resolve provider: use session settings but fall back to VS Code config
      const config = vscode.workspace.getConfiguration('orb-ai');
      let providerType = sessionSettings?.provider;
      let modelName = sessionSettings?.model;

      // If session is on 'auto' or undefined, use global config provider
      if (!providerType || providerType === 'auto') {
        providerType = config.get<string>('provider', 'nvidia');
      }
      // If model is 'auto' or undefined, use global config model for that provider
      if (!modelName || modelName === 'auto') {
        if (providerType === 'nvidia') { modelName = config.get<string>('nvidiaModel', 'qwen/qwen3.5-397b-a17b'); }
        else if (providerType === 'cloud') { modelName = config.get<string>('cloudModel', 'gpt-4o-mini'); }
        else if (providerType === 'ollama') { modelName = config.get<string>('ollamaModel', 'qwen2.5-coder:7b'); }
        else if (providerType === 'anthropic') { modelName = config.get<string>('anthropicModel', 'claude-3-5-sonnet-latest'); }
      }

      const provider = getLLMProvider(providerType, modelName);
      const available = await provider.isAvailable();

      if (!available) {
        this.view?.webview.postMessage({
          type: 'aiError',
          value: `❌ ${providerType} provider is unavailable. Check your API key and settings.`,
          isOllamaOffline: providerType === 'ollama',
        });
        return;
      }

      this.view?.webview.postMessage({ type: 'streamStart' });

      const systemPrompt = config.get<string>('systemPrompt', '');
      const messages = this.messageHistory.map((msg) => ({
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
      }));

      if (systemPrompt) {
        messages.unshift({ role: 'system', content: systemPrompt });
      }

      let fullResponse = '';
      for await (const token of provider.chat(messages)) {
        fullResponse += token;
        this.view?.webview.postMessage({ type: 'streamToken', value: token });
      }

      this.view?.webview.postMessage({ type: 'streamEnd' });
      this.messageHistory.push({ role: 'assistant', content: fullResponse });
    } catch (err: any) {
      this.view?.webview.postMessage({ type: 'aiError', value: `❌ Error: ${err.message ?? String(err)}` });
      this.logger.error('LLM chat error', err);
    }
  }

  private render(): void {
    if (!this.view) { return; }
    this.view.webview.html = this.getHtml(this.view.webview);
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const summary = this.snapshot?.summary;
    const config = vscode.workspace.getConfiguration('orb-ai');
    const initialConfig = JSON.stringify({
      provider: config.get<string>('provider', 'nvidia'),
      nvidiaApiKey: config.get<string>('nvidiaApiKey', ''),
      nvidiaModel: config.get<string>('nvidiaModel', 'qwen/qwen3.5-397b-a17b'),
      nvidiaBaseUrl: config.get<string>('nvidiaBaseUrl', 'https://integrate.api.nvidia.com/v1'),
      apiKey: config.get<string>('apiKey', ''),
      cloudModel: config.get<string>('cloudModel', 'gpt-4o-mini'),
      cloudBaseUrl: config.get<string>('cloudBaseUrl', 'https://api.openai.com/v1'),
      ollamaUrl: config.get<string>('ollamaUrl', 'http://localhost:11434'),
      ollamaModel: config.get<string>('ollamaModel', 'qwen2.5-coder:7b'),
      anthropicApiKey: config.get<string>('anthropicApiKey', ''),
      anthropicBaseUrl: config.get<string>('anthropicBaseUrl', 'https://api.anthropic.com'),
      anthropicModel: config.get<string>('anthropicModel', 'claude-3-5-sonnet-latest'),
      toolsSafety: config.get<string>('toolsSafety', 'safe'),
      systemPrompt: config.get<string>('systemPrompt', 'You are ORB AI, a helpful and knowledgeable codebase reasoning assistant.'),
      temperature: config.get<number>('temperature', 0.5),
    });

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ORB AI</title>
  <style>
    :root { color-scheme: dark; }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      padding: 0;
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      font-size: 13px;
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* ─── Top Toolbar ─── */
    .orb-toolbar {
      display: flex;
      align-items: center;
      padding: 8px 12px 6px;
      gap: 6px;
      border-bottom: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
      flex-shrink: 0;
    }
    .orb-logo {
      display: flex;
      align-items: center;
      gap: 6px;
      flex: 1;
      min-width: 0;
    }
    .orb-logo-icon {
      width: 22px;
      height: 22px;
      border-radius: 6px;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      flex-shrink: 0;
      box-shadow: 0 2px 8px rgba(99,102,241,0.4);
    }
    .orb-logo-text {
      font-size: 13px;
      font-weight: 700;
      color: var(--vscode-foreground);
      letter-spacing: 0.3px;
    }
    .orb-logo-sub {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      margin-left: 2px;
    }
    .toolbar-actions {
      display: flex;
      align-items: center;
      gap: 2px;
    }
    .tb-btn {
      background: transparent;
      border: none;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      padding: 4px 5px;
      border-radius: 5px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s, color 0.15s;
      font-size: 11px;
    }
    .tb-btn:hover {
      background: var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.07));
      color: var(--vscode-foreground);
    }
    .provider-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #6b7280;
      display: inline-block;
      margin-right: 4px;
      transition: background 0.3s;
    }
    .provider-dot.connected { background: #22c55e; box-shadow: 0 0 6px rgba(34,197,94,0.5); }
    .provider-dot.error { background: #ef4444; }
    .provider-label {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      font-weight: 500;
    }

    /* ─── Settings Panel Overlay ─── */
    .settings-overlay {
      display: none;
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      z-index: 200;
      background: var(--vscode-sideBar-background);
      flex-direction: column;
    }
    .settings-overlay.open {
      display: flex;
    }
    .settings-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
      flex-shrink: 0;
    }
    .settings-header h2 {
      margin: 0;
      font-size: 13px;
      font-weight: 600;
      flex: 1;
    }
    .settings-body {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .settings-section-title {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 6px;
      margin-top: 4px;
    }
    .form-row {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .form-row label {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      font-weight: 500;
    }
    .form-row input,
    .form-row select,
    .form-row textarea {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, rgba(255,255,255,0.12));
      border-radius: 5px;
      padding: 5px 8px;
      font-family: inherit;
      font-size: 12px;
      outline: none;
      transition: border-color 0.15s;
    }
    .form-row input:focus,
    .form-row select:focus,
    .form-row textarea:focus {
      border-color: var(--vscode-focusBorder, #6366f1);
    }
    .pw-wrap {
      position: relative;
      display: flex;
    }
    .pw-wrap input {
      flex: 1;
      padding-right: 28px;
    }
    .pw-eye {
      position: absolute;
      right: 7px;
      top: 50%;
      transform: translateY(-50%);
      cursor: pointer;
      font-size: 13px;
      color: var(--vscode-descriptionForeground);
      user-select: none;
    }
    .provider-section { display: none; }
    .provider-section.active { display: flex; flex-direction: column; gap: 10px; }
    .settings-footer {
      padding: 10px 12px;
      border-top: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
      flex-shrink: 0;
    }
    .save-btn {
      width: 100%;
      padding: 7px;
      background: linear-gradient(135deg, #6366f1, #7c3aed);
      color: #fff;
      border: none;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s, transform 0.1s;
      font-family: inherit;
    }
    .save-btn:hover { opacity: 0.9; }
    .save-btn:active { transform: scale(0.98); }

    /* ─── Quick Action Bar ─── */
    .quick-bar {
      display: flex;
      gap: 5px;
      padding: 6px 10px;
      flex-shrink: 0;
      border-bottom: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.06));
    }
    .quick-btn {
      flex: 1;
      padding: 5px 6px;
      background: var(--vscode-button-secondaryBackground, rgba(255,255,255,0.05));
      color: var(--vscode-button-secondaryForeground, var(--vscode-descriptionForeground));
      border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
      border-radius: 5px;
      font-size: 11px;
      cursor: pointer;
      font-family: inherit;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .quick-btn:hover {
      background: var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.1));
      color: var(--vscode-foreground);
      border-color: rgba(99,102,241,0.4);
    }

    /* ─── Chat Area ─── */
    .chat-area {
      flex: 1;
      overflow-y: auto;
      padding: 10px 10px 6px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      scroll-behavior: smooth;
    }
    .chat-area::-webkit-scrollbar { width: 4px; }
    .chat-area::-webkit-scrollbar-track { background: transparent; }
    .chat-area::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }

    /* Welcome card */
    .welcome-card {
      background: linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.05));
      border: 1px solid rgba(99,102,241,0.2);
      border-radius: 10px;
      padding: 14px;
      margin-top: 4px;
    }
    .welcome-title {
      font-size: 13px;
      font-weight: 700;
      color: var(--vscode-foreground);
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .welcome-sub {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      line-height: 1.5;
    }
    .welcome-hints {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-top: 10px;
    }
    .hint-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 4px 8px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 5px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
      text-align: left;
    }
    .hint-chip:hover {
      background: rgba(99,102,241,0.1);
      border-color: rgba(99,102,241,0.3);
      color: var(--vscode-foreground);
    }

    /* Messages */
    .msg-user {
      display: flex;
      justify-content: flex-end;
    }
    .msg-user .bubble {
      background: linear-gradient(135deg, #6366f1, #7c3aed);
      color: #fff;
      border-radius: 12px 12px 3px 12px;
      padding: 8px 12px;
      max-width: 88%;
      font-size: 13px;
      line-height: 1.5;
      word-break: break-word;
      white-space: pre-wrap;
      box-shadow: 0 2px 8px rgba(99,102,241,0.25);
    }
    .msg-ai {
      display: flex;
      align-items: flex-start;
      gap: 7px;
    }
    .ai-avatar {
      width: 22px;
      height: 22px;
      border-radius: 6px;
      background: linear-gradient(135deg, #1e293b, #334155);
      border: 1px solid rgba(99,102,241,0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      flex-shrink: 0;
      margin-top: 2px;
    }
    .msg-ai .bubble {
      background: var(--vscode-editor-background, rgba(255,255,255,0.04));
      border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
      border-radius: 3px 12px 12px 12px;
      padding: 8px 12px;
      max-width: calc(100% - 34px);
      font-size: 13px;
      line-height: 1.6;
      color: var(--vscode-foreground);
      word-break: break-word;
      white-space: pre-wrap;
    }
    .msg-error .bubble {
      background: rgba(239,68,68,0.08);
      border-color: rgba(239,68,68,0.3);
      color: #f87171;
    }
    .typing-dot {
      display: inline-block;
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: var(--vscode-descriptionForeground);
      animation: typingBlink 1s ease-in-out infinite;
      margin: 0 1px;
    }
    .typing-dot:nth-child(2) { animation-delay: 0.2s; }
    .typing-dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes typingBlink {
      0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
      40% { opacity: 1; transform: scale(1); }
    }

    /* ─── Model Selector Bar ─── */
    .model-bar {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 5px 10px;
      border-top: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.06));
      flex-shrink: 0;
      position: relative;
    }
    .model-chip {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.09);
      border-radius: 20px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      transition: all 0.15s;
      user-select: none;
      white-space: nowrap;
    }
    .model-chip:hover {
      background: rgba(99,102,241,0.1);
      border-color: rgba(99,102,241,0.3);
      color: var(--vscode-foreground);
    }
    .model-chip.active {
      border-color: rgba(99,102,241,0.4);
      color: var(--vscode-foreground);
    }
    .model-chip-icon { font-size: 10px; }
    .model-chip-caret { font-size: 7px; opacity: 0.6; }

    /* Model popover */
    .model-popover {
      position: absolute;
      bottom: calc(100% + 6px);
      left: 8px;
      right: 8px;
      background: var(--vscode-menu-background, #1e1e2e);
      border: 1px solid var(--vscode-menu-border, rgba(255,255,255,0.12));
      border-radius: 10px;
      box-shadow: 0 -8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(99,102,241,0.1);
      z-index: 100;
      display: flex;
      flex-direction: column;
      max-height: 280px;
      overflow: hidden;
    }
    .model-popover.hidden { display: none; }
    .popover-search {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 10px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .popover-search input {
      flex: 1;
      background: transparent;
      border: none;
      color: var(--vscode-foreground);
      font-size: 12px;
      font-family: inherit;
      outline: none;
    }
    .popover-search input::placeholder { color: var(--vscode-descriptionForeground); }
    .popover-list {
      overflow-y: auto;
      flex: 1;
      padding: 4px 0;
    }
    .popover-list::-webkit-scrollbar { width: 3px; }
    .popover-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
    .pop-section {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: var(--vscode-descriptionForeground);
      padding: 6px 12px 2px;
    }
    .pop-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 12px;
      cursor: pointer;
      transition: background 0.1s;
    }
    .pop-item:hover { background: rgba(99,102,241,0.08); }
    .pop-item.selected { background: rgba(99,102,241,0.12); }
    .pop-check { width: 14px; font-size: 11px; color: #6366f1; text-align: center; flex-shrink: 0; }
    .pop-name { flex: 1; font-size: 12px; color: var(--vscode-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pop-provider { font-size: 10px; color: var(--vscode-descriptionForeground); }
    .pop-badge {
      font-size: 9px;
      font-weight: 700;
      padding: 1px 5px;
      border-radius: 10px;
      color: #fff;
    }

    /* ─── Chat Input ─── */
    .input-area {
      padding: 0 8px 8px;
      flex-shrink: 0;
    }
    .input-box {
      display: flex;
      align-items: flex-end;
      gap: 6px;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, rgba(255,255,255,0.1));
      border-radius: 10px;
      padding: 8px 8px 8px 12px;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .input-box:focus-within {
      border-color: rgba(99,102,241,0.5);
      box-shadow: 0 0 0 2px rgba(99,102,241,0.1);
    }
    .input-box textarea {
      flex: 1;
      background: transparent;
      border: none;
      color: var(--vscode-input-foreground);
      font-family: inherit;
      font-size: 13px;
      line-height: 1.5;
      outline: none;
      resize: none;
      min-height: 20px;
      max-height: 120px;
      padding: 0;
      margin: 0;
    }
    .input-box textarea::placeholder { color: var(--vscode-input-placeholderForeground); }
    .send-btn {
      width: 28px;
      height: 28px;
      border-radius: 7px;
      background: linear-gradient(135deg, #6366f1, #7c3aed);
      color: #fff;
      border: none;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: opacity 0.15s, transform 0.1s;
      padding: 0;
      flex-shrink: 0;
      box-shadow: 0 2px 8px rgba(99,102,241,0.3);
    }
    .send-btn:hover { opacity: 0.9; transform: scale(1.05); }
    .send-btn:active { transform: scale(0.95); }
    .send-btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }

    /* ─── Summary stats ─── */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 6px;
      margin: 2px 0;
    }
    .stat-card {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.06));
      border-radius: 7px;
      padding: 8px 10px;
    }
    .stat-val { font-size: 17px; font-weight: 700; color: var(--vscode-foreground); }
    .stat-lbl { font-size: 10px; color: var(--vscode-descriptionForeground); margin-top: 2px; }
    .data-list { display: flex; flex-direction: column; gap: 5px; }
    .data-item {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.06));
      border-radius: 6px;
      padding: 7px 10px;
    }
    .data-item-title { display: flex; justify-content: space-between; font-size: 12px; font-weight: 600; }
    .data-item-meta { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 2px; overflow-wrap: anywhere; }
    .section-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.7px;
      color: var(--vscode-descriptionForeground);
      margin: 6px 0 4px;
    }
    .hidden { display: none !important; }
  </style>
</head>
<body>

<!-- ─── Settings Overlay ─── -->
<div class="settings-overlay" id="settingsOverlay">
  <div class="settings-header">
    <button class="tb-btn" id="settingsBackBtn" title="Back to Chat">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
    </button>
    <h2>ORB AI Settings</h2>
    <span class="provider-dot" id="settingsDot"></span>
    <span class="provider-label" id="settingsProviderLabel">Checking...</span>
  </div>
  <div class="settings-body">
    <div class="settings-section-title">Provider</div>
    <div class="form-row">
      <label for="providerSelect">Active Provider</label>
      <select id="providerSelect">
        <option value="nvidia">🖥️ NVIDIA (Qwen) — Recommended</option>
        <option value="cloud">☁️ Cloud OpenAI-Compatible</option>
        <option value="ollama">🦙 Ollama — Local LLM</option>
        <option value="anthropic">🤖 Anthropic (Claude)</option>
      </select>
    </div>

    <!-- NVIDIA -->
    <div class="provider-section" id="nvidiaSection">
      <div class="settings-section-title">NVIDIA Settings</div>
      <div class="form-row">
        <label for="nvidiaApiKey">API Key</label>
        <div class="pw-wrap"><input type="password" id="nvidiaApiKey" placeholder="nvapi-..."><span class="pw-eye" data-target="nvidiaApiKey">👁️</span></div>
      </div>
      <div class="form-row">
        <label for="nvidiaModel">Model</label>
        <input type="text" id="nvidiaModel" placeholder="qwen/qwen3.5-397b-a17b">
      </div>
      <div class="form-row">
        <label for="nvidiaBaseUrl">Base URL</label>
        <input type="text" id="nvidiaBaseUrl">
      </div>
    </div>

    <!-- Cloud -->
    <div class="provider-section" id="cloudSection">
      <div class="settings-section-title">Cloud / OpenAI Settings</div>
      <div class="form-row">
        <label for="cloudApiKey">API Key</label>
        <div class="pw-wrap"><input type="password" id="cloudApiKey" placeholder="sk-..."><span class="pw-eye" data-target="cloudApiKey">👁️</span></div>
      </div>
      <div class="form-row"><label for="cloudModel">Model</label><input type="text" id="cloudModel" placeholder="gpt-4o-mini"></div>
      <div class="form-row"><label for="cloudBaseUrl">Base URL</label><input type="text" id="cloudBaseUrl"></div>
    </div>

    <!-- Ollama -->
    <div class="provider-section" id="ollamaSection">
      <div class="settings-section-title">Ollama Settings</div>
      <div class="form-row"><label for="ollamaUrl">Server URL</label><input type="text" id="ollamaUrl" placeholder="http://localhost:11434"></div>
      <div class="form-row"><label for="ollamaModel">Model</label><input type="text" id="ollamaModel" placeholder="qwen2.5-coder:7b"></div>
    </div>

    <!-- Anthropic -->
    <div class="provider-section" id="anthropicSection">
      <div class="settings-section-title">Anthropic Settings</div>
      <div class="form-row">
        <label for="anthropicApiKey">API Key</label>
        <div class="pw-wrap"><input type="password" id="anthropicApiKey" placeholder="sk-ant-..."><span class="pw-eye" data-target="anthropicApiKey">👁️</span></div>
      </div>
      <div class="form-row"><label for="anthropicModel">Model</label><input type="text" id="anthropicModel" placeholder="claude-3-5-sonnet-latest"></div>
      <div class="form-row"><label for="anthropicBaseUrl">Base URL</label><input type="text" id="anthropicBaseUrl"></div>
    </div>

    <!-- Global -->
    <div class="settings-section-title">Behavior</div>
    <div class="form-row">
      <label for="systemPrompt">System Prompt</label>
      <textarea id="systemPrompt" rows="3" style="resize:vertical;"></textarea>
    </div>
    <div class="form-row">
      <label for="temperatureInput">Temperature: <span id="temperatureVal">0.5</span></label>
      <input type="range" id="temperatureInput" min="0" max="2" step="0.1">
    </div>
    <div class="form-row">
      <label for="toolsSafetySelect">Tool Safety</label>
      <select id="toolsSafetySelect">
        <option value="safe">🛡️ Ask before running</option>
        <option value="readOnly">⚡ Auto-run read-only</option>
        <option value="dangerous">⚠️ Auto-run all</option>
      </select>
    </div>
  </div>
  <div class="settings-footer">
    <button class="save-btn" id="saveConfigBtn">Save Settings</button>
  </div>
</div>

<!-- ─── Main UI ─── -->
<div class="orb-toolbar">
  <div class="orb-logo">
    <div class="orb-logo-icon">🧠</div>
    <span class="orb-logo-text">ORB AI</span>
  </div>
  <div class="toolbar-actions">
    <span class="provider-dot" id="providerDot"></span>
    <span class="provider-label" id="providerLabel">Checking...</span>
    <button class="tb-btn" id="clearChatBtn" title="Clear conversation">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
    </button>
    <button class="tb-btn" id="openSettingsBtn" title="Settings">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9"/></svg>
    </button>
  </div>
</div>

<!-- Quick action buttons -->
<div class="quick-bar">
  <button class="quick-btn" id="scanRepository">⚡ Scan Repo</button>
  <button class="quick-btn" id="showGraph">🕸️ Graph</button>
  <button class="quick-btn" id="loadScan">📂 Load Scan</button>
</div>

<!-- Chat messages area -->
<div class="chat-area" id="chatArea">
  ${summary ? renderSummaryCards(this.snapshot as RepositoryIntelligenceSnapshot) : renderWelcomeCard()}
</div>

<!-- Model selector bar -->
<div class="model-bar">
  <div class="model-chip active" id="modelChip">
    <span class="model-chip-icon">🤖</span>
    <span id="modelChipLabel">Auto</span>
    <span class="model-chip-caret">▾</span>
  </div>
  <div style="flex:1"></div>
  <div class="model-chip" id="contextChip" title="Context Mode">
    <span id="contextChipLabel">🕸️ Auto</span>
    <span class="model-chip-caret">▾</span>
  </div>
</div>

<!-- Model popover -->
<div class="model-popover hidden" id="modelPopover">
  <div class="popover-search">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--vscode-descriptionForeground);flex-shrink:0"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
    <input type="text" id="popoverSearch" placeholder="Search models..." autocomplete="off">
  </div>
  <div class="popover-list" id="popoverList"></div>
</div>

<!-- Input area -->
<div class="input-area">
  <div class="input-box">
    <textarea id="messageInput" placeholder="Ask ORB AI anything..." rows="1"></textarea>
    <button class="send-btn" id="sendBtn" title="Send (Enter)">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
    </button>
  </div>
</div>

<script nonce="${nonce}">
(function() {
  const vscode = acquireVsCodeApi();
  window.initialConfig = ${initialConfig};

  // ─── State ───────────────────────────────────────────────
  const state = vscode.getState() || {};
  const session = state.session || { provider: null, model: 'auto', contextMode: 'auto' };
  if (!state.session) { state.session = session; vscode.setState(state); }

  // Model catalog
  const modelCatalog = [
    { id: 'auto', name: 'Auto (use settings)', provider: '', section: 'default', badge: 'Default', badgeColor: '#6366f1' },
    { id: 'nvidia:qwen/qwen3.5-397b-a17b', name: 'Qwen 3.5 397B', provider: 'NVIDIA', section: 'cloud', badge: 'Balanced', badgeColor: '#4f46e5' },
    { id: 'nvidia:deepseek-ai/deepseek-r1', name: 'DeepSeek R1', provider: 'NVIDIA', section: 'cloud', badge: 'Reasoning', badgeColor: '#7c3aed' },
    { id: 'nvidia:meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', provider: 'NVIDIA', section: 'cloud', badge: 'Fast', badgeColor: '#2ea643' },
    { id: 'cloud:gpt-4o', name: 'GPT-4o', provider: 'OpenAI', section: 'cloud', badge: 'Smart', badgeColor: '#1a7f37' },
    { id: 'cloud:gpt-4o-mini', name: 'GPT-4o Mini', provider: 'OpenAI', section: 'cloud', badge: 'Fast', badgeColor: '#2ea643' },
    { id: 'cloud:deepseek-chat', name: 'DeepSeek Chat', provider: 'DeepSeek', section: 'cloud', badge: 'Fast', badgeColor: '#2ea643' },
    { id: 'cloud:deepseek-coder', name: 'DeepSeek Coder', provider: 'DeepSeek', section: 'cloud', badge: 'Code', badgeColor: '#0ea5e9' },
    { id: 'cloud:deepseek-reasoner', name: 'DeepSeek R1', provider: 'DeepSeek', section: 'cloud', badge: 'Reasoning', badgeColor: '#7c3aed' },
    { id: 'anthropic:claude-3-5-sonnet-latest', name: 'Claude 3.5 Sonnet', provider: 'Anthropic', section: 'cloud', badge: 'Smart', badgeColor: '#8a2be2' },
    { id: 'anthropic:claude-3-5-haiku-latest', name: 'Claude 3.5 Haiku', provider: 'Anthropic', section: 'cloud', badge: 'Fast', badgeColor: '#2ea643' },
    { id: 'anthropic:claude-opus-4', name: 'Claude Opus 4', provider: 'Anthropic', section: 'cloud', badge: 'Pro', badgeColor: '#7c3aed' },
  ];

  // ─── DOM refs ────────────────────────────────────────────
  const chatArea = document.getElementById('chatArea');
  const messageInput = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendBtn');
  const modelChip = document.getElementById('modelChip');
  const modelChipLabel = document.getElementById('modelChipLabel');
  const contextChip = document.getElementById('contextChip');
  const contextChipLabel = document.getElementById('contextChipLabel');
  const modelPopover = document.getElementById('modelPopover');
  const popoverSearch = document.getElementById('popoverSearch');
  const popoverList = document.getElementById('popoverList');
  const providerDot = document.getElementById('providerDot');
  const providerLabel = document.getElementById('providerLabel');
  const settingsDot = document.getElementById('settingsDot');
  const settingsProviderLabel = document.getElementById('settingsProviderLabel');
  const settingsOverlay = document.getElementById('settingsOverlay');

  // ─── Settings panel ───────────────────────────────────────
  document.getElementById('openSettingsBtn').addEventListener('click', () => {
    settingsOverlay.classList.add('open');
  });
  document.getElementById('settingsBackBtn').addEventListener('click', () => {
    settingsOverlay.classList.remove('open');
  });

  const providerSelect = document.getElementById('providerSelect');
  providerSelect.addEventListener('change', () => showProviderSection(providerSelect.value));

  function showProviderSection(p) {
    ['nvidia','cloud','ollama','anthropic'].forEach(id => {
      const el = document.getElementById(id + 'Section');
      if (el) el.classList.toggle('active', id === p);
    });
  }

  // Password eye toggles
  document.querySelectorAll('.pw-eye').forEach(el => {
    el.addEventListener('click', () => {
      const inp = document.getElementById(el.dataset.target);
      if (inp.type === 'password') { inp.type = 'text'; el.textContent = '🙈'; }
      else { inp.type = 'password'; el.textContent = '👁️'; }
    });
  });

  const temperatureInput = document.getElementById('temperatureInput');
  const temperatureVal = document.getElementById('temperatureVal');
  temperatureInput.addEventListener('input', () => { temperatureVal.textContent = temperatureInput.value; });

  // Save settings
  document.getElementById('saveConfigBtn').addEventListener('click', () => {
    vscode.postMessage({
      command: 'updateConfig',
      data: {
        provider: providerSelect.value,
        nvidiaApiKey: document.getElementById('nvidiaApiKey').value,
        nvidiaModel: document.getElementById('nvidiaModel').value,
        nvidiaBaseUrl: document.getElementById('nvidiaBaseUrl').value,
        apiKey: document.getElementById('cloudApiKey').value,
        cloudModel: document.getElementById('cloudModel').value,
        cloudBaseUrl: document.getElementById('cloudBaseUrl').value,
        ollamaUrl: document.getElementById('ollamaUrl').value,
        ollamaModel: document.getElementById('ollamaModel').value,
        anthropicApiKey: document.getElementById('anthropicApiKey').value,
        anthropicModel: document.getElementById('anthropicModel').value,
        anthropicBaseUrl: document.getElementById('anthropicBaseUrl').value,
        toolsSafety: document.getElementById('toolsSafetySelect').value,
        systemPrompt: document.getElementById('systemPrompt').value,
        temperature: parseFloat(temperatureInput.value)
      }
    });
    settingsOverlay.classList.remove('open');
  });

  // Fill settings form from config
  function fillSettingsForm(cfg) {
    if (!cfg) return;
    window._currentCfg = cfg;
    if (cfg.provider) { providerSelect.value = cfg.provider; showProviderSection(cfg.provider); }
    const set = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined) el.value = val; };
    set('nvidiaApiKey', cfg.nvidiaApiKey);
    set('nvidiaModel', cfg.nvidiaModel);
    set('nvidiaBaseUrl', cfg.nvidiaBaseUrl);
    set('cloudApiKey', cfg.apiKey);
    set('cloudModel', cfg.cloudModel);
    set('cloudBaseUrl', cfg.cloudBaseUrl);
    set('ollamaUrl', cfg.ollamaUrl);
    set('ollamaModel', cfg.ollamaModel);
    set('anthropicApiKey', cfg.anthropicApiKey);
    set('anthropicModel', cfg.anthropicModel);
    set('anthropicBaseUrl', cfg.anthropicBaseUrl);
    set('toolsSafetySelect', cfg.toolsSafety);
    set('systemPrompt', cfg.systemPrompt);
    if (cfg.temperature !== undefined) {
      temperatureInput.value = cfg.temperature;
      temperatureVal.textContent = cfg.temperature;
    }
    // Sync session provider from config if not already set manually
    if (!session.provider) {
      session.provider = cfg.provider || 'nvidia';
      updateModelChipLabel();
    }
  }

  fillSettingsForm(window.initialConfig || {});

  // ─── Quick buttons ────────────────────────────────────────
  document.getElementById('scanRepository').addEventListener('click', () => vscode.postMessage({ command: 'scanRepository' }));
  document.getElementById('showGraph').addEventListener('click', () => vscode.postMessage({ command: 'showGraph' }));
  document.getElementById('loadScan').addEventListener('click', () => vscode.postMessage({ command: 'loadScan' }));
  document.getElementById('clearChatBtn').addEventListener('click', () => {
    const welcomeOrSummary = chatArea.querySelector('.welcome-card, .summary-container');
    chatArea.innerHTML = '';
    if (welcomeOrSummary) chatArea.appendChild(welcomeOrSummary.cloneNode(true));
    vscode.postMessage({ command: 'clearHistory' });
  });

  // ─── Hint chips ───────────────────────────────────────────
  chatArea.addEventListener('click', (e) => {
    const chip = e.target.closest('.hint-chip');
    if (chip) {
      const q = chip.dataset.q;
      if (q) { messageInput.value = q; sendBtn.click(); }
    }
  });

  // ─── Provider status indicator ───────────────────────────
  function setProviderStatus(status, prov) {
    [providerDot, settingsDot].forEach(dot => {
      if (!dot) return;
      dot.className = 'provider-dot';
      if (status === 'connected') dot.classList.add('connected');
      else if (status === 'error') dot.classList.add('error');
    });
    const txt = status === 'connected' ? (prov || 'connected') : (status === 'error' ? 'offline' : 'checking...');
    if (providerLabel) providerLabel.textContent = txt;
    if (settingsProviderLabel) settingsProviderLabel.textContent = txt;
  }

  // ─── Model chip label ────────────────────────────────────
  function updateModelChipLabel() {
    const m = session.model;
    if (!m || m === 'auto') {
      const prov = (window._currentCfg && window._currentCfg.provider) || session.provider || 'auto';
      modelChipLabel.textContent = prov.charAt(0).toUpperCase() + prov.slice(1) + ' (auto)';
    } else {
      const parts = m.split('/');
      modelChipLabel.textContent = parts[parts.length - 1];
    }
    const cm = session.contextMode;
    if (cm === 'file') contextChipLabel.textContent = '📄 File';
    else if (cm === 'workspace') contextChipLabel.textContent = '📂 Workspace';
    else contextChipLabel.textContent = '🕸️ Auto';
  }
  updateModelChipLabel();

  // ─── Model popover ───────────────────────────────────────
  let searchQuery = '';

  modelChip.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !modelPopover.classList.contains('hidden');
    modelPopover.classList.toggle('hidden', isOpen);
    if (!isOpen) {
      popoverSearch.value = '';
      searchQuery = '';
      renderPopover();
      popoverSearch.focus();
      vscode.postMessage({ command: 'getModels', data: { provider: 'ollama' } });
    }
  });

  document.addEventListener('click', () => modelPopover.classList.add('hidden'));
  modelPopover.addEventListener('click', e => e.stopPropagation());

  popoverSearch.addEventListener('input', () => {
    searchQuery = popoverSearch.value.toLowerCase();
    renderPopover();
  });

  contextChip.addEventListener('click', (e) => {
    e.stopPropagation();
    const modes = ['auto', 'file', 'workspace'];
    const idx = modes.indexOf(session.contextMode || 'auto');
    session.contextMode = modes[(idx + 1) % modes.length];
    state.session = session;
    vscode.setState(state);
    updateModelChipLabel();
  });

  function renderPopover() {
    popoverList.innerHTML = '';
    const activeId = (!session.model || session.model === 'auto') ? 'auto' : (session.provider + ':' + session.model);
    const q = searchQuery;

    const filtered = modelCatalog.filter(m =>
      !q || m.name.toLowerCase().includes(q) || (m.provider && m.provider.toLowerCase().includes(q))
    );

    const sections = [
      { key: 'default', label: 'Default' },
      { key: 'local', label: 'Local (Ollama)' },
      { key: 'cloud', label: 'Cloud & API' },
    ];

    sections.forEach(sec => {
      const items = filtered.filter(m => m.section === sec.key);
      if (items.length === 0) return;
      const hdr = document.createElement('div');
      hdr.className = 'pop-section';
      hdr.textContent = sec.label;
      popoverList.appendChild(hdr);
      items.forEach(item => {
        const row = document.createElement('div');
        row.className = 'pop-item' + (activeId === item.id ? ' selected' : '');
        const checkEl = document.createElement('div'); checkEl.className = 'pop-check'; checkEl.textContent = activeId === item.id ? '✓' : '';
        const nameEl = document.createElement('span'); nameEl.className = 'pop-name'; nameEl.textContent = item.name;
        const provEl = document.createElement('span'); provEl.className = 'pop-provider'; provEl.textContent = item.provider;
        row.appendChild(checkEl); row.appendChild(nameEl); row.appendChild(provEl);
        if (item.badge) {
          const badge = document.createElement('span');
          badge.className = 'pop-badge';
          badge.textContent = item.badge;
          badge.style.background = item.badgeColor || '#6366f1';
          row.appendChild(badge);
        }
        row.addEventListener('click', () => {
          if (item.id === 'auto') {
            session.model = 'auto';
            session.provider = (window._currentCfg && window._currentCfg.provider) || 'nvidia';
          } else {
            const [prov, ...rest] = item.id.split(':');
            session.provider = prov;
            session.model = rest.join(':');
          }
          state.session = session;
          vscode.setState(state);
          updateModelChipLabel();
          modelPopover.classList.add('hidden');
          vscode.postMessage({ command: 'checkProviderStatus', data: { provider: session.provider, model: session.model === 'auto' ? undefined : session.model } });
        });
        popoverList.appendChild(row);
      });
    });

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'pop-item';
      empty.style.color = 'var(--vscode-descriptionForeground)';
      empty.textContent = 'No models found';
      popoverList.appendChild(empty);
    }
  }

  // ─── Chat helpers ─────────────────────────────────────────
  function appendUserMsg(text) {
    const row = document.createElement('div');
    row.className = 'msg-user';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;
    row.appendChild(bubble);
    chatArea.appendChild(row);
    chatArea.scrollTop = chatArea.scrollHeight;
  }

  function appendTypingIndicator() {
    const row = document.createElement('div');
    row.className = 'msg-ai';
    row.id = 'typingIndicator';
    const avatar = document.createElement('div'); avatar.className = 'ai-avatar'; avatar.textContent = '🧠';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';
    row.appendChild(avatar); row.appendChild(bubble);
    chatArea.appendChild(row);
    chatArea.scrollTop = chatArea.scrollHeight;
  }

  function removeTypingIndicator() {
    const ti = document.getElementById('typingIndicator');
    if (ti) ti.remove();
  }

  function startAiMessage() {
    removeTypingIndicator();
    const row = document.createElement('div');
    row.className = 'msg-ai';
    row.id = 'streamingRow';
    const avatar = document.createElement('div'); avatar.className = 'ai-avatar'; avatar.textContent = '🧠';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.id = 'streamingBubble';
    bubble.textContent = '';
    row.appendChild(avatar); row.appendChild(bubble);
    chatArea.appendChild(row);
    chatArea.scrollTop = chatArea.scrollHeight;
  }

  function appendAiError(text) {
    removeTypingIndicator();
    const row = document.createElement('div');
    row.className = 'msg-ai msg-error';
    const avatar = document.createElement('div'); avatar.className = 'ai-avatar'; avatar.textContent = '⚠️';
    const bubble = document.createElement('div'); bubble.className = 'bubble'; bubble.textContent = text;
    row.appendChild(avatar); row.appendChild(bubble);
    chatArea.appendChild(row);
    chatArea.scrollTop = chatArea.scrollHeight;
  }

  // ─── Send message ────────────────────────────────────────
  function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || sendBtn.disabled) return;

    appendUserMsg(text);
    messageInput.value = '';
    messageInput.style.height = 'auto';
    sendBtn.disabled = true;
    appendTypingIndicator();

    vscode.postMessage({
      command: 'sendMessage',
      text: text,
      data: {
        sessionSettings: {
          provider: session.provider,
          model: session.model === 'auto' ? undefined : session.model,
          contextMode: session.contextMode,
        }
      }
    });
  }

  sendBtn.addEventListener('click', sendMessage);
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  messageInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
  });

  // ─── Messages from extension ──────────────────────────────
  window.addEventListener('message', event => {
    const msg = event.data;
    switch (msg.type) {
      case 'userMessage':
        // Skip — frontend renders this immediately on send
        break;

      case 'streamStart': {
        removeTypingIndicator();
        startAiMessage();
        break;
      }

      case 'streamToken': {
        const bubble = document.getElementById('streamingBubble');
        if (bubble) {
          bubble.textContent += msg.value;
          chatArea.scrollTop = chatArea.scrollHeight;
        }
        break;
      }

      case 'streamEnd': {
        sendBtn.disabled = false;
        const row = document.getElementById('streamingRow');
        if (row) row.removeAttribute('id');
        const bub = document.getElementById('streamingBubble');
        if (bub) bub.removeAttribute('id');
        break;
      }

      case 'aiError':
        sendBtn.disabled = false;
        appendAiError(msg.value || 'An error occurred.');
        break;

      case 'configUpdated':
        fillSettingsForm(msg.config);
        break;

      case 'providerStatus':
        setProviderStatus(msg.status, msg.provider);
        break;

      case 'ollamaModelsLoaded': {
        // Remove existing ollama entries then add fresh ones
        const freshModels = (msg.models || []).map(n => ({
          id: 'ollama:' + n,
          name: n,
          provider: 'Ollama',
          section: 'local',
          badge: 'Local',
          badgeColor: '#0891b2'
        }));
        const idx = modelCatalog.findIndex(m => m.section === 'local');
        if (idx !== -1) modelCatalog.splice(idx, modelCatalog.filter(m => m.section === 'local').length, ...freshModels);
        else modelCatalog.push(...freshModels);
        renderPopover();
        break;
      }

      case 'ollamaModelsError':
        // No-op, catalog stays with cloud items
        break;

      case 'scanLoaded':
        sendBtn.disabled = false;
        break;
    }
  });

  // ─── Initial status check ─────────────────────────────────
  vscode.postMessage({
    command: 'checkProviderStatus',
    data: { provider: session.provider, model: session.model === 'auto' ? undefined : session.model }
  });
})();
</script>
</body>
</html>`;
  }
}

function renderWelcomeCard(): string {
  return `<div class="welcome-card">
  <div class="welcome-title">🧠 ORB AI</div>
  <div class="welcome-sub">Orchestrated Reasoning Brain — your codebase AI assistant. Ask me anything about your repository.</div>
  <div class="welcome-hints">
    <button class="hint-chip" data-q="Explain the overall architecture of this codebase">📐 Explain the architecture</button>
    <button class="hint-chip" data-q="What are the main entry points of this project?">🚀 Show main entry points</button>
    <button class="hint-chip" data-q="What frameworks and libraries are used?">📦 Detect frameworks & libraries</button>
    <button class="hint-chip" data-q="Find any potential bugs or code smells in the codebase">🐛 Find bugs & code smells</button>
  </div>
</div>`;
}

function renderSummaryCards(snapshot: RepositoryIntelligenceSnapshot): string {
  const { summary } = snapshot;
  const frameworks = summary.detectedFrameworks.slice(0, 4);
  const languages = summary.languagesUsed.slice(0, 4);
  const entryPoints = summary.importantEntryPoints.slice(0, 4);

  return `<div class="summary-container">
  <div class="stats-grid">
    <div class="stat-card"><div class="stat-val">${summary.totalFiles}</div><div class="stat-lbl">Files</div></div>
    <div class="stat-card"><div class="stat-val">${summary.totalFolders}</div><div class="stat-lbl">Folders</div></div>
    <div class="stat-card"><div class="stat-val">${summary.internalDependencyCount}</div><div class="stat-lbl">Internal Links</div></div>
    <div class="stat-card"><div class="stat-val">${summary.exportCount}</div><div class="stat-lbl">Exports</div></div>
  </div>
  ${frameworks.length ? `<div class="section-label">Frameworks</div><div class="data-list">${frameworks.map(f => `<div class="data-item"><div class="data-item-title"><span>${escapeHtml(f.framework)}</span><span>${formatPercent(f.confidence)}</span></div><div class="data-item-meta">${escapeHtml(f.signals.slice(0,2).map(s => s.value).join(', '))}</div></div>`).join('')}</div>` : ''}
  ${languages.length ? `<div class="section-label">Languages</div><div class="data-list">${languages.map(l => `<div class="data-item"><div class="data-item-title"><span>${escapeHtml(l.language)}</span><span>${l.files} files</span></div></div>`).join('')}</div>` : ''}
  ${entryPoints.length ? `<div class="section-label">Entry Points</div><div class="data-list">${entryPoints.map(e => `<div class="data-item"><div class="data-item-title"><span style="font-family:var(--vscode-editor-font-family);font-size:11px;">${escapeHtml(e.path)}</span><span style="font-size:10px;color:var(--vscode-descriptionForeground);">${escapeHtml(e.type)}</span></div><div class="data-item-meta">${escapeHtml(e.reason)}</div></div>`).join('')}</div>` : ''}
  <div class="welcome-hints" style="margin-top:8px;">
    <button class="hint-chip" data-q="Explain the overall architecture of this codebase">📐 Explain the architecture</button>
    <button class="hint-chip" data-q="What are the main entry points of this project?">🚀 Show main entry points</button>
    <button class="hint-chip" data-q="Find any potential bugs or code smells">🐛 Find bugs & code smells</button>
  </div>
</div>`;
}

function renderFramework(detection: RepositoryIntelligenceSnapshot['summary']['detectedFrameworks'][number]): string {
  const signals = detection.signals.slice(0, 3).map((signal) => `${signal.kind}: ${signal.value}`).join(', ');
  return `<div class="data-item"><div class="data-item-title"><span>${escapeHtml(detection.framework)}</span><span>${formatPercent(detection.confidence)}</span></div><div class="data-item-meta">${escapeHtml(signals || 'Detected from repository signals')}</div></div>`;
}

function renderLanguage(language: RepositoryIntelligenceSnapshot['summary']['languagesUsed'][number]): string {
  return `<div class="data-item"><div class="data-item-title"><span>${escapeHtml(language.language)}</span><span>${language.files}</span></div></div>`;
}

function renderEntryPoint(entryPoint: RepositoryIntelligenceSnapshot['summary']['importantEntryPoints'][number]): string {
  return `<div class="data-item"><div class="data-item-title"><span style="font-family:var(--vscode-editor-font-family);font-size:11px;">${escapeHtml(entryPoint.path)}</span><span style="font-size:10px;color:var(--vscode-descriptionForeground);">${escapeHtml(entryPoint.type)}</span></div><div class="data-item-meta">${escapeHtml(entryPoint.reason)}</div></div>`;
}

function renderRelationship(relationship: RepositoryIntelligenceSnapshot['summary']['dependencyRelationships'][number]): string {
  return `<div class="data-item"><div class="data-item-title"><span style="font-family:var(--vscode-editor-font-family);font-size:11px;">${escapeHtml(relationship.source)}</span></div><div class="data-item-meta">→ <span style="font-family:var(--vscode-editor-font-family);">${escapeHtml(relationship.target)}</span> (${relationship.imports} imports)</div></div>`;
}

// Suppress unused variable warnings for unused render helpers - they're kept for future use
void renderFramework;
void renderLanguage;
void renderEntryPoint;
void renderRelationship;

function getNonce(): string {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let index = 0; index < 32; index += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
