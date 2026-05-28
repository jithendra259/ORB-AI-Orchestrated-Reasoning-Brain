import * as vscode from 'vscode';
import { GraphBuilder, DependencyGraph } from './builder';

export class GraphCommands {
	private outputChannel: vscode.OutputChannel;

	constructor(outputChannel: vscode.OutputChannel) {
		this.outputChannel = outputChannel;
	}

	/**
	 * Command: orb-ai.analyzeDependencies
	 * Analyzes the dependency graph of the current workspace
	 */
	public async analyzeDependencies(): Promise<void> {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			vscode.window.showErrorMessage('No workspace folder open.');
			return;
		}

		const rootFolder = workspaceFolders[0].uri.fsPath;
		
		vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: 'ORB AI: Building Dependency Graph...',
				cancellable: false
			},
			async (progress) => {
				try {
					// 1. Get all files (reuse scanner logic if available, or simple glob)
					const files = await this.getAllSourceFiles(rootFolder);
					progress.report({ message: `Found ${files.length} files, parsing imports...` });

					// 2. Build Graph
					const builder = new GraphBuilder(rootFolder);
					const graph = builder.build(files);

					// 3. Report Results
					this.reportGraphAnalysis(graph);

					vscode.window.showInformationMessage(
						`Dependency Graph Built: ${graph.nodes.size} nodes, ${graph.edges.length} connections.` + 
						(graph.circularDependencies.length > 0 
							? ` ⚠️ ${graph.circularDependencies.length} circular dependencies detected!` 
							: ' ✅ No circular dependencies.')
					);

				} catch (error) {
					const errorMsg = error instanceof Error ? error.message : 'Unknown error';
					vscode.window.showErrorMessage(`Failed to build dependency graph: ${errorMsg}`);
					this.outputChannel.appendLine(`[ERROR] ${errorMsg}`);
				}
			}
		);
	}

	/**
	 * Helper: Collect all source files in the workspace
	 */
	private async getAllSourceFiles(rootPath: string): Promise<string[]> {
		const files: string[] = [];
		const excludePatterns = '**/{node_modules,.git,dist,build,coverage,.vscode}/**';
		
		const includePatterns = [
			'**/*.{ts,tsx,js,jsx}',
			'**/*.{py,go,rs}'
		];

		for (const pattern of includePatterns) {
			const uris = await vscode.workspace.findFiles(
				pattern, 
				excludePatterns
			);
			files.push(...uris.map(uri => uri.fsPath));
		}

		return files;
	}

	/**
	 * Helper: Format and print graph analysis to Output Channel
	 */
	private reportGraphAnalysis(graph: DependencyGraph): void {
		this.outputChannel.appendLine('\n--- ORB AI: Dependency Graph Analysis ---');
		this.outputChannel.appendLine(`Total Nodes: ${graph.nodes.size}`);
		this.outputChannel.appendLine(`Total Edges: ${graph.edges.length}`);
		this.outputChannel.appendLine('');

		// Top 5 Most Connected Files (Hubs)
		const nodeArray = Array.from(graph.nodes.values());
		const sortedByDeps = nodeArray.sort((a, b) => b.dependencies.length - a.dependencies.length).slice(0, 5);
		
		this.outputChannel.appendLine('🔗 Top 5 Most Connected Files:');
		sortedByDeps.forEach(node => {
			this.outputChannel.appendLine(`   - ${node.id} (${node.dependencies.length} imports)`);
		});
		this.outputChannel.appendLine('');

		// Circular Dependencies
		if (graph.circularDependencies.length > 0) {
			this.outputChannel.appendLine('⚠️ Circular Dependencies Detected:');
			graph.circularDependencies.forEach((cycle, idx) => {
				this.outputChannel.appendLine(`   Cycle #${idx + 1}: ${cycle.join(' -> ')}`);
			});
		} else {
			this.outputChannel.appendLine('✅ No circular dependencies found.');
		}
		
		this.outputChannel.appendLine('-----------------------------------------\n');
		this.outputChannel.show(true);
	}
}
