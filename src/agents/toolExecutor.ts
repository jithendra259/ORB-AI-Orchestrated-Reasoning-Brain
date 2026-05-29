import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import type { ToolCall } from '../ai/types';
import type { OrbLogger } from '../utils/logger';

export interface ToolResult {
  callId: string;
  name: string;
  result: string;
  error?: boolean;
}

export class ToolExecutor {
  constructor(
    private readonly workspaceRoot: string | undefined,
    private readonly logger: OrbLogger,
  ) {}

  async execute(call: ToolCall): Promise<ToolResult> {
    this.logger.info(`Executing tool: ${call.name}`, call.arguments);
    try {
      const result = await this.dispatch(call);
      return { callId: call.id, name: call.name, result };
    } catch (err: any) {
      const msg = `Tool "${call.name}" failed: ${err?.message ?? String(err)}`;
      this.logger.error(msg, err);
      return { callId: call.id, name: call.name, result: msg, error: true };
    }
  }

  private async dispatch(call: ToolCall): Promise<string> {
    switch (call.name) {
      case 'read_file':      return this.readFile(call.arguments.path);
      case 'write_file':     return this.writeFile(call.arguments.path, call.arguments.content);
      case 'create_file':    return this.writeFile(call.arguments.path, call.arguments.content);
      case 'list_dir':       return this.listDir(call.arguments.path ?? '.');
      case 'search_code':    return this.searchCode(call.arguments.query, call.arguments.include);
      case 'run_terminal':   return this.runTerminal(call.arguments.command);
      case 'delete_file':    return this.deleteFile(call.arguments.path);
      default:               throw new Error(`Unknown tool: ${call.name}`);
    }
  }

  // ─── Tool Implementations ─────────────────────────────────────────────────

  private async readFile(relPath: string): Promise<string> {
    const absPath = this.resolveAbsPath(relPath);
    const uri = vscode.Uri.file(absPath);
    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = Buffer.from(bytes).toString('utf8');
    // Cap at 50k chars to avoid overloading context
    if (text.length > 50000) {
      return text.slice(0, 50000) + `\n\n[... truncated ${text.length - 50000} chars ...]`;
    }
    return text;
  }

  private async writeFile(relPath: string, content: string): Promise<string> {
    const absPath = this.resolveAbsPath(relPath);
    const uri = vscode.Uri.file(absPath);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
    return `✓ Successfully wrote ${relPath} (${content.length} chars)`;
  }

  private async deleteFile(relPath: string): Promise<string> {
    const absPath = this.resolveAbsPath(relPath);
    const uri = vscode.Uri.file(absPath);
    await vscode.workspace.fs.delete(uri);
    return `✓ Deleted ${relPath}`;
  }

  private async listDir(relPath: string): Promise<string> {
    const absPath = this.resolveAbsPath(relPath);
    const uri = vscode.Uri.file(absPath);
    const entries = await vscode.workspace.fs.readDirectory(uri);
    const lines = entries
      .sort(([, at], [, bt]) => bt - at) // dirs first
      .map(([name, type]) => {
        const icon = type === vscode.FileType.Directory ? '📁' : '📄';
        return `${icon} ${name}`;
      });
    return lines.join('\n') || '(empty directory)';
  }

  private async searchCode(query: string, include?: string): Promise<string> {
    const pattern = include || '**/*';
    const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 500);
    const results: string[] = [];

    for (const fileUri of files) {
      try {
        const bytes = await vscode.workspace.fs.readFile(fileUri);
        const text = Buffer.from(bytes).toString('utf8');
        const lines = text.split('\n');
        const matchingLines: string[] = [];
        lines.forEach((line, idx) => {
          if (line.toLowerCase().includes(query.toLowerCase())) {
            matchingLines.push(`  L${idx + 1}: ${line.trim()}`);
          }
        });
        if (matchingLines.length > 0) {
          const rel = this.workspaceRoot
            ? path.relative(this.workspaceRoot, fileUri.fsPath).replace(/\\/g, '/')
            : fileUri.fsPath;
          results.push(`📄 ${rel}:\n${matchingLines.slice(0, 5).join('\n')}`);
        }
      } catch {
        // skip unreadable files
      }
      if (results.length >= 20) { break; }
    }

    if (results.length === 0) {
      return `No results found for "${query}"`;
    }
    return `Found ${results.length} file(s) matching "${query}":\n\n${results.join('\n\n')}`;
  }

  private runTerminal(command: string): Promise<string> {
    const cwd = this.workspaceRoot ?? process.cwd();
    return new Promise((resolve) => {
      exec(command, { cwd, timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
        const output = [stdout, stderr].filter(Boolean).join('\n').trim();
        if (err && !output) {
          resolve(`❌ Command failed: ${err.message}`);
        } else {
          resolve(output || '(no output)');
        }
      });
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private resolveAbsPath(relPath: string): string {
    if (!this.workspaceRoot) {
      throw new Error('No workspace folder is open');
    }
    // Prevent path traversal outside workspace
    const abs = path.resolve(this.workspaceRoot, relPath);
    if (!abs.startsWith(this.workspaceRoot)) {
      throw new Error(`Path "${relPath}" is outside the workspace`);
    }
    return abs;
  }
}
