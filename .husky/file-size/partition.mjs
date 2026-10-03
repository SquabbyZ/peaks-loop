// The census envelope's lint-scope partition (rid `2026-10-03-w10-rescope-a`,
// H3). The census measures the whole policy universe; the CEILINGS describe the
// enforced scope. Both callers (the generator, seeding the rows, and the gate's
// file-size leg, checking them) partition the SAME envelope through THIS module,
// so the number a run seeds and the number a run checks are cut by one line —
// the posture `.husky/peaks-gate-file-size.mjs` itself exists for (F5).
//
// `censusFilesProblem` is the fail-closed half: the partition is computed from
// the envelope's per-file over-cap list, so an envelope without one — or whose
// list does not sum to its own totals — is a census that may not be believed,
// never a partition that silently reads zero.

import { isLintScoped } from '../lint-scope.mjs';

/** The two populations of one census run, split by the ONE lint-scope rule. */
export function partitionCensusOverCap(env) {
  let overCap = 0;
  let excessLines = 0;
  let shadowOverCap = 0;
  let shadowExcessLines = 0;
  for (const entry of env.files ?? []) {
    if (isLintScoped(entry.file)) {
      overCap += 1;
      excessLines += entry.excess;
    } else {
      shadowOverCap += 1;
      shadowExcessLines += entry.excess;
    }
  }
  return {
    gated: { overCap, excessLines },
    shadow: { overCap: shadowOverCap, excessLines: shadowExcessLines }
  };
}

/** Why this envelope may not be partitioned, or `null` when it may. */
export function censusFilesProblem(env) {
  if (!Array.isArray(env.files)) {
    return (
      'produced no per-file over-cap list, so the lint-scope partition of ' +
      'fileSizeOverCap/fileSizeExcessLines would be a guess, not a split of a measurement'
    );
  }
  let sum = 0;
  for (const entry of env.files) {
    if (typeof entry?.file !== 'string' || !Number.isInteger(entry?.excess) || entry.excess < 0) {
      return 'produced an over-cap list entry without a file name and a non-negative integer excess';
    }
    sum += entry.excess;
  }
  if (env.files.length !== env.overCap) {
    return `reported overCap ${env.overCap} with ${env.files.length} file(s) in its own list`;
  }
  if (sum !== env.excessLines) {
    return `reported excessLines ${env.excessLines} while its list sums to ${sum}`;
  }
  return null;
}
