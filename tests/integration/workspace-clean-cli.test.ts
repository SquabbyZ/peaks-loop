import { existsSync } from 'node:fs';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { describe, expect, test } from 'vitest';

const CLI_BIN = resolve(__dirname, '../../bin/peaks.js');

// Snapshot the spawn env at module load. Strip HOME/USERPROFILE so that any
// prior vitest-side `vi.stubEnv('HOME', ...)` (e.g. from artifact-setup.test.ts)
// does NOT leak into spawned CLI children. Without this, `os.homedir()` in the
// child would read the stubbed HOME and `resolveCanonicalProjectRoot` would
// walk past the test tmpdir into the real user home — making cleanup operate
// on the wrong directory and producing `deleted: []`. See
// `.peaks/memory/2026-06-22-workspace-clean-cli-flake-bisected.md`.
const SPAWN_ENV: NodeJS.ProcessEnv = (() => {
  const env = { ...process.env };
  delete env.HOME;
  delete env.USERPROFILE;
  return env;
})();

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-ws-cli-'));
}

function cli(args: string, cwd: string): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execSync(`node ${CLI_BIN} ${args}`, {
      cwd,
      env: SPAWN_ENV,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout: string; stderr: string; status: number };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.status ?? 1 };
  }
}

function touchDir(path: string, ageHours: number): void {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'marker.txt'), 'x', 'utf8');
  const past = new Date(Date.now() - ageHours * 3600 * 1000);
  utimesSync(path, past, past);
  utimesSync(join(path, 'marker.txt'), past, past);
}

describe('peaks workspace clean CLI', () => {
  test('peaks workspace clean --runtime reports JSON envelope with dry-run default', () => {
    const project = makeProject();
    try {
      touchDir(join(project, '.peaks/_runtime/2026-06-10-session-aaa111'), 100);
      const { stdout, code } = cli(`workspace clean --older-than 1 --json`, project);
      expect(code).toBe(0);
      const out = JSON.parse(stdout);
      expect(out.ok).toBe(true);
      expect(out.data.dryRun).toBe(true);
      expect(out.data.deleted).toEqual(['2026-06-10-session-aaa111']);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('peaks workspace clean --runtime --apply actually deletes', () => {
    const project = makeProject();
    try {
      const sid = '2026-06-10-session-aaa111';
      touchDir(join(project, '.peaks/_runtime', sid), 100);
      const { stdout, code } = cli(`workspace clean --older-than 1 --apply --json`, project);
      expect(code).toBe(0);
      const out = JSON.parse(stdout);
      expect(out.data.dryRun).toBe(false);
      expect(existsSync(join(project, '.peaks/_runtime', sid))).toBe(false);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('peaks workspace clean --sub-agents --invalid is no longer accepted (option removed)', () => {
    const project = makeProject();
    try {
      // The --sub-agents and --invalid flags were removed in slice
      // 2026-06-27-archive-feature-removal. Commander should reject the
      // unknown option with a non-zero exit. We verify the binary does
      // not silently accept it (which would indicate a regression).
      const { code, stderr } = cli(`workspace clean --sub-agents --invalid --apply --json`, project);
      expect(code).not.toBe(0);
      expect(stderr.toLowerCase()).toMatch(/unknown option|--sub-agents|--invalid/);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
