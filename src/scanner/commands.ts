import * as vscode from 'vscode';
import { getRepositoryStructure } from './index';
import { detectFramework, extractDependencies, analyzeImports } from './analyzer';

/**
 * Scan the current workspace and display repository analysis
 */
export async function scanRepository(outputChannel: vscode.OutputChannel) {
  const workspaceFolders = vscode.workspace.workspaceFolders;

  if (!workspaceFolders) {
    vscode.window.showErrorMessage('No workspace folder is open');
    return;
  }

  const rootPath = workspaceFolders[0].uri.fsPath;

  try {
    // Show progress indicator
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'ORB AI: Scanning repository...',
        cancellable: false,
      },
      async (progress) => {
        // Get repository structure
        progress.report({ message: 'Analyzing file structure...' });
        const structure = await getRepositoryStructure(rootPath);

        // Detect framework
        progress.report({ message: 'Detecting framework...' });
        const frameworks = await detectFramework(rootPath);

        // Extract dependencies
        progress.report({ message: 'Extracting dependencies...' });
        const dependencies = await extractDependencies(rootPath);

        // Create analysis report
        const report = createAnalysisReport(structure, frameworks, dependencies);

        // Display report in output channel
        outputChannel.clear();
        outputChannel.append(report);
        outputChannel.show();

        vscode.window.showInformationMessage('Repository scan complete!');
      }
    );
  } catch (error) {
    vscode.window.showErrorMessage(`Repository scan failed: ${error}`);
  }
}

/**
 * Generate a formatted analysis report
 */
function createAnalysisReport(structure: any, frameworks: any[], dependencies: any[]): string {
  let report = '=== ORB AI Repository Analysis Report ===\n\n';

  // Repository Structure
  report += '📁 Repository Structure\n';
  report += `   Root: ${structure.rootPath}\n`;
  report += `   Total Files: ${structure.totalFiles}\n`;
  report += `   Total Directories: ${structure.totalDirectories}\n\n`;

  // Frameworks Detected
  report += '🔍 Detected Frameworks\n';
  if (frameworks.length === 0) {
    report += '   No frameworks detected\n';
  } else {
    frameworks.forEach((fw) => {
      report += `   • ${fw.framework}`;
      if (fw.version) {
        report += ` (${fw.version})`;
      }
      report += ` [${Math.round(fw.confidence * 100)}% confidence]\n`;
    });
  }
  report += '\n';

  // Dependencies
  report += '📦 Dependencies\n';
  if (dependencies.length === 0) {
    report += '   No dependencies found\n';
  } else {
    const directDeps = dependencies.filter((d) => d.type === 'direct');
    const devDeps = dependencies.filter((d) => d.type === 'dev');

    if (directDeps.length > 0) {
      report += `   Direct (${directDeps.length}):\n`;
      directDeps.forEach((dep) => {
        report += `     • ${dep.name}@${dep.version}\n`;
      });
    }

    if (devDeps.length > 0) {
      report += `   Development (${devDeps.length}):\n`;
      devDeps.forEach((dep) => {
        report += `     • ${dep.name}@${dep.version}\n`;
      });
    }
  }

  report += '\n=== End of Report ===\n';
  return report;
}
