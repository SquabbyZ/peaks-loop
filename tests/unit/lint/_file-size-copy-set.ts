// tests/unit/lint/_file-size-copy-set.ts
//
// WHAT THE HOOKS FIXTURE COPIES INTO ITS TEMP REPOSITORY — the walk, plus the
// non-`.husky/` runtime half, in one module.
//
// WHY IT IS ITS OWN FILE. It lived in `_file-size-hooks-fixture.ts`, which had reached
// 501 raw lines under a 500 cap: the commit path's new file-size leg needs two more
// runtime files staged (`scripts/lint/file-size-delta.ts` and the two `scan/` modules it
// imports), and appending them there would have grown an over-cap file past its own
// ratchet row — the exact defect this slice is about. Extract, do not append.
//
// A WALK, NOT A LIST. `hooksScopeFilesUnder` applies the census's OWN hooks-scope rule
// (`isHooksMeasuredFile`), so a module added under `.husky/gate/` joins the staged set
// with no edit here. The fixed list this replaced named four `.husky/` files by hand and
// died at load inside the temp repo the day `.husky/peaks-gate.mjs` grew regions into
// `.husky/gate/*.mjs` (`ERR_MODULE_NOT_FOUND`, nine arms red for an unrelated reason).

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  HOOKS_FILE_SIZE_SCOPE_DIRS,
  isHooksMeasuredFile
} from '../../../src/services/scan/file-size-policy.js';
import { REPO_ROOT } from '../standards/_file-size-cap-scan.js';

/**
 * Every `.husky/` module the gate is made of, by WALKING the source tree under the
 * census's own hooks-scope rule. Used by the fixture to stage what the gate imports, and
 * by several guard files as the independent reading of that same set.
 */
export function hooksScopeFilesUnder(root: string): string[] {
  const out: string[] = [];
  const scan = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel2 = rel === '' ? entry.name : `${rel}/${entry.name}`;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) scan(abs, rel2);
      else if (entry.isFile() && isHooksMeasuredFile(rel2)) out.push(rel2);
    }
  };
  for (const dir of HOOKS_FILE_SIZE_SCOPE_DIRS) {
    const abs = join(root, dir);
    if (existsSync(abs)) scan(abs, dir);
  }
  return out.sort();
}

/**
 * The non-`.husky/` half of what the fixture runs byte-for-byte from the repository.
 * `file-size-delta.ts` and the two `scan/` modules it imports are here because the
 * COMMIT path now spawns it: a fixture that runs `staged` mode without them would have
 * the leg refuse (a tool that cannot run is a failure, not a zero), and every arm in
 * `gate-empty-result-exit-codes.test.ts` would go red for the wrong reason.
 */
const RUNTIME_FILES = [
  'scripts/lint/file-size-census.ts',
  'scripts/lint/file-size-census-hooks.ts',
  'scripts/lint/file-size-delta.ts',
  'scripts/lint/lint-file-list.mjs',
  'src/services/scan/file-size-baseline.ts',
  'src/services/scan/file-size-policy.ts',
  'src/services/scan/file-size-scan.ts'
];

/**
 * Everything the fixture runs byte-for-byte from the repository, in one walked set.
 * Exported so `gate-module-staging.test.ts` can assert it covers every module the gate
 * is made of: a fixture that stages less than the entry imports dies at load, and that
 * is the failure this list used to cause.
 */
export const FIXTURE_COPIED_FILES = [...hooksScopeFilesUnder(REPO_ROOT), ...RUNTIME_FILES];
