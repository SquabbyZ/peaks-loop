#!/usr/bin/env node
/**
 * The silent-warning leg's measurement path, shared by the two callers that own a
 * row (rid `2026-10-03-silent-warning-scope`, backlog §2.43) — the same F5 posture
 * `.husky/peaks-gate-file-size.mjs` established for the census: the gate is the
 * enforcement surface, the generator seeds the ceiling from the SAME measurement,
 * so the two must agree about what "could not be measured" means and about WHICH
 * FILES the number was measured over.
 *
 * THE POPULATION IS THE POINT. Until this slice the leg asked
 * `scripts/lint/silent-warning-detector.mjs` for its own default scope — a
 * filesystem walk of `SCAN_ROOTS = ['src']`, 905 files measured 2026-10-03 — while
 * `eslintFindings`, `prettierUnformatted`, `fileSizeOverCap` and the hooks rows all
 * ratchet the 943 files `git ls-files` filtered by the published scope rule names.
 * The 38-file difference was exactly `packages/<name>/src`, and it held 17 real swallows
 * (8 catch-return-null + 9 empty-catch) that no ceiling had ever counted. `repo`
 * mode printed the divergence as a footnote — `Recorded, not reconciled` — and kept
 * going, which is §2.41's shape one layer down: two numbers on one screen, neither
 * of them an error.
 *
 * A WALK IS NOT A SCOPE. The same 905-file walk also sees files the index has never
 * heard of, and it misses tracked files the disk no longer carries; both were
 * measured on 2026-09-29 when an injected fixture under `src/` moved the row without
 * editing anyone's source (`tests/unit/lint/silent-warning-gate-leg.test.ts` header).
 * So the leg now takes the list its callers hand eslint and prettier, and the count
 * it scanned must EQUAL the count it was handed. It is a refusal otherwise, never a
 * footnote.
 *
 * WHY THE BATCHING. `node scripts/lint/silent-warning-detector.mjs --json <943
 * paths>` cannot run on this box: measured 2026-10-03, one spawn of the enforced
 * scope's own list fails `spawnSync node ENAMETOOLONG` at 41,716 argv characters
 * (the Windows command-line limit is ~32,767). That is the same reason
 * `.husky/baseline/paths.mjs` batches eslint at `BATCH = 150`, and the reason a
 * spawn failure here is a refusal — an argv that never reached the tool is the one
 * state that must never read as "0 swallows".
 *
 * THE DETECTOR'S OWN WALK STILL EXISTS, unchanged, for standalone human use
 * (`node scripts/lint/silent-warning-detector.mjs`, `pnpm run
 * lint:silent-warning`, `peaks` CLI callers). Nothing in this module asks for it:
 * every run passes explicit paths, so the walk is no longer the ratchet's source.
 */

import { execFileSync } from 'node:child_process';

/** The tool this leg reads, exactly as `pnpm test:ci` used to. */
export const SW_DETECTOR = 'scripts/lint/silent-warning-detector.mjs';

/** [detector rule, baseline ceiling key, table label] — the two rows the leg owns. */
export const SW_RULES = [
  ['catch-return-null', 'silentWarningCatchReturnNull', 'silent-warn return-null'],
  ['empty-catch', 'silentWarningEmptyCatch', 'silent-warn empty-catch']
];

/**
 * Where the leg's population comes from, named IN the artifact record. §2.41: a
 * count without a source is a claim, and this claim is `git ls-files` filtered by
 * the published scope — the same words that describe every other enforced row.
 */
export const SW_SCOPE_SOURCE = 'git ls-files <scope dirs>';

/**
 * The key this leg's population record sits under inside the artifact's `scope`
 * block. METADATA, not a ceiling: `CEILING_KEYS` stays the fifteen it is, and
 * `.husky/monotonic/keys.mjs` still owns that set. `artifact.mjs` writes it,
 * `baseline/rescope.mjs` compares it, and both spell it from here.
 */
export const SW_SCOPE_KEY = 'silentWarning';

