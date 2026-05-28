import * as vscode from 'vscode';
import type { RepositoryIntelligenceService, RepositoryIntelligenceSnapshot } from '../scanner';
import type { OrbLogger } from '../utils/logger';
import { OrbAiChatHandler } from './chatHandler';
import { escapeHtml, formatPercent } from './html';

export class OrbAiViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'orb-ai.repositoryView';

  private view: vscode.WebviewView | undefined;
  private snapshot: RepositoryIntelligenceSnapshot | undefined;
  private chatHandler: OrbAiChatHandler;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly intelligenceService: RepositoryIntelligenceService,
    private readonly logger: OrbLogger,
  ) {
    this.chatHandler = new OrbAiChatHandler(logger);
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    this.snapshot = this.intelligenceService.getSnapshot();
    this.chatHandler.setSnapshot(this.snapshot);

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.onDidReceiveMessage(async (message: { command?: string; text?: string }) => {
      switch (message.command) {
        case 'scanRepository':
          await vscode.commands.executeCommand('orb-ai.scanRepository');
          break;
        case 'showGraph':
          await vscode.commands.executeCommand('orb-ai.showRepositoryGraph');
          break;
        case 'sendMessage':
          if (message.text) {
            this.chatHandler.addMessage(message.text);
            // Generate AI response using repository context
            const response = await this.chatHandler.generateResponse(message.text);
            webviewView.webview.postMessage({ command: 'aiResponse', text: response });
          }
          break;
        default:
          this.logger.warn('Unknown ORB AI webview message', message);
      }
    });

    this.render();
  }

  public refresh(snapshot?: RepositoryIntelligenceSnapshot): void {
    this.snapshot = snapshot ?? this.intelligenceService.getSnapshot();
    this.chatHandler.setSnapshot(this.snapshot);
    this.render();
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
    </style>
</head>
<body>
  <section class="header">
    <div class="brand">
      <h1>ORB AI</h1>
      <p class="subtitle">Orchestrated Reasoning Brain</p>
    </div>
  </section>

    <div class="actions">
      <button id="scanRepository">Scan Repository</button>
      <button id="showGraph" class="secondary">Show Graph</button>
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
    const vscode = acquireVsCodeApi();
    const scanBtn = document.getElementById('scanRepository');
    const graphBtn = document.getElementById('showGraph');
    const sendBtn = document.getElementById('sendMessage');
    const inputBox = document.getElementById('messageInput');
    const chatContainer = document.getElementById('chatContainer');
    const loadingSpinner = document.getElementById('loadingSpinner');

    scanBtn?.addEventListener('click', () => vscode.postMessage({ command: 'scanRepository' }));
    graphBtn?.addEventListener('click', () => vscode.postMessage({ command: 'showGraph' }));

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

    // Receive messages from extension
    window.addEventListener('message', event => {
      const message = event.data;
      if (message.command === 'aiResponse') {
        loadingSpinner?.classList.add('hidden');
        addMessage(message.text, 'ai');
      }
    });
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

