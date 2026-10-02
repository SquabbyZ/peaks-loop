// argv parsing (`parseFileSizeArgv`) and the ceiling-presence guard
// (`missingFileSizeCeilings`). Both read only the ceiling-key/flag constants; the
// bodies moved verbatim from `.husky/peaks-gate-file-size.mjs` (rid
// `2026-10-02-wave9-file-size-split`).

import {
  FS_CEILING_KEY,
  FS_CONTROL_ARM_FLAG,
  FS_EXCESS_CEILING_KEY,
  FS_HOOKS_CEILING_KEY,
  FS_HOOKS_EXCESS_CEILING_KEY
} from './constants.mjs';

/** Split a raw argv into (control-arm?, file list), so two callers cannot disagree about which argument is a path. */
export function parseFileSizeArgv(argv) {
  return {
    controlArm: argv.includes(FS_CONTROL_ARM_FLAG),
    files: argv.filter((arg) => arg !== FS_CONTROL_ARM_FLAG)
  };
}

/**
 * The refusal for a baseline that carries no ceiling for one or more of this leg's
 * rows, or `null` when the leg has numbers to compare against.
 *
 * WHY IT IS HERE AND WHY IT KNOWS ALL FOUR KEYS. The leg's rows share one census run,
 * so a missing ceiling has to take them ALL down: seeding `fileSizeExcessLines` while
 * leaving the guard keyed on `fileSizeOverCap` alone would let the over-cap row print
 * a green next to a number that was never measured against anything, and adding the
 * two hooks rows (§2.32) while keeping a two-key guard would let the main pair print
 * `held` next to a `.husky/` scope the baseline had never seeded. The gate used to
 * spell this refusal inline for one key; the key list and the text now live beside
 * the measurement they guard (F5 of the cap-unify review).
 */
export function missingFileSizeCeilings(ceilings) {
  const missing = [
    FS_CEILING_KEY,
    FS_EXCESS_CEILING_KEY,
    FS_HOOKS_CEILING_KEY,
    FS_HOOKS_EXCESS_CEILING_KEY
  ].filter((key) => !Number.isInteger(ceilings[key]));
  if (missing.length === 0) return null;
  return (
    `REFUSING to measure the file-size leg — the baseline has no ceiling for ${missing.join(', ')}.\n` +
    '  Regenerate it: node .husky/peaks-gate-baseline.mjs'
  );
}
