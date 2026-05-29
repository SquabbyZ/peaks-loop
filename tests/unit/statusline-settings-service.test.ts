import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  applyStatusLineInstall,
  planStatusLineInstall,
  removeStatusLineInstall,
  STATUSLINE_COMMAND
} from '../../src/services/skills/statusline-settings-service.js';

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-statusline-settings-'));
}

function writeGitDir(root: string): void {
  mkdirSync(join(root, '.git'), { recursive: true });
}

function writeSettings(root: string, content: object): void {
  const claudeDir = join(root, '.claude');
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify(content, null, 2), 'utf8');
}

function readSettings(root: string): object {
  return JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf8'));
}

describe('planStatusLineInstall', () => {
  test('reports not installed when settings.json is absent', () => {
    const root = createTempDir();
    try {
      writeGitDir(root);
      const plan = planStatusLineInstall('project', root);
      expect(plan.exists).toBe(false);
      expect(plan.alreadyInstalled).toBe(false);
      expect(plan.conflict).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('reports already installed when statusLine contains peaks statusline', () => {
    const root = createTempDir();
    try {
      writeGitDir(root);
      writeSettings(root, { statusLine: { type: 'command', command: STATUSLINE_COMMAND } });
      const plan = planStatusLineInstall('project', root);
      expect(plan.alreadyInstalled).toBe(true);
      expect(plan.conflict).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('reports conflict when a different statusLine command is set', () => {
    const root = createTempDir();
    try {
      writeGitDir(root);
      writeSettings(root, { statusLine: { type: 'command', command: 'other-tool status' } });
      const plan = planStatusLineInstall('project', root);
      expect(plan.conflict).toBe(true);
      expect(plan.conflictCommand).toBe('other-tool status');
      expect(plan.alreadyInstalled).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('applyStatusLineInstall', () => {
  test('writes statusLine entry into empty settings.json', () => {
    const root = createTempDir();
    try {
      writeGitDir(root);
      const result = applyStatusLineInstall('project', root);
      expect(result.applied).toBe(true);
      const settings = readSettings(root);
      expect(settings).toHaveProperty('statusLine');
      expect((settings as any).statusLine.command).toBe(STATUSLINE_COMMAND);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('preserves other settings keys when merging', () => {
    const root = createTempDir();
    try {
      writeGitDir(root);
      writeSettings(root, { someOtherKey: 'preserved', nested: { value: 42 } });
      applyStatusLineInstall('project', root);
      const settings = readSettings(root) as any;
      expect(settings.someOtherKey).toBe('preserved');
      expect(settings.nested.value).toBe(42);
      expect(settings.statusLine.command).toBe(STATUSLINE_COMMAND);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('does not apply when already installed', () => {
    const root = createTempDir();
    try {
      writeGitDir(root);
      writeSettings(root, { statusLine: { type: 'command', command: STATUSLINE_COMMAND } });
      const result = applyStatusLineInstall('project', root);
      expect(result.applied).toBe(false);
      expect(result.alreadyInstalled).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('does not apply when conflict exists and force is false', () => {
    const root = createTempDir();
    try {
      writeGitDir(root);
      writeSettings(root, { statusLine: { type: 'command', command: 'other-tool' } });
      const result = applyStatusLineInstall('project', root);
      expect(result.applied).toBe(false);
      expect(result.conflict).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('overwrites conflict when force is true', () => {
    const root = createTempDir();
    try {
      writeGitDir(root);
      writeSettings(root, { statusLine: { type: 'command', command: 'other-tool' } });
      const result = applyStatusLineInstall('project', root, { force: true });
      expect(result.applied).toBe(true);
      const settings = readSettings(root) as any;
      expect(settings.statusLine.command).toBe(STATUSLINE_COMMAND);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects symlinked .claude directory', () => {
    const root = createTempDir();
    const target = createTempDir();
    try {
      writeGitDir(root);
      mkdirSync(join(target, '.claude'), { recursive: true });
      symlinkSync(join(target, '.claude'), join(root, '.claude'), 'dir');
      expect(() => applyStatusLineInstall('project', root)).toThrow('.claude directory must not be a symlink');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(target, { recursive: true, force: true });
    }
  });

  test('rejects symlinked settings.json', () => {
    const root = createTempDir();
    const target = createTempDir();
    try {
      writeGitDir(root);
      mkdirSync(join(root, '.claude'), { recursive: true });
      writeSettings(target, {});
      symlinkSync(join(target, '.claude', 'settings.json'), join(root, '.claude', 'settings.json'), 'file');
      expect(() => applyStatusLineInstall('project', root)).toThrow('settings.json must not be a symlink');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(target, { recursive: true, force: true });
    }
  });

  test('creates .claude directory when absent', () => {
    const root = createTempDir();
    try {
      writeGitDir(root);
      applyStatusLineInstall('project', root);
      expect(existsSync(join(root, '.claude'))).toBe(true);
      expect(existsSync(join(root, '.claude', 'settings.json'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('removeStatusLineInstall', () => {
  test('removes statusLine key and preserves other keys', () => {
    const root = createTempDir();
    try {
      writeGitDir(root);
      writeSettings(root, { statusLine: { type: 'command', command: STATUSLINE_COMMAND }, otherKey: 'kept' });
      const result = removeStatusLineInstall('project', root);
      expect(result.removed).toBe(true);
      const settings = readSettings(root) as any;
      expect(settings).not.toHaveProperty('statusLine');
      expect(settings.otherKey).toBe('kept');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('returns removed: false when statusLine is absent', () => {
    const root = createTempDir();
    try {
      writeGitDir(root);
      writeSettings(root, { otherKey: 'value' });
      const result = removeStatusLineInstall('project', root);
      expect(result.removed).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('returns removed: false when settings.json does not exist', () => {
    const root = createTempDir();
    try {
      writeGitDir(root);
      const result = removeStatusLineInstall('project', root);
      expect(result.removed).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('does not remove non-Peaks statusLine commands', () => {
    const root = createTempDir();
    try {
      writeGitDir(root);
      writeSettings(root, { statusLine: { type: 'command', command: 'other-tool status' } });
      const result = removeStatusLineInstall('project', root);
      expect(result.removed).toBe(false);
      const settings = readSettings(root) as any;
      expect(settings.statusLine.command).toBe('other-tool status');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
