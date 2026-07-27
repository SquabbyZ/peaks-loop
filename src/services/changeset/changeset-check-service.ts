/**
 * rid-011 — peaks changeset check hard gate (Phase 4 slice 2).
 *
 * Module path: src/services/changeset/changeset-check-service.ts
 * Mirror of publish.yml gate-changeset step (lines 220-243). Hard-gate,
 * no warning mode, no opt-out. Auto-wired as step 0 of `peaks release
 * canary` and `peaks release hotfix` BEFORE the rid-010 precheck guard.
 *
 * Decoupling note: rid-010 Layer C (`runChangesetStaged`) is ad-hoc
 * precheck (warning by default, --strict upgrade); rid-011 hard gate is
 * unconditional. Both filters inspect `.changeset/*.md` (excluding
 * README.md) but with different policy semantics.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

export type ChangesetGateState =
  | 'staged-empty'
  | 'staged-present'
  | 'dir-missing';

export interface ChangesetHardGateEnvelope {
  readonly ok: boolean;
  readonly state: ChangesetGateState;
  readonly stagedFiles: readonly string[];
  readonly root: string;
  readonly snapshotAt: string;
}

export function runChangesetHardGate(projectRoot: string): ChangesetHardGateEnvelope {
  const dir = join(projectRoot, '.changeset');
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        ok: true,
        state: 'dir-missing',
        stagedFiles: [],
        root: projectRoot,
        snapshotAt: new Date().toISOString()
      };
    }
    // Unexpected I/O — fail closed (do NOT silently report clean).
    throw err;
  }
  const staged = files
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .sort();
  const ok = staged.length === 0;
  const state: ChangesetGateState = ok ? 'staged-empty' : 'staged-present';
  return {
    ok,
    state,
    stagedFiles: staged,
    root: projectRoot,
    snapshotAt: new Date().toISOString()
  };
}