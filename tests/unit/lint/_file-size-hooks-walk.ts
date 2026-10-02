// tests/unit/lint/_file-size-hooks-walk.ts
//
// THE INDEPENDENT READING for the `.husky/` rows (rid `2026-10-02-hooks-size-rows`,
// backlog §2.32), split out of `_file-size-hooks-fixture.ts` because that harness is a
// measured, capped file under `tests/` and this is the one part of the slice that must
// NOT share a file with the machinery it is checking.
//
// WHY IT IS A WALK AND NOT A QUERY. The census enumerates its scope with
// `git ls-files -- <hooks dirs>` on purpose (`scripts/lint/file-size-census-hooks.ts`):
// that is the set a push carries, so an untracked scratch file cannot inflate a row and
// a deleted-but-staged one cannot silently shrink it. A guard that re-ran that same
// command would agree with the census by construction and prove nothing, so this reads
// the DIRECTORY instead — its own recursive `readdirSync`, the policy's own extension
// set, the policy's own line unit, the policy's own hooks cap. It never shells out to
// git, never spawns the census, and never opens the artifact, which is what makes a
// number it agrees with evidence rather than a copy.
//
// ONE UNIT, ONE POLICY, SAME RULE AS THE CENSUS. The cap, the directories and the
// extensions come from `src/services/scan/file-size-policy.ts`; restating 300 or
// `['mjs']` here would recreate the second copy
// `tests/unit/standards/file-size-cap.test.ts` exists to report.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  HOOKS_FILE_SIZE_SCOPE_DIRS,
  countRawLines,
  hasPolicyExtension,
  hooksFileSizeCaps
} from '../../../src/services/scan/file-size-policy.js';

/** One hooks-scope file as the census and the walk both report it. */
export type OverCapEntry = { file: string; lines: number; cap: number; excess: number };

/** What the walk answers for a root: the two rows, and both populations behind them. */
export type HooksWalk = {
  overCap: number;
  excessLines: number;
  files: OverCapEntry[];
  scopedFiles: string[];
};

/**
 * Two lists, because the census reports two populations and an arm that confuses them
 * measures nothing:
 *   `files`       — the over-cap entries, census-shaped, so a walk list can be compared
 *                   path-for-path with `envelope.hooks.files`
 *   `scopedFiles` — EVERY file the walk enumerated, tracked or not, which is the
 *                   population `scope.countedFiles` names. The two differ exactly when
 *                   the walk saw something `git ls-files` cannot see (an untracked file)
 *                   or could not see something it can (a staged deletion), and that
 *                   difference is what the cross-measurement arms assert.
 *
 * Paths come back POSIX and root-relative (`.husky/peaks-gate.mjs`), which is both the
 * census's spelling and the one `isHooksMeasuredFile` understands, so a Windows-native
 * `join` never leaks a backslash into a comparison.
 */
export function walkHooksScope(root: string): HooksWalk {
  const cap = hooksFileSizeCaps().hooksCap;
  const paths: string[] = [];
  const scan = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel2 = rel === '' ? entry.name : `${rel}/${entry.name}`;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) scan(abs, rel2);
      else if (entry.isFile() && hasPolicyExtension(rel2)) paths.push(rel2);
    }
  };
  for (const dir of HOOKS_FILE_SIZE_SCOPE_DIRS) {
    const abs = join(root, dir);
    if (existsSync(abs)) scan(abs, dir);
  }
  const files: OverCapEntry[] = [];
  let excessLines = 0;
  for (const file of paths) {
    const lines = countRawLines(readFileSync(join(root, file), 'utf8'));
    if (lines > cap) {
      files.push({ file, lines, cap, excess: lines - cap });
      excessLines += lines - cap;
    }
  }
  return { overCap: files.length, excessLines, files, scopedFiles: paths.sort() };
}
