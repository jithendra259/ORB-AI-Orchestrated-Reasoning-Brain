import * as vscode from 'vscode';

export interface OrbLogger {
  info(message: string, details?: unknown): void;
  warn(message: string, details?: unknown): void;
  error(message: string, details?: unknown): void;
  appendLine(message: string): void;
  clear(): void;
  show(): void;
}

export class OutputChannelOrbLogger implements OrbLogger {
  public constructor(private readonly outputChannel: vscode.OutputChannel) {}

  public info(message: string, details?: unknown): void {
    this.write('INFO', message, details);
  }

  public warn(message: string, details?: unknown): void {
    this.write('WARN', message, details);
  }

  public error(message: string, details?: unknown): void {
    this.write('ERROR', message, details);
  }

  public appendLine(message: string): void {
    this.outputChannel.appendLine(message);
  }

  public clear(): void {
    this.outputChannel.clear();
  }

  public show(): void {
    this.outputChannel.show(true);
  }

  private write(level: 'INFO' | 'WARN' | 'ERROR', message: string, details?: unknown): void {
    const timestamp = new Date().toISOString();
    this.outputChannel.appendLine(`[${timestamp}] [${level}] ${message}`);

    if (details !== undefined) {
      this.outputChannel.appendLine(this.formatDetails(details));
    }
  }

  private formatDetails(details: unknown): string {
    if (details instanceof Error) {
      return `${details.name}: ${details.message}\n${details.stack ?? ''}`.trim();
    }

    if (typeof details === 'string') {
      return details;
    }

    try {
      return JSON.stringify(details, null, 2);
    } catch {
      return String(details);
    }
  }
}

