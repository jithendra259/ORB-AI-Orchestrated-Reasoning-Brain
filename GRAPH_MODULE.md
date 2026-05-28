# ORB AI - Graph Module Implementation

## Overview
The Graph module has been implemented to analyze code dependencies, detect circular dependencies, and identify key files in your codebase.

## New Command: `orb-ai.analyzeDependencies`

### Features
- **Dependency Graph Construction**: Parses import/require statements across TypeScript, JavaScript, Python, Go, and Rust files
- **Circular Dependency Detection**: Uses DFS algorithm to find problematic circular imports
- **Hub Identification**: Identifies the most connected files in your codebase
- **Multi-language Support**: Handles ES6 imports, CommonJS requires, Python imports, and Go imports

### How to Use
1. Open a workspace in VS Code
2. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
3. Type "ORB AI: Analyze Dependencies"
4. View results in the Output Channel

### Output Example
```
--- ORB AI: Dependency Graph Analysis ---
Total Nodes: 45
Total Edges: 78

🔗 Top 5 Most Connected Files:
   - src/utils/helpers.ts (12 imports)
   - src/components/Button.tsx (8 imports)
   - src/api/client.ts (7 imports)
   - src/store/index.ts (6 imports)
   - src/hooks/useAuth.ts (5 imports)

⚠️ Circular Dependencies Detected:
   Cycle #1: src/a.ts -> src/b.ts -> src/c.ts -> src/a.ts

-----------------------------------------
```

## Architecture

### Files Created
- `src/graph/builder.ts` - Core graph building logic
  - `GraphBuilder` class
  - Import parsing with regex patterns
  - Path resolution for local imports
  - Cycle detection algorithm
  
- `src/graph/commands.ts` - VS Code command integration
  - `analyzeDependencies()` command handler
  - Progress reporting
  - Formatted output generation

### Integration Points
- Updated `src/extension.ts` to register the new command
- Updated `package.json` to expose the command in the UI
- Shares output channel with scanner module for unified logging

## Technical Details

### Supported Import Patterns
- ES6: `import X from '...'`, `import { X } from '...'`
- CommonJS: `require('...')`
- Python: `import ...`, `from ... import ...`
- Go: `import "..."`

### Path Resolution Strategy
1. Try exact file match
2. Try adding common extensions (.ts, .tsx, .js, .jsx, .py, .go, .rs)
3. Try index files in directories

### Performance Considerations
- Skips files larger than 500KB
- Ignores node_modules, .git, dist, build, coverage directories
- Efficient DFS cycle detection with O(V+E) complexity

## Next Steps
Consider implementing:
- Interactive graph visualization using webviews
- Export graph to DOT/GraphML format
- Integration with AI agents for refactoring suggestions
- Real-time dependency monitoring on file save
