import * as vscode from 'vscode';
import { OrbAiViewProvider, RepositoryGraphPanel } from '../ui';
import type { OrbLogger } from '../utils/logger';
import type { CurrentFileAnalysis, RepositoryIntelligenceService, RepositoryIntelligenceSnapshot } from './repositoryIntelligenceService';

export function registerOrbAiCommands(
  context: vscode.ExtensionContext,
  intelligenceService: RepositoryIntelligenceService,
  viewProvider: OrbAiViewProvider,
  logger: OrbLogger,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('orb-ai.scanRepository', async () => {
      await scanRepository(intelligenceService, viewProvider, logger);
    }),
    vscode.commands.registerCommand('orb-ai.showRepositoryGraph', async () => {
      await showRepositoryGraph(context.extensionUri, intelligenceService, logger);
    }),
    vscode.commands.registerCommand('orb-ai.analyzeCurrentFile', async () => {
      await analyzeCurrentFile(intelligenceService, logger);
    }),
    vscode.commands.registerCommand('orb-ai.openPanel', async () => {
      await vscode.commands.executeCommand(`${OrbAiViewProvider.viewType}.focus`);
    }),
    // New command to open the ORB AI chat sidebar directly
    vscode.commands.registerCommand('orb-ai.openChat', async () => {
      await vscode.commands.executeCommand(`${OrbAiViewProvider.viewType}.focus`);
    }),
  );
}

async function scanRepository(
  intelligenceService: RepositoryIntelligenceService,
  viewProvider: OrbAiViewProvider,
  logger: OrbLogger,
): Promise<void> {
  try {
    const snapshot = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'ORB AI: Scanning repository',
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: 'Reading workspace files' });
        const result = await intelligenceService.analyzeWorkspace();
        progress.report({ message: 'Building repository intelligence' });
        return result;
      },
    );

    viewProvider.refresh(snapshot);
    appendSnapshotReport(logger, snapshot);
    vscode.window.showInformationMessage(`ORB AI scan complete: ${snapshot.summary.totalFiles} files analyzed.`);
  } catch (error) {
    logger.error('Repository scan failed', error);
    vscode.window.showErrorMessage(`ORB AI scan failed: ${getErrorMessage(error)}`);
  }
}

async function showRepositoryGraph(
  extensionUri: vscode.Uri,
  intelligenceService: RepositoryIntelligenceService,
  logger: OrbLogger,
): Promise<void> {
  try {
    const snapshot = intelligenceService.getSnapshot() ?? await intelligenceService.analyzeWorkspace();
    RepositoryGraphPanel.show(extensionUri, snapshot);
  } catch (error) {
    logger.error('Unable to show repository graph', error);
    vscode.window.showErrorMessage(`Unable to show ORB AI graph: ${getErrorMessage(error)}`);
  }
}

async function analyzeCurrentFile(
  intelligenceService: RepositoryIntelligenceService,
  logger: OrbLogger,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    vscode.window.showWarningMessage('Open a file before running ORB AI: Analyze Current File.');
    return;
  }

  try {
    const analysis = await intelligenceService.analyzeCurrentFile(editor.document);
    appendCurrentFileAnalysis(logger, analysis);
    logger.show();
    vscode.window.showInformationMessage(`ORB AI analyzed ${analysis.file.relativePath}.`);
  } catch (error) {
    logger.error('Current file analysis failed', error);
    vscode.window.showErrorMessage(`ORB AI file analysis failed: ${getErrorMessage(error)}`);
  }
}

function appendSnapshotReport(logger: OrbLogger, snapshot: RepositoryIntelligenceSnapshot): void {
  const { summary, scan } = snapshot;

  logger.clear();
  logger.appendLine('ORB AI Repository Intelligence');
  logger.appendLine('================================');
  logger.appendLine(`Root: ${summary.rootPath}`);
  logger.appendLine(`Scanned: ${scan.scannedAt}`);
  logger.appendLine(`Files: ${summary.totalFiles}`);
  logger.appendLine(`Folders: ${summary.totalFolders}`);
  logger.appendLine(`Internal Dependencies: ${summary.internalDependencyCount}`);
  logger.appendLine(`External Dependencies: ${summary.externalDependencyCount}`);
  logger.appendLine(`Exports: ${summary.exportCount}`);
  logger.appendLine('');

  logger.appendLine('Detected Frameworks');
  if (summary.detectedFrameworks.length === 0) {
    logger.appendLine('- None detected');
  } else {
    for (const detection of summary.detectedFrameworks) {
      const version = detection.version ? ` ${detection.version}` : '';
      logger.appendLine(`- ${detection.framework}${version} (${Math.round(detection.confidence * 100)}%)`);
    }
  }

  logger.appendLine('');
  logger.appendLine('Languages Used');
  for (const language of summary.languagesUsed) {
    logger.appendLine(`- ${language.language}: ${language.files} file(s)`);
  }

  logger.appendLine('');
  logger.appendLine('Important Entry Points');
  if (summary.importantEntryPoints.length === 0) {
    logger.appendLine('- None identified');
  } else {
    for (const entryPoint of summary.importantEntryPoints) {
      logger.appendLine(`- ${entryPoint.path}: ${entryPoint.reason}`);
    }
  }

  logger.appendLine('');
  logger.appendLine('Dependency Relationships');
  if (summary.dependencyRelationships.length === 0) {
    logger.appendLine('- None found');
  } else {
    for (const relationship of summary.dependencyRelationships.slice(0, 50)) {
      logger.appendLine(`- ${relationship.source} -> ${relationship.target} (${relationship.imports})`);
    }
  }

  if (scan.issues.length > 0) {
    logger.appendLine('');
    logger.appendLine('Scan Issues');
    for (const issue of scan.issues.slice(0, 25)) {
      logger.appendLine(`- ${issue.path}: ${issue.message}`);
    }
  }

  logger.show();
}

function appendCurrentFileAnalysis(logger: OrbLogger, analysis: CurrentFileAnalysis): void {
  logger.appendLine('');
  logger.appendLine('Current File Analysis');
  logger.appendLine('=====================');
  logger.appendLine(`File: ${analysis.file.relativePath}`);
  logger.appendLine(`Language: ${analysis.file.language}`);
  logger.appendLine(`Imports: ${analysis.file.imports.length}`);
  logger.appendLine(`Internal Imports: ${analysis.internalImports}`);
  logger.appendLine(`External Imports: ${analysis.externalImports}`);
  logger.appendLine(`Exports: ${analysis.file.exports.length}`);

  if (analysis.file.imports.length > 0) {
    logger.appendLine('');
    logger.appendLine('Imports');
    for (const importStatement of analysis.file.imports) {
      logger.appendLine(`- line ${importStatement.line}: ${importStatement.moduleSpecifier}`);
    }
  }

  if (analysis.exportedSymbols.length > 0) {
    logger.appendLine('');
    logger.appendLine('Exported Symbols');
    for (const exportedSymbol of analysis.exportedSymbols) {
      logger.appendLine(`- ${exportedSymbol}`);
    }
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
