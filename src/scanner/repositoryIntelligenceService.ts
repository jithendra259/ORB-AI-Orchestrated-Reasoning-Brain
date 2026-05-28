import * as path from 'path';
import * as vscode from 'vscode';
import { DependencyGraphBuilder, InMemoryRepositoryGraphStore, type RepositoryGraph } from '../graph';
import type { OrbLogger } from '../utils/logger';
import { normalizePath, toRepositoryRelativePath } from '../utils/pathUtils';
import { FrameworkDetector } from './frameworkDetector';
import { RepositoryScanner } from './repositoryScanner';
import { parseSourceFile } from './sourceParser';
import { RepositorySummaryGenerator } from './summaryGenerator';
import type { FrameworkDetection, RepositoryScanResult, RepositorySummary, ScannedFile } from './types';

export interface RepositoryIntelligenceSnapshot {
  scan: RepositoryScanResult;
  frameworks: FrameworkDetection[];
  graph: RepositoryGraph;
  summary: RepositorySummary;
}

export interface CurrentFileAnalysis {
  file: ScannedFile;
  internalImports: number;
  externalImports: number;
  exportedSymbols: string[];
}

export class RepositoryIntelligenceService {
  private readonly scanner: RepositoryScanner;
  private readonly frameworkDetector: FrameworkDetector;
  private readonly graphBuilder = new DependencyGraphBuilder();
  private readonly graphStore = new InMemoryRepositoryGraphStore();
  private readonly summaryGenerator = new RepositorySummaryGenerator();
  private readonly onDidChangeSnapshotEmitter = new vscode.EventEmitter<RepositoryIntelligenceSnapshot>();
  private snapshot: RepositoryIntelligenceSnapshot | undefined;

  public readonly onDidChangeSnapshot = this.onDidChangeSnapshotEmitter.event;

  public constructor(private readonly logger: OrbLogger) {
    this.scanner = new RepositoryScanner(logger);
    this.frameworkDetector = new FrameworkDetector(logger);
  }

  public async analyzeWorkspace(rootPath?: string): Promise<RepositoryIntelligenceSnapshot> {
    const workspaceRoot = rootPath ?? this.getWorkspaceRoot();

    if (!workspaceRoot) {
      throw new Error('No workspace folder is open.');
    }

    this.logger.info(`Starting repository intelligence scan: ${workspaceRoot}`);

    const scan = await this.scanner.scan(workspaceRoot);
    const frameworks = await this.frameworkDetector.detect(workspaceRoot, scan);
    const graph = this.graphBuilder.build(scan);
    const summary = this.summaryGenerator.generate(scan, frameworks, graph);
    const snapshot = { scan, frameworks, graph, summary };

    this.snapshot = snapshot;
    this.graphStore.setGraph(graph);
    this.onDidChangeSnapshotEmitter.fire(snapshot);

    // Persist a JSON copy of the snapshot to out/repository-scan.json for inspection
    try {
      const outPath = path.join(this.getWorkspaceRoot() ?? '.', 'out');
      const outFile = path.join(outPath, 'repository-scan.json');
      const uri = vscode.Uri.file(outFile);
      const data = Buffer.from(JSON.stringify(snapshot, null, 2), 'utf8');
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(outPath));
      await vscode.workspace.fs.writeFile(uri, data);
      this.logger.info(`Wrote repository scan snapshot to ${outFile}`);
    } catch (err) {
      this.logger.warn('Failed to persist repository scan snapshot', err);
    }

    this.logger.info('Repository intelligence scan complete', {
      files: summary.totalFiles,
      folders: summary.totalFolders,
      frameworks: summary.detectedFrameworks.map((framework) => framework.framework),
      internalDependencies: summary.internalDependencyCount,
      externalDependencies: summary.externalDependencyCount,
    });

    return snapshot;
  }

  public async analyzeCurrentFile(document: vscode.TextDocument): Promise<CurrentFileAnalysis> {
    const workspaceRoot = this.getWorkspaceRootForUri(document.uri);
    const relativePath = workspaceRoot
      ? toRepositoryRelativePath(workspaceRoot, document.uri.fsPath)
      : normalizePath(path.basename(document.uri.fsPath));

    let file = this.snapshot?.scan.files.find((scannedFile) => scannedFile.relativePath === relativePath);

    if (!file) {
      const parsed = parseSourceFile(document.getText(), path.extname(document.fileName).toLowerCase());
      file = {
        absolutePath: document.uri.fsPath,
        relativePath,
        name: path.basename(document.fileName),
        extension: path.extname(document.fileName).toLowerCase(),
        language: document.languageId,
        sizeBytes: Buffer.byteLength(document.getText(), 'utf8'),
        imports: parsed.imports,
        exports: parsed.exports,
      };
    }

    return {
      file,
      internalImports: file.imports.filter((importStatement) => importStatement.resolvedPath).length,
      externalImports: file.imports.filter((importStatement) => !importStatement.resolvedPath).length,
      exportedSymbols: file.exports.flatMap((exportStatement) => exportStatement.exportedNames),
    };
  }

  public getSnapshot(): RepositoryIntelligenceSnapshot | undefined {
    return this.snapshot;
  }

  public getGraph(): RepositoryGraph | undefined {
    return this.graphStore.getGraph();
  }

  public getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  public dispose(): void {
    this.onDidChangeSnapshotEmitter.dispose();
    this.graphStore.clear();
  }

  private getWorkspaceRootForUri(uri: vscode.Uri): string | undefined {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    return folder?.uri.fsPath ?? this.getWorkspaceRoot();
  }
}

