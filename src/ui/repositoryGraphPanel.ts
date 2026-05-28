import * as vscode from 'vscode';
import type { RepositoryIntelligenceSnapshot } from '../scanner';
import { escapeHtml } from './html';

export class RepositoryGraphPanel {
  public static show(extensionUri: vscode.Uri, snapshot: RepositoryIntelligenceSnapshot): void {
    const panel = vscode.window.createWebviewPanel(
      'orb-ai.repositoryGraph',
      'ORB AI Repository Graph',
      vscode.ViewColumn.Beside,
      {
        enableScripts: false,
        localResourceRoots: [extensionUri],
      },
    );

    panel.webview.html = renderGraphHtml(snapshot);
  }
}

function renderGraphHtml(snapshot: RepositoryIntelligenceSnapshot): string {
  const { graph, summary } = snapshot;
  const internalEdges = graph.importGraph.filter((edge) => edge.resolved);
  const externalEdges = graph.importGraph.filter((edge) => !edge.resolved);
  const topFileDependencies = graph.fileDependencies.slice(0, 150);
  const topExports = graph.exportGraph.slice(0, 150);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ORB AI Repository Graph</title>
  <style>
    body {
      margin: 0;
      padding: 24px;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      line-height: 1.5;
    }

    h1, h2, p {
      margin: 0;
    }

    h1 {
      font-size: 22px;
      font-weight: 700;
    }

    h2 {
      margin-top: 28px;
      margin-bottom: 10px;
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 0;
      color: var(--vscode-descriptionForeground);
    }

    .subtitle {
      margin-top: 4px;
      color: var(--vscode-descriptionForeground);
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px;
      margin-top: 18px;
    }

    .stat,
    .row {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      background: var(--vscode-sideBar-background);
    }

    .stat {
      padding: 12px;
    }

    .stat strong {
      display: block;
      font-size: 22px;
    }

    .stat span {
      color: var(--vscode-descriptionForeground);
    }

    .rows {
      display: grid;
      gap: 8px;
    }

    .row {
      padding: 10px 12px;
      overflow-wrap: anywhere;
    }

    .path {
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
    }

    .meta {
      margin-top: 4px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }
  </style>
</head>
<body>
  <h1>Repository Graph</h1>
  <p class="subtitle">${escapeHtml(summary.rootPath)}</p>

  <section class="stats">
    <div class="stat"><strong>${graph.nodes.length}</strong><span>Nodes</span></div>
    <div class="stat"><strong>${internalEdges.length}</strong><span>Internal Imports</span></div>
    <div class="stat"><strong>${externalEdges.length}</strong><span>External Imports</span></div>
    <div class="stat"><strong>${graph.exportGraph.length}</strong><span>Exports</span></div>
  </section>

  <h2>File Dependencies</h2>
  ${topFileDependencies.length ? `<div class="rows">${topFileDependencies.map((relationship) => `<div class="row">
    <div><span class="path">${escapeHtml(relationship.sourceFile)}</span> -> <span class="path">${escapeHtml(relationship.targetFile ?? relationship.moduleSpecifier)}</span></div>
    <div class="meta">${relationship.imports.length} import${relationship.imports.length === 1 ? '' : 's'} ${relationship.resolved ? 'resolved inside the workspace' : 'from an external module'}</div>
  </div>`).join('')}</div>` : '<p class="subtitle">No import relationships found.</p>'}

  <h2>Export Graph</h2>
  ${topExports.length ? `<div class="rows">${topExports.map((edge) => `<div class="row">
    <div><span class="path">${escapeHtml(edge.source.replace(/^file:/, ''))}</span> exports <strong>${escapeHtml(edge.exportedName)}</strong></div>
    <div class="meta">${escapeHtml(edge.kind)} export at line ${edge.line}</div>
  </div>`).join('')}</div>` : '<p class="subtitle">No exports found.</p>'}
</body>
</html>`;
}

