import type { ToolDefinition } from '../ai/types';

/**
 * The canonical set of tools available to the ORB AI agent.
 * All tools use the OpenAI-compatible function-calling schema.
 */
export const ALL_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the full text content of a file in the workspace. Use this to inspect source code, config files, or any text file before making changes.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative path from workspace root, e.g. "src/utils/logger.ts"',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write or overwrite a file with new content. Always read the file first before writing. This will be shown to the user for approval before executing.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative path from workspace root, e.g. "src/newFeature.ts"',
          },
          content: {
            type: 'string',
            description: 'The full new content to write to the file.',
          },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_file',
      description: 'Create a brand new file at the given path with the given content. Only use this for files that do not exist yet.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative path for the new file, e.g. "src/newModule.ts"',
          },
          content: {
            type: 'string',
            description: 'The initial content for the new file.',
          },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List all files and sub-directories inside a directory. Use "." for the workspace root.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative path from workspace root to list, e.g. "src" or "."',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_code',
      description: 'Search for a text pattern or keyword across all files in the workspace. Returns matching file paths and lines.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The text string or pattern to search for.',
          },
          include: {
            type: 'string',
            description: 'Optional glob pattern to filter files, e.g. "**/*.ts" or "src/**"',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_terminal',
      description: 'Execute a shell command in the workspace root and return its output. Examples: "npm test", "git status", "npm run build". This requires user approval in safe mode.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The shell command to run, e.g. "npm run test" or "git log --oneline -5"',
          },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Delete a file from the workspace. This is irreversible and always requires user approval.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative path of the file to delete, e.g. "src/oldFile.ts"',
          },
        },
        required: ['path'],
      },
    },
  },
];

/** Tools that require explicit user approval in safe mode */
export const APPROVAL_REQUIRED_TOOLS = new Set(['write_file', 'create_file', 'run_terminal', 'delete_file']);

/** Tools that are read-only (never require approval) */
export const READ_ONLY_TOOLS = new Set(['read_file', 'list_dir', 'search_code']);

export function getToolByName(name: string): ToolDefinition | undefined {
  return ALL_TOOLS.find(t => t.function.name === name);
}
