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

    // Listen for configuration changes to sync with webview
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
        case 'updateConfig':
          if (message.data) {
            try {
              const config = vscode.workspace.getConfiguration('orb-ai');
              const {
                provider,
                nvidiaApiKey,
                nvidiaModel,
                nvidiaBaseUrl,
                apiKey,
                cloudModel,
                cloudBaseUrl,
                ollamaUrl,
                ollamaModel,
                anthropicApiKey,
                anthropicBaseUrl,
                anthropicModel,
                toolsSafety,
                systemPrompt,
                temperature,
              } = message.data;

              if (provider !== undefined) {
                await config.update('provider', provider, vscode.ConfigurationTarget.Global);
              }
              if (nvidiaApiKey !== undefined) {
                await config.update('nvidiaApiKey', nvidiaApiKey, vscode.ConfigurationTarget.Global);
              }
              if (nvidiaModel !== undefined) {
                await config.update('nvidiaModel', nvidiaModel, vscode.ConfigurationTarget.Global);
              }
              if (nvidiaBaseUrl !== undefined) {
                await config.update('nvidiaBaseUrl', nvidiaBaseUrl, vscode.ConfigurationTarget.Global);
              }
              if (apiKey !== undefined) {
                await config.update('apiKey', apiKey, vscode.ConfigurationTarget.Global);
              }
              if (cloudModel !== undefined) {
                await config.update('cloudModel', cloudModel, vscode.ConfigurationTarget.Global);
              }
              if (cloudBaseUrl !== undefined) {
                await config.update('cloudBaseUrl', cloudBaseUrl, vscode.ConfigurationTarget.Global);
              }
              if (ollamaUrl !== undefined) {
                await config.update('ollamaUrl', ollamaUrl, vscode.ConfigurationTarget.Global);
              }
              if (ollamaModel !== undefined) {
                await config.update('ollamaModel', ollamaModel, vscode.ConfigurationTarget.Global);
              }
              if (anthropicApiKey !== undefined) {
                await config.update('anthropicApiKey', anthropicApiKey, vscode.ConfigurationTarget.Global);
              }
              if (anthropicBaseUrl !== undefined) {
                await config.update('anthropicBaseUrl', anthropicBaseUrl, vscode.ConfigurationTarget.Global);
              }
              if (anthropicModel !== undefined) {
                await config.update('anthropicModel', anthropicModel, vscode.ConfigurationTarget.Global);
              }
              if (toolsSafety !== undefined) {
                await config.update('toolsSafety', toolsSafety, vscode.ConfigurationTarget.Global);
              }
              if (systemPrompt !== undefined) {
                await config.update('systemPrompt', systemPrompt, vscode.ConfigurationTarget.Global);
              }
              if (temperature !== undefined) {
                await config.update('temperature', Number(temperature), vscode.ConfigurationTarget.Global);
              }

              vscode.window.showInformationMessage('ORB AI settings updated successfully.');
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
    // Synchronize initial configuration and test status
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
        systemPrompt: config.get<string>('systemPrompt', 'You are ORB AI, a helpful and knowledgeable codebase reasoning assistant. Analyze the repository structure and code to provide precise, clean, and helpful answers.'),
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
    } catch (err) {
      this.view?.webview.postMessage({
        type: 'providerStatus',
        status: 'error',
        provider: 'unknown',
      });
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
        this.view?.webview.postMessage({
          type: 'ollamaModelsLoaded',
          models: models,
        });
      } else {
        throw new Error(`Failed to fetch models from Ollama: ${response.statusText}`);
      }
    } catch (err) {
      this.view?.webview.postMessage({
        type: 'ollamaModelsError',
        error: String(err),
      });
    }
  }

  private async handleUserMessage(userMessage: string, sessionSettings?: any): Promise<void> {
    try {
      // Add user message to history
      this.messageHistory.push({
        role: 'user',
        content: userMessage,
      });

      // Send user message to webview
      this.view?.webview.postMessage({
        type: 'userMessage',
        value: userMessage,
      });

      // Get LLM provider
      const providerType = sessionSettings?.provider;
      const modelName = sessionSettings?.model;
      const provider = getLLMProvider(providerType, modelName);
      const available = await provider.isAvailable();

      if (!available) {
        this.view?.webview.postMessage({
          type: 'aiError',
          value: '❌ LLM provider unavailable. Check ORB AI settings.',
          isOllamaOffline: providerType === 'ollama',
        });
        return;
      }

      // Send stream start signal
      this.view?.webview.postMessage({
        type: 'streamStart',
      });

      const config = vscode.workspace.getConfiguration('orb-ai');
      const systemPrompt = config.get<string>('systemPrompt', '');

      // Build messages array for LLM
      const messages = this.messageHistory.map((msg) => ({
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
      }));

      if (systemPrompt) {
        messages.unshift({
          role: 'system',
          content: systemPrompt,
        });
      }

      let fullResponse = '';

      // Stream the response
      for await (const token of provider.chat(messages)) {
        fullResponse += token;
        this.view?.webview.postMessage({
          type: 'streamToken',
          value: token,
        });
      }

      // Send stream end signal
      this.view?.webview.postMessage({
        type: 'streamEnd',
      });

      // Add assistant response to history
      this.messageHistory.push({
        role: 'assistant',
        content: fullResponse,
      });
    } catch (err: any) {
      this.view?.webview.postMessage({
        type: 'aiError',
        value: `❌ Error: ${err.message}`,
      });
      this.logger.error('LLM chat error', err);
    }
  }

  private render(): void {
    if (!this.view) {
      return;
    }

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
      systemPrompt: config.get<string>('systemPrompt', 'You are ORB AI, a helpful and knowledgeable codebase reasoning assistant. Analyze the repository structure and code to provide precise, clean, and helpful answers.'),
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
    :root { color-scheme: light dark; }
    body { margin:0; padding:12px; font-family:var(--vscode-font-family); font-size:var(--vscode-font-size); line-height:1.45; color:var(--vscode-foreground); background:var(--vscode-sideBar-background); }
    .header { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
    .brand { min-width:0; }
    h1,h2,h3,p { margin:0; }
    h1 { font-size:18px; font-weight:700; }
    .subtitle { margin-top:2px; color:var(--vscode-descriptionForeground); }
    .actions { display:flex; gap:8px; flex-wrap:wrap; margin:8px 0; }
    button { border:1px solid var(--vscode-button-border,transparent); border-radius:4px; padding:6px 10px; cursor:pointer; font:inherit; color:var(--vscode-button-foreground); background:var(--vscode-button-background); }
    button.secondary { color:var(--vscode-button-secondaryForeground); background:var(--vscode-button-secondaryBackground); }
    button:hover { background:var(--vscode-button-hoverBackground); }
    button.secondary:hover { background:var(--vscode-button-secondaryHoverBackground); }
    .stats { display:grid; grid-template-columns:repeat(2,1fr); gap:8px; }
    .stat,.empty,.item { border:1px solid var(--vscode-sideBarSectionHeader-border,var(--vscode-panel-border)); border-radius:6px; padding:10px; background:var(--vscode-editor-background); }
    .stat-value { display:block; font-size:18px; font-weight:700; }
    .stat-label { display:block; margin-top:2px; font-size:12px; color:var(--vscode-descriptionForeground); }
    .list { display:grid; gap:8px; }
    .item-title { display:flex; justify-content:space-between; font-weight:600; }
    .item-meta { margin-top:4px; font-size:12px; color:var(--vscode-descriptionForeground); overflow-wrap:anywhere; }
    .path { font-family:var(--vscode-editor-font-family); font-size:12px; }
    .empty { color:var(--vscode-descriptionForeground); }
    /* Chat UI */
    #chatContainer { max-height:250px; overflow-y:auto; margin-bottom:8px; }
    .message { padding:6px 10px; border-radius:4px; margin:4px 0; }
    .message.user { background:var(--vscode-input-background); }
    .message.ai { background:var(--vscode-editorWidget-background); }
    #loadingSpinner { margin-left:auto; margin-right:4px; }
    
    /* Premium Unified Chat Input Area */
    .chat-input-container {
      position: relative;
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      border-radius: 8px;
      background: var(--vscode-input-background);
      margin-bottom: 12px;
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    
    /* Model Popover Styles */
    .model-popover {
      position: absolute;
      top: calc(100% + 4px);
      left: 8px;
      width: 280px;
      background: var(--vscode-menu-background, var(--vscode-editorWidget-background, #1e1e1e));
      border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border, #303030));
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
      z-index: 1000;
      display: flex;
      flex-direction: column;
      max-height: 320px;
    }
    .model-popover.hidden {
      display: none;
    }
    
    /* Session Header Configuration Bar Styles */
    .session-container {
      position: relative;
      margin-bottom: 8px;
    }
    .session-config-bar {
      display: flex;
      gap: 6px;
      padding: 6px 8px;
      background: var(--vscode-sideBar-background);
      border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border));
      font-size: 11px;
      font-family: var(--vscode-font-family);
      overflow-x: auto;
      white-space: nowrap;
      border-radius: 6px;
    }
    .session-config-btn {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      border-radius: 4px;
      background: var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.15));
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      user-select: none;
      transition: background 0.15s, color 0.15s;
    }
    .session-config-btn:hover {
      background: var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.3));
      color: var(--vscode-foreground);
    }
    .session-config-btn strong {
      font-weight: 600;
      color: var(--vscode-foreground);
    }
    .session-config-btn .dropdown-arrow {
      font-size: 8px;
      color: var(--vscode-descriptionForeground);
      margin-left: 2px;
    }
    
    .session-popover {
      position: absolute;
      top: calc(100% + 4px);
      background: var(--vscode-menu-background, var(--vscode-editorWidget-background, #1e1e1e));
      border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border, #303030));
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
      z-index: 1000;
      display: flex;
      flex-direction: column;
      padding: 4px 0;
    }
    .session-popover.hidden {
      display: none;
    }
    
    .popover-item-badge-pill {
      font-size: 8px;
      font-weight: 600;
      padding: 1px 4px;
      border-radius: 3px;
      margin-left: 6px;
      color: #ffffff;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      display: inline-block;
      line-height: 1.2;
    }
    .popover-search-container {
      display: flex;
      align-items: center;
      padding: 8px 10px;
      border-bottom: 1px solid var(--vscode-menu-border, var(--vscode-widget-border, #303030));
      gap: 8px;
    }
    .popover-search-container input {
      flex: 1;
      background: transparent;
      border: none;
      color: var(--vscode-menu-foreground, var(--vscode-foreground, #cccccc));
      font-family: inherit;
      font-size: var(--vscode-font-size, 13px);
      outline: none;
      padding: 0;
    }
    .popover-search-container input::placeholder {
      color: var(--vscode-input-placeholderForeground, #888888);
    }
    .popover-settings-btn {
      background: transparent;
      border: none;
      color: var(--vscode-descriptionForeground, #888888);
      cursor: pointer;
      padding: 2px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      transition: color 0.15s, background-color 0.15s;
    }
    .popover-settings-btn:hover {
      color: var(--vscode-menu-foreground, var(--vscode-foreground, #ffffff));
      background-color: var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.2));
    }
    .popover-content {
      overflow-y: auto;
      padding: 4px 0;
    }
    .popover-item {
      display: flex;
      align-items: center;
      padding: 6px 12px;
      cursor: pointer;
      font-size: var(--vscode-font-size, 13px);
      user-select: none;
      color: var(--vscode-menu-foreground, var(--vscode-foreground, #cccccc));
      transition: background-color 0.1s;
    }
    .popover-item:hover {
      background-color: var(--vscode-menu-list-hoverBackground, var(--vscode-list-hoverBackground, #2a2d2e));
      color: var(--vscode-menu-foreground, var(--vscode-foreground, #ffffff));
    }
    .popover-item.selected {
      font-weight: 500;
    }
    .popover-item-check {
      width: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-right: 6px;
      color: var(--vscode-foreground, #cccccc);
      font-size: 11px;
    }
    .popover-item-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .popover-item-provider {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #888888);
      margin-left: 8px;
    }
    .popover-item-badge {
      font-size: 10px;
      background: var(--vscode-sideBarSectionHeader-background, rgba(128, 128, 128, 0.2));
      color: var(--vscode-descriptionForeground, #888888);
      padding: 1px 4px;
      border-radius: 3px;
      margin-left: 6px;
    }
    .popover-item-upgrade {
      font-size: 11px;
      color: var(--vscode-textLink-foreground, #3b82f6);
      font-weight: 600;
      margin-left: 8px;
      cursor: pointer;
    }
    .popover-item-upgrade:hover {
      text-decoration: underline;
    }
    .popover-section-title {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-descriptionForeground, #888888);
      padding: 6px 12px 2px 12px;
      user-select: none;
    }
    .popover-collapsible-header {
      display: flex;
      align-items: center;
      padding: 6px 12px;
      cursor: pointer;
      font-size: var(--vscode-font-size, 13px);
      font-weight: 500;
      color: var(--vscode-menu-foreground, var(--vscode-foreground, #cccccc));
      user-select: none;
      transition: background-color 0.1s;
    }
    .popover-collapsible-header:hover {
      background-color: var(--vscode-menu-list-hoverBackground, var(--vscode-list-hoverBackground, #2a2d2e));
    }
    .popover-collapsible-chevron {
      font-size: 10px;
      margin-right: 6px;
      transition: transform 0.15s;
    }
    .popover-collapsible-chevron.expanded {
      transform: rotate(90deg);
    }
    .popover-collapsible-content {
      display: none;
    }
    .popover-collapsible-content.expanded {
      display: block;
    }
    .chat-input-container:focus-within {
      border-color: var(--vscode-focusBorder);
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
    }
    .chat-input-container textarea {
      width: 100%;
      background: transparent;
      border: none;
      color: var(--vscode-input-foreground);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      line-height: 1.4;
      outline: none;
      padding: 0;
      margin: 0;
      resize: none;
      min-height: 24px;
      max-height: 120px;
      overflow-y: auto;
    }
    .chat-input-container textarea::placeholder {
      color: var(--vscode-input-placeholderForeground);
    }
    .chat-input-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 4px;
    }
    .toolbar-left {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
    }
    .toolbar-btn {
      background: transparent;
      border: none;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      padding: 4px 6px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-family: inherit;
      transition: color 0.15s, background 0.15s;
    }
    .toolbar-btn:hover {
      color: var(--vscode-foreground);
      background: var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.2));
    }
    .toolbar-separator {
      color: var(--vscode-panel-border, rgba(128, 128, 128, 0.3));
      font-weight: 300;
      user-select: none;
    }
    .toolbar-badge {
      padding: 2px 6px;
      background: var(--vscode-sideBarSectionHeader-background, var(--vscode-panel-background));
      border-radius: 4px;
      font-weight: 500;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      user-select: none;
      transition: background-color 0.15s, color 0.15s;
    }
    .toolbar-badge:hover {
      background: var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.2));
      color: var(--vscode-foreground);
    }
    .send-btn {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: background 0.15s, transform 0.1s;
      padding: 0;
    }
    .send-btn:hover {
      background: var(--vscode-button-hoverBackground);
      transform: scale(1.05);
    }
    .send-btn:active {
      transform: scale(0.95);
    }
    .send-btn svg {
      stroke: currentColor;
    }
    .hidden { display:none; }

    /* Collapsible Settings Panel */
    .config-card {
      border: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border));
      border-radius: 6px;
      margin-bottom: 12px;
      background: var(--vscode-sideBar-background);
      overflow: hidden;
    }
    .config-header {
      padding: 10px 12px;
      background: var(--vscode-sideBarSectionHeader-background, var(--vscode-sideBar-background));
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      user-select: none;
    }
    .config-header:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .config-title-group {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .config-title {
      font-weight: 600;
      font-size: 13px;
    }
    .config-status {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 10px;
      font-weight: 500;
    }
    .status-connected {
      background: rgba(46, 160, 67, 0.15);
      color: #3fb950;
      border: 1px solid rgba(46, 160, 67, 0.2);
    }
    .status-error {
      background: rgba(248, 81, 73, 0.15);
      color: #f85149;
      border: 1px solid rgba(248, 81, 73, 0.2);
    }
    .status-checking {
      background: rgba(187, 128, 9, 0.15);
      color: #d29922;
      border: 1px solid rgba(187, 128, 9, 0.2);
    }
    .config-content {
      padding: 12px;
      display: none;
      flex-direction: column;
      gap: 10px;
      border-top: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border));
      background: var(--vscode-editor-background);
    }
    .config-content.open {
      display: flex;
    }
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .form-group label {
      font-size: 11px;
      font-weight: 600;
      color: var(--vscode-descriptionForeground);
    }
    .form-group input, .form-group select {
      padding: 6px;
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      font-family: inherit;
      font-size: 12px;
    }
    .form-group input:focus, .form-group select:focus {
      outline: 1px solid var(--vscode-focusBorder);
    }
    .password-input-wrapper {
      position: relative;
      display: flex;
      align-items: center;
    }
    .password-input-wrapper input {
      width: 100%;
      padding-right: 28px;
    }
    .toggle-password {
      position: absolute;
      right: 8px;
      cursor: pointer;
      font-size: 14px;
      user-select: none;
      color: var(--vscode-descriptionForeground);
    }
    .config-buttons {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 4px;
    }
    .chevron-icon {
      transition: transform 0.2s;
      font-size: 10px;
      display: inline-block;
    }
    .icon-button {
      background: transparent;
      border: none;
      color: var(--vscode-descriptionForeground);
      padding: 4px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      transition: background 0.2s, color 0.2s;
    }
    .icon-button:hover {
      background: var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.31));
      color: var(--vscode-foreground);
    }
    </style>
</head>
<body>
  <section class="header">
    <div class="brand">
      <h1>ORB AI</h1>
      <p class="subtitle">Orchestrated Reasoning Brain</p>
    </div>
    <button id="openSettingsBtn" class="icon-button" title="Open Extension Settings">⚙️</button>
  </section>

    <!-- Collapsible Settings Panel -->
    <div class="config-card">
      <div class="config-header" id="configHeader">
        <div class="config-title-group">
          <span class="chevron-icon" id="configChevron">▶</span>
          <span class="config-title">LLM Provider Settings</span>
        </div>
        <span class="config-status status-checking" id="configStatusBadge">⏳ Checking</span>
      </div>
      <div class="config-content" id="configContent">
        <div class="form-group">
          <label for="providerSelect">Provider</label>
          <select id="providerSelect">
            <option value="nvidia">Nvidia Qwen (Recommended)</option>
            <option value="cloud">Cloud OpenAI Compatible</option>
            <option value="ollama">Ollama Local LLM</option>
            <option value="anthropic">Anthropic Claude</option>
          </select>
        </div>

        <!-- Nvidia Settings -->
        <div id="nvidiaSettings" class="provider-fields">
          <div class="form-group">
            <label for="nvidiaApiKey">Nvidia API Key</label>
            <div class="password-input-wrapper">
              <input type="password" id="nvidiaApiKey" placeholder="nvapi-..." />
              <span class="toggle-password" id="toggleNvidiaKey">👁️</span>
            </div>
          </div>
          <div class="form-group">
            <label for="nvidiaModel">Nvidia Model</label>
            <input type="text" id="nvidiaModel" />
          </div>
          <div class="form-group">
            <label for="nvidiaBaseUrl">Nvidia API Base URL</label>
            <input type="text" id="nvidiaBaseUrl" />
          </div>
        </div>

        <!-- Cloud Settings -->
        <div id="cloudSettings" class="provider-fields hidden">
          <div class="form-group">
            <label for="cloudApiKey">API Key</label>
            <div class="password-input-wrapper">
              <input type="password" id="cloudApiKey" placeholder="sk-..." />
              <span class="toggle-password" id="toggleCloudKey">👁️</span>
            </div>
          </div>
          <div class="form-group">
            <label for="cloudModel">Model Name</label>
            <input type="text" id="cloudModel" />
          </div>
          <div class="form-group">
            <label for="cloudBaseUrl">API Base URL</label>
            <input type="text" id="cloudBaseUrl" />
          </div>
        </div>

        <!-- Ollama Settings -->
        <div id="ollamaSettings" class="provider-fields hidden">
          <div class="form-group">
            <label for="ollamaUrl">Ollama Server URL</label>
            <input type="text" id="ollamaUrl" />
          </div>
          <div class="form-group">
            <label for="ollamaModel">Ollama Model</label>
            <input type="text" id="ollamaModel" />
          </div>
        </div>

        <!-- Anthropic Settings -->
        <div id="anthropicSettings" class="provider-fields hidden">
          <div class="form-group">
            <label for="anthropicApiKey">Anthropic API Key</label>
            <div class="password-input-wrapper">
              <input type="password" id="anthropicApiKey" placeholder="sk-ant-..." />
              <span class="toggle-password" id="toggleAnthropicKey">👁️</span>
            </div>
          </div>
          <div class="form-group">
            <label for="anthropicModel">Model Name</label>
            <input type="text" id="anthropicModel" />
          </div>
          <div class="form-group">
            <label for="anthropicBaseUrl">API Base URL</label>
            <input type="text" id="anthropicBaseUrl" />
          </div>
        </div>

        <!-- Global Parameter Settings -->
        <div class="form-group">
          <label for="systemPrompt">System Prompt</label>
          <textarea id="systemPrompt" rows="3" style="resize:vertical; padding:6px; border:1px solid var(--vscode-input-border); border-radius:4px; background:var(--vscode-input-background); color:var(--vscode-input-foreground); font-family:inherit; font-size:12px;"></textarea>
        </div>
        <div class="form-group">
          <label for="temperatureInput">Temperature: <span id="temperatureVal">0.5</span></label>
          <input type="range" id="temperatureInput" min="0" max="2" step="0.1" style="width: 100%;" />
        </div>
        <div class="form-group">
          <label for="toolsSafetySelect">Tool Execution Safety</label>
          <select id="toolsSafetySelect">
            <option value="safe">Ask before running (Safe)</option>
            <option value="readOnly">Auto-run read-only</option>
            <option value="dangerous">Auto-run all (Dangerous)</option>
          </select>
        </div>

        <div class="config-buttons">
          <button id="saveConfigBtn">Save Configuration</button>
        </div>
      </div>
    </div>

    <div class="actions">
      <button id="scanRepository">Scan Repository</button>
      <button id="showGraph" class="secondary">Show Graph</button>
      <button id="loadScan" class="secondary">Load Scan</button>
    </div>

    <!-- Chat UI -->
    <div class="session-container">
      <div class="session-config-bar">
        <div class="session-config-btn" id="sessionModelBtn" title="Choose Active Model">
          Model: <strong id="sessionModelLabel">Auto</strong> <span class="dropdown-arrow">▼</span>
        </div>
        <div class="session-config-btn" id="sessionContextBtn" title="Choose Context Mode">
          Context: <strong id="sessionContextLabel">Auto 🕸️</strong> <span class="dropdown-arrow">▼</span>
        </div>
        <div class="session-config-btn" id="sessionToolsBtn" title="Choose Tool Safety">
          Tools: <strong id="sessionToolsLabel">Ask First 🛡️</strong> <span class="dropdown-arrow">▼</span>
        </div>
      </div>

      <!-- Floating Popovers -->
      <!-- Model Selector Popover -->
      <div class="model-popover hidden" id="modelPopover">
        <div class="popover-search-container">
          <input type="text" id="popoverSearch" placeholder="Search models" autocomplete="off" />
          <button class="popover-settings-btn" id="popoverSettingsBtn" title="LLM Provider Settings">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
          </button>
        </div>
        <div class="popover-content" id="popoverContentList"></div>
      </div>

      <!-- Context Popover -->
      <div class="session-popover hidden" id="contextPopover" style="left: 60px; width: 220px;">
        <div class="popover-content">
          <div class="popover-item" data-value="auto">
            <div class="popover-item-check">✓</div>
            <span class="popover-item-name">Smart Graph (Auto)</span>
            <span class="popover-item-provider">🕸️</span>
          </div>
          <div class="popover-item" data-value="file">
            <div class="popover-item-check"></div>
            <span class="popover-item-name">Current File Only</span>
            <span class="popover-item-provider">📄</span>
          </div>
          <div class="popover-item" data-value="workspace">
            <div class="popover-item-check"></div>
            <span class="popover-item-name">Whole Workspace</span>
            <span class="popover-item-provider">📂</span>
            <span class="popover-item-badge" style="background:var(--vscode-statusBadge-background); color:var(--vscode-statusBadge-foreground); font-size:9px; font-weight:600; padding:1px 4px; border-radius:3px; margin-left:6px;">Warning</span>
          </div>
        </div>
      </div>

      <!-- Tools Popover -->
      <div class="session-popover hidden" id="toolsPopover" style="right: 8px; width: 240px;">
        <div class="popover-content">
          <div class="popover-item" data-value="safe">
            <div class="popover-item-check">✓</div>
            <span class="popover-item-name">Ask before running (Safe)</span>
            <span class="popover-item-provider">🛡️</span>
          </div>
          <div class="popover-item" data-value="readOnly">
            <div class="popover-item-check"></div>
            <span class="popover-item-name">Auto-run read-only</span>
            <span class="popover-item-provider">⚡</span>
          </div>
          <div class="popover-item" data-value="dangerous">
            <div class="popover-item-check"></div>
            <span class="popover-item-name">Auto-run all (Dangerous)</span>
            <span class="popover-item-provider">⚠️</span>
          </div>
        </div>
      </div>
    </div>

    <div id="chatContainer"></div>
    <div class="chat-input-container">
      <textarea id="messageInput" placeholder="Ask ORB AI..." rows="1"></textarea>
      <div class="chat-input-toolbar">
        <div class="toolbar-left">
          <button class="toolbar-btn" id="toolbarPlusBtn" title="Add Context">+</button>
          <span class="toolbar-separator">|</span>
          <button class="toolbar-btn" id="toolbarCodeBtn" title="Insert Code Block">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
          </button>
          <span class="toolbar-separator">|</span>
          <button class="toolbar-btn" id="toolbarSettingsBtn" title="Toggle Inline Settings">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line><line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line><line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line><line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line><line x1="17" y1="16" x2="23" y2="16"></line></svg>
          </button>
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          <span id="loadingSpinner" class="hidden">⏳</span>
          <button class="send-btn" id="sendMessage" title="Send Message">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>
          </button>
        </div>
      </div>
    </div>

    ${summary ? renderSummary(this.snapshot as RepositoryIntelligenceSnapshot) : renderWelcome()}

    <script nonce="${nonce}">
    window.initialConfig = ${initialConfig};
    const vscode = acquireVsCodeApi();
    const scanBtn = document.getElementById('scanRepository');
    const graphBtn = document.getElementById('showGraph');
    const sendBtn = document.getElementById('sendMessage');
    const openSettingsBtn = document.getElementById('openSettingsBtn');

    openSettingsBtn?.addEventListener('click', () => {
      vscode.postMessage({ command: 'openSettings' });
    });
    const inputBox = document.getElementById('messageInput');
    const chatContainer = document.getElementById('chatContainer');
    const loadingSpinner = document.getElementById('loadingSpinner');

    scanBtn?.addEventListener('click', () => vscode.postMessage({ command: 'scanRepository' }));
    graphBtn?.addEventListener('click', () => vscode.postMessage({ command: 'showGraph' }));
    const loadBtn = document.getElementById('loadScan');
    loadBtn?.addEventListener('click', () => vscode.postMessage({ command: 'loadScan' }));

    // Load state
    const state = vscode.getState() || { messages: [] };

    // Config Panel toggle
    const configHeader = document.getElementById('configHeader');
    const configContent = document.getElementById('configContent');
    const configChevron = document.getElementById('configChevron');
    
    let isConfigOpen = state.isConfigOpen || false;
    
    function setConfigPanelOpen(open) {
      isConfigOpen = open;
      state.isConfigOpen = open;
      vscode.setState(state);
      if (open) {
        configContent.classList.add('open');
        configChevron.textContent = '▼';
      } else {
        configContent.classList.remove('open');
        configChevron.textContent = '▶';
      }
    }
    
    setConfigPanelOpen(isConfigOpen);
    
    configHeader?.addEventListener('click', () => {
      setConfigPanelOpen(!isConfigOpen);
    });

    // Model selector popover catalog
    const modelCatalog = [
      { id: 'auto', name: 'Auto', provider: '', badge: 'Recommended', section: 'auto' },
      // Nvidia models
      { id: 'nvidia:qwen/qwen3.5-397b-a17b', name: 'Qwen 3.5 397B', provider: 'NVIDIA', badge: 'Balanced', badgeColor: '#4f46e5', section: 'cloud' },
      { id: 'nvidia:deepseek-ai/deepseek-r1', name: 'DeepSeek R1', provider: 'NVIDIA', badge: 'Reasoning', badgeColor: '#7c3aed', section: 'cloud' },
      // Cloud models
      { id: 'cloud:gpt-4o-mini', name: 'gpt-4o-mini', provider: 'OpenAI', badge: 'Fast', badgeColor: '#2ea643', section: 'cloud' },
      { id: 'cloud:gpt-4o', name: 'gpt-4o', provider: 'OpenAI', badge: 'Smart', badgeColor: '#8a2be2', section: 'cloud' },
      { id: 'cloud:deepseek-coder', name: 'deepseek-coder', provider: 'OpenAI', badge: 'Smart', badgeColor: '#8a2be2', section: 'cloud' },
      { id: 'cloud:deepseek-chat', name: 'deepseek-chat', provider: 'OpenAI', badge: 'Fast', badgeColor: '#2ea643', section: 'cloud' },
      { id: 'cloud:deepseek-reasoner', name: 'deepseek-reasoner', provider: 'OpenAI', badge: 'Reasoning', badgeColor: '#7c3aed', section: 'cloud' },
      { id: 'anthropic:claude-3-5-sonnet-latest', name: 'claude-3-5-sonnet', provider: 'Anthropic', badge: 'Smart', badgeColor: '#8a2be2', section: 'cloud' },
      { id: 'anthropic:claude-3-5-haiku-latest', name: 'claude-3-5-haiku', provider: 'Anthropic', badge: 'Fast', badgeColor: '#2ea643', section: 'cloud' },
      // Copilot / Upgrade mock models
      { id: 'copilot:claude-haiku-4.5', name: 'Claude Haiku 4.5', provider: 'Copilot', badge: '1x', section: 'copilot' },
      { id: 'upgrade:claude-sonnet-4.6', name: 'Claude Sonnet 4.6', provider: '', upgrade: true, section: 'copilot' },
      { id: 'upgrade:gpt-5.4', name: 'GPT-5.4', provider: '', upgrade: true, section: 'copilot' },
      { id: 'upgrade:o1-pro', name: 'GPT-o1-pro', provider: '', upgrade: true, section: 'copilot' }
    ];

    const activeSessionState = state.sessionSettings || {
      provider: 'nvidia',
      model: 'auto',
      contextMode: 'auto',
      toolsMode: 'safe'
    };
    // Ensure all fields are robustly initialized
    if (!activeSessionState.provider) activeSessionState.provider = 'nvidia';
    if (!activeSessionState.model) activeSessionState.model = 'auto';
    if (!activeSessionState.contextMode) activeSessionState.contextMode = 'auto';
    if (!activeSessionState.toolsMode) activeSessionState.toolsMode = 'safe';
    if (!state.sessionSettings) {
      state.sessionSettings = activeSessionState;
      vscode.setState(state);
    }

    let currentSearchQuery = '';
    window.isOllamaAvailable = true;

    // DOM Elements for Model Popover and Session Configuration
    const sessionModelBtn = document.getElementById('sessionModelBtn');
    const sessionContextBtn = document.getElementById('sessionContextBtn');
    const sessionToolsBtn = document.getElementById('sessionToolsBtn');

    const modelPopover = document.getElementById('modelPopover');
    const contextPopover = document.getElementById('contextPopover');
    const toolsPopover = document.getElementById('toolsPopover');

    const popoverSearch = document.getElementById('popoverSearch');
    const popoverContentList = document.getElementById('popoverContentList');
    const popoverSettingsBtn = document.getElementById('popoverSettingsBtn');

    function getActiveModelId(cfg) {
      if (!cfg) return 'auto';
      const provider = cfg.provider;
      if (provider === 'nvidia') {
        if (cfg.nvidiaModel === 'qwen/qwen3.5-397b-a17b') {
          return 'auto';
        }
        return 'nvidia:' + cfg.nvidiaModel;
      }
      if (provider === 'cloud') {
        return 'cloud:' + cfg.cloudModel;
      }
      if (provider === 'ollama') {
        return 'ollama:' + cfg.ollamaModel;
      }
      if (provider === 'anthropic') {
        return 'anthropic:' + cfg.anthropicModel;
      }
      return 'auto';
    }

    function updateSessionBarLabels() {
      const modelLabel = document.getElementById('sessionModelLabel');
      if (modelLabel) {
        if (activeSessionState.model === 'auto') {
          modelLabel.textContent = 'Auto';
        } else {
          const name = activeSessionState.model;
          modelLabel.textContent = name.split('/').pop() || name;
        }
      }

      const contextLabel = document.getElementById('sessionContextLabel');
      if (contextLabel) {
        if (activeSessionState.contextMode === 'auto') {
          contextLabel.textContent = 'Auto 🕸️';
        } else if (activeSessionState.contextMode === 'file') {
          contextLabel.textContent = 'File Only 📄';
        } else if (activeSessionState.contextMode === 'workspace') {
          contextLabel.textContent = 'Workspace 📂';
        }
      }

      const toolsLabel = document.getElementById('sessionToolsLabel');
      if (toolsLabel) {
        if (activeSessionState.toolsMode === 'safe') {
          toolsLabel.textContent = 'Ask First 🛡️';
        } else if (activeSessionState.toolsMode === 'readOnly') {
          toolsLabel.textContent = 'Auto Read ⚡';
        } else if (activeSessionState.toolsMode === 'dangerous') {
          toolsLabel.textContent = 'Auto All ⚠️';
        }
      }
    }

    function updateSessionSettings(updates) {
      Object.assign(activeSessionState, updates);
      state.sessionSettings = activeSessionState;
      vscode.setState(state);
      
      updateSessionBarLabels();
      renderModelList();
      
      vscode.postMessage({
        command: 'checkProviderStatus',
        data: {
          provider: activeSessionState.provider,
          model: activeSessionState.model === 'auto' ? undefined : activeSessionState.model
        }
      });
    }

    window.switchToCloudFallback = function() {
      updateSessionSettings({
        provider: 'cloud',
        model: 'gpt-4o-mini'
      });
      addMessage('Switched to Cloud Fallback (gpt-4o-mini)', 'ai');
    };

    function renderModelList() {
      if (!popoverContentList) return;
      popoverContentList.innerHTML = '';

      const query = currentSearchQuery.toLowerCase().trim();
      const activeId = activeSessionState.model === 'auto' ? 'auto' : (activeSessionState.provider + ':' + activeSessionState.model);

      const matchesQuery = (item) => {
        if (!query) return true;
        return item.name.toLowerCase().includes(query) || (item.provider && item.provider.toLowerCase().includes(query));
      };

      const autoItems = modelCatalog.filter(i => i.section === 'auto' && matchesQuery(i));
      const localItems = modelCatalog.filter(i => i.section === 'local' && matchesQuery(i));
      const cloudItems = modelCatalog.filter(i => i.section === 'cloud' && matchesQuery(i));
      const copilotItems = modelCatalog.filter(i => i.section === 'copilot' && matchesQuery(i));

      autoItems.forEach(item => {
        popoverContentList.appendChild(createModelItemElement(item, activeId === 'auto'));
      });

      const localHeader = document.createElement('div');
      localHeader.className = 'popover-section-title';
      
      if (window.isOllamaAvailable === false) {
        localHeader.innerHTML = 'LOCAL (Offline) <span style="color:#f85149; font-weight:normal; text-transform:none; margin-left:6px;">⚫ disconnected</span>';
        popoverContentList.appendChild(localHeader);
        
        const offlineWarning = document.createElement('div');
        offlineWarning.className = 'popover-item';
        offlineWarning.style.color = 'var(--vscode-descriptionForeground)';
        offlineWarning.style.fontSize = '11px';
        offlineWarning.style.padding = '6px 12px';
        offlineWarning.style.cursor = 'pointer';
        offlineWarning.innerHTML = '<span style="color:#d29922; margin-right:4px;">⚠️</span> Ollama offline. Click to switch to Cloud.';
        offlineWarning.addEventListener('click', () => {
          window.switchToCloudFallback();
          modelPopover.classList.add('hidden');
        });
        popoverContentList.appendChild(offlineWarning);
      } else {
        localHeader.innerHTML = 'LOCAL (Offline) <span style="color:#3fb950; font-weight:normal; text-transform:none; margin-left:6px;">🟢 active</span>';
        popoverContentList.appendChild(localHeader);
        
        if (localItems.length === 0) {
          const noLocal = document.createElement('div');
          noLocal.className = 'popover-item';
          noLocal.style.color = 'var(--vscode-descriptionForeground)';
          noLocal.style.fontSize = '11px';
          noLocal.style.cursor = 'default';
          noLocal.textContent = 'No local models found';
          popoverContentList.appendChild(noLocal);
        } else {
          localItems.forEach(item => {
            popoverContentList.appendChild(createModelItemElement(item, activeId === item.id));
          });
        }
      }

      if (cloudItems.length > 0) {
        const cloudHeader = document.createElement('div');
        cloudHeader.className = 'popover-section-title';
        cloudHeader.textContent = 'CLOUD (API)';
        popoverContentList.appendChild(cloudHeader);
        
        cloudItems.forEach(item => {
          popoverContentList.appendChild(createModelItemElement(item, activeId === item.id));
        });
      }

      if (copilotItems.length > 0) {
        const copilotHeader = document.createElement('div');
        copilotHeader.className = 'popover-section-title';
        copilotHeader.textContent = 'Copilot / Premium';
        popoverContentList.appendChild(copilotHeader);
        
        copilotItems.forEach(item => {
          popoverContentList.appendChild(createModelItemElement(item, activeId === item.id));
        });
      }

      if (autoItems.length === 0 && localItems.length === 0 && cloudItems.length === 0 && copilotItems.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'popover-item';
        emptyDiv.style.color = 'var(--vscode-descriptionForeground)';
        emptyDiv.style.cursor = 'default';
        emptyDiv.textContent = 'No models found';
        popoverContentList.appendChild(emptyDiv);
      }
    }

    function createModelItemElement(item, isSelected) {
      const itemDiv = document.createElement('div');
      itemDiv.className = 'popover-item';
      if (isSelected) {
        itemDiv.classList.add('selected');
      }

      const checkDiv = document.createElement('div');
      checkDiv.className = 'popover-item-check';
      if (isSelected) {
        checkDiv.textContent = '✓';
      }
      itemDiv.appendChild(checkDiv);

      const nameSpan = document.createElement('span');
      nameSpan.className = 'popover-item-name';
      nameSpan.textContent = item.name;
      itemDiv.appendChild(nameSpan);

      if (item.provider) {
        const providerSpan = document.createElement('span');
        providerSpan.className = 'popover-item-provider';
        providerSpan.textContent = item.provider;
        itemDiv.appendChild(providerSpan);
      }

      if (item.badge) {
        const badgeSpan = document.createElement('span');
        badgeSpan.className = 'popover-item-badge-pill';
        badgeSpan.textContent = item.badge;
        if (item.badgeColor) {
          badgeSpan.style.backgroundColor = item.badgeColor;
          badgeSpan.style.color = '#ffffff';
        } else {
          badgeSpan.style.backgroundColor = 'var(--vscode-sideBarSectionHeader-background, rgba(128, 128, 128, 0.2))';
        }
        itemDiv.appendChild(badgeSpan);
      }

      if (item.upgrade) {
        const upgradeSpan = document.createElement('span');
        upgradeSpan.className = 'popover-item-upgrade';
        upgradeSpan.textContent = 'Upgrade';
        upgradeSpan.addEventListener('click', (e) => {
          e.stopPropagation();
          vscode.postMessage({
            command: 'showUpgradeMessage',
            text: 'Upgrade to premium to access ' + item.name + '!'
          });
          modelPopover.classList.add('hidden');
        });
        itemDiv.appendChild(upgradeSpan);
      }

      itemDiv.addEventListener('click', () => {
        if (item.upgrade) return;
        
        let providerVal = 'nvidia';
        let modelVal = 'auto';
        
        if (item.id === 'auto') {
          providerVal = 'nvidia';
          modelVal = 'auto';
        } else {
          const parts = item.id.split(':');
          providerVal = parts[0];
          modelVal = parts.slice(1).join(':');
        }
        
        if (providerVal === 'copilot') {
          vscode.postMessage({
            command: 'showUpgradeMessage',
            text: 'Copilot models require a connected Copilot account.'
          });
          return;
        }
        
        updateSessionSettings({
          provider: providerVal,
          model: modelVal
        });
        
        modelPopover.classList.add('hidden');
      });

      return itemDiv;
    }

    sessionModelBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      contextPopover?.classList.add('hidden');
      toolsPopover?.classList.add('hidden');
      
      const isHidden = modelPopover.classList.contains('hidden');
      if (isHidden) {
        modelPopover.classList.remove('hidden');
        popoverSearch.value = '';
        currentSearchQuery = '';
        renderModelList();
        popoverSearch.focus();
        
        // Fetch dynamic Ollama models
        vscode.postMessage({ command: 'getModels', data: { provider: 'ollama' } });
      } else {
        modelPopover.classList.add('hidden');
      }
    });

    sessionContextBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      modelPopover?.classList.add('hidden');
      toolsPopover?.classList.add('hidden');
      
      const isHidden = contextPopover.classList.contains('hidden');
      if (isHidden) {
        contextPopover.classList.remove('hidden');
        renderContextPopoverList();
      } else {
        contextPopover.classList.add('hidden');
      }
    });

    sessionToolsBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      modelPopover?.classList.add('hidden');
      contextPopover?.classList.add('hidden');
      
      const isHidden = toolsPopover.classList.contains('hidden');
      if (isHidden) {
        toolsPopover.classList.remove('hidden');
        renderToolsPopoverList();
      } else {
        toolsPopover.classList.add('hidden');
      }
    });

    document.addEventListener('click', (e) => {
      if (modelPopover && !modelPopover.contains(e.target) && !sessionModelBtn?.contains(e.target)) {
        modelPopover.classList.add('hidden');
      }
      if (contextPopover && !contextPopover.contains(e.target) && !sessionContextBtn?.contains(e.target)) {
        contextPopover.classList.add('hidden');
      }
      if (toolsPopover && !toolsPopover.contains(e.target) && !sessionToolsBtn?.contains(e.target)) {
        toolsPopover.classList.add('hidden');
      }
    });

    popoverSearch?.addEventListener('input', (e) => {
      currentSearchQuery = e.target.value;
      renderModelList();
    });

    popoverSettingsBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      modelPopover.classList.add('hidden');
      setConfigPanelOpen(!isConfigOpen);
    });

    function renderContextPopoverList() {
      if (!contextPopover) return;
      const items = contextPopover.querySelectorAll('.popover-item');
      items.forEach(item => {
        const val = item.getAttribute('data-value');
        const check = item.querySelector('.popover-item-check');
        if (check) {
          if (activeSessionState.contextMode === val) {
            check.textContent = '✓';
            item.classList.add('selected');
          } else {
            check.textContent = '';
            item.classList.remove('selected');
          }
        }
        
        if (!item.hasClickListener) {
          item.hasClickListener = true;
          item.addEventListener('click', () => {
            updateSessionSettings({ contextMode: val });
            contextPopover.classList.add('hidden');
          });
        }
      });
    }

    function renderToolsPopoverList() {
      if (!toolsPopover) return;
      const items = toolsPopover.querySelectorAll('.popover-item');
      items.forEach(item => {
        const val = item.getAttribute('data-value');
        const check = item.querySelector('.popover-item-check');
        if (check) {
          if (activeSessionState.toolsMode === val) {
            check.textContent = '✓';
            item.classList.add('selected');
          } else {
            check.textContent = '';
            item.classList.remove('selected');
          }
        }
        
        if (!item.hasClickListener) {
          item.hasClickListener = true;
          item.addEventListener('click', () => {
            updateSessionSettings({ toolsMode: val });
            toolsPopover.classList.add('hidden');
          });
        }
      });
    }

    // Populate inputs from configuration
    const config = window.initialConfig || {};
    
    const providerSelect = document.getElementById('providerSelect');
    const nvidiaApiKey = document.getElementById('nvidiaApiKey');
    const nvidiaModel = document.getElementById('nvidiaModel');
    const nvidiaBaseUrl = document.getElementById('nvidiaBaseUrl');
    const cloudApiKey = document.getElementById('cloudApiKey');
    const cloudModel = document.getElementById('cloudModel');
    const cloudBaseUrl = document.getElementById('cloudBaseUrl');
    const ollamaUrl = document.getElementById('ollamaUrl');
    const ollamaModel = document.getElementById('ollamaModel');
    const anthropicApiKey = document.getElementById('anthropicApiKey');
    const anthropicModel = document.getElementById('anthropicModel');
    const anthropicBaseUrl = document.getElementById('anthropicBaseUrl');
    const toolsSafetySelect = document.getElementById('toolsSafetySelect');
    const systemPrompt = document.getElementById('systemPrompt');
    const temperatureInput = document.getElementById('temperatureInput');
    const temperatureVal = document.getElementById('temperatureVal');

    temperatureInput?.addEventListener('input', (e) => {
      temperatureVal.textContent = e.target.value;
    });
    
    let hasInitializedSession = false;

    function fillForm(cfg) {
      if (!cfg) return;
      window.currentConfigState = cfg;
      
      if (!hasInitializedSession) {
        hasInitializedSession = true;
        if (!state.sessionSettings) {
          activeSessionState.provider = cfg.provider || 'nvidia';
          if (cfg.provider === 'nvidia') {
            activeSessionState.model = 'auto';
          } else if (cfg.provider === 'cloud') {
            activeSessionState.model = cfg.cloudModel || 'gpt-4o-mini';
          } else if (cfg.provider === 'ollama') {
            activeSessionState.model = cfg.ollamaModel || 'qwen2.5-coder:7b';
          } else if (cfg.provider === 'anthropic') {
            activeSessionState.model = cfg.anthropicModel || 'claude-3-5-sonnet-latest';
          }
          activeSessionState.toolsMode = cfg.toolsSafety || 'safe';
          state.sessionSettings = activeSessionState;
          vscode.setState(state);
        }
        updateSessionBarLabels();
      }

      if (cfg.provider) {
        providerSelect.value = cfg.provider;
      }
      if (cfg.nvidiaApiKey !== undefined) nvidiaApiKey.value = cfg.nvidiaApiKey;
      if (cfg.nvidiaModel !== undefined) nvidiaModel.value = cfg.nvidiaModel;
      if (cfg.nvidiaBaseUrl !== undefined) nvidiaBaseUrl.value = cfg.nvidiaBaseUrl;
      if (cfg.apiKey !== undefined) cloudApiKey.value = cfg.apiKey;
      if (cfg.cloudModel !== undefined) cloudModel.value = cfg.cloudModel;
      if (cfg.cloudBaseUrl !== undefined) cloudBaseUrl.value = cfg.cloudBaseUrl;
      if (cfg.ollamaUrl !== undefined) ollamaUrl.value = cfg.ollamaUrl;
      if (cfg.ollamaModel !== undefined) ollamaModel.value = cfg.ollamaModel;
      if (cfg.anthropicApiKey !== undefined) anthropicApiKey.value = cfg.anthropicApiKey;
      if (cfg.anthropicModel !== undefined) anthropicModel.value = cfg.anthropicModel;
      if (cfg.anthropicBaseUrl !== undefined) anthropicBaseUrl.value = cfg.anthropicBaseUrl;
      if (cfg.toolsSafety !== undefined) toolsSafetySelect.value = cfg.toolsSafety;
      if (cfg.systemPrompt !== undefined) systemPrompt.value = cfg.systemPrompt;
      if (cfg.temperature !== undefined) {
        temperatureInput.value = cfg.temperature;
        temperatureVal.textContent = cfg.temperature;
      }
      
      updateProviderFieldsVisibility(providerSelect.value);
      renderModelList();
    }
    
    function updateProviderFieldsVisibility(provider) {
      document.getElementById('nvidiaSettings').classList.add('hidden');
      document.getElementById('cloudSettings').classList.add('hidden');
      document.getElementById('ollamaSettings').classList.add('hidden');
      document.getElementById('anthropicSettings').classList.add('hidden');
      
      if (provider === 'nvidia') {
        document.getElementById('nvidiaSettings').classList.remove('hidden');
      } else if (provider === 'cloud') {
        document.getElementById('cloudSettings').classList.remove('hidden');
      } else if (provider === 'ollama') {
        document.getElementById('ollamaSettings').classList.remove('hidden');
      } else if (provider === 'anthropic') {
        document.getElementById('anthropicSettings').classList.remove('hidden');
      }
    }
    
    providerSelect?.addEventListener('change', (e) => {
      updateProviderFieldsVisibility(e.target.value);
    });
    
    fillForm(config);
    
    // Toggle Password Visibility
    function setupPasswordToggle(toggleId, inputId) {
      const toggle = document.getElementById(toggleId);
      const input = document.getElementById(inputId);
      toggle?.addEventListener('click', () => {
        if (input.type === 'password') {
          input.type = 'text';
          toggle.textContent = '🙈';
        } else {
          input.type = 'password';
          toggle.textContent = '👁️';
        }
      });
    }
    setupPasswordToggle('toggleNvidiaKey', 'nvidiaApiKey');
    setupPasswordToggle('toggleCloudKey', 'cloudApiKey');
    setupPasswordToggle('toggleAnthropicKey', 'anthropicApiKey');
    
    // Save Config
    const saveConfigBtn = document.getElementById('saveConfigBtn');
    saveConfigBtn?.addEventListener('click', () => {
      vscode.postMessage({
        command: 'updateConfig',
        data: {
          provider: providerSelect.value,
          nvidiaApiKey: nvidiaApiKey.value,
          nvidiaModel: nvidiaModel.value,
          nvidiaBaseUrl: nvidiaBaseUrl.value,
          apiKey: cloudApiKey.value,
          cloudModel: cloudModel.value,
          cloudBaseUrl: cloudBaseUrl.value,
          ollamaUrl: ollamaUrl.value,
          ollamaModel: ollamaModel.value,
          anthropicApiKey: anthropicApiKey.value,
          anthropicModel: anthropicModel.value,
          anthropicBaseUrl: anthropicBaseUrl.value,
          toolsSafety: toolsSafetySelect.value,
          systemPrompt: systemPrompt.value,
          temperature: parseFloat(temperatureInput.value)
        }
      });
    });

    function addMessage(text, author) {
      const msgDiv = document.createElement('div');
      msgDiv.className = 'message ' + author;
      msgDiv.textContent = text;
      chatContainer?.appendChild(msgDiv);
      chatContainer?.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
    }

    function addMessageWithHTML(htmlContent, author) {
      const msgDiv = document.createElement('div');
      msgDiv.className = 'message ' + author;
      msgDiv.innerHTML = htmlContent;
      chatContainer?.appendChild(msgDiv);
      chatContainer?.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
    }

    sendBtn?.addEventListener('click', () => {
      const text = inputBox?.value.trim();
      if (!text) { return; }
      addMessage(text, 'user');
      inputBox.value = '';
      if (inputBox) {
        inputBox.style.height = 'auto';
      }
      loadingSpinner?.classList.remove('hidden');
      vscode.postMessage({
        command: 'sendMessage',
        text: text,
        data: {
          sessionSettings: {
            provider: activeSessionState.provider,
            model: activeSessionState.model === 'auto' ? undefined : activeSessionState.model,
            contextMode: activeSessionState.contextMode,
            toolsMode: activeSessionState.toolsMode
          }
        }
      });
    });

    // Support Enter to send and Shift+Enter for newlines
    inputBox?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendBtn?.click();
      }
    });

    // Auto-resize textarea
    inputBox?.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = this.scrollHeight + 'px';
    });

    // Toolbar Code Btn listener
    const toolbarCodeBtn = document.getElementById('toolbarCodeBtn');
    toolbarCodeBtn?.addEventListener('click', () => {
      if (!inputBox) return;
      const start = inputBox.selectionStart;
      const end = inputBox.selectionEnd;
      const val = inputBox.value;
      inputBox.value = val.substring(0, start) + "\`\`\`\n\n\`\`\`" + val.substring(end);
      inputBox.focus();
      inputBox.selectionStart = inputBox.selectionEnd = start + 4;
      inputBox.style.height = 'auto';
      inputBox.style.height = inputBox.scrollHeight + 'px';
    });

    // Toolbar Settings Btn listener (toggles configurations drawer)
    const toolbarSettingsBtn = document.getElementById('toolbarSettingsBtn');
    toolbarSettingsBtn?.addEventListener('click', () => {
      setConfigPanelOpen(!isConfigOpen);
    });

    // Plus button toast warning
    const toolbarPlusBtn = document.getElementById('toolbarPlusBtn');
    toolbarPlusBtn?.addEventListener('click', () => {
      vscode.postMessage({ command: 'sendMessage', text: 'How can I add files to the chat context?' });
    });

    // Request initial provider status check
    vscode.postMessage({
      command: 'checkProviderStatus',
      data: {
        provider: activeSessionState.provider,
        model: activeSessionState.model === 'auto' ? undefined : activeSessionState.model
      }
    });

    // Receive messages from extension
    window.addEventListener('message', event => {
      const message = event.data;
      
      switch (message.type) {
        case 'userMessage':
          addMessage(message.value, 'user');
          break;
          
        case 'streamStart':
          loadingSpinner?.classList.remove('hidden');
          const msgDiv = document.createElement('div');
          msgDiv.className = 'message ai';
          msgDiv.id = 'streamingMessage';
          msgDiv.textContent = '';
          chatContainer?.appendChild(msgDiv);
          break;
          
        case 'streamToken':
          const streamingMsg = document.getElementById('streamingMessage');
          if (streamingMsg) {
            streamingMsg.textContent += message.value;
            chatContainer?.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
          }
          break;
          
        case 'streamEnd':
          loadingSpinner?.classList.add('hidden');
          const finishedMsg = document.getElementById('streamingMessage');
          if (finishedMsg) {
            finishedMsg.removeAttribute('id');
          }
          break;
          
        case 'aiError':
          loadingSpinner?.classList.add('hidden');
          if (message.isOllamaOffline) {
            addMessageWithHTML('⚠️ Ollama is offline. <button onclick="window.switchToCloudFallback()" style="padding: 2px 6px; font-size: 11px; margin-left: 6px; border:1px solid var(--vscode-button-border); border-radius:4px; color:var(--vscode-button-foreground); background:var(--vscode-button-background); cursor:pointer;">Switch to Cloud Fallback</button> or start Ollama server.', 'ai');
          } else {
            addMessage(message.value, 'ai');
          }
          break;
          
        case 'aiResponse':
          loadingSpinner?.classList.add('hidden');
          addMessage(message.text, 'ai');
          break;
          
        case 'scanLoaded':
          loadingSpinner?.classList.add('hidden');
          renderScanSummary(message.data);
          break;
          
        case 'scanLoadError':
          loadingSpinner?.classList.add('hidden');
          addMessage('Failed to load scan: ' + (message.text || 'unknown error'), 'ai');
          break;

        case 'configUpdated':
          fillForm(message.config);
          break;

        case 'ollamaModelsLoaded':
          const nonLocalCatalog = modelCatalog.filter(i => i.section !== 'local');
          const fetchedModels = message.models || [];
          const newLocalItems = fetchedModels.map(modelName => ({
            id: 'ollama:' + modelName,
            name: modelName,
            provider: 'Ollama',
            badge: 'Local',
            badgeColor: '#007acc',
            section: 'local'
          }));
          modelCatalog.length = 0;
          modelCatalog.push(...nonLocalCatalog, ...newLocalItems);
          window.isOllamaAvailable = true;
          renderModelList();
          break;
          
        case 'ollamaModelsError':
          window.isOllamaAvailable = false;
          renderModelList();
          break;

        case 'providerStatus':
          const badge = document.getElementById('configStatusBadge');
          if (badge) {
            badge.className = 'config-status';
            if (message.status === 'connected') {
              badge.classList.add('status-connected');
              badge.textContent = '🟢 Connected';
            } else if (message.status === 'error') {
              badge.classList.add('status-error');
              badge.textContent = '🔴 Offline';
            } else {
              badge.classList.add('status-checking');
              badge.textContent = '⏳ Checking';
            }
          }
          break;
      }
    });

    function renderScanSummary(data) {
      const container = document.createElement('div');
      container.className = 'item';
      const title = document.createElement('div');
      title.className = 'item-title';
      title.textContent = 'Scan: ' + data.scannedAt + ' — ' + data.files.length + ' files, ' + data.relationships.length + ' relationships';
      container.appendChild(title);

      const list = document.createElement('div');
      list.className = 'list';
      for (const f of data.files.slice(0, 50)) {
        const item = document.createElement('div');
        item.className = 'item-meta';
        item.textContent = f.relativePath;
        list.appendChild(item);
      }

      container.appendChild(list);
      document.body.insertBefore(container, document.getElementById('chatContainer'));
    }
    </script>
