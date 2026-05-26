# ORB AI - Orchestrated Reasoning Brain

A VS Code extension that acts as an intelligent reasoning agent, capable of scanning repositories, analyzing code structure, and providing orchestrated intelligence for developers.

## Features

- Repository scanning and analysis
- Framework detection
- Dependency graph visualization
- Code context retrieval
- Intelligent agent orchestration

## Getting Started

### Prerequisites

- Node.js (LTS)
- VS Code (latest)
- npm

### Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Build the extension:
   ```bash
   npm run esbuild
   ```

3. Run in development mode:
   - Press `F5` to launch the Extension Development Host

### Testing

```bash
npm test
```

## Architecture

```
orb-ai/
├── src/
│   ├── extension.ts       # Extension entry point
│   ├── scanner/           # Repository scanning
│   ├── agents/            # Intelligent agents
│   ├── graph/             # Dependency graph
│   ├── retrieval/         # Code retrieval
│   └── ui/                # UI components
├── dist/                  # Compiled output
└── package.json
```

## License

MIT