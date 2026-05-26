import * as fs from 'fs';
import * as path from 'path';

export interface FileInfo {
  path: string;
  name: string;
  extension: string;
  isDirectory: boolean;
}

export interface RepositoryStructure {
  rootPath: string;
  files: FileInfo[];
  directories: string[];
  totalFiles: number;
  totalDirectories: number;
}

/**
 * Recursively scan a directory and collect file information
 */
export async function scanDirectory(dirPath: string, maxDepth: number = 5, currentDepth: number = 0): Promise<FileInfo[]> {
  const files: FileInfo[] = [];

  if (currentDepth >= maxDepth) {
    return files;
  }

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      // Skip hidden files and common ignore patterns
      if (entry.name.startsWith('.') || isIgnoredPath(entry.name)) {
        continue;
      }

      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(dirPath, fullPath);

      if (entry.isDirectory()) {
        files.push({
          path: relativePath,
          name: entry.name,
          extension: '',
          isDirectory: true,
        });

        // Recursively scan subdirectories
        const subFiles = await scanDirectory(fullPath, maxDepth, currentDepth + 1);
        files.push(...subFiles);
      } else {
        files.push({
          path: relativePath,
          name: entry.name,
          extension: path.extname(entry.name),
          isDirectory: false,
        });
      }
    }
  } catch (error) {
    console.error(`Error scanning directory ${dirPath}:`, error);
  }

  return files;
}

/**
 * Check if a path should be ignored during scanning
 */
function isIgnoredPath(name: string): boolean {
  const ignoredPatterns = [
    'node_modules',
    '.git',
    'dist',
    'out',
    'build',
    '.vscode',
    '__pycache__',
    '.pytest_cache',
    'venv',
    '.env',
    '.env.local',
  ];

  return ignoredPatterns.includes(name);
}

/**
 * Get the repository structure from a given root path
 */
export async function getRepositoryStructure(rootPath: string): Promise<RepositoryStructure> {
  const files = await scanDirectory(rootPath);

  return {
    rootPath,
    files,
    directories: files.filter(f => f.isDirectory).map(f => f.path),
    totalFiles: files.filter(f => !f.isDirectory).length,
    totalDirectories: files.filter(f => f.isDirectory).length,
  };
}
