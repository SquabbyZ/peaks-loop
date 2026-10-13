// tests/unit/lint/_ceiling-divergence.ts
//
// The failure text for "the published ceiling and the live measurement disagree".
// The file-size gate-leg guards assert equality against the published ceiling, so
// they red on any tree whose ratchet has not been regenerated since the last
// measurement. A bare `expected 22419 to be 22301` names none of the situations
// that produce it, and each one wants a different response:
//
//   descent   — the tree measures UNDER the ceiling. The artifact is stale in the
//               safe direction: a ratchet only refuses a rise.
//   rise      — the tree measures OVER the ceiling and nothing under the census
//               scope is uncommitted, so the committed revision itself is over.
//   in-flight — the tree measures over it while the scope carries uncommitted
//               edits, so the number may describe work in progress rather than
//               the committed revision.
//
// The direction is the gate's own: `peaks-gate.mjs file-size` prints ✓ when the
// measurement is at or under the ceiling and ✗ when it is over.

import { execFileSync } from 'node:child_process';

import { isPolicyMeasuredFile } from '../../../src/services/scan/file-size-policy.js';

export type CeilingDivergence = 'current' | 'descent' | 'rise' | 'in-flight';

export type CeilingReading = {
  /** The ceiling recorded in `.peaks/lint/gate-baseline.json`. */
  readonly published: number;
  /** What the tree measures now. */
  readonly live: number;
  /** Does the census scope carry uncommitted edits? */
  readonly scopeDirty: boolean;
};

export function classifyCeilingDivergence(reading: CeilingReading): CeilingDivergence {
  if (reading.live === reading.published) return 'current';
  if (reading.live < reading.published) return 'descent';
  return reading.scopeDirty ? 'in-flight' : 'rise';
}

/**
 * The message for a mismatch, or `null` when there is none. Pass it to an
 * assertion so the failure a reader sees names the case instead of two numbers.
 */
export function describeCeilingDivergence(reading: CeilingReading): string | null {
  const kind = classifyCeilingDivergence(reading);
  if (kind === 'current') return null;
  const { published, live } = reading;
  const delta = Math.abs(live - published);
  if (kind === 'descent') {
    return (
      `the published ceiling is ${published} and the tree measures ${live} — the baseline is ` +
      `AHEAD of the tree by ${delta} line(s), which is the SAFE direction (the gate row prints ✓). ` +
      'A ratchet refuses only a rise, so this is work not yet regenerated into the artifact, not a ' +
      'regression. Regenerate the artifact after staging if the descent should be recorded.'
    );
  }
  if (kind === 'rise') {
    return (
      `REGRESSION: the published ceiling is ${published} and the tree measures ${live} — ` +
      `${delta} line(s) MORE than the ceiling, with no uncommitted change under the census scope to ` +
      'explain it (the gate row prints ✗). The committed revision exceeds its own published ceiling: ' +
      'fix the growth. Do NOT regenerate the artifact — that would record the rise.'
    );
  }
  return (
    `the published ceiling is ${published} and the tree measures ${live} — ${delta} line(s) MORE, ` +
    'while the census scope carries uncommitted changes (the gate row prints ✗). The census takes file ' +
    "names from the index and content from the working tree, so this rise may be another agent's work " +
    'in flight rather than a committed regression. Attribute it with `git status` before editing ' +
    'anything or regenerating the artifact.'
  );
}

/**
 * Uncommitted edits to files the CENSUS can actually see.
 *
 * The universe here is the census's, not `git status`'s: the census takes file
 * NAMES from the index and CONTENT from the working tree, so only a path that is
 * both tracked and policy-measured can move the number. A plain
 * `git status --porcelain` is a superset in two directions — it lists untracked
 * files (which `git ls-files` never reports) and tracked files the policy does
 * not measure — and either one would label a committed rise as work in flight,
 * which is the opposite of what this predicate is for.
 */
export function scopeHasUncommittedChanges(root: string, dirs: readonly string[]): boolean {
  const git = (args: readonly string[]): string =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  const counted = new Set(
    git(['ls-files', '--', ...dirs])
      .split('\n')
      .filter((path) => path !== '' && isPolicyMeasuredFile(path))
  );
  return git(['status', '--porcelain', '--untracked-files=no', '--', ...dirs])
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const path = line.slice(3).trim();
      const arrow = path.indexOf(' -> ');
      return arrow === -1 ? path : path.slice(arrow + 4);
    })
    .some((path) => counted.has(path));
}
