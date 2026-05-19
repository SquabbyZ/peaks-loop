import * as nodeFs from 'node:fs';
import { mkdirSync, realpathSync, rmSync } from 'node:fs';
import { describe, expect, test, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getTempDir, isInsidePath, isWindowsAbsolutePath, localPath, normalizePath, pathsEqual, resolveInputPath, stablePath } from '../../src/shared/path-utils.js';

describe('normalizePath', () => {
  test('converts backslashes to forward slashes', () => {
    expect(normalizePath('C:\\Users\\foo')).toBe('C:/Users/foo');
  });

  test('keeps forward slashes unchanged', () => {
    expect(normalizePath('/home/foo')).toBe('/home/foo');
  });
});

describe('pathsEqual', () => {
  test('returns true for same paths', () => {
    expect(pathsEqual('/foo/bar', '/foo/bar')).toBe(true);
  });

  test('returns true for paths with different separators', () => {
    expect(pathsEqual('/foo/bar', '\\foo\\bar')).toBe(true);
  });

  test('returns false for different paths', () => {
    expect(pathsEqual('/foo/bar', '/foo/baz')).toBe(false);
  });
});

describe('localPath', () => {
  test('converts to backslashes for Windows', () => {
    expect(localPath('C:/Users/foo', 'win32')).toBe('C:\\Users\\foo');
  });

  test('keeps forward slashes for non-Windows platforms', () => {
    expect(localPath('C:/Users/foo', 'darwin')).toBe('C:/Users/foo');
    expect(localPath('C:/Users/foo', 'linux')).toBe('C:/Users/foo');
  });
});

describe('isInsidePath', () => {
  test('accepts a child path inside a parent path', () => {
    expect(isInsidePath('/project/src/file.ts', '/project')).toBe(true);
  });

  test('accepts the parent path itself', () => {
    expect(isInsidePath('/project', '/project')).toBe(true);
  });

  test('rejects a sibling path outside the parent path', () => {
    expect(isInsidePath('/project-other/file.ts', '/project')).toBe(false);
  });
});

describe('Windows input path helpers', () => {
  test('detects drive-letter absolute paths with either separator', () => {
    expect(isWindowsAbsolutePath('C:/Users/foo')).toBe(true);
    expect(isWindowsAbsolutePath('C:\\Users\\foo')).toBe(true);
    expect(isWindowsAbsolutePath('/Users/foo')).toBe(false);
  });

  test('keeps Windows absolute paths stable on non-Windows hosts', () => {
    expect(resolveInputPath('C:\\Users\\foo')).toBe('C:/Users/foo');
  });
});

describe('stablePath', () => {
  test('resolves through the deepest existing parent for missing descendants', () => {
    const root = join(tmpdir(), `peaks-path-utils-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const existing = join(root, 'existing');

    try {
      mkdirSync(existing, { recursive: true });

      expect(stablePath(join(existing, 'missing', 'file.txt'))).toBe(join(realpathSync(existing), 'missing', 'file.txt'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('returns a rooted path when no existing parent is found before the filesystem root', () => {
    expect(stablePath('/missing-root/file.txt')).toBe(resolve('/missing-root/file.txt'));
  });

  test('uses parsed root when filesystem existence changes during stable path resolution', async () => {
    vi.resetModules();
    vi.doMock('node:fs', () => ({
      ...nodeFs,
      existsSync: () => false
    }));
    try {
      const mockedPathUtils = await import('../../src/shared/path-utils.js');
      expect(mockedPathUtils.stablePath('/volatile/path')).toBe(resolve('/volatile/path'));
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });

  test('returns the resolved Windows-style path when no parent exists on the host', () => {
    expect(stablePath('C:/missing-root/file.txt')).toBe(resolve('C:/missing-root/file.txt'));
  });
});

describe('getTempDir', () => {
  test('returns TEMP from process.env when no override is provided', () => {
    const previousTemp = process.env.TEMP;
    process.env.TEMP = 'C:\\Temp';

    expect(getTempDir()).toBe('C:\\Temp');

    if (previousTemp === undefined) {
      delete process.env.TEMP;
    } else {
      process.env.TEMP = previousTemp;
    }
  });

  test('returns TEMP when override env has TEMP', () => {
    expect(getTempDir({ env: { TEMP: 'C:\\Temp' } as NodeJS.ProcessEnv })).toBe('C:\\Temp');
  });

  test('returns TMP when TEMP is missing', () => {
    expect(getTempDir({ env: { TMP: '/tmp/custom' } as NodeJS.ProcessEnv })).toBe('/tmp/custom');
  });

  test('falls back to the system temp directory', () => {
    expect(getTempDir({ env: {} as NodeJS.ProcessEnv })).toBe(tmpdir());
  });
});
