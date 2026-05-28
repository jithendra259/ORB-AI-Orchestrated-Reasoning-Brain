export type ImportKind = 'es' | 'side-effect' | 'dynamic' | 'commonjs' | 'python';

export interface ImportStatement {
  moduleSpecifier: string;
  rawText: string;
  line: number;
  kind: ImportKind;
  importedSymbols: string[];
  isRelative: boolean;
  resolvedPath?: string;
}

export type ExportKind = 'named' | 'default' | 're-export' | 'namespace' | 'commonjs';

export interface ExportStatement {
  exportedNames: string[];
  rawText: string;
  line: number;
  kind: ExportKind;
  moduleSpecifier?: string;
}

export interface ScannedFile {
  absolutePath: string;
  relativePath: string;
  name: string;
  extension: string;
  language: string;
  sizeBytes: number;
  imports: ImportStatement[];
  exports: ExportStatement[];
}

export interface ScannedFolder {
  absolutePath: string;
  relativePath: string;
  name: string;
  depth: number;
}

export interface FolderTreeNode {
  name: string;
  relativePath: string;
  folders: FolderTreeNode[];
  files: string[];
}

export interface ScanIssue {
  path: string;
  message: string;
}

export interface RepositoryScanResult {
  rootPath: string;
  scannedAt: string;
  files: ScannedFile[];
  folders: ScannedFolder[];
  folderTree: FolderTreeNode;
  ignoredDirectories: string[];
  issues: ScanIssue[];
}

export interface RepositoryScanOptions {
  ignoredDirectories: string[];
  maxFileSizeBytes: number;
}

export type FrameworkName =
  | 'React'
  | 'Next.js'
  | 'Express'
  | 'Vue'
  | 'Angular'
  | 'NestJS'
  | 'Django'
  | 'Flask'
  | 'FastAPI';

export type DetectionSignalKind = 'dependency' | 'config' | 'import' | 'folder-pattern';

export interface FrameworkDetectionSignal {
  kind: DetectionSignalKind;
  source: string;
  value: string;
  weight: number;
}

export interface FrameworkDetection {
  framework: FrameworkName;
  confidence: number;
  version?: string;
  signals: FrameworkDetectionSignal[];
}

export interface LanguageUsage {
  language: string;
  extensions: string[];
  files: number;
}

export interface EntryPoint {
  path: string;
  type: 'extension' | 'frontend' | 'backend' | 'server' | 'framework' | 'package' | 'script';
  reason: string;
}

export interface DependencyRelationshipSummary {
  source: string;
  target: string;
  imports: number;
  resolved: boolean;
}

export interface RepositorySummary {
  rootPath: string;
  generatedAt: string;
  totalFiles: number;
  totalFolders: number;
  languagesUsed: LanguageUsage[];
  detectedFrameworks: FrameworkDetection[];
  importantEntryPoints: EntryPoint[];
  dependencyRelationships: DependencyRelationshipSummary[];
  internalDependencyCount: number;
  externalDependencyCount: number;
  exportCount: number;
}

