import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assertSafeSettingsFile, isInsidePath } from '../../../../src/services/ide/shared/safe-path.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'peaks-safe-path-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('isInsidePath', () => {
  test('returns true when child equals parent', () => {
    const dir = join(tmpRoot, 'a');
    mkdirSync(dir, { recursive: true });
    expect(isInsidePath(dir, dir)).toBe(true);
  });

  test('returns true when child is nested under parent', () => {
    const parent = join(tmpRoot, 'a');
    const child = join(parent, 'b', 'c.json');
    expect(isInsidePath(child, parent)).toBe(true);
  });

  test('returns false when child is a sibling of parent', () => {
    const parent = join(tmpRoot, 'a');
    const child = join(tmpRoot, 'b');
    expect(isInsidePath(child, parent)).toBe(false);
  });

  test('returns false when child escapes via ".."', () => {
    const parent = join(tmpRoot, 'a');
    const child = join(parent, '..', 'b');
    expect(isInsidePath(child, parent)).toBe(false);
  });
});

describe('assertSafeSettingsFile', () => {
  test('returns the resolved settings path when no file exists', () => {
    const result = assertSafeSettingsFile('project', tmpRoot, '.claude', 'settings.json');
    expect(result.settingsPath).toBe(join(tmpRoot, '.claude', 'settings.json'));
    expect(existsSync(result.settingsPath)).toBe(false);
  });

  test('returns the resolved settings path when the file exists and is safe', () => {
    const dir = join(tmpRoot, '.claude');
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, 'settings.json');
    writeFileSync(filePath, '{}', 'utf8');
    const result = assertSafeSettingsFile('project', tmpRoot, '.claude', 'settings.json');
    expect(result.settingsPath).toBe(filePath);
  });

  test('throws when the settings directory is a symlink', () => {
    const realDir = join(tmpRoot, 'real-claude');
    mkdirSync(realDir, { recursive: true });
    const linkDir = join(tmpRoot, '.claude');
    try {
      symlinkSync(realDir, linkDir, 'dir');
    } catch {
      // Windows without developer mode: skip the assertion
      return;
    }
    expect(() => assertSafeSettingsFile('project', tmpRoot, '.claude', 'settings.json')).toThrow(
      /must not be a symlink/
    );
  });

  test('throws when the settings file is a symlink', () => {
    const realFile = join(tmpRoot, 'real.json');
    writeFileSync(realFile, '{}', 'utf8');
    const dir = join(tmpRoot, '.claude');
    mkdirSync(dir, { recursive: true });
    const linkFile = join(dir, 'settings.json');
    try {
      symlinkSync(realFile, linkFile, 'file');
    } catch {
      return;
    }
    expect(() => assertSafeSettingsFile('project', tmpRoot, '.claude', 'settings.json')).toThrow(
      /must not be a symlink/
    );
  });

  test('does not throw when the directory does not exist yet', () => {
    expect(() => assertSafeSettingsFile('global', tmpRoot, '.claude', 'settings.json')).not.toThrow();
  });
});
