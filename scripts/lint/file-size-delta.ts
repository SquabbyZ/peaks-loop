#!/usr/bin/env node
// scripts/lint/file-size-delta.ts
//
// The diff-scoped file-size RATCHET as a JSON envelope on stdout — the measurement
// path of the COMMIT gate. Run it through tsx, exactly as `file-size-census.ts` is:
//
//   node node_modules/tsx/dist/cli.mjs scripts/lint/file-size-delta.ts <file>...
//
// THE RULE IS NOT HERE, AND THAT IS THE POINT OF THIS FILE. `file-size-census.ts`
// counts the whole tree for the aggregate rows; this one adds no rule of its own and
// simply calls `scanFileSize` (`src/services/scan/file-size-scan.ts`) — the one
// function the `peaks scan file-size` command and the RD→implemented transition
// already run. So the commit path and the transition path cannot drift into two
// opinions about "this change grew a file past its cap": they are one implementation,
// and this file is only the argv/envelope adapter that lets a plain `.mjs` gate reach
// a `.ts` module it cannot import under bare `node`.
//
// ARGV IS THE POPULATION, AND IT IS NEVER DERIVED HERE. The commit hook is handed the
// staged paths by lint-staged, so the caller always knows the set; a run with no paths
// REFUSES (exit 2) instead of falling back to the whole change set, because "I was
// handed nothing" and "the change set is empty" are different facts and an exit code
// is all a hook reader looks at. `--json` is accepted for symmetry with the census and
// changes nothing.
//
// Exit codes: 2 on misuse (no paths), 1 when something grew past its cap, 0 otherwise.
// The envelope is on stdout in both of the latter cases; a git read that cannot be
// completed throws with NO envelope, which is what the caller fails closed on.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FILE_SIZE_LINE_CONVENTION,
  fileSizeCaps
} from '../../src/services/scan/file-size-policy.js';
import { scanFileSize } from '../../src/services/scan/file-size-scan.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOOL = 'scripts/lint/file-size-delta.ts';
const BASE_REF = 'HEAD';

/** The population source string, so the envelope says where its file list came from. */
const SCOPE_SOURCE = 'argv (the caller-supplied change set)';

function main(): number {
  const paths = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  if (paths.length === 0) {
    process.stderr.write(
      `${TOOL}: pass the files to judge. A run with no paths measured nothing, and ` +
        '"nothing was measured" is not the same statement as "nothing grew".\n'
    );
    return 2;
  }
  const result = scanFileSize({ projectRoot: REPO_ROOT, baseRef: BASE_REF, files: paths });
  process.stdout.write(
    `${JSON.stringify(
      {
        tool: TOOL,
        policyModule: 'src/services/scan/file-size-policy.ts',
        convention: FILE_SIZE_LINE_CONVENTION,
        caps: fileSizeCaps(),
        baseRef: BASE_REF,
        scope: { source: SCOPE_SOURCE, countedFiles: paths.length },
        checkedFiles: result.checkedFiles,
        acceptedOverCapFiles: result.acceptedOverCapFiles,
        outOfScopeFiles: result.outOfScopeFiles,
        exemptFiles: result.exemptFiles,
        deletedFiles: result.deletedFiles,
        violations: result.violations,
        ok: result.ok
      },
      null,
      2
    )}\n`
  );
  return result.ok ? 0 : 1;
}

process.exitCode = main();
