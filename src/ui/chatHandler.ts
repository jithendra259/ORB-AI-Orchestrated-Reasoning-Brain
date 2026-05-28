import type { RepositoryIntelligenceSnapshot } from '../scanner';
import type { OrbLogger } from '../utils/logger';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export class OrbAiChatHandler {
  private messages: ChatMessage[] = [];
  private snapshot: RepositoryIntelligenceSnapshot | undefined;

  constructor(
    private logger: OrbLogger,
  ) {}

  public setSnapshot(snapshot: RepositoryIntelligenceSnapshot | undefined): void {
    this.snapshot = snapshot;
  }

  public addMessage(content: string): void {
    this.messages.push({
      role: 'user',
      content,
      timestamp: Date.now(),
    });
  }

  public async generateResponse(userMessage: string): Promise<string> {
    try {
      // For now, simply echo the user's message to verify the chat round‑trip works.
      // This satisfies the requirement: UI should show "ORB AI received: hello" when the user types "hello".
      const response = `ORB AI received: ${userMessage}`;

      this.messages.push({
        role: 'assistant',
        content: response,
        timestamp: Date.now(),
      });

      return response;
    } catch (error) {
      this.logger.error('Failed to generate chat response', error);
      return 'I encountered an error processing your request. Please try again.';
    }
  }

  private extractIntent(message: string): string {
    const lower = message.toLowerCase();

    if (lower.includes('scan') || lower.includes('analyze')) {
      return 'scan';
    }
    if (lower.includes('framework') || lower.includes('tech stack')) {
      return 'frameworks';
    }
    if (lower.includes('language') || lower.includes('language used')) {
      return 'languages';
    }
    if (lower.includes('dependency') || lower.includes('import') || lower.includes('export')) {
      return 'dependencies';
    }
    if (lower.includes('file') || lower.includes('structure')) {
      return 'structure';
    }
    if (lower.includes('entry') || lower.includes('main')) {
      return 'entry';
    }

    return 'general';
  }

  private buildContextualResponse(intent: string, userMessage: string): string {
    if (!this.snapshot) {
      return 'Repository intelligence is not yet available. Try scanning your repository first by clicking the "Scan Repository" button.';
    }

    const { summary } = this.snapshot;

    switch (intent) {
      case 'scan':
        return this.respondToScan(summary);
      case 'frameworks':
        return this.respondToFrameworks(summary);
      case 'languages':
        return this.respondToLanguages(summary);
      case 'dependencies':
        return this.respondToDependencies(summary);
      case 'structure':
        return this.respondToStructure(summary);
      case 'entry':
        return this.respondToEntryPoints(summary);
      default:
        return this.respondGeneral(userMessage, summary);
    }
  }

  private respondToScan(summary: any): string {
    return `Your repository has ${summary.totalFiles} files across ${summary.totalFolders} folders. ` +
      `I found ${summary.internalDependencyCount} internal dependencies and ${summary.exportCount} exports. ` +
      `Run a fresh scan anytime to update the analysis.`;
  }

  private respondToFrameworks(summary: any): string {
    if (summary.detectedFrameworks.length === 0) {
      return 'No frameworks detected yet. Try scanning your repository to identify the tech stack.';
    }

    const frameworks = summary.detectedFrameworks
      .slice(0, 5)
      .map((f: any) => `${f.framework}${f.version ? ` (${f.version})` : ''} (${Math.round(f.confidence * 100)}%)`)
      .join(', ');

    return `I detected the following frameworks: ${frameworks}. These are the primary technologies used in your repository.`;
  }

  private respondToLanguages(summary: any): string {
    if (summary.languagesUsed.length === 0) {
      return 'No language data available yet. Scan your repository to analyze programming languages.';
    }

    const languages = summary.languagesUsed
      .slice(0, 5)
      .map((l: any) => `${l.language} (${l.files} files)`)
      .join(', ');

    return `Your repository uses: ${languages}. These are the primary programming languages in your project.`;
  }

  private respondToDependencies(summary: any): string {
    if (summary.internalDependencyCount === 0) {
      return 'No internal dependencies found. Your repository might have a simple structure with minimal module coupling.';
    }

    return `Your repository has ${summary.internalDependencyCount} internal dependencies and ` +
      `${summary.externalDependencyCount} external dependencies. This indicates a moderately complex module structure.`;
  }

  private respondToStructure(summary: any): string {
    return `Your repository structure includes ${summary.totalFolders} folders and ${summary.totalFiles} files. ` +
      `${summary.importantEntryPoints.length} important entry points were identified. ` +
      `The average module exports ${Math.round(summary.exportCount / Math.max(summary.internalDependencyCount, 1))} targets.`;
  }

  private respondToEntryPoints(summary: any): string {
    if (summary.importantEntryPoints.length === 0) {
      return 'No entry points identified yet. Common entry points are main files, index.ts, or files with primary exports.';
    }

    const entries = summary.importantEntryPoints
      .slice(0, 3)
      .map((e: any) => `${e.path} (${e.type})`)
      .join(', ');

    return `Key entry points: ${entries}. These are the main files your application uses for initialization and exports.`;
  }

  private respondGeneral(userMessage: string, summary: any): string {
    // Provide a helpful overview
    return `I'm ORB AI, your repository intelligence assistant. I can help you understand your codebase. ` +
      `Your repo has ${summary.totalFiles} files with ${summary.detectedFrameworks.length} detected frameworks. ` +
      `Try asking me about frameworks, languages, dependencies, or file structure!`;
  }

  public getMessageHistory(): ChatMessage[] {
    return [...this.messages];
  }

  public clearHistory(): void {
    this.messages = [];
  }
}
