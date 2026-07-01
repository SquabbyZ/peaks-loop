// Slice 0.5 Task 14 — peaks config {migrate,rollback,restore} integration test
// Spec reference: docs/superpowers/specs/2026-06-11-peaks-loop-l1-l2-l3-redesign.md §8
//
// Spec bug fixes baked into this test (deviation report in the slice PR):
//   #1 Entrypoint: spec wrote `dist/cli/program.js` (factory-only — no output).
//       The real CLI entrypoint is `bin/peaks.js`. Use `resolve(__dirname, '../../bin/peaks.js')`.
//   #2 stderr/stdout: `execSync` error object exposes `stderr`; the spec code
//       returned only `stdout` then asserted on `stderr`. Add `stderr` to the
//       return type, populate via `e.stderr ?? ''`.
//   #3 NO_BACKUP assertion: spec wrote `expect(stdout).toMatch(/NO_BACKUP/)`,
//       but the CLI writes the error to stderr. Use `expect(stderr).toMatch(/NO_BACKUP/)`.
//   #4 preferences.json schema: Task 12's `restoreField` filter test depends on
//       preferences.json having `schema_version: '2.0.0'`. Pre-populate the
//       project with valid preferences.json (not empty {}).

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

const CLI_BIN = resolve(__dirname, '../../bin/peaks.js');

let HOME_DIR: string;
const origHome = process.env.HOME;
const origUserProfile = process.env.USERPROFILE;

beforeEach(() => {
  HOME_DIR = mkdtempSync(join(tmpdir(), 'peaks-cfg-cli-home-'));
  process.env.HOME = HOME_DIR;
  process.env.USERPROFILE = HOME_DIR;
});
afterEach(() => {
  rmSync(HOME_DIR, { recursive: true, force: true });
  process.env.HOME = origHome;
  process.env.USERPROFILE = origUserProfile;
});

function cli(args: string, cwd: string): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execSync(`node ${CLI_BIN} ${args}`, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout: string; stderr: string; status: number };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.status ?? 1 };
  }
}

function makeProject(): string {
  const project = mkdtempSync(join(tmpdir(), 'peaks-cfg-cli-proj-'));
  mkdirSync(join(project, '.peaks'), { recursive: true });
  // Pre-populate preferences.json with valid schema_version (needed by Task 12 restoreField spec compliance)
  writeFileSync(join(project, '.peaks/preferences.json'), JSON.stringify({ schema_version: '2.0.0' }), 'utf8');
  return project;
}

function writeGlobal1x(obj: Record<string, unknown>): void {
  const dir = join(HOME_DIR, '.peaks');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify(obj), 'utf8');
}

describe('peaks config migrate', () => {
  test('dry-run reports plan, does not write', () => {
    writeGlobal1x({ version: '1.4.2', economyMode: true, swarmMode: false });
    const project = makeProject();
    try {
      const { stdout, code } = cli(`config migrate --project ${project} --dry-run --json`, project);
      expect(code).toBe(0);
      const out = JSON.parse(stdout);
      expect(out.ok).toBe(true);
      expect(out.data.applied).toBe(false);
      expect(out.data.willMigrateFields).toContain('economyMode');
      const cfg = readFileSync(join(HOME_DIR, '.peaks/config.json'), 'utf8');
      expect(cfg).toContain('1.4.2');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('apply slims config.json + writes preferences.json + creates .bak', () => {
    writeGlobal1x({ version: '1.4.2', economyMode: true, swarmMode: false, currentWorkspace: '/p' });
    const project = makeProject();
    try {
      const { stdout, code } = cli(`config migrate --project ${project} --apply --json`, project);
      expect(code).toBe(0);
      const out = JSON.parse(stdout);
      expect(out.data.applied).toBe(true);
      const newCfg = JSON.parse(readFileSync(join(HOME_DIR, '.peaks/config.json'), 'utf8'));
      expect(newCfg).toEqual({ version: '2.0.0', ocr: { llm: { url: '', authToken: '', model: '', useAnthropic: false, authHeader: 'authorization' } } });
      expect(existsSync(join(HOME_DIR, '.peaks/config.json.1.x.bak'))).toBe(true);
      const prefs = JSON.parse(readFileSync(join(project, '.peaks/preferences.json'), 'utf8'));
      expect(prefs.swarmMode).toBe(false);
      expect(prefs.economyMode).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe('peaks config rollback', () => {
  test('apply restores from .bak', () => {
    writeGlobal1x({ version: '1.4.2', economyMode: false });
    const project = makeProject();
    try {
      cli(`config migrate --project ${project} --apply`, project);
      const { code } = cli(`config rollback --apply --json`, project);
      expect(code).toBe(0);
      const restored = JSON.parse(readFileSync(join(HOME_DIR, '.peaks/config.json'), 'utf8'));
      expect(restored.version).toBe('1.4.2');
      expect(restored.economyMode).toBe(false);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('throws NO_BACKUP when no .bak', () => {
    writeGlobal1x({ version: '2.0.0' });
    const project = makeProject();
    try {
      const { code, stderr } = cli(`config rollback --apply --json`, project);
      expect(code).not.toBe(0);
      expect(stderr).toMatch(/NO_BACKUP/);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe('peaks config restore', () => {
  test('--list returns NO_BACKUP when no .bak', () => {
    const project = makeProject();
    try {
      const { code, stderr } = cli(`config restore --list --json`, project);
      expect(code).not.toBe(0);
      expect(stderr).toMatch(/NO_BACKUP/);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('apply restores language field to sidecar file', () => {
    writeGlobal1x({ version: '1.4.2', language: 'zh' });
    const project = makeProject();
    try {
      cli(`config migrate --project ${project} --apply`, project);
      const { code } = cli(`config restore --field language --apply --json`, project);
      expect(code).toBe(0);
      expect(existsSync(join(HOME_DIR, '.peaks/config.json.restore-language.json'))).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('throws RESTORE_GUARDED for workspaces field', () => {
    writeGlobal1x({ version: '1.4.2', workspaces: [] });
    const project = makeProject();
    try {
      cli(`config migrate --project ${project} --apply`, project);
      const { code, stderr } = cli(`config restore --field workspaces --apply --json`, project);
      expect(code).not.toBe(0);
      expect(stderr).toMatch(/RESTORE_GUARDED/);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
