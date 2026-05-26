import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
	let disposable = vscode.commands.registerCommand('orb-ai.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from ORB AI!');
	});

	context.subscriptions.push(disposable);
}

export function deactivate() {}
