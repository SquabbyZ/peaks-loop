// Vitest GLOBAL setup: runs ONCE in the main process before any test worker
// spawns; its returned teardown runs ONCE after all workers exit.
//
// Purpose
// -------
// Stash the real project's `.peaks/.session.json` and `.peaks/.active-skill.json`
// so the suite runs in a "no active session" state, then restore them when the
// run ends. `src/services/session/session-manager.ts:readSessionInfo` walks
// process.cwd() and reads `.peaks/.session.json`; when a developer (or a
// peaks-code orchestrator) has an active session those files exist and ~31
// tests that assert the legacy sessionId-based artifact shape start failing.
//
// Why globalSetup (not setupFiles)
// --------------------------------
// This stash used to live in tests/vitest.setup.ts, which vitest runs once
// PER TEST FILE inside EACH worker. That was race-free ONLY because the suite
// was forced through a single worker (`fileParallelism: false`) — which is the
// dominant cause of the >10min suite runtime and the per-test O(N) slowdown
// documented in .peaks/memory/slice-014-vitest-slowdown-and-race-repeat.md.
//
// Renaming a SHARED file from every worker is inherently racy, so it blocked
// parallelism. Moving it here makes the rename happen exactly once (main
// process, before workers) and the restore once (after workers) — no
// cross-worker race — which is what lets vitest.config.ts set
// `fileParallelism: true`.
//
// Uses only plain node APIs (no `vi`); globalSetup runs outside the test
// environment.

import { existsSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const targets = [
  {
    live: join(projectRoot, '.peaks', '.session.json'),
    backup: join(projectRoot, '.peaks', '.session.json.test-bak'),
  },
  {
    live: join(projectRoot, '.peaks', '.active-skill.json'),
    backup: join(projectRoot, '.peaks', '.active-skill.json.test-bak'),
  },
];

let restored = false;
function restore(): void {
  if (restored) return;
  restored = true;
  for (const { live, backup } of targets) {
    // Restore any leftover backup (also recovers from a prior crashed run).
    if (existsSync(backup)) {
      try { renameSync(backup, live); } catch { /* best-effort */ }
    }
  }
}

export default function setup(): () => void {
  for (const { live, backup } of targets) {
    if (!existsSync(live)) continue;
    try { renameSync(live, backup); } catch { /* nothing to stash */ }
  }
  // Belt-and-braces: restore on a hard exit even if vitest skips teardown.
  process.once('exit', restore);
  // Vitest invokes this returned teardown once, after all workers exit.
  return restore;
}
