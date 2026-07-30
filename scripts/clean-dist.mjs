#!/usr/bin/env node
import { readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Slice 2026-07-30 — extend clean-dist to also wipe every
// packages/*/dist. Rationale: tsc's incremental-build cache
// compares files by mtime + size, and a stale dist that
// survived from a previous build can cause tsc to skip the
// emission of newly-added src/*.ts (Bug-04 lineage — see
// tests/unit/scripts/sync-version-invalidation.test.ts for
// the regression pin on version.ts specifically).
//
// The wider wipe is safe because:
//   - watch.mjs only watches src/, schemas/, skills/ — it
//     never reads packages/*/dist during dev iteration
//   - sync-version.mjs's later unlink step on
//     packages/peaks-loop-shared/dist/version.* is now a
//     narrower no-op safety net, not the load-bearing invalidator
//
// We deliberately use { recursive: true, force: true } for
// every dist — missing dirs are tolerated so a fresh clone
// without prior builds does not crash.

rmSync(join(packageRoot, 'dist'), { recursive: true, force: true });

const packagesRoot = join(packageRoot, 'packages');
for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  rmSync(join(packagesRoot, entry.name, 'dist'), {
    recursive: true,
    force: true,
  });
}

