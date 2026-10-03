/**
 * `.husky/baseline/anchor.mjs` — THE ANCHOR: where the previous ceilings come
 * from, the two independent guards, and everything they refuse before a minute
 * of measurement is spent (rid `2026-10-02-wave9-generator-split`, HEAD lines
 * 135–172 and 183–239 verbatim, 241–310 wrapped as `guardAnchor()`).
 *
 * WHY IT RETURNS A RECORD RATHER THAN MOVING `const` LINES. HEAD computed these
 * numbers at top level and later regions read them by name — `anchorCeilings`
 * and `anchorKnown` reach the key audit and the comparison, `workingCopy` reaches
 * the key audit, `anchorNotes` is printed after the decision, `deferredAdded` is
 * settled against the measurement. The dataflow table in the envelope is the
 * contract for what the record has to carry; the wrapped lines are HEAD's, two
 * spaces deeper, in HEAD's order — the refusals still run before the write, and
 * `anchorNotes` is still the same array `decide.mjs` pushes into.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

import {
  CEILING_KEYS,
  SEED_FLAG,
  missingCanonicalKeys,
  parsePreviousArtifact,
  workingCopyTrip
} from '../peaks-gate-baseline-monotonic.mjs';

import { SHADOW_MOVE_ROWS, isShadowBlock } from './rescope.mjs';

import { HEAD_REF, OUT_PATH, OUT_REL, ROOT, refuse } from './paths.mjs';

// ---------------------------------------------------------------------------
// THE ANCHOR — where the previous ceilings come from (rid 2026-10-02-monotonicity-head-anchor)
// ---------------------------------------------------------------------------
// C wave 8 read them back out of `OUT_PATH`: the working-tree artifact, the same
// file this run is about to overwrite and the same file a weakening edits. An
// out-of-band review measured the three ways past that: delete a row and the run
// prints `NEWLY SEEDED` and writes it, inflate a row and it prints `CLEARED` and
// writes the descent, set `"ceilings": {}` and all thirteen rows re-seed because an
// empty object parses. The push leg then closed it worse — the remedy its own
// refusal prints is `Regenerate it: node .husky/peaks-gate-baseline.mjs`, so an
// operator following the gate's instruction performs attack one.
//
// So the previous side is a git object now, and the whole trip runs BEFORE the
// measurement: minutes of eslint, prettier and tsc are not spent deciding a verdict
// about a file that an edit already decided. Two guards, independent of each other:
//
//   1. `git show HEAD:.peaks/lint/gate-baseline.json` is what the fresh measurement
//      is compared against. Editing the working copy cannot move it.
//   2. The working copy is then compared against THAT. Lifting a number, dropping a
//      row or carrying a value that is not a ceiling is the attack, and this refuses it
//      before it judges its own measurement. A working copy that is only LOWER is a
//      stricter request, not an attack: it goes through, out loud, and the
//      measurement decides the number that is written.
//   2b. A row the disk ADDS and HEAD never carried is the one difference the disk cannot
//      decide for itself (backlog §2.35) — it may be the previous run's own legitimate
//      write — so it is deferred to `settleDeferredAdded` below, where this run's
//      measurement either confirms it as seeded or refuses it. Restoring the anchor is
//      advice for a hand-typed row only; a row this run measures at a different number
//      gets named on both sides and no `git checkout` at all, because following that
//      instruction would delete real debt.
//
// The order of the refusals is stated in `.husky/peaks-gate-baseline-monotonic.mjs`
// and the arms in `tests/unit/lint/baseline-monotonicity-head-anchor.test.ts` follow
// it: no anchor → the documented `--seed` path; anchor + edited working copy → trip;
// then the canonical key set on all three vectors; then HEAD vs measurement.
const seedRun = process.argv.slice(2).includes(SEED_FLAG);

/**
 * `git show HEAD:…`, or the reason there is no anchor. Never throws: a repository
 * with no commit, no such path, no git binary or no git at all is the documented
 * seed path (a baseline that has to be seeded says so with `--seed`), not a stack
 * trace an operator has to read.
 */
function readGitShowHead(path) {
  try {
    return {
      text: execFileSync('git', ['show', `HEAD:${path}`], {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true
      }),
      problem: null
    };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return {
        text: null,
        problem: 'git could not be run at all (ENOENT), and the previous ceilings live in git'
      };
    }
    const first = String(err.stderr ?? err.message)
      .split('\n')[0]
      .trim();
    return { text: null, problem: `HEAD has no readable artifact (${first})` };
  }
}

/**
 * The artifact on disk, as a second witness rather than as the source of the
 * previous numbers. `state` says which of the four situations the trip has to
 * distinguish: nothing there, something unreadable, something unparseable, ceilings.
 */
function readWorkingCopyCeilings() {
  if (!existsSync(OUT_PATH)) return { state: 'absent', ceilings: null, problem: null };
  let text;
  try {
    text = readFileSync(OUT_PATH, 'utf8');
  } catch (err) {
    return {
      state: 'unreadable',
      ceilings: null,
      problem: `could not be read (${err.code ?? err.message})`
    };
  }
  if (text.trim() === '') return { state: 'empty', ceilings: null, problem: 'is empty' };
  const parsed = parsePreviousArtifact(text);
  if (parsed.problem !== null) {
    return { state: 'unparseable', ceilings: null, problem: parsed.problem };
  }
  // An emptied `ceilings` block on disk is row-deletion by another name, and it is
  // a row-deletion the trip below can only see if it is still read as a vector.
  return { state: 'ceilings', ceilings: parsed.ceilings, problem: null };
}

