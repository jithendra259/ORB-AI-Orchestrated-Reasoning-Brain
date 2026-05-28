import { isRelativeModuleSpecifier } from '../utils/pathUtils';
import type { ExportStatement, ImportStatement } from './types';

const IMPORTABLE_EXTENSIONS = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.py',
  '.svelte',
  '.ts',
  '.tsx',
  '.vue',
]);

export function canParseSource(extension: string): boolean {
  return IMPORTABLE_EXTENSIONS.has(extension.toLowerCase());
}

export function parseSourceFile(content: string, extension: string): { imports: ImportStatement[]; exports: ExportStatement[] } {
  const imports = extension.toLowerCase() === '.py'
    ? parsePythonImports(content)
    : parseJavaScriptImports(content);

  const exports = extension.toLowerCase() === '.py'
    ? []
    : parseJavaScriptExports(content);

  return {
    imports: dedupeImports(imports),
    exports: dedupeExports(exports),
  };
}

function parseJavaScriptImports(content: string): ImportStatement[] {
  const imports: ImportStatement[] = [];
  const importFromRegex = /\bimport\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  const sideEffectImportRegex = /^\s*import\s+['"]([^'"]+)['"]\s*;?/gm;
  const dynamicImportRegex = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  const requireRegex = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  collectMatches(importFromRegex, content, (match) => {
    const moduleSpecifier = match[2];
    imports.push({
      moduleSpecifier,
      rawText: match[0],
      line: getLineNumber(content, match.index),
      kind: 'es',
      importedSymbols: extractImportedSymbols(match[1]),
      isRelative: isRelativeModuleSpecifier(moduleSpecifier),
    });
  });

  collectMatches(sideEffectImportRegex, content, (match) => {
    const moduleSpecifier = match[1];
    imports.push({
      moduleSpecifier,
      rawText: match[0],
      line: getLineNumber(content, match.index),
      kind: 'side-effect',
      importedSymbols: [],
      isRelative: isRelativeModuleSpecifier(moduleSpecifier),
    });
  });

  collectMatches(dynamicImportRegex, content, (match) => {
    const moduleSpecifier = match[1];
    imports.push({
      moduleSpecifier,
      rawText: match[0],
      line: getLineNumber(content, match.index),
      kind: 'dynamic',
      importedSymbols: [],
      isRelative: isRelativeModuleSpecifier(moduleSpecifier),
    });
  });

  collectMatches(requireRegex, content, (match) => {
    const moduleSpecifier = match[1];
    imports.push({
      moduleSpecifier,
      rawText: match[0],
      line: getLineNumber(content, match.index),
      kind: 'commonjs',
      importedSymbols: [],
      isRelative: isRelativeModuleSpecifier(moduleSpecifier),
    });
  });

  return imports;
}

