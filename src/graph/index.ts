import type { ExportStatement, ImportStatement, RepositoryScanResult } from '../scanner/types';

export type GraphNodeKind = 'file' | 'external-module' | 'export';

export interface GraphNode {
  id: string;
  label: string;
  kind: GraphNodeKind;
  path?: string;
}

export interface ImportGraphEdge {
  source: string;
  target: string;
  moduleSpecifier: string;
  kind: ImportStatement['kind'];
  resolved: boolean;
  line: number;
}

export interface ExportGraphEdge {
  source: string;
  target: string;
  exportedName: string;
  kind: ExportStatement['kind'];
  moduleSpecifier?: string;
  line: number;
}

export interface FileDependencyRelationship {
  sourceFile: string;
  targetFile?: string;
  moduleSpecifier: string;
  resolved: boolean;
  imports: ImportStatement[];
}

export interface RepositoryGraph {
  generatedAt: string;
  nodes: GraphNode[];
  importGraph: ImportGraphEdge[];
  exportGraph: ExportGraphEdge[];
  fileDependencies: FileDependencyRelationship[];
}

export class DependencyGraphBuilder {
  public build(scanResult: RepositoryScanResult): RepositoryGraph {
    const nodes = new Map<string, GraphNode>();
    const importGraph: ImportGraphEdge[] = [];
    const exportGraph: ExportGraphEdge[] = [];
    const relationships = new Map<string, FileDependencyRelationship>();

    for (const file of scanResult.files) {
      const sourceNodeId = getFileNodeId(file.relativePath);
      nodes.set(sourceNodeId, {
        id: sourceNodeId,
        label: file.name,
        kind: 'file',
        path: file.relativePath,
      });

      for (const importStatement of file.imports) {
        const resolved = Boolean(importStatement.resolvedPath);
        const targetPath = importStatement.resolvedPath ?? importStatement.moduleSpecifier;
        const targetNodeId = resolved ? getFileNodeId(targetPath) : getExternalNodeId(targetPath);

        if (!nodes.has(targetNodeId)) {
          nodes.set(targetNodeId, {
            id: targetNodeId,
            label: resolved ? targetPath.split('/').pop() ?? targetPath : targetPath,
            kind: resolved ? 'file' : 'external-module',
            path: resolved ? targetPath : undefined,
          });
        }

        importGraph.push({
          source: sourceNodeId,
          target: targetNodeId,
          moduleSpecifier: importStatement.moduleSpecifier,
          kind: importStatement.kind,
          resolved,
          line: importStatement.line,
        });

        const relationshipKey = `${file.relativePath}->${targetPath}`;
        const relationship = relationships.get(relationshipKey) ?? {
          sourceFile: file.relativePath,
          targetFile: importStatement.resolvedPath,
          moduleSpecifier: importStatement.moduleSpecifier,
          resolved,
          imports: [],
        };

        relationship.imports.push(importStatement);
        relationships.set(relationshipKey, relationship);
      }

      for (const exportStatement of file.exports) {
        for (const exportedName of exportStatement.exportedNames) {
          const exportNodeId = getExportNodeId(file.relativePath, exportedName);
          nodes.set(exportNodeId, {
            id: exportNodeId,
            label: exportedName,
            kind: 'export',
            path: file.relativePath,
          });

          exportGraph.push({
            source: sourceNodeId,
            target: exportNodeId,
            exportedName,
            kind: exportStatement.kind,
            moduleSpecifier: exportStatement.moduleSpecifier,
            line: exportStatement.line,
          });
        }
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
      importGraph: importGraph.sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target)),
      exportGraph: exportGraph.sort((a, b) => a.source.localeCompare(b.source) || a.exportedName.localeCompare(b.exportedName)),
      fileDependencies: [...relationships.values()].sort((a, b) => a.sourceFile.localeCompare(b.sourceFile) || a.moduleSpecifier.localeCompare(b.moduleSpecifier)),
    };
  }
}

export class InMemoryRepositoryGraphStore {
  private graph: RepositoryGraph | undefined;

  public setGraph(graph: RepositoryGraph): void {
    this.graph = graph;
  }

  public getGraph(): RepositoryGraph | undefined {
    return this.graph;
  }

  public clear(): void {
    this.graph = undefined;
  }
}

function getFileNodeId(relativePath: string): string {
  return `file:${relativePath}`;
}

function getExternalNodeId(moduleSpecifier: string): string {
  return `external:${moduleSpecifier}`;
}

function getExportNodeId(relativePath: string, exportedName: string): string {
  return `export:${relativePath}:${exportedName}`;
}

