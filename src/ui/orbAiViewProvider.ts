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
            await this.handleUserMessage(message.text);
          }
          break;
        case 'checkProviderStatus':
          await this.checkAndPushProviderStatus();
          break;
        case 'openSettings':
          await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:orb-ai');
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
      },
    });
    this.checkAndPushProviderStatus();
  }

  private async checkAndPushProviderStatus(): Promise<void> {
    try {
      const provider = getLLMProvider();
      const available = await provider.isAvailable();
      const config = vscode.workspace.getConfiguration('orb-ai');
      const providerType = config.get<string>('provider', 'nvidia');

      this.view?.webview.postMessage({
        type: 'providerStatus',
        status: available ? 'connected' : 'error',
        provider: providerType,
      });
    } catch (err) {
      this.view?.webview.postMessage({
        type: 'providerStatus',
        status: 'error',
        provider: 'unknown',
      });
    }
  }

  private async handleUserMessage(userMessage: string): Promise<void> {
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
      const provider = getLLMProvider();
      const available = await provider.isAvailable();

      if (!available) {
        this.view?.webview.postMessage({
          type: 'aiError',
          value: '❌ LLM provider unavailable. Check ORB AI settings.',
        });
        return;
      }

      // Send stream start signal
      this.view?.webview.postMessage({
        type: 'streamStart',
      });

      // Build messages array for LLM
      const messages = this.messageHistory.map((msg) => ({
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
      }));

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
    #inputArea { display:flex; gap:6px; align-items:center; }
    #messageInput { flex:1; padding:6px; border:1px solid var(--vscode-input-border); border-radius:4px; background:var(--vscode-input-background); color:var(--vscode-input-foreground); }
    #sendMessage { padding:6px 12px; }
    #loadingSpinner { margin-left:auto; }
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
    <div id="chatContainer"></div>
    <div id="inputArea">
      <input type="text" id="messageInput" placeholder="Ask ORB AI..." />
      <button id="sendMessage">Send</button>
      <span id="loadingSpinner" class="hidden">⏳</span>
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
    
    function fillForm(cfg) {
      if (!cfg) return;
      if (cfg.provider) providerSelect.value = cfg.provider;
      if (cfg.nvidiaApiKey !== undefined) nvidiaApiKey.value = cfg.nvidiaApiKey;
      if (cfg.nvidiaModel !== undefined) nvidiaModel.value = cfg.nvidiaModel;
      if (cfg.nvidiaBaseUrl !== undefined) nvidiaBaseUrl.value = cfg.nvidiaBaseUrl;
      if (cfg.apiKey !== undefined) cloudApiKey.value = cfg.apiKey;
      if (cfg.cloudModel !== undefined) cloudModel.value = cfg.cloudModel;
      if (cfg.cloudBaseUrl !== undefined) cloudBaseUrl.value = cfg.cloudBaseUrl;
      if (cfg.ollamaUrl !== undefined) ollamaUrl.value = cfg.ollamaUrl;
      if (cfg.ollamaModel !== undefined) ollamaModel.value = cfg.ollamaModel;
      
      updateProviderFieldsVisibility(providerSelect.value);
    }
    
    function updateProviderFieldsVisibility(provider) {
      document.getElementById('nvidiaSettings').classList.add('hidden');
      document.getElementById('cloudSettings').classList.add('hidden');
      document.getElementById('ollamaSettings').classList.add('hidden');
      
      if (provider === 'nvidia') {
        document.getElementById('nvidiaSettings').classList.remove('hidden');
      } else if (provider === 'cloud') {
        document.getElementById('cloudSettings').classList.remove('hidden');
      } else if (provider === 'ollama') {
        document.getElementById('ollamaSettings').classList.remove('hidden');
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
          ollamaModel: ollamaModel.value
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

    sendBtn?.addEventListener('click', () => {
      const text = inputBox?.value.trim();
      if (!text) { return; }
      addMessage(text, 'user');
      inputBox.value = '';
      loadingSpinner?.classList.remove('hidden');
      vscode.postMessage({ command: 'sendMessage', text });
    });

    // Support Enter key to send
    inputBox?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        sendBtn?.click();
      }
    });

    // Request initial provider status check
    vscode.postMessage({ command: 'checkProviderStatus' });

    // Receive messages from extension
    window.addEventListener('message', event => {
      const message = event.data;
      
      switch (message.type) {
        case 'userMessage':
          addMessage(message.value, 'user');
          break;
          
        case 'streamStart':
          loadingSpinner?.classList.remove('hidden');
          // Create a new AI message div for streaming
          const msgDiv = document.createElement('div');
          msgDiv.className = 'message ai';
          msgDiv.id = 'streamingMessage';
          msgDiv.textContent = '';
          chatContainer?.appendChild(msgDiv);
          break;
          
        case 'streamToken':
          // Append token to streaming message
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
          addMessage(message.value, 'ai');
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
