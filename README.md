# ORB AI - Orchestrated Reasoning Brain

A VS Code extension that acts as an intelligent reasoning agent, capable of scanning repositories, analyzing code structure, providing orchestrated intelligence, and engaging in context-aware chat conversations about your codebase.

## Features

- **Repository Scanning & Analysis** - Comprehensive codebase analysis
- **Framework Detection** - Identifies frameworks and tech stack
- **Sidebar Chat Interface** - Intelligent AI assistant in VS Code sidebar
- **Repository Intelligence** - Context-aware chat using your codebase
- **Dependency Graph Visualization** - Visual representation of module dependencies
- **Code Context Retrieval** - Smart code analysis and retrieval
- **Intelligent Agent Orchestration** - Multi-purpose reasoning capabilities
- **Dark Mode Support** - Seamless VS Code theme integration

## Quick Start

### Installation & Setup

```bash
# Clone the repository
git clone https://github.com/jithendra259/ORB-AI-Orchestrated-Reasoning-Brain.git
cd ORB-AI-Orchestrated-Reasoning-Brain

# Install dependencies
npm install

# Build the extension
npm run compile
```

### Launch in VS Code

1. Press `F5` to open Extension Development Host
2. Click the ORB AI icon in the Activity Bar (left sidebar)
3. Click "Scan Repository" to analyze your codebase
4. Start chatting! Ask questions like:
   - "What frameworks are detected?"
   - "What languages do I use?"
   - "Tell me about dependencies"
   - "What are the entry points?"

## Chat Interface Guide

For detailed chat interface documentation, see [CHAT_INTERFACE_GUIDE.md](./CHAT_INTERFACE_GUIDE.md)

### Quick Chat Examples

```
User: What frameworks are in my repo?
ORB AI: I detected React (87%), TypeScript (95%), and Webpack (78%).

User: How many files?
ORB AI: Your repository has 156 files across 23 folders.

User: Tell me about dependencies
ORB AI: Found 43 internal and 28 external dependencies.
```

## Development

### Available Scripts

```bash
# Compile in development mode
npm run compile

# Watch mode - recompile on changes
npm run watch

# Package for production
npm run package

# Run linter
npm run lint

# Full test suite
npm run test

# Type-check only
npm run test-compile
```

### Debugging

1. Press `F5` to start Extension Development Host
2. Use VS Code debugger to set breakpoints
3. Check "ORB AI Logs" in Output panel for logs
4. Use browser DevTools on webview (F12 in sidebar)

## Architecture

```
src/
├── extension.ts                    # Extension entry point
├── ui/
│   ├── orbAiViewProvider.ts       # Sidebar webview provider
│   ├── chatHandler.ts             # Chat logic & responses
│   ├── sidebarChatService.ts      # Service wrapper
│   ├── repositoryGraphPanel.ts    # Graph visualization
│   └── html.ts                     # HTML utilities
├── scanner/
│   ├── index.ts
│   ├── commands.ts                # Command handlers
│   ├── frameworkDetector.ts       # Framework detection
│   ├── repositoryScanner.ts       # Core scanner
│   ├── repositoryIntelligenceService.ts
│   ├── sourceParser.ts
│   ├── summaryGenerator.ts
│   └── types.ts
├── graph/
│   └── index.ts                   # Graph models
├── agents/
│   └── index.ts                   # Future agent system
└── utils/
    ├── logger.ts                  # Logging utilities
    └── pathUtils.ts               # Path helpers
```

## Commands

- `ORB AI: Open Chat` - Open the chat sidebar
- `ORB AI: Scan Repository` - Analyze your repository
- `ORB AI: Show Repository Graph` - Display dependency graph
- `ORB AI: Analyze Current File` - Analyze the active editor file
- `ORB AI: Open ORB AI Panel` - Open the main panel

## Testing

```bash
npm test
```

## License

MIT