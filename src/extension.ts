import * as vscode from 'vscode';
import { scanRepository } from './scanner/commands';
import { GraphCommands } from './graph/commands';

export function activate(context: vscode.ExtensionContext) {
	// Create Output Channel
	const outputChannel = vscode.window.createOutputChannel('ORB AI');
	context.subscriptions.push(outputChannel);

	// Hello World command
	const helloWorld = vscode.commands.registerCommand('orb-ai.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from ORB AI!');
	});

	// Repository Scanner command
	const scanRepo = vscode.commands.registerCommand('orb-ai.scanRepository', async () => {
		await scanRepository(outputChannel);
	});

	// Dependency Graph Analyzer command (NEW)
	const graphCommands = new GraphCommands(outputChannel);
	const analyzeDeps = vscode.commands.registerCommand('orb-ai.analyzeDependencies', async () => {
		await graphCommands.analyzeDependencies();
	});

	context.subscriptions.push(helloWorld, scanRepo, analyzeDeps);
}

export function deactivate() {}
