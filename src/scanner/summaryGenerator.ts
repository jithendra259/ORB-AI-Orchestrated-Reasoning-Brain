import type { RepositoryGraph } from '../graph';
import type {
  DependencyRelationshipSummary,
  EntryPoint,
  FrameworkDetection,
  LanguageUsage,
  RepositoryScanResult,
  RepositorySummary,
  ScannedFile,
} from './types';

export class RepositorySummaryGenerator {
  public generate(
    scanResult: RepositoryScanResult,
    detectedFrameworks: FrameworkDetection[],
    graph: RepositoryGraph,
  ): RepositorySummary {
    const dependencyRelationships = graph.fileDependencies
      .slice(0, 75)
      .map<DependencyRelationshipSummary>((relationship) => ({
        source: relationship.sourceFile,
        target: relationship.targetFile ?? relationship.moduleSpecifier,
        imports: relationship.imports.length,
        resolved: relationship.resolved,
      }));

    return {
      rootPath: scanResult.rootPath,
      generatedAt: new Date().toISOString(),
      totalFiles: scanResult.files.length,
      totalFolders: scanResult.folders.length,
      languagesUsed: getLanguageUsage(scanResult.files),
      detectedFrameworks,
      importantEntryPoints: getImportantEntryPoints(scanResult.files),
      dependencyRelationships,
      internalDependencyCount: graph.fileDependencies.filter((relationship) => relationship.resolved).length,
      externalDependencyCount: graph.fileDependencies.filter((relationship) => !relationship.resolved).length,
      exportCount: scanResult.files.reduce((total, file) => total + file.exports.length, 0),
    };
  }
}

function getLanguageUsage(files: ScannedFile[]): LanguageUsage[] {
  const usage = new Map<string, { extensions: Set<string>; files: number }>();

  for (const file of files) {
    const language = usage.get(file.language) ?? { extensions: new Set<string>(), files: 0 };
    language.files += 1;

    if (file.extension) {
      language.extensions.add(file.extension);
    }

    usage.set(file.language, language);
  }

  return [...usage.entries()]
    .map(([language, value]) => ({
      language,
      extensions: [...value.extensions].sort(),
      files: value.files,
    }))
    .sort((a, b) => b.files - a.files || a.language.localeCompare(b.language));
}

function getImportantEntryPoints(files: ScannedFile[]): EntryPoint[] {
  const entryPoints: EntryPoint[] = [];
  const filePathSet = new Set(files.map((file) => file.relativePath.toLowerCase()));

  const exactRules: Array<Omit<EntryPoint, 'path'> & { candidates: string[] }> = [
    {
      candidates: ['package.json'],
      type: 'package',
      reason: 'Node package manifest and dependency root',
    },
    {
      candidates: ['src/extension.ts', 'src/extension.js'],
      type: 'extension',
      reason: 'VS Code extension activation entry',
    },
    {
      candidates: ['src/index.ts', 'src/index.tsx', 'src/index.js', 'src/index.jsx'],
      type: 'frontend',
      reason: 'Application index entry',
    },
    {
      candidates: ['src/main.ts', 'src/main.tsx', 'src/main.js', 'src/main.jsx'],
      type: 'frontend',
      reason: 'Application bootstrap entry',
    },
    {
      candidates: ['server.ts', 'server.js', 'src/server.ts', 'src/server.js'],
      type: 'server',
      reason: 'Server startup entry',
    },
    {
      candidates: ['app.ts', 'app.js', 'src/app.ts', 'src/app.js', 'app.py', 'src/app.py'],
      type: 'backend',
      reason: 'Application root module',
    },
    {
      candidates: ['manage.py'],
      type: 'framework',
      reason: 'Django management entry',
    },
    {
      candidates: ['app/page.tsx', 'app/page.jsx', 'src/app/page.tsx', 'src/app/page.jsx'],
      type: 'framework',
      reason: 'Next.js app router page',
    },
    {
      candidates: ['pages/_app.tsx', 'pages/_app.jsx', 'src/pages/_app.tsx', 'src/pages/_app.jsx'],
      type: 'framework',
      reason: 'Next.js pages router application wrapper',
    },
  ];

  for (const rule of exactRules) {
    for (const candidate of rule.candidates) {
      if (filePathSet.has(candidate.toLowerCase())) {
        entryPoints.push({
          path: candidate,
          type: rule.type,
          reason: rule.reason,
        });
      }
    }
  }

  const exportedFiles = files
    .filter((file) => file.exports.length > 0 && !entryPoints.some((entryPoint) => entryPoint.path === file.relativePath))
    .sort((a, b) => b.exports.length - a.exports.length)
    .slice(0, 5);

  for (const file of exportedFiles) {
    entryPoints.push({
      path: file.relativePath,
      type: 'script',
      reason: `${file.exports.length} exported symbol${file.exports.length === 1 ? '' : 's'}`,
    });
  }

  return entryPoints;
}

