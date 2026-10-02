#!/usr/bin/env node
/**
 * The file-size leg's measurement path, shared by the two callers that own a row.
 *
 * WHY THIS FILE EXISTS (F5 of the repair cycle for rid `2026-09-30-cap-unify-01`).
 * The cap itself was single-sourced into `src/services/scan/file-size-policy.ts`,
 * but the code that SPAWNS the census and decides when it may not be believed was
 * written twice, near-verbatim — `.husky/peaks-gate.mjs:666` and
 * `.husky/peaks-gate-baseline.mjs:330` — and the copies had already drifted (one
 * passes `windowsHide: true`, the other not). The gate is the enforcement surface
 * and the generator is the thing that seeds the ceiling from the same measurement;
 * if the two disagree about what "could not be measured" means, one of them writes
 * a green the other would have refused. One module, both callers.
 *
 * THE POLICY IS STILL NOT HERE. Caps, scope dirs, extensions and the line
 * convention live in the policy module and reach this file only through the census
 * envelope (`scripts/lint/file-size-census.ts`, the one tool that imports the `.ts`
 * policy). Nothing in this file states a policy number.
 */

// THE SPLIT (rid `2026-10-02-wave9-file-size-split`). HEAD's 411 raw lines were a
// bag of exported functions, so this file is now a thin entry that keeps the
// documented header above and re-exports the same surface from modules under
// `.husky/file-size/`. Same path, same exports, same arity — `.husky/gate/` and
// `.husky/baseline/` keep reaching it with their existing specifiers, and the
// function bodies are byte-identical moves (see the envelope's multiset proof).

export {
  FS_CENSUS,
  FS_CEILING_KEY,
  FS_CONTROL_ARM_FLAG,
  FS_EXCESS_CEILING_KEY,
  FS_EXCESS_ROW_LABEL,
  FS_HOOKS_CEILING_KEY,
  FS_HOOKS_EXCESS_CEILING_KEY,
  FS_HOOKS_EXCESS_ROW_LABEL,
  FS_HOOKS_ROW_LABEL,
  FS_HOOKS_WHOLE_SCOPE_SOURCE,
  FS_ROW_LABEL,
  FS_WHOLE_SCOPE_SOURCE,
  TSX_CLI
} from './file-size/constants.mjs';

export { missingFileSizeCeilings, parseFileSizeArgv } from './file-size/argv.mjs';

export {
  hooksEnvelopeProblem,
  measureFileSizeOverCap,
  refuseScopedSubset
} from './file-size/measure.mjs';

export { describeInputTrips, fileSizeInputTrips } from './file-size/input.mjs';

export {
  describeControlArmRun,
  describeFileSizeEnvelope,
  describeHooksFileSizeEnvelope,
  printFileSizeLeg
} from './file-size/print.mjs';
