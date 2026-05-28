import * as path from 'path';
import * as vscode from 'vscode';
import { normalizePath } from '../utils/pathUtils';
import type { OrbLogger } from '../utils/logger';
import { canParseSource, parseSourceFile } from './sourceParser';
import type {
  FolderTreeNode,
  ExportStatement,
  ImportStatement,
  RepositoryScanOptions,
  RepositoryScanResult,
  ScanIssue,
  ScannedFile,
  ScannedFolder,
} from './types';

export const DEFAULT_IGNORED_DIRECTORIES = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.vs',
  '.vscode-test',
  'coverage',
];

const DEFAULT_MAX_FILE_SIZE_BYTES = 1024 * 1024;
const RESOLVABLE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.json', '.vue', '.svelte', '.py'];

export class RepositoryScanner {
  public constructor(private readonly logger: OrbLogger) {}

  public async scan(rootPath: string, options?: Partial<RepositoryScanOptions>): Promise<RepositoryScanResult> {
    const scanOptions: RepositoryScanOptions = {
      ignoredDirectories: options?.ignoredDirectories ?? DEFAULT_IGNORED_DIRECTORIES,
      maxFileSizeBytes: options?.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES,
    };

    const files: ScannedFile[] = [];
    const folders: ScannedFolder[] = [];
    const issues: ScanIssue[] = [];
    const rootUri = vscode.Uri.file(rootPath);

    await this.scanDirectory(rootUri, rootPath, '', 0, scanOptions, files, folders, issues);
    this.resolveImports(files);

    return {
      rootPath,
      scannedAt: new Date().toISOString(),
      files: files.sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
      folders: folders.sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
      folderTree: buildFolderTree(files, folders),
      ignoredDirectories: scanOptions.ignoredDirectories,
      issues,
    };
  }

  private async scanDirectory(
    directoryUri: vscode.Uri,
    rootPath: string,
    relativeDirectory: string,
    depth: number,
    options: RepositoryScanOptions,
    files: ScannedFile[],
    folders: ScannedFolder[],
    issues: ScanIssue[],
  ): Promise<void> {
    let entries: [string, vscode.FileType][];

    try {
      entries = await vscode.workspace.fs.readDirectory(directoryUri);
    } catch (error) {
      const pathLabel = relativeDirectory || '.';
      issues.push({ path: pathLabel, message: getErrorMessage(error) });
      this.logger.warn(`Unable to read directory: ${pathLabel}`, error);
      return;
    }

    for (const [name, fileType] of entries) {
      if (fileType === vscode.FileType.Directory && options.ignoredDirectories.includes(name)) {
        continue;
      }

      const absolutePath = path.join(directoryUri.fsPath, name);
      const relativePath = normalizePath(relativeDirectory ? path.posix.join(relativeDirectory, name) : name);
      const entryUri = vscode.Uri.file(absolutePath);

      if (fileType === vscode.FileType.Directory) {
        folders.push({
          absolutePath,
          relativePath,
          name,
          depth,
        });

        await this.scanDirectory(entryUri, rootPath, relativePath, depth + 1, options, files, folders, issues);
        continue;
      }

      if (fileType !== vscode.FileType.File) {
        continue;
      }

      files.push(await this.createScannedFile(entryUri, rootPath, relativePath, name, options, issues));
    }
  }

  private async createScannedFile(
    uri: vscode.Uri,
    rootPath: string,
    relativePath: string,
    name: string,
    options: RepositoryScanOptions,
    issues: ScanIssue[],
  ): Promise<ScannedFile> {
    const extension = path.extname(name).toLowerCase();
    const language = detectLanguage(extension, name);
    let sizeBytes = 0;
    let imports: ImportStatement[] = [];
    let exports: ExportStatement[] = [];

    try {
      const stat = await vscode.workspace.fs.stat(uri);
      sizeBytes = stat.size;

      if (canParseSource(extension) && stat.size <= options.maxFileSizeBytes) {
        const contentBytes = await vscode.workspace.fs.readFile(uri);
        const content = Buffer.from(contentBytes).toString('utf8');
        const parsed = parseSourceFile(content, extension);
        imports = parsed.imports;
        exports = parsed.exports;
      }
    } catch (error) {
      issues.push({ path: relativePath, message: getErrorMessage(error) });
      this.logger.warn(`Unable to inspect file: ${relativePath}`, error);
    }

    return {
      absolutePath: path.join(rootPath, relativePath),
      relativePath,
      name,
      extension,
      language,
      sizeBytes,
      imports,
      exports,
    };
  }

