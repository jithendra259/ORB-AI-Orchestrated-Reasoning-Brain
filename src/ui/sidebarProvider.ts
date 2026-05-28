import * as vscode from 'vscode';
import { getNonce } from '../utils/getNonce';

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'orb-ai-sidebar';
  private view?: vscode.WebviewView;
  private messageHistory: Array<{ role: string; content: string }> = [];

  constructor(private readonly context: vscode.ExtensionContext) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'onInfo':
          if (!data.value) {
            return;
          }
          vscode.window.showInformationMessage(data.value);
          break;
        case 'onError':
          if (!data.value) {
            return;
          }
          vscode.window.showErrorMessage(data.value);
          break;
        case 'onMessage':
          if (!data.value) {
            return;
          }
          // Add user message to history
          this.messageHistory.push({
            role: 'user',
            content: data.value,
          });

          // Send thinking state
          this.view?.webview.postMessage({
            type: 'thinking',
          });

          // Simulate AI thinking and generate mock response
          setTimeout(() => {
            const mockResponse = await this.generateMockResponse(data.value);
            // Add AI response to history
            this.messageHistory.push({
              role: 'assistant',
              content: mockResponse,
            });

            // Send response back to webview
            this.view?.webview.postMessage({
              type: 'onMessage',
              value: mockResponse,
            });
          }, 1000);
          break;
      }
    });
  }

  private async generateMockResponse(userMessage: string): Promise<string> {
    // Mock AI responses based on user input
    const lower = userMessage.toLowerCase();

    if (lower.includes('hello') || lower.includes('hi')) {
      return 'Hello! I am ORB AI, your intelligent codebase assistant. How can I help you today?';
    }

    if (lower.includes('what') && lower.includes('framework')) {
      return 'I can detect frameworks in your codebase. Run "Scan Repository" to analyze your project and I will identify what frameworks you are using!';
    }

    if (lower.includes('help')) {
      return 'I can help you with:\n• Analyzing your codebase\n• Detecting frameworks\n• Understanding dependencies\n• Generating code insights\n\nTry asking me about your project!';
    }

    if (lower.includes('scan')) {
      return 'To scan your repository, click the "Scan Repository" button at the top of the sidebar. This will analyze all files and detect your tech stack.';
    }

    return `You said: "${userMessage}". I'm learning to respond intelligently. Try asking about frameworks, dependencies, or scanning your repository!`;
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>ORB AI</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
      color: var(--vscode-editor-foreground);
      background-color: var(--vscode-editor-background);
      display: flex;
      flex-direction: column;
      height: 100vh;
      padding: 16px;
    }

    .header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }

    .header h1 {
      font-size: 18px;
      font-weight: 600;
      color: var(--vscode-editor-foreground);
    }

    .chat-container {
      flex: 1;
      overflow-y: auto;
      margin-bottom: 16px;
      padding-right: 8px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .message {
      display: flex;
      gap: 8px;
      margin-bottom: 8px;
    }

    .message.user {
      justify-content: flex-end;
    }

    .message-content {
      max-width: 85%;
      padding: 8px 12px;
      border-radius: 8px;
      line-height: 1.4;
      word-wrap: break-word;
      white-space: pre-wrap;
    }

    .message.assistant .message-content {
      background-color: var(--vscode-textBlockQuote-background);
      color: var(--vscode-editor-foreground);
      border-left: 3px solid var(--vscode-textBlockQuote-border);
      padding-left: 12px;
    }

    .message.user .message-content {
      background-color: var(--vscode-inputValidation-infoBackground);
      color: var(--vscode-editor-foreground);
      border-radius: 12px;
    }

    .thinking {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background-color: var(--vscode-textBlockQuote-background);
      border-left: 3px solid var(--vscode-textBlockQuote-border);
      border-radius: 8px;
      color: var(--vscode-editor-foreground);
      font-size: 14px;
    }

    .spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid var(--vscode-editor-foreground);
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    .input-area {
      display: flex;
      gap: 8px;
      padding: 8px;
      background-color: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
    }

    .input-area input {
      flex: 1;
      border: none;
      background-color: transparent;
      color: var(--vscode-editor-foreground);
      font-size: 14px;
      outline: none;
    }

    .input-area input::placeholder {
      color: var(--vscode-input-placeholderForeground);
    }

    .send-button {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      transition: background-color 0.2s;
    }

    .send-button:hover {
      background-color: var(--vscode-button-hoverBackground);
    }

    .send-button:active {
      background-color: var(--vscode-button-background);
    }

    /* Scrollbar styling */
    .chat-container::-webkit-scrollbar {
      width: 8px;
    }

    .chat-container::-webkit-scrollbar-track {
      background: transparent;
    }

    .chat-container::-webkit-scrollbar-thumb {
      background: var(--vscode-scrollbarSlider-background);
      border-radius: 4px;
    }

    .chat-container::-webkit-scrollbar-thumb:hover {
      background: var(--vscode-scrollbarSlider-hoverBackground);
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>🧠 ORB AI Chat</h1>
  </div>

  <div class="chat-container" id="chatContainer"></div>

  <div class="input-area">
    <input
      type="text"
      id="messageInput"
      placeholder="Ask ORB AI something..."
      autocomplete="off"
    />
    <button class="send-button" id="sendButton">Send</button>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const chatContainer = document.getElementById('chatContainer');
    const messageInput = document.getElementById('messageInput');
    const sendButton = document.getElementById('sendButton');

    // Load chat history from state if available
    const state = vscode.getState() || { messages: [] };

    function renderMessage(role, content) {
      const messageDiv = document.createElement('div');
      messageDiv.className = \`message \${role}\`;

      const contentDiv = document.createElement('div');
      contentDiv.className = 'message-content';
      contentDiv.textContent = content;

      messageDiv.appendChild(contentDiv);
      chatContainer.appendChild(messageDiv);

      // Auto-scroll to bottom
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    function renderThinking() {
      const messageDiv = document.createElement('div');
      messageDiv.className = 'thinking';
      messageDiv.id = 'thinkingMessage';

      const spinner = document.createElement('div');
      spinner.className = 'spinner';

      const text = document.createElement('span');
      text.textContent = 'Thinking...';

      messageDiv.appendChild(spinner);
      messageDiv.appendChild(text);
      chatContainer.appendChild(messageDiv);

      // Auto-scroll to bottom
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    function removeThinking() {
      const thinkingMessage = document.getElementById('thinkingMessage');
      if (thinkingMessage) {
        thinkingMessage.remove();
      }
    }

    function sendMessage() {
      const message = messageInput.value.trim();

      if (!message) {
        return;
      }

      // Render user message
      renderMessage('user', message);
      state.messages.push({ role: 'user', content: message });

      // Clear input
      messageInput.value = '';
      messageInput.focus();

      // Send to extension
      vscode.postMessage({
        type: 'onMessage',
        value: message,
      });

      // Show thinking state
      renderThinking();
    }

    // Send button click
    sendButton.addEventListener('click', sendMessage);

    // Enter key
    messageInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        sendMessage();
      }
    });

    // Handle messages from extension
    window.addEventListener('message', (event) => {
      const message = event.data;

      switch (message.type) {
        case 'onMessage':
          removeThinking();
          renderMessage('assistant', message.value);
          state.messages.push({ role: 'assistant', content: message.value });
          break;
        case 'thinking':
          renderThinking();
          break;
      }

      // Save state
      vscode.setState(state);
    });

    // Render existing messages from state on load
    for (const msg of state.messages) {
      renderMessage(msg.role, msg.content);
    }

    // Focus input on load
    messageInput.focus();
  </script>
</body>
</html>`;
  }
}
