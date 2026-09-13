/**
 * `peaks workspace init --project .` with a cwd of `$HOME` — the default
 * position of a freshly opened terminal — used to materialize a whole project
 * tree into the user's home directory. The worst of it was
 * `$HOME/.claude/settings.local.json`: a live harness config file, shared with
 * every project on the machine and read by every Claude Code session. There was
 * a real incident (`C:\Users\smallMark\.claude\settings.local.json`, since
 * deleted), and the previous slice guarded only the harness-window writer.
 *
 * These cases drive the REAL CLI entry (`bin/peaks.js`, i.e. `dist/`) against a
 * fake `$HOME`, which is the only way to exercise `os.homedir()` as the CLI
 * sees it. Both `HOME` and `USERPROFILE` are set because `os.homedir()` prefers
 * `USERPROFILE` on win32 and `HOME` elsewhere.
 *
 * The second case is the one that must keep passing: a project INSIDE the home
 * directory (`~/my-project`) is an ordinary project. A guard that refused it
 * would be worse than the defect.
 *
 * Run with: pnpm exec vitest run --config vitest.config.integration.ts tests/integration/workspace-init-home-guard.test.ts
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

const BIN = resolve(__dirname, '../../bin/peaks.js');
const BIN_TIMEOUT_MS = 120_000;

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots) {
    try {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
  tmpRoots.length = 0;
});

/** A directory to act as the user's home for the child process. */
function makeFakeHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'peaks-fake-home-'));
  tmpRoots.push(home);
  return home;
}

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

function runCli(args: readonly string[], cwd: string, fakeHome: string): RunResult {
  try {
    const stdout = execFileSync('node', [BIN, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: BIN_TIMEOUT_MS,
      env: {
        ...process.env,
        // Both, because `os.homedir()` prefers USERPROFILE on win32 and HOME
        // everywhere else. Setting only one would test the guard against a home
        // directory the child never uses.
        HOME: fakeHome,
        USERPROFILE: fakeHome,
        PEAKS_CALLER_ID: 'workspace-init-home-guard-e2e'
      }
    }).toString('utf8');
    return { stdout, stderr: '', code: 0 };
  } catch (error: unknown) {
    const caught = error as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    return {
      stdout: typeof caught.stdout === 'string' ? caught.stdout : caught.stdout?.toString('utf8') ?? '',
      stderr: typeof caught.stderr === 'string' ? caught.stderr : caught.stderr?.toString('utf8') ?? '',
      code: caught.status ?? 1
    };
  }
}

function envelopeOf(result: RunResult): { ok: boolean; code?: string; message?: string; nextActions: readonly string[] } {
  const combined = `${result.stdout}\n${result.stderr}`;
  const start = combined.indexOf('{');
  expect(start, `no JSON envelope in output:\n${combined}`).toBeGreaterThanOrEqual(0);
  return JSON.parse(combined.slice(start)) as { ok: boolean; code?: string; message?: string; nextActions: readonly string[] };
}

describe('peaks workspace init refuses to write into the home directory', () => {
  test('--project . with cwd=$HOME is refused and creates no project tree', () => {
    const home = makeFakeHome();
    const result = runCli(['workspace', 'init', '--project', '.', '--json'], home, home);

    expect(result.code).toBe(1);
    const envelope = envelopeOf(result);
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('UNSAFE_PROJECT_ROOT');
    expect(envelope.nextActions.length).toBeGreaterThan(0);

    // Every artifact the unguarded command created in the incident. Asserted
    // individually (not as "the directory is empty") because `$HOME/.peaks/logs`
    // is the USER-level peaks log directory — any peaks command creates it, it
    // is the same `~/.peaks/` that holds the user's `config.json`, and it is not
    // what this guard is about.
    for (const artifact of [
      join(home, '.claude', 'settings.local.json'),
      join(home, '.peaks', '.claude-settings-template.json'),
      join(home, '.peaks', '_runtime'),
      join(home, '.peaks', 'project-scan'),
      join(home, '.peaks', '.peaks-init-hooks-decision.json'),
      join(home, '.gitignore'),
      join(home, '.codegraph')
    ]) {
      expect(existsSync(artifact), `${artifact} must not exist`).toBe(false);
    }
  }, BIN_TIMEOUT_MS);

  test('a project INSIDE the home directory is still initialized normally', () => {
    const home = makeFakeHome();
    const project = join(home, 'my-project');
    mkdirSync(project, { recursive: true });

    const result = runCli(['workspace', 'init', '--project', project, '--json'], home, home);

    expect(result.code).toBe(0);
    const envelope = envelopeOf(result);
    expect(envelope.ok).toBe(true);
    // The guard is EXACT-home only: `~/my-project` is an ordinary project and
    // must keep getting a real workspace, or the fix would be worse than the
    // defect.
    expect(existsSync(join(project, '.peaks', '_runtime'))).toBe(true);
    expect(existsSync(join(project, '.claude', 'settings.local.json'))).toBe(true);
  }, BIN_TIMEOUT_MS);
});
