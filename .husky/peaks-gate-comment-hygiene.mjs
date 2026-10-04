#!/usr/bin/env node
/**
 * The comment-hygiene leg's measurement path, shared by the two callers that own its
 * rows — the gate leg that ENFORCES them and the generator that SEEDS them (the F5
 * posture `.husky/peaks-gate-silent-warning.mjs` and `.husky/peaks-gate-file-size.mjs`
 * established: one spawn, over one list, with one refusal, so the number a ceiling was
 * seeded from and the number a gate compares against cannot mean different things).
 *
 * THE POPULATION IS THE ENFORCED SCOPE, HANDED IN. `peaks comments audit` walks
 * `src` + `packages/peaks-loop-mut/src` (923 files); the ratchet measures
 * `git ls-files` filtered by the published scope rule — every package's `src`, and only
 * tracked files. The two numbers differ on purpose, and a row may only be measured over
 * the one every other row shares, because the walk would let an untracked scratch file
 * move a ceiling nobody edited (rid `2026-10-03-silent-warning-scope`).
 *
 * ARGV BATCHING for the same reason as the silent-warning leg: one spawn of the
 * enforced scope's own list exceeds the Windows command-line limit (`ENAMETOOLONG` at
 * ~41,716 characters), and a spawn that never reached the tool must never read as "0
 * findings".
 *
 * FAIL-CLOSED throughout: a detector that cannot run, that emits no parseable envelope,
 * that reports a non-integer count, that scans nothing, or that scans a different number
 * of files than it was handed, returns a `failure` — it does not return counts.
 */

import { execFileSync } from 'node:child_process';

/** The tool this leg runs. It is the only thing that reaches the `.ts` classifier. */
export const CH_DETECTOR = 'scripts/lint/comment-hygiene-detector.ts';

/** The tsx CLI, spelled as the file-size leg spells it. */
export const TSX_CLI = 'node_modules/tsx/dist/cli.mjs';

/** [envelope field, ceiling key, table label] — the two rows this leg owns. */
export const CH_RULES = [
  ['deadReferences', 'commentDeadReferences', 'comment dead-ref'],
  ['narrative', 'commentNarrativeLines', 'comment narrative']
];

/** The ceiling keys this leg owns, derived from the same table so they cannot drift. */
export const CH_CEILING_KEYS = CH_RULES.map(([, ceilingKey]) => ceilingKey);

/** Where the leg's population comes from, named IN the artifact record. */
export const CH_SCOPE_SOURCE = 'git ls-files <scope dirs>';

/** The key this leg's population record sits under inside the artifact's `scope` block. */
export const CH_SCOPE_KEY = 'commentHygiene';

/** Files per detector spawn — the eslint leg's bound, for the same argv limit. */
export const CH_ARGV_BATCH = 150;

/** The phrase that says the leg measured the population it was handed. */
export const populationPhrase = (scanned) =>
  `${scanned} file(s) scanned, == the enforced scope (${CH_SCOPE_SOURCE})`;

/** The one sentence both callers print about this run's measurement. */
export function describeCommentHygieneRun({ deadReferences, narrative, scanned }) {
  return `comment-hygiene: dead-reference=${deadReferences}, narrative=${narrative}, ${populationPhrase(scanned)}`;
}

function populationTrip(scanned, asked) {
  if (scanned === 0) return `${CH_DETECTOR} scanned 0 files, so it measured nothing`;
  return (
    `the detector scanned ${scanned} file(s) of the ${asked} the enforced scope names ` +
    `(${CH_SCOPE_SOURCE}). Two populations on one screen: the row would ratchet a number ` +
    'measured over a file set nobody agreed to'
  );
}

/** A count that is not an integer is a refusal, so each rule is checked once per run. */
function countProblem(envelope) {
  for (const [field] of CH_RULES) {
    const value = envelope[field];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      return `${CH_DETECTOR} reported ${field}=${String(value)}, which is not a count`;
    }
  }
  return null;
}

/**
 * Run the detector over an explicit tracked list, in argv batches.
 *
 * Returns `{ failure, scannedFiles, askedFiles, deadReferences, narrative }`.
 */
export function runCommentHygieneScan(files, cwd = process.cwd()) {
  const asked = files.length;
  const refuse = (why) => ({
    failure: why,
    scannedFiles: 0,
    askedFiles: asked,
    deadReferences: 0,
    narrative: 0
  });
  if (asked === 0) return refuse('its caller handed the leg no files, so it measured nothing');

  let scanned = 0;
  let deadReferences = 0;
  let narrative = 0;
  for (let i = 0; i < asked; i += CH_ARGV_BATCH) {
    const batch = files.slice(i, i + CH_ARGV_BATCH);
    const at = `batch starting at file ${i + 1}`;
    let raw = '';
    try {
      raw = execFileSync('node', [TSX_CLI, CH_DETECTOR, ...batch], {
        cwd,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true
      });
    } catch (err) {
      return refuse(`${at} could not be measured (${String(err.message).slice(0, 160)})`);
    }
    let envelope;
    try {
      envelope = JSON.parse(raw);
    } catch {
      return refuse(`${at} printed no parseable envelope`);
    }
    const bad = countProblem(envelope);
    if (bad !== null) return refuse(`${at}: ${bad}`);
    const batchScanned = envelope.scannedFiles;
    if (batchScanned !== batch.length) {
      return refuse(
        `${at}: ${populationPhrase(batchScanned)} but the batch was ${batch.length} files`
      );
    }
    scanned += batchScanned;
    deadReferences += envelope.deadReferences;
    narrative += envelope.narrative;
  }
  if (scanned !== asked) return refuse(populationTrip(scanned, asked));
  return { failure: null, scannedFiles: scanned, askedFiles: asked, deadReferences, narrative };
}