/**
 * HEAD's `scope` block and measured-file count, read from the SAME bytes the
 * ceilings were parsed from (rid `2026-10-03-w10-rescope-a`, H1). The
 * monotonicity comparison sees values; this is the population that produced
 * them. Absent or malformed scope is `null` — a pre-rescope artifact carries no
 * scope block and there is nothing to compare against; the scope guard stays
 * quiet rather than inventing a verdict.
 */
function readAnchorScope(text) {
  try {
    const doc = JSON.parse(text);
    const scope =
      doc !== null && typeof doc === 'object' && Array.isArray(doc.scope?.dirs)
        ? { dirs: doc.scope.dirs, source: HEAD_REF, ...(typeof doc.scope.rule === 'string' ? { rule: doc.scope.rule } : {}) }
        : null;
    const fileCount =
      doc !== null && typeof doc === 'object' && doc.files !== null && typeof doc.files === 'object'
        ? Object.keys(doc.files).length
        : null;
    // W1 of rid `2026-10-03-shadow-move-rider`: the SAME bytes also carry the
    // non-gated `shadow` block, and the shadow-move check compares this run's
    // population against it. A block that is absent (HEAD predates `561ba8b5`) or
    // unreadable row by row is `null`, which the check reports as INACTIVE out loud
    // rather than as "nothing moved" — §2.41's shape, one layer down.
    const shadow =
      doc !== null && typeof doc === 'object' && isShadowBlock(doc.shadow) ? doc.shadow : null;
    return { headScope: scope, headFileCount: fileCount, headShadow: shadow };
  } catch {
    return { headScope: null, headFileCount: null, headShadow: null };
  }
}

/**
 * HEAD's anchor block, run in HEAD's order. It refuses by exiting, so a caller
 * that reaches the measurement legs has already passed the anchor trip and the
 * working-copy trip.
 */
export function guardAnchor() {
  const anchorRead = readGitShowHead(OUT_REL);
  let anchorCeilings = null;
  let anchorProblem = anchorRead.problem;
  let anchorScope = { headScope: null, headFileCount: null, headShadow: null };
  if (anchorProblem === null) {
    const parsed = parsePreviousArtifact(anchorRead.text);
    anchorCeilings = parsed.ceilings;
    anchorProblem = parsed.problem;
    if (anchorProblem === null) {
      anchorScope = readAnchorScope(anchorRead.text);
    }
  }
  // A `ceilings` block that is empty, or full of rows no slice sanctioned, is not a
  // baseline with holes in it: it is the absence of one. Treat it as such so it lands
  // on the documented `--seed` path instead of silently seeding every canonical row.
  if (
    anchorProblem === null &&
    missingCanonicalKeys(anchorCeilings).length === CEILING_KEYS.length
  ) {
    anchorCeilings = null;
    anchorProblem =
      `has no canonical ceiling row at all (${HEAD_REF} carries an empty or ` +
      'unrecognised `ceilings` block)';
  }
  const workingCopy = readWorkingCopyCeilings();
  const anchorKnown = anchorCeilings !== null;

  if (!anchorKnown && !seedRun) {
    refuse(
      `the previous ceilings are anchored in ${HEAD_REF} and that anchor ${anchorProblem}.\n\n` +
        '  A baseline cannot be re-based on a number nobody read, and the file on disk is not\n' +
        `  the anchor: ${OUT_REL} is what a weakening edits. If this really is the first\n` +
        '  generation in this repository, say so on purpose:\n' +
        `    node .husky/peaks-gate-baseline.mjs ${SEED_FLAG}\n` +
        `  Otherwise restore the anchor: git checkout HEAD -- ${OUT_REL}`
    );
  }

  // The artifact on disk is the file the push-time gate reads, so an unreadable or
  // unparseable copy of it is worth naming even though it carries no number to
  // launder. `--seed` is the way to say "this repository has no baseline yet, write it
  // anyway"; nothing else silences this.
  const anchorNotes = [];
  if (anchorKnown && workingCopy.state !== 'ceilings' && workingCopy.state !== 'absent') {
    if (!seedRun) {
      refuse(
        `the artifact on disk ${workingCopy.problem}, and the push-time gate reads that\n` +
          `  file. The anchor is ${HEAD_REF}, so this run could compare it and refused to\n` +
          '  overwrite something it could not read:\n' +
          `    - ${OUT_REL}\n` +
          `  Restore it first: git checkout HEAD -- ${OUT_REL}\n` +
          '  (If this repository really has no baseline yet, that is what ' +
          `${SEED_FLAG} is for, and it will replace the file.)`
      );
    }
    anchorNotes.push(
      `anchor: the artifact on disk ${workingCopy.problem}, and ${SEED_FLAG} was passed, so ` +
        `this run replaces it.\n  The comparison was made against ${HEAD_REF}, not against it.`
    );
  }

  // The second guard: the working copy judged against the anchor, not against itself.
  // `deferredAdded` is the one difference this guard cannot decide without the
  // measurement (see 2b above), so it is carried down to where the numbers exist; every
  // other difference refuses right here, before a minute of eslint is spent on it.
  let deferredAdded = [];
  if (anchorKnown && workingCopy.state === 'ceilings') {
    const trip = workingCopyTrip({
      headRef: HEAD_REF,
      outRel: OUT_REL,
      head: anchorCeilings,
      working: workingCopy.ceilings
    });
    if (trip.refusal !== null) refuse(trip.refusal);
    deferredAdded = trip.deferredAdded;
    anchorNotes.push(...trip.notes);
  }
  return {
    anchorCeilings,
    anchorKnown,
    workingCopy,
    anchorNotes,
    deferredAdded,
    headScope: anchorScope.headScope,
    headFileCount: anchorScope.headFileCount,
    headShadow: anchorScope.headShadow
  };
}
