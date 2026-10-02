/**
 * `.husky/baseline/scope.mjs` — the tracked-file scope every measurement leg
 * iterates (rid `2026-10-02-wave9-generator-split`, HEAD lines 312–332 wrapped
 * as `measureScope()`). `scope` is the most-consumed binding in the file: eslint,
 * prettier, the silent-warning note, the artifact's per-file rows and its
 * `invocation.linted` field all read it, so this is a returned value and not a
 * moved `const`.
 */
import { execFileSync } from 'node:child_process';

import { CODE_EXT, HEAD_REF, ROOT, TOP_DIRS, refuse } from './paths.mjs';

/** `git ls-files`, filtered the way HEAD filtered it, printed the way it printed. */
export function measureScope() {
  // ---- scope -----------------------------------------------------------------
  // The scope list is `git ls-files`, and since this file's own slice the generator
  // needs git for a second reason: its previous ceilings live in HEAD. So a checkout
  // with no git is a refusal the operator can read, not an `ENOENT` stack trace from
  // `execFileSync` — the trip up in THE ANCHOR block is the one that fires first, and
  // this one catches a `--seed` run that got past it.
  let trackedFiles;
  try {
    trackedFiles = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' });
  } catch (err) {
    refuse(
      'this generator measures the tracked file list with `git ls-files` and git could not ' +
        `be run here (${err.code ?? err.message}).\n` +
        `  The previous ceilings are read from ${HEAD_REF} for the same reason.`
    );
  }
  const scope = trackedFiles
    .trim()
    .split('\n')
    .filter((f) => CODE_EXT.test(f) && TOP_DIRS.some((d) => f.startsWith(`${d}/`)));
  console.error(`scope: ${scope.length} files`);
  return scope;
}
