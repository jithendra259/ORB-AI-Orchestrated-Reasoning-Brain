import * as vscode from 'vscode';
import { registerOrbAiCommands, RepositoryIntelligenceService } from './scanner';
import { OrbAiViewProvider } from './ui';
import { OutputChannelOrbLogger } from './utils/logger';

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel('ORB AI Logs');
  const logger = new OutputChannelOrbLogger(outputChannel);
  const intelligenceService = new RepositoryIntelligenceService(logger);
  const viewProvider = new OrbAiViewProvider(context.extensionUri, intelligenceService, logger);

  context.subscriptions.push(
    outputChannel,
    intelligenceService,
    vscode.window.registerWebviewViewProvider(OrbAiViewProvider.viewType, viewProvider),
  );

  registerOrbAiCommands(context, intelligenceService, viewProvider, logger);

  logger.info('ORB AI extension activated');
  // Immediately open the ORB AI chat view so the user can see the UI without manually clicking the icon
  vscode.commands.executeCommand('orb-ai.openChat').then(
    () => logger.info('ORB AI chat view opened on activation'),
    (err) => logger.error('Failed to open ORB AI chat view on activation', err),
  );
  // Show a toast notification so the user can see that the extension has been activated
  vscode.window.showInformationMessage('ORB AI extension activated');
}

export function deactivate(): void {
  // No cleanup required for this extension
  return;
}

