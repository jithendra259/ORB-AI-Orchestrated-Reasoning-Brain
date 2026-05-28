import * as path from 'path';
import * as vscode from 'vscode';
import type { OrbLogger } from '../utils/logger';
import type {
  DetectionSignalKind,
  FrameworkDetection,
  FrameworkDetectionSignal,
  FrameworkName,
  RepositoryScanResult,
} from './types';

type PackageDependencies = Record<string, string>;

interface PackageJson {
  dependencies?: PackageDependencies;
  devDependencies?: PackageDependencies;
  peerDependencies?: PackageDependencies;
  optionalDependencies?: PackageDependencies;
}

interface FrameworkAccumulator {
  framework: FrameworkName;
  version?: string;
  signals: FrameworkDetectionSignal[];
}

const FRAMEWORKS: FrameworkName[] = [
  'React',
  'Next.js',
  'Express',
  'Vue',
  'Angular',
  'NestJS',
  'Django',
  'Flask',
  'FastAPI',
];

export class FrameworkDetector {
  public constructor(private readonly logger: OrbLogger) {}

  public async detect(rootPath: string, scanResult: RepositoryScanResult): Promise<FrameworkDetection[]> {
    const accumulators = new Map<FrameworkName, FrameworkAccumulator>();
    const filePaths = new Set(scanResult.files.map((file) => file.relativePath.toLowerCase()));
    const folderPaths = new Set(scanResult.folders.map((folder) => folder.relativePath.toLowerCase()));
    const packageJson = await this.readPackageJson(rootPath);

    if (packageJson) {
      this.detectNodeDependencies(packageJson, accumulators);
    }

    await this.detectPythonDependencies(rootPath, scanResult, accumulators);
    this.detectConfigFiles(filePaths, accumulators);
    this.detectFolderPatterns(filePaths, folderPaths, accumulators);
    this.detectImports(scanResult, accumulators);

    return FRAMEWORKS
      .map((framework) => accumulators.get(framework))
      .filter((accumulator): accumulator is FrameworkAccumulator => Boolean(accumulator))
      .map((accumulator) => ({
        framework: accumulator.framework,
        version: accumulator.version,
        confidence: calculateConfidence(accumulator.signals),
        signals: accumulator.signals.sort((a, b) => b.weight - a.weight),
      }))
      .filter((detection) => detection.confidence >= 0.2)
      .sort((a, b) => b.confidence - a.confidence || a.framework.localeCompare(b.framework));
  }

  private detectNodeDependencies(packageJson: PackageJson, accumulators: Map<FrameworkName, FrameworkAccumulator>): void {
    const dependencies = mergeDependencies(packageJson);
    const dependencyRules: Array<{ framework: FrameworkName; packages: string[] }> = [
      { framework: 'React', packages: ['react'] },
      { framework: 'Next.js', packages: ['next'] },
      { framework: 'Express', packages: ['express'] },
      { framework: 'Vue', packages: ['vue'] },
      { framework: 'Angular', packages: ['@angular/core'] },
      { framework: 'NestJS', packages: ['@nestjs/core', '@nestjs/common'] },
    ];

    for (const rule of dependencyRules) {
      for (const packageName of rule.packages) {
        const version = dependencies[packageName];
        if (version) {
          addSignal(accumulators, rule.framework, 'dependency', 'package.json', packageName, 0.55, version);
        }
      }
    }
  }

  private async detectPythonDependencies(
    rootPath: string,
    scanResult: RepositoryScanResult,
    accumulators: Map<FrameworkName, FrameworkAccumulator>,
  ): Promise<void> {
    const dependencyFiles = ['requirements.txt', 'pyproject.toml', 'Pipfile'];
    const availableFiles = new Set(scanResult.files.map((file) => file.relativePath));

    for (const dependencyFile of dependencyFiles) {
      if (!availableFiles.has(dependencyFile)) {
        continue;
      }

      try {
        const content = await readWorkspaceText(path.join(rootPath, dependencyFile));
        this.detectPythonDependencyText(dependencyFile, content, accumulators);
      } catch (error) {
        this.logger.warn(`Unable to read Python dependency file: ${dependencyFile}`, error);
      }
    }
  }

