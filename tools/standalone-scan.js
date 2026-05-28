#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'out');
const OUT_FILE = path.join(OUT_DIR, 'repository-scan.json');

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.vs', '.vscode-test', 'coverage']);
const RESOLVABLE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.py'];

function walk(dir, files = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (RESOLVABLE_EXTENSIONS.includes(ext)) files.push(full);
    }
  }
  return files;
}

function getLineNumber(content, index) {
  return content.slice(0, index).split(/\r\n|\r|\n/).length;
}

function parseJSImports(content) {
  const imports = [];
  const importFromRegex = /\bimport\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  const sideEffectImportRegex = /^\s*import\s+['"]([^'"]+)['"]\s*;?/gm;
  const dynamicImportRegex = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  const requireRegex = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  let m;
  while ((m = importFromRegex.exec(content))) {
    imports.push({ moduleSpecifier: m[2], rawText: m[0], line: getLineNumber(content, m.index), kind: 'es' });
  }
  while ((m = sideEffectImportRegex.exec(content))) {
    imports.push({ moduleSpecifier: m[1], rawText: m[0], line: getLineNumber(content, m.index), kind: 'side-effect' });
  }
  while ((m = dynamicImportRegex.exec(content))) {
    imports.push({ moduleSpecifier: m[1], rawText: m[0], line: getLineNumber(content, m.index), kind: 'dynamic' });
  }
  while ((m = requireRegex.exec(content))) {
    imports.push({ moduleSpecifier: m[1], rawText: m[0], line: getLineNumber(content, m.index), kind: 'commonjs' });
  }

  return imports;
}

function parseJSExports(content) {
  const exports = [];
  const namedDeclarationRegex = /^\s*export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;
  const defaultExportRegex = /^\s*export\s+default(?:\s+(?:async\s+)?(?:class|function)\s+([A-Za-z_$][\w$]*))?/gm;
  const exportListRegex = /^\s*export\s*\{([^}]+)\}(?:\s+from\s+['"]([^'"]+)['"])?\s*;?/gm;
  const exportStarRegex = /^\s*export\s+\*\s*(?:as\s+([A-Za-z_$][\w$]*)\s+)?from\s+['"]([^'"]+)['"]\s*;?/gm;
  const moduleExportsRegex = /^\s*module\.exports\s*=\s*([A-Za-z_$][\w$]*)?/gm;
  const commonJsNamedExportRegex = /^\s*exports\.([A-Za-z_$][\w$]*)\s*=/gm;

  let m;
  while ((m = namedDeclarationRegex.exec(content))) exports.push({ exportedNames: [m[1]], rawText: m[0], line: getLineNumber(content, m.index), kind: 'named' });
  while ((m = defaultExportRegex.exec(content))) exports.push({ exportedNames: [m[1] || 'default'], rawText: m[0], line: getLineNumber(content, m.index), kind: 'default' });
  while ((m = exportListRegex.exec(content))) exports.push({ exportedNames: m[1].split(',').map(s=>s.trim()), rawText: m[0], line: getLineNumber(content, m.index), kind: m[2] ? 're-export' : 'named', moduleSpecifier: m[2] });
  while ((m = exportStarRegex.exec(content))) exports.push({ exportedNames: [m[1] || '*'], rawText: m[0], line: getLineNumber(content, m.index), kind: 'namespace', moduleSpecifier: m[2] });
  while ((m = moduleExportsRegex.exec(content))) exports.push({ exportedNames: [m[1] || 'module.exports'], rawText: m[0], line: getLineNumber(content, m.index), kind: 'commonjs' });
  while ((m = commonJsNamedExportRegex.exec(content))) exports.push({ exportedNames: [m[1]], rawText: m[0], line: getLineNumber(content, m.index), kind: 'commonjs' });

  return exports;
}

function parsePythonImports(content) {
  const imports = [];
  const fromImportRegex = /^\s*from\s+([A-Za-z_][\w.]*)/gm;
  const importRegex = /^\s*import\s+([A-Za-z_][\w.]*)/gm;
  let m;
  while ((m = fromImportRegex.exec(content))) imports.push({ moduleSpecifier: m[1], rawText: m[0], line: getLineNumber(content, m.index), kind: 'python' });
  while ((m = importRegex.exec(content))) imports.push({ moduleSpecifier: m[1], rawText: m[0], line: getLineNumber(content, m.index), kind: 'python' });
  return imports;
}

function isRelative(spec) {
  return spec.startsWith('.') || spec.startsWith('./') || spec.startsWith('../');
}

function normalizePosix(p) { return p.split(path.sep).join('/'); }

function buildGraph(files) {
  const fileSet = new Set(files.map(f => normalizePosix(path.relative(ROOT, f.path))));
  const relationships = [];

  for (const file of files) {
    const source = normalizePosix(path.relative(ROOT, file.path));
    for (const imp of file.imports) {
      const spec = imp.moduleSpecifier;
      let resolved = null;
      if (isRelative(spec)) {
        const base = path.posix.normalize(path.posix.join(path.posix.dirname(source), spec));
        const candidates = [base, ...['.ts','.tsx','.js','.jsx','.mjs','.cjs','.py'].map(e=>base+e), base + '/index.ts', base + '/index.js'];
        resolved = candidates.find(c => fileSet.has(c));
      }
      relationships.push({ source, moduleSpecifier: spec, resolvedPath: resolved, resolved: Boolean(resolved) });
    }
  }
  return relationships;
}

function main() {
  console.log('Scanning workspace for source files...');
  const found = walk(ROOT, []);
  const files = found.map(full => {
    const rel = path.relative(ROOT, full);
    const name = path.basename(full);
    const ext = path.extname(full).toLowerCase();
    const content = fs.readFileSync(full, 'utf8');
    const imports = (ext === '.py') ? parsePythonImports(content) : parseJSImports(content);
    const exports = (ext === '.py') ? [] : parseJSExports(content);
    return { path: full, relativePath: normalizePosix(rel), name, extension: ext, imports, exports };
  });

  const relationships = buildGraph(files);

  const snapshot = {
    scannedAt: new Date().toISOString(),
    files: files.map(f => ({ relativePath: f.relativePath, name: f.name, extension: f.extension, imports: f.imports, exports: f.exports })),
    relationships,
  };

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(snapshot, null, 2), 'utf8');
  console.log(`Wrote ${OUT_FILE} — ${files.length} files indexed, ${relationships.length} relationships`);
}

main();