function parsePythonImports(content: string): ImportStatement[] {
  const imports: ImportStatement[] = [];
  const fromImportRegex = /^\s*from\s+([A-Za-z_][\w.]*)(?:\s+import\s+([^\n#]+))?/gm;
  const importRegex = /^\s*import\s+([A-Za-z_][\w.]*)(?:\s+as\s+[A-Za-z_][\w]*)?(?:\s*,\s*([^\n#]+))?/gm;

  collectMatches(fromImportRegex, content, (match) => {
    const moduleSpecifier = match[1];
    imports.push({
      moduleSpecifier,
      rawText: match[0],
      line: getLineNumber(content, match.index),
      kind: 'python',
      importedSymbols: splitPythonImportSymbols(match[2] ?? ''),
      isRelative: moduleSpecifier.startsWith('.'),
    });
  });

  collectMatches(importRegex, content, (match) => {
    const moduleSpecifiers = [match[1], ...splitPythonImportSymbols(match[2] ?? '')];

    for (const moduleSpecifier of moduleSpecifiers) {
      imports.push({
        moduleSpecifier,
        rawText: match[0],
        line: getLineNumber(content, match.index),
        kind: 'python',
        importedSymbols: [],
        isRelative: moduleSpecifier.startsWith('.'),
      });
    }
  });

  return imports;
}

function parseJavaScriptExports(content: string): ExportStatement[] {
  const exports: ExportStatement[] = [];
  const namedDeclarationRegex = /^\s*export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;
  const defaultExportRegex = /^\s*export\s+default(?:\s+(?:async\s+)?(?:class|function)\s+([A-Za-z_$][\w$]*))?/gm;
  const exportListRegex = /^\s*export\s*\{([^}]+)\}(?:\s+from\s+['"]([^'"]+)['"])?\s*;?/gm;
  const exportStarRegex = /^\s*export\s+\*\s*(?:as\s+([A-Za-z_$][\w$]*)\s+)?from\s+['"]([^'"]+)['"]\s*;?/gm;
  const moduleExportsRegex = /^\s*module\.exports\s*=\s*([A-Za-z_$][\w$]*)?/gm;
  const commonJsNamedExportRegex = /^\s*exports\.([A-Za-z_$][\w$]*)\s*=/gm;

  collectMatches(namedDeclarationRegex, content, (match) => {
    exports.push({
      exportedNames: [match[1]],
      rawText: match[0],
      line: getLineNumber(content, match.index),
      kind: 'named',
    });
  });

  collectMatches(defaultExportRegex, content, (match) => {
    exports.push({
      exportedNames: [match[1] ?? 'default'],
      rawText: match[0],
      line: getLineNumber(content, match.index),
      kind: 'default',
    });
  });

  collectMatches(exportListRegex, content, (match) => {
    exports.push({
      exportedNames: splitExportNames(match[1]),
      rawText: match[0],
      line: getLineNumber(content, match.index),
      kind: match[2] ? 're-export' : 'named',
      moduleSpecifier: match[2],
    });
  });

  collectMatches(exportStarRegex, content, (match) => {
    exports.push({
      exportedNames: [match[1] ?? '*'],
      rawText: match[0],
      line: getLineNumber(content, match.index),
      kind: 'namespace',
      moduleSpecifier: match[2],
    });
  });

  collectMatches(moduleExportsRegex, content, (match) => {
    exports.push({
      exportedNames: [match[1] ?? 'module.exports'],
      rawText: match[0],
      line: getLineNumber(content, match.index),
      kind: 'commonjs',
    });
  });

  collectMatches(commonJsNamedExportRegex, content, (match) => {
    exports.push({
      exportedNames: [match[1]],
      rawText: match[0],
      line: getLineNumber(content, match.index),
      kind: 'commonjs',
    });
  });

  return exports;
}

function collectMatches(regex: RegExp, content: string, callback: (match: RegExpExecArray) => void): void {
  regex.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    callback(match);
  }
}

function extractImportedSymbols(importClause: string): string[] {
  const trimmed = importClause.replace(/\btype\b/g, '').trim();

  if (!trimmed) {
    return [];
  }

  const symbols = new Set<string>();
  const namespaceMatch = trimmed.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
  if (namespaceMatch) {
    symbols.add(namespaceMatch[1]);
  }

  const namedMatch = trimmed.match(/\{([^}]+)\}/);
  if (namedMatch) {
    for (const symbol of namedMatch[1].split(',')) {
      const cleanName = symbol.trim().split(/\s+as\s+/)[0]?.trim();
      if (cleanName) {
        symbols.add(cleanName);
      }
    }
  }

  const defaultCandidate = trimmed.split(',')[0]?.trim();
  if (defaultCandidate && !defaultCandidate.startsWith('{') && !defaultCandidate.startsWith('*')) {
    symbols.add(defaultCandidate);
  }

  return [...symbols];
}

function splitExportNames(value: string): string[] {
  return value
    .split(',')
    .map((name) => name.trim().split(/\s+as\s+/).pop()?.trim())
    .filter((name): name is string => Boolean(name));
}

function splitPythonImportSymbols(value: string): string[] {
  return value
    .split(',')
    .map((symbol) => symbol.trim().split(/\s+as\s+/)[0]?.trim())
    .filter((symbol): symbol is string => Boolean(symbol));
}

function getLineNumber(content: string, index: number): number {
  return content.slice(0, index).split(/\r\n|\r|\n/).length;
}

function dedupeImports(imports: ImportStatement[]): ImportStatement[] {
  const seen = new Set<string>();

  return imports.filter((importStatement) => {
    const key = `${importStatement.kind}:${importStatement.moduleSpecifier}:${importStatement.line}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function dedupeExports(exports: ExportStatement[]): ExportStatement[] {
  const seen = new Set<string>();

  return exports.filter((exportStatement) => {
    const key = `${exportStatement.kind}:${exportStatement.exportedNames.join(',')}:${exportStatement.line}:${exportStatement.moduleSpecifier ?? ''}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

