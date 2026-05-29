/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^vscode$': '<rootDir>/src/__mocks__/vscode.ts'
  },
  testMatch: ['**/?(*.)+(spec|test).[t]s?(x)'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.json'
    }]
  }
};