  private resolveImports(files: ScannedFile[]): void {
    const filePaths = new Set(files.map((file) => file.relativePath));

    for (const file of files) {
      file.imports = file.imports.map((importStatement) => ({
        ...importStatement,
        resolvedPath: importStatement.isRelative
          ? resolveRelativeImport(file.relativePath, importStatement.moduleSpecifier, filePaths)
          : undefined,
      }));
    }
  }
}

function resolveRelativeImport(sourceRelativePath: string, moduleSpecifier: string, filePaths: Set<string>): string | undefined {
  const sourceDirectory = path.posix.dirname(sourceRelativePath);
  const normalizedSpecifier = normalizePath(moduleSpecifier);
  const baseCandidate = normalizePath(path.posix.normalize(path.posix.join(sourceDirectory, normalizedSpecifier)));
  const candidates = buildCandidatePaths(baseCandidate);

  return candidates.find((candidate) => filePaths.has(candidate));
}

function buildCandidatePaths(baseCandidate: string): string[] {
  if (path.posix.extname(baseCandidate)) {
    return [baseCandidate];
  }

  return [
    ...RESOLVABLE_EXTENSIONS.map((extension) => `${baseCandidate}${extension}`),
    ...RESOLVABLE_EXTENSIONS.map((extension) => `${baseCandidate}/index${extension}`),
  ];
}

function buildFolderTree(files: ScannedFile[], folders: ScannedFolder[]): FolderTreeNode {
  const root: FolderTreeNode = {
    name: '',
    relativePath: '',
    folders: [],
    files: [],
  };

  const folderNodes = new Map<string, FolderTreeNode>([['', root]]);

  for (const folder of folders) {
    const segments = folder.relativePath.split('/');
    let current = root;
    let currentPath = '';

    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      let next = folderNodes.get(currentPath);

      if (!next) {
        next = {
          name: segment,
          relativePath: currentPath,
          folders: [],
          files: [],
        };
        folderNodes.set(currentPath, next);
        current.folders.push(next);
      }

      current = next;
    }
  }

  for (const file of files) {
    const folderPath = path.posix.dirname(file.relativePath);
    const parent = folderNodes.get(folderPath === '.' ? '' : folderPath) ?? root;
    parent.files.push(file.name);
  }

  sortFolderTree(root);
  return root;
}

function sortFolderTree(node: FolderTreeNode): void {
  node.folders.sort((a, b) => a.name.localeCompare(b.name));
  node.files.sort((a, b) => a.localeCompare(b));

  for (const folder of node.folders) {
    sortFolderTree(folder);
  }
}

function detectLanguage(extension: string, fileName: string): string {
  const normalizedName = fileName.toLowerCase();

  if (normalizedName === 'dockerfile') {
    return 'Dockerfile';
  }

  const languages: Record<string, string> = {
    '.cjs': 'JavaScript',
    '.css': 'CSS',
    '.cts': 'TypeScript',
    '.html': 'HTML',
    '.js': 'JavaScript',
    '.json': 'JSON',
    '.jsx': 'JavaScript React',
    '.md': 'Markdown',
    '.mjs': 'JavaScript',
    '.mts': 'TypeScript',
    '.py': 'Python',
    '.scss': 'SCSS',
    '.svelte': 'Svelte',
    '.ts': 'TypeScript',
    '.tsx': 'TypeScript React',
    '.vue': 'Vue',
    '.yaml': 'YAML',
    '.yml': 'YAML',
  };

  return languages[extension] ?? (extension ? extension.slice(1).toUpperCase() : 'Plain Text');
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
