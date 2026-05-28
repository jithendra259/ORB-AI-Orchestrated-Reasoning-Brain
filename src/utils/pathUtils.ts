import * as path from 'path';

export function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}

export function toRepositoryRelativePath(rootPath: string, filePath: string): string {
  return normalizePath(path.relative(rootPath, filePath));
}

export function isRelativeModuleSpecifier(moduleSpecifier: string): boolean {
  return moduleSpecifier.startsWith('.') || moduleSpecifier.startsWith('/');
}

export function getPathSegments(relativePath: string): string[] {
  return normalizePath(relativePath).split('/').filter(Boolean);
}

