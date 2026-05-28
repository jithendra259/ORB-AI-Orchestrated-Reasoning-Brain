import * as vscode from 'vscode';
import type { OrbLogger } from '../utils/logger';
import { OrbAiChatHandler } from './chatHandler';

export class SidebarChatService {
  private statusBarItem: vscode.StatusBarItem;

  constructor(
    private logger: OrbLogger,
    private chatHandler: OrbAiChatHandler,
  ) {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.statusBarItem.text = '$(orb) ORB AI';
    this.statusBarItem.tooltip = 'Open ORB AI Chat';
    this.statusBarItem.command = 'orb-ai.openChat';
    this.statusBarItem.show();
  }

  public async sendChatMessage(message: string): Promise<string> {
    try {
      this.logger.info(`[Chat] User: ${message}`);
      const response = await this.chatHandler.generateResponse(message);
      this.logger.info(`[Chat] AI: ${response}`);
      return response;
    } catch (error) {
      const errorMsg = 'Failed to process chat message';
      this.logger.error(errorMsg, error);
      return errorMsg;
    }
  }

  public notifyRepositoryScan(): void {
    this.logger.info('[Chat] Repository scan completed, chat context updated');
  }

  public dispose(): void {
    this.statusBarItem.dispose();
  }
}