</body>
</html>`;
  }
}

function renderWelcome(): string {
  return `<section class="empty">
    <strong>Welcome.</strong>
    <div class="item-meta">Repository intelligence is ready for the current workspace.</div>
  </section>`;
}

function renderSummary(snapshot: RepositoryIntelligenceSnapshot): string {
  const { summary } = snapshot;
  const frameworks = summary.detectedFrameworks.slice(0, 8);
  const languages = summary.languagesUsed.slice(0, 8);
  const entryPoints = summary.importantEntryPoints.slice(0, 8);
  const relationships = summary.dependencyRelationships.slice(0, 8);

  return `<section>
    <h2>Repository Summary</h2>
    <div class="stats">
      <div class="stat"><span class="stat-value">${summary.totalFiles}</span><span class="stat-label">Files</span></div>
      <div class="stat"><span class="stat-value">${summary.totalFolders}</span><span class="stat-label">Folders</span></div>
      <div class="stat"><span class="stat-value">${summary.internalDependencyCount}</span><span class="stat-label">Internal Links</span></div>
      <div class="stat"><span class="stat-value">${summary.exportCount}</span><span class="stat-label">Exports</span></div>
    </div>

    <h2>Frameworks</h2>
    ${frameworks.length ? `<div class="list">${frameworks.map(renderFramework).join('')}</div>` : '<div class="empty">No framework detected yet.</div>'}

    <h2>Languages</h2>
    ${languages.length ? `<div class="list">${languages.map(renderLanguage).join('')}</div>` : '<div class="empty">No language data available.</div>'}

    <h2>Entry Points</h2>
    ${entryPoints.length ? `<div class="list">${entryPoints.map(renderEntryPoint).join('')}</div>` : '<div class="empty">No entry points identified.</div>'}

    <h2>Dependency Relationships</h2>
    ${relationships.length ? `<div class="list">${relationships.map(renderRelationship).join('')}</div>` : '<div class="empty">No dependency relationships found.</div>'}
  </section>`;
}

function renderFramework(detection: RepositoryIntelligenceSnapshot['summary']['detectedFrameworks'][number]): string {
  const signals = detection.signals.slice(0, 3).map((signal) => `${signal.kind}: ${signal.value}`).join(', ');

  return `<div class="item">
    <div class="item-title">
      <span>${escapeHtml(detection.framework)}</span>
      <span>${formatPercent(detection.confidence)}</span>
    </div>
    <div class="item-meta">${escapeHtml(signals || 'Detected from repository signals')}</div>
  </div>`;
}

function renderLanguage(language: RepositoryIntelligenceSnapshot['summary']['languagesUsed'][number]): string {
  return `<div class="item">
    <div class="item-title">
      <span>${escapeHtml(language.language)}</span>
      <span>${language.files}</span>
    </div>
    <div class="item-meta">${escapeHtml(language.extensions.join(', ') || 'No extension')}</div>
  </div>`;
}

function renderEntryPoint(entryPoint: RepositoryIntelligenceSnapshot['summary']['importantEntryPoints'][number]): string {
  return `<div class="item">
    <div class="item-title">
      <span class="path">${escapeHtml(entryPoint.path)}</span>
      <span>${escapeHtml(entryPoint.type)}</span>
    </div>
    <div class="item-meta">${escapeHtml(entryPoint.reason)}</div>
  </div>`;
}

function renderRelationship(relationship: RepositoryIntelligenceSnapshot['summary']['dependencyRelationships'][number]): string {
  return `<div class="item">
    <div class="item-title">
      <span class="path">${escapeHtml(relationship.source)}</span>
    </div>
    <div class="item-meta">to <span class="path">${escapeHtml(relationship.target)}</span> (${relationship.imports})</div>
  </div>`;
}

function getNonce(): string {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';

  for (let index = 0; index < 32; index += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }

  return text;
}
