import { normalizePath, toRepositoryRelativePath, isRelativeModuleSpecifier, getPathSegments } from './pathUtils';

describe('pathUtils', () => {
  describe('normalizePath', () => {
    it('replaces backslashes with forward slashes', () => {
      expect(normalizePath('C:\\path\\to\\file')).toBe('C:/path/to/file');
      expect(normalizePath('src\\utils\\logger.ts')).toBe('src/utils/logger.ts');
    });

    it('leaves forward slashes intact', () => {
      expect(normalizePath('src/utils/logger.ts')).toBe('src/utils/logger.ts');
    });
  });

  describe('toRepositoryRelativePath', () => {
    it('returns a relative path using forward slashes', () => {
      expect(toRepositoryRelativePath('C:/workspace', 'C:/workspace/src/index.ts')).toBe('src/index.ts');
    });
  });

  describe('isRelativeModuleSpecifier', () => {
    it('returns true for paths starting with dot', () => {
      expect(isRelativeModuleSpecifier('./logger')).toBe(true);
      expect(isRelativeModuleSpecifier('../utils/logger')).toBe(true);
    });

    it('returns true for paths starting with slash', () => {
      expect(isRelativeModuleSpecifier('/src/logger')).toBe(true);
    });

    it('returns false for module names', () => {
      expect(isRelativeModuleSpecifier('vscode')).toBe(false);
      expect(isRelativeModuleSpecifier('react')).toBe(false);
    });
  });

  describe('getPathSegments', () => {
    it('splits a path into segments', () => {
      expect(getPathSegments('src/utils/logger.ts')).toEqual(['src', 'utils', 'logger.ts']);
    });

    it('ignores empty segments', () => {
      expect(getPathSegments('/src//utils/logger.ts/')).toEqual(['src', 'utils', 'logger.ts']);
    });
  });
});
