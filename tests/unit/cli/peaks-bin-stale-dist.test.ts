// tests/unit/cli/peaks-bin-stale-dist.test.ts
//
// Slice 2026-09-10-three-fixes (Slice 1) — `bin/peaks.js` must fail
// FRIENDLY when the local dist is stale.
//
// Reproduced 3× in one session: `scripts/sync-version.mjs` (run by
// `npm run build` / `pretest` / `prepublish`) unlinks
// `packages/peaks-loop-shared/dist/version.js`, so every
// `node bin/peaks.js <anything>` died with a raw ERR_MODULE_NOT_FOUND
// before any CLI code ran. The shim now converts exactly that class of
// failure — a missing INTERNAL specifier (workspace package or any
// `dist/` artifact) — into an actionable message + non-zero exit, and
// rethrows every other resolution error unchanged.
//
// Dimensions covered:
//   - render:     the friendly message shape (missing specifier + fix line)
//   - behavior:   exit codes + argv passthrough on the happy path; raw
//                 rethrow for a third-party miss
//   - integration: real `node` subprocess against real tmp dirs on disk
//   - a11y:       the message is the human-visible surface (what to run next)
//
// Run with: pnpm vitest run tests/unit/cli/peaks-bin-stale-dist.test.ts

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const REAL_BIN = resolve(REPO_ROOT, 'bin', 'peaks.js');
const REAL_DIST_ENTRY = resolve(REPO_ROOT, 'dist', 'cli', 'index.js');

declareDimensions('tests/unit/cli/peaks-bin-stale-dist.test.ts', ['render', 'behavior', 'integration', 'a11y']);

interface SpawnOutcome {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run the shim copy inside `dir` as a real child process. */
function runShim(dir: string, args: readonly string[] = []): SpawnOutcome {
  try {
    const stdout = execFileSync(process.execPath, [join(dir, 'bin', 'peaks.js'), ...args], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number | null; stdout?: string; stderr?: string };
    return { status: e.status ?? null, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

/** Fresh tmp dir containing a byte-identical copy of the real shim. */
function makeShimDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'peaks-bin-'));
  mkdirSync(join(dir, 'bin'), { recursive: true });
  writeFileSync(join(dir, 'bin', 'peaks.js'), readFileSync(REAL_BIN, 'utf8'), 'utf8');
  return dir;
}

const created: string[] = [];
function track(dir: string): string {
  created.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of created) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort tmp cleanup */
    }
  }
});

describe('(render) stale-dist message names the missing module + the fix', () => {
  it('prints the specifier and `npm run build` when the entry module is missing', () => {
    const dir = track(makeShimDir());
    const out = runShim(dir, ['--version']);
    expect(out.status).toBe(1);
    expect(out.stderr).toContain('npm run build');
    expect(out.stderr).toContain('missing:');
    expect(out.stderr).toContain('dist/cli/index.js');
    // No raw Node stack trace leaks into the friendly path.
    expect(out.stderr).not.toContain('at ModuleLoader');
    expect(out.stdout).toBe('');
  });

  it('prints the internal PACKAGE specifier when a workspace dist file is unlinked', () => {
    const dir = track(makeShimDir());
    mkdirSync(join(dir, 'dist', 'cli'), { recursive: true });
    mkdirSync(join(dir, 'node_modules', 'peaks-loop-shared', 'dist'), { recursive: true });
    writeFileSync(
      join(dir, 'node_modules', 'peaks-loop-shared', 'package.json'),
      JSON.stringify({ name: 'peaks-loop-shared', version: '0.0.0', type: 'module', exports: { './version': { default: './dist/version.js' } } }),
      'utf8'
    );
    writeFileSync(join(dir, 'dist', 'cli', 'index.js'), "import 'peaks-loop-shared/version';\n", 'utf8');
    const out = runShim(dir, ['anything']);
    expect(out.status).toBe(1);
    expect(out.stderr).toContain('peaks-loop-shared');
    expect(out.stderr).toContain('npm run build');
  });
});

describe('(behavior) happy path is unchanged; non-internal errors rethrow', () => {
  it('passes argv through and preserves the entry module exit code', () => {
    const dir = track(makeShimDir());
    mkdirSync(join(dir, 'dist', 'cli'), { recursive: true });
    writeFileSync(
      join(dir, 'dist', 'cli', 'index.js'),
      "process.stdout.write(JSON.stringify(process.argv.slice(2)));\nprocess.exitCode = 7;\n",
      'utf8'
    );
    const out = runShim(dir, ['memory', 'reindex', '--project', '.']);
    expect(out.status).toBe(7);
    expect(JSON.parse(out.stdout)).toEqual(['memory', 'reindex', '--project', '.']);
    expect(out.stderr).toBe('');
  });

  it('rethrows a third-party resolution failure unchanged (no friendly message)', () => {
    const dir = track(makeShimDir());
    mkdirSync(join(dir, 'dist', 'cli'), { recursive: true });
    writeFileSync(join(dir, 'dist', 'cli', 'index.js'), "import 'totally-missing-thirdparty-xyz';\n", 'utf8');
    const out = runShim(dir, ['anything']);
    expect(out.status).toBe(1);
    expect(out.stderr).toContain('ERR_MODULE_NOT_FOUND');
    expect(out.stderr).toContain('totally-missing-thirdparty-xyz');
    expect(out.stderr).not.toContain('npm run build');
  });

  it.skipIf(!existsSync(REAL_DIST_ENTRY))('real repo shim still runs the real CLI', () => {
    const stdout = execFileSync(process.execPath, [REAL_BIN, '--version'], { cwd: REPO_ROOT, encoding: 'utf8' });
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('(integration) real subprocess against real tmp dirs', () => {
  it('exits non-zero with an empty stdout and a non-empty stderr on a stale build', () => {
    const dir = track(makeShimDir());
    const out = runShim(dir);
    expect(out.status).not.toBe(0);
    expect(out.status).not.toBeNull();
    expect(out.stderr.length).toBeGreaterThan(0);
  });
});

describe('(a11y) the message tells a human exactly what to run next', () => {
  it('contains an actionable fix command and the package root', () => {
    const dir = track(makeShimDir());
    const out = runShim(dir, ['--version']);
    expect(out.stderr).toMatch(/run `npm run build` in /);
    expect(out.stderr).toContain(dir);
  });
});