  private detectPythonDependencyText(
    source: string,
    content: string,
    accumulators: Map<FrameworkName, FrameworkAccumulator>,
  ): void {
    const normalized = content.toLowerCase();
    const pythonDependencyRules: Array<{ framework: FrameworkName; packageName: string }> = [
      { framework: 'Django', packageName: 'django' },
      { framework: 'Flask', packageName: 'flask' },
      { framework: 'FastAPI', packageName: 'fastapi' },
    ];

    for (const rule of pythonDependencyRules) {
      if (new RegExp(`(^|[^a-z0-9_-])${rule.packageName}([^a-z0-9_-]|$)`, 'i').test(normalized)) {
        addSignal(accumulators, rule.framework, 'dependency', source, rule.packageName, 0.55);
      }
    }
  }

  private detectConfigFiles(filePaths: Set<string>, accumulators: Map<FrameworkName, FrameworkAccumulator>): void {
    const configRules: Array<{ framework: FrameworkName; files: string[] }> = [
      { framework: 'Next.js', files: ['next.config.js', 'next.config.mjs', 'next.config.ts'] },
      { framework: 'Vue', files: ['vue.config.js'] },
      { framework: 'Angular', files: ['angular.json'] },
      { framework: 'NestJS', files: ['nest-cli.json'] },
      { framework: 'Django', files: ['manage.py'] },
    ];

    for (const rule of configRules) {
      for (const configFile of rule.files) {
        if (filePaths.has(configFile)) {
          addSignal(accumulators, rule.framework, 'config', configFile, configFile, 0.35);
        }
      }
    }
  }

  private detectFolderPatterns(
    filePaths: Set<string>,
    folderPaths: Set<string>,
    accumulators: Map<FrameworkName, FrameworkAccumulator>,
  ): void {
    if (hasAnyPath(filePaths, ['src/app.tsx', 'src/app.jsx', 'src/main.tsx', 'src/main.jsx', 'src/app.ts', 'src/app.js'])) {
      addSignal(accumulators, 'React', 'folder-pattern', 'src', 'src/App or src/main entry', 0.25);
    }

    if (hasAnyFolder(folderPaths, ['pages', 'src/pages']) || hasAnyPath(filePaths, ['app/page.tsx', 'app/layout.tsx', 'src/app/page.tsx', 'src/app/layout.tsx'])) {
      addSignal(accumulators, 'Next.js', 'folder-pattern', 'app/pages', 'Next.js routing folders', 0.25);
    }

    if ([...filePaths].some((filePath) => filePath.endsWith('.vue'))) {
      addSignal(accumulators, 'Vue', 'folder-pattern', '*.vue', 'Vue single-file components', 0.25);
    }

    if (folderPaths.has('src/app') && hasAnyPath(filePaths, ['src/app/app.module.ts', 'src/app/app.component.ts', 'src/app/app.config.ts'])) {
      addSignal(accumulators, 'Angular', 'folder-pattern', 'src/app', 'Angular source layout', 0.22);
    }

    if (hasAnyPath(filePaths, ['src/app.module.ts']) || (hasAnyPath(filePaths, ['src/main.ts']) && hasAnyPath(filePaths, ['src/app.controller.ts', 'src/app.service.ts']))) {
      addSignal(accumulators, 'NestJS', 'folder-pattern', 'src/*.module.ts', 'NestJS module layout', 0.25);
    }

    if (hasAnyPath(filePaths, ['manage.py']) || [...filePaths].some((filePath) => filePath.endsWith('/settings.py') || filePath.endsWith('/urls.py'))) {
      addSignal(accumulators, 'Django', 'folder-pattern', 'manage.py/settings.py', 'Django project layout', 0.3);
    }

    if (hasAnyPath(filePaths, ['app.py', 'wsgi.py', 'src/app.py'])) {
      addSignal(accumulators, 'Flask', 'folder-pattern', 'app.py', 'Python web app entry', 0.18);
    }
  }

