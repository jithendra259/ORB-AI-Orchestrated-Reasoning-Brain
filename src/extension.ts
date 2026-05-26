import * as vscode from 'vscode';
import { scanRepository } from './scanner/commands';

export function activate(context: vscode.ExtensionContext) {
	// Hello World command
	let helloWorld = vscode.commands.registerCommand('orb-ai.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from ORB AI!');
	});

	// Repository Scanner command
	let scanRepo = vscode.commands.registerCommand('orb-ai.scanRepository', async () => {
		await scanRepository();
	});

	context.subscriptions.push(helloWorld, scanRepo);
}

export function deactivate() {}
