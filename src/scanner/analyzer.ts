import * as fs from 'fs';
import * as path from 'path';

export interface PackageInfo {
  type: 'npm' | 'pip' | 'gradle' | 'maven' | 'go' | 'rust' | 'unknown';
  file: string;
  exists: boolean;
}

export interface FrameworkDetection {
  framework: string;
  version?: string;
  confidence: number; // 0-1
  indicators: string[];
}

export interface DependencyInfo {
  name: string;
  version?: string;
  type: 'direct' | 'dev' | 'peer';
}

/**
 * Detect framework from package files and configuration
 */
export async function detectFramework(rootPath: string): Promise<FrameworkDetection[]> {
  const detections: FrameworkDetection[] = [];

  // Check for Node.js/npm
  const packageJsonPath = path.join(rootPath, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const content = fs.readFileSync(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(content);

      const indicators: string[] = [];
      const frameworks: { [key: string]: string } = {
        'react': 'React',
        'vue': 'Vue.js',
        'angular': 'Angular',
        'next': 'Next.js',
        'express': 'Express',
        'fastify': 'Fastify',
        'nestjs': '@nestjs/core',
      };

      for (const [pkg, framework] of Object.entries(frameworks)) {
        const deps = packageJson.dependencies || {};
        const devDeps = packageJson.devDependencies || {};

        if (deps[pkg] || devDeps[pkg]) {
          indicators.push(pkg);
          detections.push({
            framework,
            version: deps[pkg] || devDeps[pkg],
            confidence: 0.95,
            indicators: [pkg],
          });
        }
      }

      // Check if it's a VS Code extension
      if (packageJson.activationEvents || packageJson.contributes) {
        detections.push({
          framework: 'VS Code Extension',
          confidence: 1.0,
          indicators: ['activationEvents', 'contributes'],
        });
      }
    } catch (error) {
      console.error('Error parsing package.json:', error);
    }
  }

  // Check for Python
  const requirementsPath = path.join(rootPath, 'requirements.txt');
  if (fs.existsSync(requirementsPath)) {
    detections.push({
      framework: 'Python',
      confidence: 0.85,
      indicators: ['requirements.txt'],
    });
  }

  // Check for Go
  const goModPath = path.join(rootPath, 'go.mod');
  if (fs.existsSync(goModPath)) {
    detections.push({
      framework: 'Go',
      confidence: 1.0,
      indicators: ['go.mod'],
    });
  }

  // Check for Rust
  const cargoPath = path.join(rootPath, 'Cargo.toml');
  if (fs.existsSync(cargoPath)) {
    detections.push({
      framework: 'Rust',
      confidence: 1.0,
      indicators: ['Cargo.toml'],
    });
  }

  return detections;
}

/**
 * Extract dependencies from package.json
 */
export async function extractDependencies(rootPath: string): Promise<DependencyInfo[]> {
  const packageJsonPath = path.join(rootPath, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(content);

    const dependencies: DependencyInfo[] = [];

    // Extract direct dependencies
    if (packageJson.dependencies) {
      for (const [name, version] of Object.entries(packageJson.dependencies)) {
        dependencies.push({
          name,
          version: version as string,
          type: 'direct',
        });
      }
    }

    // Extract dev dependencies
    if (packageJson.devDependencies) {
      for (const [name, version] of Object.entries(packageJson.devDependencies)) {
        dependencies.push({
          name,
          version: version as string,
          type: 'dev',
        });
      }
    }

    // Extract peer dependencies
    if (packageJson.peerDependencies) {
      for (const [name, version] of Object.entries(packageJson.peerDependencies)) {
        dependencies.push({
          name,
          version: version as string,
          type: 'peer',
        });
      }
    }

    return dependencies;
  } catch (error) {
    console.error('Error extracting dependencies:', error);
    return [];
  }
}

/**
 * Analyze imports in TypeScript/JavaScript files
 */
export async function analyzeImports(filePath: string): Promise<string[]> {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const imports: string[] = [];

    // Match ES6 imports
    const importRegex = /import\s+(?:.*?)\s+from\s+['"]([^'"]+)['"]/g;
    let match;

    while ((match = importRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }

    // Match CommonJS requires
    const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = requireRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }

    return [...new Set(imports)]; // Return unique imports
  } catch (error) {
    console.error(`Error analyzing imports in ${filePath}:`, error);
    return [];
  }
}