/**
 * Files per detector spawn. Mirrors `BATCH` in `.husky/baseline/paths.mjs` (the
 * eslint leg's argv bound, `150`, for the same Windows limit) rather than importing
 * it: that module is the generator's, and this file is reached from the gate side
 * too, where importing it would drag the generator's paths along. The two are
 * compared arm-for-arm by `tests/unit/lint/silent-warning-scope-leg.test.ts`.
 */
export const SW_ARGV_BATCH = 150;

/** The phrase that says the leg measured the population it was handed. */
export const populationPhrase = (scanned) =>
  `${scanned} file(s) scanned, == the enforced scope (${SW_SCOPE_SOURCE})`;

/** The one sentence both callers print about this run's silent-warning measurement. */
export function describeSilentWarningRun({ returnNull, emptyCatch, scanned }) {
  return `silent-warning: catch-return-null=${returnNull}, empty-catch=${emptyCatch}, ${populationPhrase(scanned)}`;
}

/** Why this leg may not be believed, in the shape both callers wrap. */
function populationTrip(scanned, asked) {
  if (scanned === 0) return `${SW_DETECTOR} scanned 0 files, so it measured nothing`;
  return (
    `the detector scanned ${scanned} file(s) of the ${asked} the enforced scope names ` +
    `(${SW_SCOPE_SOURCE}). Two populations on one screen: the row would ratchet a ` +
    'number measured over a file set nobody agreed to'
  );
}

/**
 * The detector, over an explicit tracked list, in argv batches.
 *
 * Returns `{ failure, scannedFiles, askedFiles, counts }`. FAIL-CLOSED on every
 * path, like `measureFileSizeOverCap`: a detector that cannot run, that produced no
 * parseable envelope, that reported no integer count, that scanned nothing, or that
 * scanned a different number of files than it was handed returns a `failure` — it
 * never returns `counts: 0`, because 0 is what "no swallows found" looks like, and
 * telling those two states apart is the entire reason the rows exist.
 */
export function runSilentWarningScan(files, cwd = process.cwd()) {
  const asked = files.length;
  const refuse = (why) => ({ failure: why, scannedFiles: 0, askedFiles: asked, counts: {} });
  if (asked === 0) {
    return refuse('its caller handed the leg no files, so it measured nothing');
  }
  const counts = {};
  for (const [rule] of SW_RULES) counts[rule] = 0;
  let scanned = 0;
  for (let i = 0; i < asked; i += SW_ARGV_BATCH) {
    const batch = files.slice(i, i + SW_ARGV_BATCH);
    const at = `batch starting at file ${String(i + 1)}`;
    let raw = '';
    try {
      raw = execFileSync('node', [SW_DETECTOR, '--json', ...batch], {
        cwd,
        encoding: 'utf8',
        maxBuffer: 512 * 1024 * 1024,
        windowsHide: true
      });
    } catch (err) {
      // Exit 1 means the detector FOUND swallows and the envelope is still on
      // stdout — the same shape as eslint's report and the census's. Anything that
      // leaves no stdout at all (`ENAMETOOLONG` argv, ENOENT, a crash) DID NOT RUN.
      raw = err.stdout ?? '';
      if (raw === '') {
        return refuse(`${SW_DETECTOR} could not be run over the ${at} (${err.code ?? err.message})`);
      }
    }
    let env;
    try {
      env = JSON.parse(raw);
    } catch {
      return refuse(`${SW_DETECTOR} --json produced no parseable envelope for the ${at}`);
    }
    if (!Number.isInteger(env.scannedFiles) || env.scannedFiles < 0) {
      return refuse(`${SW_DETECTOR} produced an envelope with no integer scannedFiles for the ${at}`);
    }
    if (typeof env.byRule !== 'object' || env.byRule === null) {
      return refuse(`${SW_DETECTOR} produced an envelope with no byRule object for the ${at}`);
    }
    scanned += env.scannedFiles;
    for (const [rule] of SW_RULES) counts[rule] += env.byRule[rule] ?? 0;
  }
  if (scanned !== asked) return refuse(populationTrip(scanned, asked));
  return { failure: null, scannedFiles: scanned, askedFiles: asked, counts };
}

/** The two ceiling keys, for a caller that has to check the baseline carries them. */
export const SW_CEILING_KEYS = SW_RULES.map(([, key]) => key);