  private detectImports(scanResult: RepositoryScanResult, accumulators: Map<FrameworkName, FrameworkAccumulator>): void {
    for (const file of scanResult.files) {
      for (const importStatement of file.imports) {
        const moduleSpecifier = importStatement.moduleSpecifier.toLowerCase();

        if (moduleSpecifier === 'react' || moduleSpecifier.startsWith('react/')) {
          addSignal(accumulators, 'React', 'import', file.relativePath, importStatement.moduleSpecifier, 0.3);
        }

        if (moduleSpecifier === 'next' || moduleSpecifier.startsWith('next/')) {
          addSignal(accumulators, 'Next.js', 'import', file.relativePath, importStatement.moduleSpecifier, 0.3);
        }

        if (moduleSpecifier === 'express') {
          addSignal(accumulators, 'Express', 'import', file.relativePath, importStatement.moduleSpecifier, 0.3);
        }

        if (moduleSpecifier === 'vue' || moduleSpecifier.startsWith('vue/')) {
          addSignal(accumulators, 'Vue', 'import', file.relativePath, importStatement.moduleSpecifier, 0.3);
        }

        if (moduleSpecifier === '@vitejs/plugin-vue') {
          addSignal(accumulators, 'Vue', 'import', file.relativePath, importStatement.moduleSpecifier, 0.25);
        }

        if (moduleSpecifier === '@angular/core' || moduleSpecifier.startsWith('@angular/')) {
          addSignal(accumulators, 'Angular', 'import', file.relativePath, importStatement.moduleSpecifier, 0.3);
        }

        if (moduleSpecifier.startsWith('@nestjs/')) {
          addSignal(accumulators, 'NestJS', 'import', file.relativePath, importStatement.moduleSpecifier, 0.3);
        }

        if (moduleSpecifier === 'django' || moduleSpecifier.startsWith('django.')) {
          addSignal(accumulators, 'Django', 'import', file.relativePath, importStatement.moduleSpecifier, 0.3);
        }

        if (moduleSpecifier === 'flask') {
          addSignal(accumulators, 'Flask', 'import', file.relativePath, importStatement.moduleSpecifier, 0.3);
        }

        if (moduleSpecifier === 'fastapi') {
          addSignal(accumulators, 'FastAPI', 'import', file.relativePath, importStatement.moduleSpecifier, 0.3);
        }
      }
    }
  }

  private async readPackageJson(rootPath: string): Promise<PackageJson | undefined> {
    try {
      const content = await readWorkspaceText(path.join(rootPath, 'package.json'));
      return JSON.parse(content) as PackageJson;
    } catch (error) {
      this.logger.warn('Unable to parse package.json for framework detection', error);
      return undefined;
    }
  }
}

function addSignal(
  accumulators: Map<FrameworkName, FrameworkAccumulator>,
  framework: FrameworkName,
  kind: DetectionSignalKind,
  source: string,
  value: string,
  weight: number,
  version?: string,
): void {
  const existing = accumulators.get(framework) ?? {
    framework,
    version,
    signals: [],
  };

  const key = `${kind}:${source}:${value}`;
  if (!existing.signals.some((signal) => `${signal.kind}:${signal.source}:${signal.value}` === key)) {
    existing.signals.push({ kind, source, value, weight });
  }

  if (!existing.version && version) {
    existing.version = version;
  }

  accumulators.set(framework, existing);
}

function calculateConfidence(signals: FrameworkDetectionSignal[]): number {
  const rawScore = signals.reduce((sum, signal) => sum + signal.weight, 0);
  return Math.min(1, Number(rawScore.toFixed(2)));
}

function mergeDependencies(packageJson: PackageJson): PackageDependencies {
  return {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
    ...packageJson.peerDependencies,
    ...packageJson.optionalDependencies,
  };
}

function hasAnyPath(filePaths: Set<string>, candidates: string[]): boolean {
  return candidates.some((candidate) => filePaths.has(candidate.toLowerCase()));
}

function hasAnyFolder(folderPaths: Set<string>, candidates: string[]): boolean {
  return candidates.some((candidate) => folderPaths.has(candidate.toLowerCase()));
}

async function readWorkspaceText(absolutePath: string): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(absolutePath));
  return Buffer.from(bytes).toString('utf8');
}
