import * as vscode from 'vscode';
import * as path from 'path';
import type { RepositoryIntelligenceService, RepositoryIntelligenceSnapshot } from '../scanner';
import type { OrbLogger } from '../utils/logger';
import { escapeHtml, formatPercent } from './html';
import { getLLMProvider } from '../ai';
import { ToolExecutor } from '../agents/toolExecutor';
import { ALL_TOOLS, APPROVAL_REQUIRED_TOOLS } from '../agents/toolRegistry';
import type { ChatMessage, ToolCall } from '../ai/types';

export class OrbAiViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'orb-ai.repositoryView';

  private view: vscode.WebviewView | undefined;
  private snapshot: RepositoryIntelligenceSnapshot | undefined;
  private messageHistory: ChatMessage[] = [];
  private toolExecutor: ToolExecutor;
  private pendingApproval: { resolve: (approved: boolean) => void; callId: string } | undefined;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly intelligenceService: RepositoryIntelligenceService,
    private readonly logger: OrbLogger,
  ) {
    this.toolExecutor = new ToolExecutor(
      this.intelligenceService.getWorkspaceRoot(),
      this.logger
    );

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('orb-ai') && this.view) {
        this.pushConfigToWebview();
      }
    });
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    this.snapshot = this.intelligenceService.getSnapshot();

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
        case 'toolApproval':
          if (this.pendingApproval && this.pendingApproval.callId === message.data?.callId) {
            this.pendingApproval.resolve(!!message.data?.approved);
            this.pendingApproval = undefined;
          }
          break;
        case 'getWorkspaceFiles':
          try {
            const query = message.data?.query || '';
            const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**', 150);
            let fileList = files.map(f => {
              const root = this.intelligenceService.getWorkspaceRoot();
              return root ? path.relative(root, f.fsPath).replace(/\\/g, '/') : f.fsPath;
            });
            if (query) {
              fileList = fileList.filter(f => f.toLowerCase().includes(query.toLowerCase()));
            }
            webviewView.webview.postMessage({ type: 'workspaceFiles', files: fileList });
          } catch (err) {
            this.logger.error('Failed to search workspace files', err);
          }
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
      // 1. Detect and parse @file references to inject file content as context
      const fileRegex = /@([a-zA-Z0-9_\-./]+)/g;
      let match;
      let extraContext = '';
      const matchedFiles = new Set<string>();

      while ((match = fileRegex.exec(userMessage)) !== null) {
        const relPath = match[1];
        if (matchedFiles.has(relPath)) continue;
        matchedFiles.add(relPath);

        try {
          const root = this.intelligenceService.getWorkspaceRoot();
          if (root) {
            const absPath = path.resolve(root, relPath);
            if (absPath.startsWith(root)) {
              const uri = vscode.Uri.file(absPath);
              const bytes = await vscode.workspace.fs.readFile(uri);
              const text = Buffer.from(bytes).toString('utf8');
              const truncatedText = text.length > 15000 ? text.slice(0, 15000) + '\n[... truncated ...]' : text;
              extraContext += `\n--- Context File: ${relPath} ---\n${truncatedText}\n---------------------\n`;
            }
          }
        } catch {
          // ignore unreadable/non-existent file tags
        }
      }

      let finalUserContent = userMessage;
      if (extraContext) {
        finalUserContent = `[System Context: Injected Files]\n${extraContext}\n\nUser Question:\n${userMessage}`;
      }

      this.messageHistory.push({ role: 'user', content: finalUserContent });

      // Resolve provider
      const config = vscode.workspace.getConfiguration('orb-ai');
      let providerType = sessionSettings?.provider;
      let modelName = sessionSettings?.model;

      if (!providerType || providerType === 'auto') {
        providerType = config.get<string>('provider', 'nvidia');
      }
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
          value: `❌ ${providerType} provider is unavailable. Check your settings.`,
          isOllamaOffline: providerType === 'ollama',
        });
        return;
      }

      const toolsSafety = config.get<string>('toolsSafety', 'safe');
      const systemPrompt = config.get<string>('systemPrompt', '');

      let loopCount = 0;
      const maxLoops = 10;
      let finished = false;

      // Start response stream/process
      this.view?.webview.postMessage({ type: 'streamStart' });

      while (!finished && loopCount < maxLoops) {
        loopCount++;

        const messages: ChatMessage[] = [];
        if (systemPrompt) {
          messages.push({ role: 'system', content: systemPrompt });
        }
        messages.push(...this.messageHistory);

        this.view?.webview.postMessage({
          type: 'agentThinking',
          text: loopCount === 1 ? 'Thinking...' : `Thinking (step ${loopCount}/10)...`
        });

        if (provider.chatWithTools) {
          const response = await provider.chatWithTools(messages, ALL_TOOLS);
          const { content, toolCalls } = response;

          if (toolCalls && toolCalls.length > 0) {
            // Append assistant response to message history (with tool_calls info)
            this.messageHistory.push({
              role: 'assistant',
              content: content || '',
              tool_calls: toolCalls.map(tc => ({
                id: tc.id,
                type: 'function',
                function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }
              }))
            });

            // Display tool call information in webview
            if (content) {
              this.view?.webview.postMessage({ type: 'streamToken', value: content + '\n\n' });
            }

            for (const tc of toolCalls) {
              const requiresApproval = APPROVAL_REQUIRED_TOOLS.has(tc.name) && toolsSafety !== 'dangerous';
              
              // Generate diff if write_file or create_file
              let diffText = '';
              if (tc.name === 'write_file' || tc.name === 'create_file') {
                const targetPath = tc.arguments.path;
                const newContent = tc.arguments.content || '';
                let oldContent = '';
                try {
                  const root = this.intelligenceService.getWorkspaceRoot();
                  if (root) {
                    const abs = path.resolve(root, targetPath);
                    if (abs.startsWith(root)) {
                      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(abs));
                      oldContent = Buffer.from(bytes).toString('utf8');
                    }
                  }
                } catch {
                  oldContent = '';
                }
                diffText = this.generateDiff(oldContent, newContent);
              }

              this.view?.webview.postMessage({
                type: 'toolCallStarted',
                callId: tc.id,
                name: tc.name,
                arguments: tc.arguments,
                requiresApproval,
                diff: diffText
              });

              let approved = true;
              if (requiresApproval) {
                approved = await this.waitForApproval(tc.id);
              }

              if (approved) {
                this.view?.webview.postMessage({
                  type: 'toolCallExecuting',
                  callId: tc.id,
                  name: tc.name
                });

                const executorResult = await this.toolExecutor.execute(tc);

                this.view?.webview.postMessage({
                  type: 'toolCallFinished',
                  callId: tc.id,
                  name: tc.name,
                  result: executorResult.result,
                  error: executorResult.error
                });

                this.messageHistory.push({
                  role: 'tool',
                  content: executorResult.result,
                  tool_call_id: tc.id,
                  name: tc.name
                });
              } else {
                this.view?.webview.postMessage({
                  type: 'toolCallFinished',
                  callId: tc.id,
                  name: tc.name,
                  result: 'Error: Tool execution rejected by user.',
                  error: true
                });

                this.messageHistory.push({
                  role: 'tool',
                  content: 'Error: Tool execution rejected by user.',
                  tool_call_id: tc.id,
                  name: tc.name
                });
              }
            }
          } else {
            // No tool calls, we are finished!
            finished = true;
            if (content) {
              this.view?.webview.postMessage({ type: 'streamToken', value: content });
              this.messageHistory.push({ role: 'assistant', content });
            }
          }
        } else {
          // Fallback to normal streaming chat if provider doesn't support tools
          let fullResponse = '';
          for await (const token of provider.chat(messages)) {
            fullResponse += token;
            this.view?.webview.postMessage({ type: 'streamToken', value: token });
          }
          this.messageHistory.push({ role: 'assistant', content: fullResponse });
          finished = true;
        }
      }

      this.view?.webview.postMessage({ type: 'streamEnd' });
    } catch (err: any) {
      this.view?.webview.postMessage({ type: 'aiError', value: `❌ Error: ${err.message ?? String(err)}` });
      this.logger.error('LLM agent chat error', err);
    }
  }

  private waitForApproval(callId: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.pendingApproval = { resolve, callId };
    });
  }

  private generateDiff(oldStr: string, newStr: string): string {
    const oldLines = oldStr.split(/\r?\n/);
    const newLines = newStr.split(/\r?\n/);
    let diff = '';
    let i = 0;
    let j = 0;

    while (i < oldLines.length || j < newLines.length) {
      if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
        diff += `  ${oldLines[i]}\n`;
        i++;
        j++;
      } else if (j < newLines.length && (i >= oldLines.length || !oldLines.slice(i).includes(newLines[j]))) {
        diff += `+ ${newLines[j]}\n`;
        j++;
      } else {
        diff += `- ${oldLines[i]}\n`;
        i++;
      }
    }
    return diff;
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
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

    :root { color-scheme: dark; }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      padding: 0;
      font-family: 'Inter', var(--vscode-font-family, -apple-system, BlinkMacSystemFont, sans-serif);
      font-size: 13px;
      color: var(--vscode-foreground, #cbd5e1);
      background: var(--vscode-sideBar-background, #1e1e1e);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* ─── Top Toolbar ─── */
    .orb-toolbar {
      display: flex;
      align-items: center;
      padding: 10px 14px 8px;
      gap: 6px;
      border-bottom: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
      background: var(--vscode-sideBar-background, #1e1e1e);
      flex-shrink: 0;
    }
    .orb-logo {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
      min-width: 0;
    }
    .orb-logo-icon {
      width: 22px;
      height: 22px;
      border-radius: 6px;
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #ffffff);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      flex-shrink: 0;
      box-shadow: 0 2px 6px rgba(0,0,0,0.2);
    }
    .orb-logo-text {
      font-size: 13px;
      font-weight: 700;
      color: var(--vscode-titleBar-activeForeground, #ffffff);
      letter-spacing: 0.4px;
    }
    .orb-logo-sub {
      font-size: 9px;
      color: var(--vscode-descriptionForeground, #858585);
      margin-left: 2px;
    }
    .toolbar-actions {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .tb-btn {
      background: transparent;
      border: none;
      color: var(--vscode-descriptionForeground, #858585);
      cursor: pointer;
      padding: 4px 6px;
      border-radius: 5px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s, color 0.15s;
    }
    .tb-btn:hover {
      background: var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.06));
      color: var(--vscode-foreground, #ffffff);
    }
    .provider-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #64748b;
      display: inline-block;
      margin-right: 4px;
      transition: background 0.3s;
    }
    .provider-dot.connected { background: #10b981; box-shadow: 0 0 8px rgba(16,185,129,0.5); }
    .provider-dot.error { background: #ef4444; }
    .provider-label {
      font-size: 10px;
      color: var(--vscode-descriptionForeground, #858585);
      font-weight: 600;
    }

    /* ─── Settings Panel Overlay ─── */
    .settings-overlay {
      display: none;
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      z-index: 200;
      background: var(--vscode-sideBar-background, #1e1e1e);
      flex-direction: column;
    }
    .settings-overlay.open {
      display: flex;
    }
    .settings-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 14px;
      border-bottom: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
      background: var(--vscode-sideBar-background, #1e1e1e);
      flex-shrink: 0;
    }
    .settings-header h2 {
      margin: 0;
      font-size: 13px;
      font-weight: 700;
      flex: 1;
      color: var(--vscode-foreground, #ffffff);
    }
    .settings-body {
      flex: 1;
      overflow-y: auto;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      background: var(--vscode-sideBar-background, #1e1e1e);
    }
    .settings-section-title {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: var(--vscode-textLink-foreground, #0e639c);
      margin-bottom: 4px;
      margin-top: 4px;
    }
    .form-row {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .form-row label {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #858585);
      font-weight: 500;
    }
    .form-row input,
    .form-row select,
    .form-row textarea {
      background: var(--vscode-input-background, #2d2d2d);
      color: var(--vscode-input-foreground, #ffffff);
      border: 1px solid var(--vscode-input-border, rgba(255,255,255,0.1));
      border-radius: 6px;
      padding: 6px 10px;
      font-family: inherit;
      font-size: 12px;
      outline: none;
      transition: border-color 0.15s;
    }
    .form-row input:focus,
    .form-row select:focus,
    .form-row textarea:focus {
      border-color: var(--vscode-focusBorder, #0e639c);
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
      right: 8px;
      top: 50%;
      transform: translateY(-50%);
      cursor: pointer;
      font-size: 12px;
      color: var(--vscode-descriptionForeground, #858585);
      user-select: none;
    }
    .provider-section { display: none; }
    .provider-section.active { display: flex; flex-direction: column; gap: 12px; }
    .settings-footer {
      padding: 12px 14px;
      border-top: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
      background: var(--vscode-sideBar-background, #1e1e1e);
      flex-shrink: 0;
    }
    .save-btn {
      width: 100%;
      padding: 8px;
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #ffffff);
      border: none;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s, transform 0.1s;
      font-family: inherit;
    }
    .save-btn:hover { background: var(--vscode-button-hoverBackground, #1177bb); }
    .save-btn:active { transform: scale(0.98); }

    /* ─── Quick Action Bar ─── */
    .quick-bar {
      display: flex;
      gap: 6px;
      padding: 8px 12px;
      flex-shrink: 0;
      border-bottom: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
      background: var(--vscode-sideBar-background, #1e1e1e);
    }
    .quick-btn {
      flex: 1;
      padding: 6px;
      background: var(--vscode-button-secondaryBackground, #2d2d2d);
      color: var(--vscode-button-secondaryForeground, #ffffff);
      border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
      border-radius: 6px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      font-family: inherit;
      transition: all 0.15s;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
    }
    .quick-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground, rgba(255,255,255,0.1));
      color: var(--vscode-foreground, #ffffff);
      border-color: var(--vscode-focusBorder, #0e639c);
    }

    /* ─── Chat Area ─── */
    .chat-area {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      scroll-behavior: smooth;
      background: var(--vscode-editor-background, #1e1e1e);
    }
    .chat-area::-webkit-scrollbar { width: 4px; }
    .chat-area::-webkit-scrollbar-track { background: transparent; }
    .chat-area::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 2px; }

    /* Welcome card */
    .welcome-card {
      background: var(--vscode-sideBar-background, #252526);
      border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
      border-radius: 8px;
      padding: 14px;
      margin-top: 2px;
    }
    .welcome-title {
      font-size: 13px;
      font-weight: 700;
      color: var(--vscode-foreground, #ffffff);
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .welcome-sub {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #858585);
      line-height: 1.5;
    }
    .welcome-hints {
      display: flex;
      flex-direction: column;
      gap: 5px;
      margin-top: 12px;
    }
    .hint-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      background: var(--vscode-editor-background, #1e1e1e);
      border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
      border-radius: 6px;
      font-size: 11px;
      color: var(--vscode-foreground, #cbd5e1);
      cursor: pointer;
      transition: all 0.15s;
      text-align: left;
    }
    .hint-chip:hover {
      background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.06));
      border-color: var(--vscode-focusBorder, #0e639c);
      color: var(--vscode-foreground, #ffffff);
    }

    /* Messages */
    .msg-user {
      display: flex;
      justify-content: flex-end;
    }
    .msg-user .bubble {
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #ffffff);
      border-radius: 12px 12px 3px 12px;
      padding: 8px 12px;
      max-width: 88%;
      font-size: 13px;
      line-height: 1.5;
      word-break: break-word;
      white-space: pre-wrap;
      box-shadow: 0 1px 4px rgba(0,0,0,0.2);
    }
    .msg-ai {
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }
    .ai-avatar {
      width: 22px;
      height: 22px;
      border-radius: 6px;
      background: var(--vscode-sideBar-background, #252526);
      border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      flex-shrink: 0;
      margin-top: 2px;
    }
    .msg-ai .bubble {
      background: var(--vscode-sideBar-background, #252526);
      border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
      border-radius: 3px 12px 12px 12px;
      padding: 8px 12px;
      max-width: calc(100% - 30px);
      font-size: 13px;
      line-height: 1.6;
      color: var(--vscode-foreground, #cbd5e1);
      word-break: break-word;
      white-space: pre-wrap;
    }
    .msg-error .bubble {
      background: var(--vscode-statusBarItem-errorBackground, rgba(239,68,68,0.08));
      border-color: rgba(239,68,68,0.25);
      color: #f87171;
    }
    .typing-dot {
      display: inline-block;
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: var(--vscode-descriptionForeground, #858585);
      animation: typingBlink 1s ease-in-out infinite;
      margin: 0 1px;
    }
    .typing-dot:nth-child(2) { animation-delay: 0.2s; }
    .typing-dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes typingBlink {
      0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
      40% { opacity: 1; transform: scale(1); }
    }

    /* Agent reasoning indicator */
    .agent-thinking-card {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: var(--vscode-sideBar-background, #252526);
      border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
      border-radius: 6px;
      color: var(--vscode-foreground, #cbd5e1);
      font-size: 12px;
      margin: 4px 0;
    }
    .spinner {
      width: 14px;
      height: 14px;
      border: 2px solid rgba(16,185,129,0.2);
      border-top-color: var(--vscode-textLink-foreground, #0e639c);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* Tool execution cards */
    .tool-card {
      background: var(--vscode-sideBar-background, #252526);
      border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
      border-radius: 6px;
      padding: 10px;
      margin: 6px 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .tool-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 11px;
      font-weight: 600;
      color: var(--vscode-textLink-foreground, #0e639c);
    }
    .tool-title {
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .tool-badge {
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 9px;
      text-transform: uppercase;
      font-weight: 700;
    }
    .tool-badge.pending { background: #b45309; color: #ffffff; }
    .tool-badge.running { background: #1e3a8a; color: #ffffff; }
    .tool-badge.finished { background: #064e3b; color: #ffffff; }
    .tool-badge.error { background: #7f1d1d; color: #ffffff; }
    
    .tool-details {
      background: var(--vscode-editor-background, #1e1e1e);
      border-radius: 4px;
      padding: 6px 8px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      color: var(--vscode-editor-foreground, #cbd5e1);
      border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
      white-space: pre-wrap;
      word-break: break-all;
      max-height: 150px;
      overflow-y: auto;
    }
    .tool-actions {
      display: flex;
      gap: 6px;
      margin-top: 4px;
    }
    .tool-btn {
      flex: 1;
      padding: 6px;
      border: none;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      color: var(--vscode-button-foreground, #ffffff);
    }
    .tool-btn.approve { background: var(--vscode-button-background, #0e639c); }
    .tool-btn.approve:hover { background: var(--vscode-button-hoverBackground, #1177bb); }
    .tool-btn.reject { background: var(--vscode-statusBarItem-errorBackground, #a80000); }
    .tool-btn.reject:hover { opacity: 0.9; }

    /* Diff View styles */
    .diff-container {
      background: var(--vscode-editor-background, #1e1e1e);
      border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
      border-radius: 4px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      max-height: 250px;
      overflow-y: auto;
      white-space: pre;
      margin-top: 4px;
    }
    .diff-line {
      display: block;
      padding: 1px 6px;
    }
    .diff-line.added { background: var(--vscode-diffEditor-insertedTextBackground, rgba(16,185,129,0.12)); color: #34d399; }
    .diff-line.removed { background: var(--vscode-diffEditor-removedTextBackground, rgba(239,68,68,0.12)); color: #f87171; }
    .diff-line.info { color: #85a5ff; font-weight: 600; }

    /* ─── Model Selector Bar ─── */
    .model-bar {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 6px 12px;
      border-top: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
      background: var(--vscode-sideBar-background, #1e1e1e);
      flex-shrink: 0;
      position: relative;
    }
    .model-chip {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      background: var(--vscode-editor-background, #1e1e1e);
      border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
      border-radius: 20px;
      font-size: 11px;
      color: var(--vscode-foreground, #cbd5e1);
      cursor: pointer;
      transition: all 0.15s;
      user-select: none;
      white-space: nowrap;
    }
    .model-chip:hover {
      background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.06));
      border-color: var(--vscode-focusBorder, #0e639c);
      color: var(--vscode-foreground, #ffffff);
    }
    .model-chip.active {
      border-color: var(--vscode-focusBorder, #0e639c);
      color: var(--vscode-foreground, #ffffff);
      background: rgba(14,99,156,0.08);
    }
    .model-chip-icon { font-size: 10px; }
    .model-chip-caret { font-size: 7px; opacity: 0.6; }

    /* Model popover */
    .model-popover {
      position: absolute;
      bottom: calc(100% + 6px);
      left: 10px;
      right: 10px;
      background: var(--vscode-menu-background, #252526);
      border: 1px solid var(--vscode-menu-border, rgba(255,255,255,0.12));
      border-radius: 8px;
      box-shadow: 0 -4px 12px rgba(0,0,0,0.5);
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
      border-bottom: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
    }
    .popover-search input {
      flex: 1;
      background: transparent;
      border: none;
      color: var(--vscode-menu-foreground, #ffffff);
      font-size: 12px;
      font-family: inherit;
      outline: none;
    }
    .popover-search input::placeholder { color: var(--vscode-descriptionForeground, #858585); }
    .popover-list {
      overflow-y: auto;
      flex: 1;
      padding: 4px 0;
    }
    .popover-list::-webkit-scrollbar { width: 3px; }
    .popover-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 2px; }
    .pop-section {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: var(--vscode-textLink-foreground, #0e639c);
      padding: 6px 12px 2px;
    }
    .pop-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      cursor: pointer;
      transition: background 0.1s;
    }
    .pop-item:hover { background: var(--vscode-menu-hoverBackground, rgba(255,255,255,0.06)); }
    .pop-item.selected { background: var(--vscode-list-activeSelectionBackground, #094771); }
    .pop-item.selected .pop-name { color: var(--vscode-list-activeSelectionForeground, #ffffff); }
    .pop-check { width: 14px; font-size: 11px; color: var(--vscode-textLink-foreground, #0e639c); text-align: center; flex-shrink: 0; }
    .pop-name { flex: 1; font-size: 12px; color: var(--vscode-menu-foreground, #ffffff); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pop-provider { font-size: 10px; color: var(--vscode-descriptionForeground, #858585); }
    .pop-badge {
      font-size: 9px;
      font-weight: 700;
      padding: 1px 5px;
      border-radius: 10px;
      color: #fff;
    }

    /* ─── Chat Input & Autocomplete ─── */
    .input-area {
      padding: 0 10px 10px;
      flex-shrink: 0;
      position: relative;
      background: var(--vscode-sideBar-background, #1e1e1e);
    }
    .input-box {
      display: flex;
      align-items: flex-end;
      gap: 6px;
      background: var(--vscode-input-background, #2d2d2d);
      border: 1px solid var(--vscode-input-border, rgba(255,255,255,0.1));
      border-radius: 10px;
      padding: 8px 8px 8px 12px;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .input-box:focus-within {
      border-color: var(--vscode-focusBorder, #0e639c);
      box-shadow: 0 0 0 1px var(--vscode-focusBorder, #0e639c);
    }
    .input-box textarea {
      flex: 1;
      background: transparent;
      border: none;
      color: var(--vscode-input-foreground, #ffffff);
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
    .input-box textarea::placeholder { color: var(--vscode-input-placeholderForeground, #858585); }
    .send-btn {
      width: 28px;
      height: 28px;
      border-radius: 7px;
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #ffffff);
      border: none;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: opacity 0.15s, transform 0.1s;
      padding: 0;
      flex-shrink: 0;
      box-shadow: 0 1px 3px rgba(0,0,0,0.2);
    }
    .send-btn:hover { background: var(--vscode-button-hoverBackground, #1177bb); transform: scale(1.02); }
    .send-btn:active { transform: scale(0.95); }
    .send-btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }

    /* Autocomplete popup */
    .autocomplete-popup {
      position: absolute;
      bottom: calc(100% + 4px);
      left: 10px;
      right: 10px;
      background: var(--vscode-menu-background, #252526);
      border: 1px solid var(--vscode-menu-border, rgba(255,255,255,0.12));
      border-radius: 8px;
      box-shadow: 0 -4px 12px rgba(0,0,0,0.5);
      z-index: 110;
      max-height: 180px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
    }
    .autocomplete-popup.hidden { display: none; }
    .autocomplete-item {
      padding: 7px 12px;
      cursor: pointer;
      font-size: 12px;
      color: var(--vscode-menu-foreground, #ffffff);
      border-bottom: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .autocomplete-item:hover {
      background: var(--vscode-menu-hoverBackground, rgba(255,255,255,0.06));
      color: var(--vscode-foreground, #ffffff);
    }

    /* ─── Summary stats ─── */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 6px;
      margin: 2px 0;
    }
    .stat-card {
      background: var(--vscode-sideBar-background, #252526);
      border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
      border-radius: 6px;
      padding: 8px 10px;
    }
    .stat-val { font-size: 16px; font-weight: 700; color: var(--vscode-foreground, #ffffff); }
    .stat-lbl { font-size: 10px; color: var(--vscode-descriptionForeground, #858585); margin-top: 2px; }
    .data-list { display: flex; flex-direction: column; gap: 5px; }
    .data-item {
      background: var(--vscode-sideBar-background, #252526);
      border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
      border-radius: 6px;
      padding: 7px 10px;
    }
    .data-item-title { display: flex; justify-content: space-between; font-size: 12px; font-weight: 600; }
    .data-item-meta { font-size: 11px; color: var(--vscode-descriptionForeground, #858585); margin-top: 2px; overflow-wrap: anywhere; }
    .section-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.7px;
      color: var(--vscode-textLink-foreground, #0e639c);
      margin: 8px 0 4px;
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
    <div class="orb-logo-icon">🤖</div>
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
  \${summary ? renderSummaryCards(this.snapshot as RepositoryIntelligenceSnapshot) : renderWelcomeCard()}
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

  <!-- Model popover inside model-bar container -->
  <div class="model-popover hidden" id="modelPopover">
    <div class="popover-search">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:#64748b;flex-shrink:0"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="text" id="popoverSearch" placeholder="Search models..." autocomplete="off">
    </div>
    <div class="popover-list" id="popoverList"></div>
  </div>
</div>

<!-- Input area -->
<div class="input-area">
  <!-- Autocomplete floating picker -->
  <div class="autocomplete-popup hidden" id="autocompletePopup"></div>
  <div class="input-box">
    <textarea id="messageInput" placeholder="Ask anything... type @ to reference files" rows="1"></textarea>
    <button class="send-btn" id="sendBtn" title="Send (Enter)">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
    </button>
  </div>
</div>

<script nonce="\${nonce}">
(function() {
  const vscode = acquireVsCodeApi();
  window.initialConfig = \${initialConfig};

  // ─── State ───────────────────────────────────────────────
  const state = vscode.getState() || {};
  const session = state.session || { provider: null, model: 'auto', contextMode: 'auto' };
  if (!state.session) { state.session = session; vscode.setState(state); }

  // Model catalog
  const modelCatalog = [
    { id: 'auto', name: 'Auto (use settings)', provider: '', section: 'default', badge: 'Default', badgeColor: '#10b981' },
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
  const autocompletePopup = document.getElementById('autocompletePopup');

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

    // List Ollama/Local first, then Default, then Cloud
    const sections = [
      { key: 'local', label: 'Local (Ollama) — Recommended' },
      { key: 'default', label: 'Default' },
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
          badge.style.background = item.badgeColor || '#10b981';
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
      empty.style.color = '#64748b';
      empty.textContent = 'No models found';
      popoverList.appendChild(empty);
    }
  }

  // ─── Autocomplete logic ──────────────────────────────────
  let atIndex = -1;
  messageInput.addEventListener('input', function(e) {
    const val = this.value;
    const cursor = this.selectionStart;
    const lastAt = val.lastIndexOf('@', cursor - 1);
    
    if (lastAt !== -1 && (lastAt === 0 || /\\s/.test(val[lastAt - 1]))) {
      atIndex = lastAt;
      const query = val.slice(lastAt + 1, cursor);
      vscode.postMessage({ command: 'getWorkspaceFiles', data: { query } });
    } else {
      atIndex = -1;
      autocompletePopup.classList.add('hidden');
    }
  });

  function renderAutocomplete(files) {
    if (atIndex === -1 || files.length === 0) {
      autocompletePopup.classList.add('hidden');
      return;
    }
    autocompletePopup.innerHTML = '';
    autocompletePopup.classList.remove('hidden');

    files.slice(0, 10).forEach(file => {
      const item = document.createElement('div');
      item.className = 'autocomplete-item';
      item.textContent = file;
      item.addEventListener('click', () => {
        const val = messageInput.value;
        const before = val.slice(0, atIndex);
        const after = val.slice(messageInput.selectionStart);
        messageInput.value = before + '@' + file + ' ' + after;
        autocompletePopup.classList.add('hidden');
        atIndex = -1;
        messageInput.focus();
      });
      autocompletePopup.appendChild(item);
    });
  }

  // Hide autocomplete popup when clicking elsewhere
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.input-area')) {
      autocompletePopup.classList.add('hidden');
    }
  });

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

  function appendAgentThinking(text) {
    removeAgentThinking();
    const card = document.createElement('div');
    card.className = 'agent-thinking-card';
    card.id = 'agentThinkingCard';
    card.innerHTML = '<div class="spinner"></div><span>' + escapeHtml(text) + '</span>';
    chatArea.appendChild(card);
    chatArea.scrollTop = chatArea.scrollHeight;
  }

  function removeAgentThinking() {
    const card = document.getElementById('agentThinkingCard');
    if (card) card.remove();
  }

  function startAiMessage() {
    removeAgentThinking();
    const row = document.createElement('div');
    row.className = 'msg-ai';
    row.id = 'streamingRow';
    const avatar = document.createElement('div'); avatar.className = 'ai-avatar'; avatar.textContent = '🤖';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.id = 'streamingBubble';
    bubble.textContent = '';
    row.appendChild(avatar); row.appendChild(bubble);
    chatArea.appendChild(row);
    chatArea.scrollTop = chatArea.scrollHeight;
  }

  function appendAiError(text) {
    removeAgentThinking();
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
    appendAgentThinking('Thinking...');

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
      case 'streamStart': {
        removeAgentThinking();
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
        removeAgentThinking();
        break;
      }

      case 'aiError':
        sendBtn.disabled = false;
        appendAiError(msg.value || 'An error occurred.');
        break;

      case 'agentThinking':
        appendAgentThinking(msg.text);
        break;

      case 'workspaceFiles':
        renderAutocomplete(msg.files || []);
        break;

      case 'toolCallStarted': {
        removeAgentThinking();
        const card = document.createElement('div');
        card.className = 'tool-card';
        card.id = 'tool-call-' + msg.callId;

        // Render parameters
        const argsStr = JSON.stringify(msg.arguments, null, 2);
        
        let actionsHtml = '';
        if (msg.requiresApproval) {
          actionsHtml = '<div class="tool-actions" id="actions-' + msg.callId + '">' +
            '<button class="tool-btn approve" id="approve-' + msg.callId + '">Approve ✓</button>' +
            '<button class="tool-btn reject" id="reject-' + msg.callId + '">Reject ✗</button>' +
            '</div>';
        }

        // Render diff if provided
        let diffHtml = '';
        if (msg.diff) {
          const lines = msg.diff.split('\n');
          const renderedLines = lines.map(line => {
            if (line.startsWith('+')) return '<span class="diff-line added">' + escapeHtml(line) + '</span>';
            if (line.startsWith('-')) return '<span class="diff-line removed">' + escapeHtml(line) + '</span>';
            return '<span class="diff-line">&nbsp;' + escapeHtml(line.slice(1)) + '</span>';
          }).join('');
          
          diffHtml = '<div class="section-label">Proposed Changes</div>' +
            '<div class="diff-container">' + renderedLines + '</div>';
        }

        card.innerHTML = '<div class="tool-header">' +
          '<div class="tool-title">🔧 Tool: <strong>' + escapeHtml(msg.name) + '</strong></div>' +
          '<div class="tool-badge ' + (msg.requiresApproval ? 'pending' : 'running') + '" id="badge-' + msg.callId + '">' +
            (msg.requiresApproval ? 'Approval Required' : 'Executing') +
          '</div>' +
          '</div>' +
          '<div class="tool-details">' + escapeHtml(argsStr) + '</div>' +
          diffHtml +
          actionsHtml +
          '<div class="tool-details hidden" style="margin-top:4px;" id="output-' + msg.callId + '"></div>';

        chatArea.appendChild(card);
        chatArea.scrollTop = chatArea.scrollHeight;

        if (msg.requiresApproval) {
          document.getElementById('approve-' + msg.callId).addEventListener('click', () => {
            vscode.postMessage({ command: 'toolApproval', data: { callId: msg.callId, approved: true } });
            document.getElementById('actions-' + msg.callId).remove();
            const badge = document.getElementById('badge-' + msg.callId);
            badge.textContent = 'Executing';
            badge.className = 'tool-badge running';
          });

          document.getElementById('reject-' + msg.callId).addEventListener('click', () => {
            vscode.postMessage({ command: 'toolApproval', data: { callId: msg.callId, approved: false } });
            document.getElementById('actions-' + msg.callId).remove();
            const badge = document.getElementById('badge-' + msg.callId);
            badge.textContent = 'Rejected';
            badge.className = 'tool-badge error';
          });
        }
        break;
      }

      case 'toolCallExecuting': {
        const badge = document.getElementById('badge-' + msg.callId);
        if (badge) {
          badge.textContent = 'Executing';
          badge.className = 'tool-badge running';
        }
        break;
      }

      case 'toolCallFinished': {
        const badge = document.getElementById('badge-' + msg.callId);
        if (badge) {
          badge.textContent = msg.error ? 'Error' : 'Finished';
          badge.className = 'tool-badge ' + (msg.error ? 'error' : 'finished');
        }

        const out = document.getElementById('output-' + msg.callId);
        if (out && msg.result) {
          out.textContent = 'Output:\n' + msg.result;
          out.classList.remove('hidden');
        }
        chatArea.scrollTop = chatArea.scrollHeight;
        break;
      }

      case 'configUpdated':
        fillSettingsForm(msg.config);
        break;

      case 'providerStatus':
        setProviderStatus(msg.status, msg.provider);
        break;

      case 'ollamaModelsLoaded': {
        const freshModels = (msg.models || []).map(n => ({
          id: 'ollama:' + n,
          name: n,
          provider: 'Ollama',
          section: 'local',
          badge: 'Local',
          badgeColor: '#0ea5e9'
        }));
        const idx = modelCatalog.findIndex(m => m.section === 'local');
        if (idx !== -1) {
          const count = modelCatalog.filter(m => m.section === 'local').length;
          modelCatalog.splice(idx, count, ...freshModels);
        } else {
          modelCatalog.push(...freshModels);
        }
        renderPopover();
        break;
      }

      case 'ollamaModelsError':
        break;

      case 'scanLoaded':
        sendBtn.disabled = false;
        break;
    }
  });

  // Helpers to escape html in UI
  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/"/g, "&quot;")
              .replace(/'/g, "&#039;");
  }

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
  <div class="welcome-title">🤖 ORB AI</div>
  <div class="welcome-sub">Welcome to your Codex-style AI programming assistant. I can inspect files, write code, run terminal commands, and reason over your codebase. Type @ to mention files.</div>
  <div class="welcome-hints">
    <button class="hint-chip" data-q="Explain the overall architecture of this codebase">📐 Explain the architecture</button>
    <button class="hint-chip" data-q="Read the package.json file and summarize the project dependencies">📦 Check project dependencies</button>
    <button class="hint-chip" data-q="Run npm test using terminal and tell me if they pass">🧪 Run test suite</button>
    <button class="hint-chip" data-q="Find any potential bugs or code smells in src/extension.ts">🐛 Audit extension.ts</button>
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
  ${entryPoints.length ? `<div class="section-label">Entry Points</div><div class="data-list">${entryPoints.map(e => `<div class="data-item"><div class="data-item-title"><span style="font-family:var(--vscode-editor-font-family);font-size:11px;">${escapeHtml(e.path)}</span><span style="font-size:10px;color:#64748b;">${escapeHtml(e.type)}</span></div><div class="data-item-meta">${escapeHtml(e.reason)}</div></div>`).join('')}</div>` : ''}
  <div class="welcome-hints" style="margin-top:8px;">
    <button class="hint-chip" data-q="Explain the overall architecture of this codebase">📐 Explain the architecture</button>
    <button class="hint-chip" data-q="Read the package.json file and summarize the project dependencies">📦 Check dependencies</button>
    <button class="hint-chip" data-q="Find any potential bugs or code smells">🐛 Find bugs & code smells</button>
  </div>
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
