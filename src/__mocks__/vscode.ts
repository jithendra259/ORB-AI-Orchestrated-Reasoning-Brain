const vscode = {
  workspace: {
    getConfiguration: jest.fn().mockReturnValue({
      get: jest.fn((key: string) => {
        if (key === 'provider') return 'nvidia';
        return undefined;
      }),
      update: jest.fn()
    }),
    onDidChangeConfiguration: jest.fn()
  },
  window: {
    createOutputChannel: jest.fn().mockReturnValue({
      appendLine: jest.fn(),
      append: jest.fn(),
      clear: jest.fn(),
      show: jest.fn(),
      hide: jest.fn(),
      dispose: jest.fn()
    }),
    showInformationMessage: jest.fn(),
    showErrorMessage: jest.fn(),
    showWarningMessage: jest.fn()
  },
  Uri: {
    file: jest.fn((path: string) => ({ fsPath: path, path }))
  },
  commands: {
    registerCommand: jest.fn(),
    executeCommand: jest.fn()
  },
  TreeItem: class {},
  EventEmitter: class {
    fire = jest.fn();
    event = jest.fn();
  }
};

module.exports = vscode;
