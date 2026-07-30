// tests/unit/_setup/tmp-workspace.ts
//
// antfu-style tmp workspace for the unit suite. The 2026-07-30 test-rebuild
// epic removed the legacy global setup that renamed `.peaks/.session.json`
// + `.peaks/.active-skill.json` for every run. The new rule is: unit tests
// never touch the real `.peaks/**` tree.
//
// `useTmpWorkspace()` returns a fresh `mkdtemp`-backed directory path, chdir
// into it, and register a restore hook that chdirs back and removes the
// directory. Each test file gets its own workspace; concurrent test files
// run in separate vitest forks (see vitest.config.ts: pool: 'forks') so two
// files can never collide on the same tmp path.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach } from 'vitest';

const projectRoot = resolve(__dirname, '..', '..', '..');

export interface TmpWorkspace {
  /** Absolute path to the throwaway workspace root. */
  readonly path: string;
  /** Absolute path to a `.peaks/` directory inside the workspace. */
  readonly peaksDir: string;
  /** Resolve a relative path inside the workspace. */
  rel: (p: string) => string;
}

let active: TmpWorkspace | null = null;
const previousCwd: string[] = [];

export function getActiveTmpWorkspace(): TmpWorkspace {
  if (!active) {
    throw new Error('getActiveTmpWorkspace() called before useTmpWorkspace()');
  }
  return active;
}

/**
 * Create a fresh tmp workspace, chdir into it, and register cleanup.
 * Pair with `beforeEach` / `afterEach` per test file:
 *
 * ```ts
 * let ws: TmpWorkspace;
 * beforeEach(() => { ws = useTmpWorkspace(); });
 * ```
 */
export function useTmpWorkspace(prefix = 'peaks-unit-'): TmpWorkspace {
  if (active) {
    throw new Error('useTmpWorkspace() called twice without cleanup');
  }
  previousCwd.push(process.cwd());
  const path = mkdtempSync(join(tmpdir(), prefix));
  const peaksDir = join(path, '.peaks');
  process.chdir(path);
  active = {
    path,
    peaksDir,
    rel: (p: string) => resolve(path, p),
  };
  return active;
}

export function cleanupTmpWorkspace(): void {
  if (!active) return;
  const ws = active;
  active = null;
  // chdir back BEFORE rmSync so an open handle on cwd does not block removal
  // on Windows.
  if (previousCwd.length > 0) {
    const prev = previousCwd.pop();
    if (prev && prev !== ws.path) {
      try {
        process.chdir(prev);
      } catch {
        // Fall back to project root if the previous cwd no longer exists.
        process.chdir(projectRoot);
      }
    }
  }
  try {
    rmSync(ws.path, { recursive: true, force: true });
  } catch {
    // best-effort: a crashed worker will leak the tmp dir; that is fine.
  }
}

/** Convenience pair: register cleanup on vitest's afterEach. */
export function withTmpWorkspacePerTest(prefix?: string): () => TmpWorkspace {
  beforeEach(() => useTmpWorkspace(prefix));
  afterEach(() => cleanupTmpWorkspace());
  return () => {
    if (!active) throw new Error('no active tmp workspace');
    return active;
  };
}
