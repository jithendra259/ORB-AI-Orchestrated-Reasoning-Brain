import * as path from 'path';
import * as fs from 'fs';
import { Uri } from 'vscode';

export interface DependencyNode {
	id: string;
	path: string;
	dependencies: string[]; // IDs of dependent nodes
	importStatements: string[];
}

export interface DependencyGraph {
	nodes: Map<string, DependencyNode>;
	edges: [string, string][]; // [from, to]
	circularDependencies: string[][];
}

export class GraphBuilder {
	private rootPath: string;

	constructor(rootPath: string) {
		this.rootPath = rootPath;
	}

	/**
	 * Parses a file to extract import/require statements
	 */
	private parseImports(filePath: string, content: string): string[] {
		const imports: string[] = [];
		const ext = path.extname(filePath);
		
		// Regex patterns for different languages
		const patterns: RegExp[] = [
			// ES6 Import: import ... from '...'
			/import\s+(?:{[^}]*}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/g,
			// CommonJS Require: require('...')
			/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
			// Python Import: import ... / from ... import ...
			/^(?:import\s+([\w.]+)|from\s+([\w.]+)\s+import)/gm,
			// Go Import: import "..."
			/import\s+"([^"]+)"/g,
		];

		for (const pattern of patterns) {
			pattern.lastIndex = 0; // Reset regex state
			let match;
			while ((match = pattern.exec(content)) !== null) {
				const importPath = match[1] || match[2];
				if (importPath) {
					imports.push(importPath);
				}
			}
		}

		return imports;
	}

	/**
	 * Resolves a relative import path to an absolute file path
	 */
	private resolveImport(importPath: string, currentFile: string): string | null {
		// Skip external packages (node_modules) for now, focus on local graph
		if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
			return null; 
		}

		const dir = path.dirname(currentFile);
		const resolved = path.resolve(dir, importPath);
		
		// Try exact match
		if (fs.existsSync(resolved)) {
			return resolved;
		}

		// Try adding extensions
		const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs'];
		for (const ext of extensions) {
			if (fs.existsSync(resolved + ext)) {
				return resolved + ext;
			}
		}

		// Try index files
		for (const ext of extensions) {
			const indexPath = path.join(resolved, `index${ext}`);
			if (fs.existsSync(indexPath)) {
				return indexPath;
			}
		}

		return null;
	}

	/**
	 * Builds the full dependency graph for the workspace
	 */
	public build(fileList: string[]): DependencyGraph {
		const nodes = new Map<string, DependencyNode>();
		const edges: [string, string][] = [];
		const idMap = new Map<string, string>(); // path -> ID

		// 1. Initialize Nodes
		fileList.forEach(file => {
			const id = path.relative(this.rootPath, file);
			idMap.set(file, id);
			
			let imports: string[] = [];
			try {
				const content = fs.readFileSync(file, 'utf-8');
				// Limit file size for parsing performance
				if (content.length < 500000) { 
					imports = this.parseImports(file, content);
				}
			} catch (e) {
				console.error(`Failed to read ${file}:`, e);
			}

			nodes.set(id, {
				id,
				path: file,
				dependencies: [],
				importStatements: imports
			});
		});

		// 2. Resolve Edges
		fileList.forEach(file => {
			const sourceId = idMap.get(file)!;
			const node = nodes.get(sourceId)!;
			
			node.importStatements.forEach(imp => {
				const resolvedPath = this.resolveImport(imp, file);
				if (resolvedPath && idMap.has(resolvedPath)) {
					const targetId = idMap.get(resolvedPath)!;
					if (!node.dependencies.includes(targetId)) {
						node.dependencies.push(targetId);
						edges.push([sourceId, targetId]);
					}
				}
			});
		});

		// 3. Detect Circular Dependencies (DFS)
		const circularDependencies = this.detectCycles(nodes, edges);

		return { nodes, edges, circularDependencies };
	}

	/**
	 * Simple DFS to detect cycles
	 */
	private detectCycles(nodes: Map<string, DependencyNode>, edges: [string, string][]): string[][] {
		const cycles: string[][] = [];
		const adj = new Map<string, string[]>();
		
		nodes.forEach((node, id) => {
			adj.set(id, node.dependencies);
		});

		const visited = new Set<string>();
		const recursionStack = new Set<string>();
		const path: string[] = [];

		const dfs = (nodeId: string) => {
			visited.add(nodeId);
			recursionStack.add(nodeId);
			path.push(nodeId);

			const neighbors = adj.get(nodeId) || [];
			for (const neighbor of neighbors) {
				if (!visited.has(neighbor)) {
					dfs(neighbor);
				} else if (recursionStack.has(neighbor)) {
					// Cycle detected
					const cycleStart = path.indexOf(neighbor);
					const cycle = path.slice(cycleStart).concat(neighbor);
					cycles.push(cycle);
				}
			}

			path.pop();
			recursionStack.delete(nodeId);
		};

		nodes.forEach((_, id) => {
			if (!visited.has(id)) {
				dfs(id);
			}
		});

		return cycles;
	}
}
