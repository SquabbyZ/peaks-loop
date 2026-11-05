/**
 * The real effects the four write-side `peaks worktree` commands hand to the
 * workspace-runtime package's lifecycle actions.
 *
 * The package takes `fs`, `runGit` and the clock value as parameters, so the
 * host policy stays here: peaks-loop writes every lease through
 * `atomicWriteJson` (same bytes, same rename-over-target), runs git through
 * `runGitCli`, and reads `Date.now()` once per action — exactly what the
 * command bodies did before the extraction.
 */

import { existsSync, readdirSync, readFileSync as readFileSyncNode } from 'node:fs';

import type { LeaseEffects, LeaseFs } from 'peaks-loop-workspace-runtime';

import { atomicWriteJson } from '../../services/ide/shared/atomic-json.js';
import { runGitCli } from './worktree-lease-git.js';

const realLeaseFs: LeaseFs = {
  readFile: (file) => readFileSyncNode(file, 'utf8'),
  writeFile: (file, contents) => atomicWriteJson(file, JSON.parse(contents)),
  existsSync: (file) => existsSync(file),
  readdir: (dir) => readdirSync(dir)
};

/** One effect bundle per action; `now` is read once here, as before. */
export function leaseEffects(now: number): LeaseEffects {
  return { fs: realLeaseFs, runGit: runGitCli, now };
}
