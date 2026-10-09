#!/usr/bin/env node
/**
 * The ratchet's monotonicity rule, as a pure function.
 *
 * WHY THIS FILE EXISTS (backlog §2.27, rid `2026-10-02-baseline-monotonicity`).
 * `.husky/peaks-gate-baseline.mjs` writes a `note` into its own artifact that
 * says *"Every ceiling may only go DOWN — if a regeneration raises one, that is a
 * regression to fix, not a number to commit."* Until 2026-10-02 nothing in that
 * file implemented the sentence: it never read `OUT_PATH` back, so it held no
 * previous number to compare against. Measured on 2026-10-01, after C wave 7
 * staged 29 files of which seven were not prettier-formatted, the generator
 * raised `prettierUnformatted` 0 → 7, printed `wrote
 * .peaks/lint/gate-baseline.json` and exited **0**. Only a human diffing the
 * artifact key by key could see it, and the ratchet is precisely the thing a
 * human is not in the loop to check every time.
 *
 * WHY THE COMPARISON IS PURE AND NOT INLINE.
 *   1. The generator costs minutes — eslint over ~1,300 type-aware files, then
 *      prettier, then `tsc`, then the census. A decision table with seven rows
 *      cannot be tested at that price, and an untested guard on a ratchet is a
 *      rumour: this very sentence sat unenforced for six weeks while the code
 *      that printed it was green.
 *   2. Every row of that table is a *shape* (a key absent, a key vanished, a
 *      value that is not an integer) that the real measurement path produces only
 *      by accident, and an accident is not an arm. A pure function takes the two
 *      vectors as arguments, so each shape is handed over directly and the arm
 *      states which row it answers.
 * The subprocess half is not skipped, only bounded:
 * `tests/unit/lint/baseline-monotonicity-generator.test.ts` runs the real
 * generator against an isolated fixture repository, because only that can prove
 * the refusal happens BEFORE the write and that the artifact bytes are untouched
 * afterwards.
 *
 * WHAT "MONOTONIC" MEANS HERE, EXACTLY
 *   - equal or lower on every key the previous artifact carried → write.
 *   - any key HIGHER than the previous artifact's → refuse, with ONE exception:
 *     `fileSizeOverCap` against a strictly lower `fileSizeExcessLines`, in the same
 *     comparison. See THE ONE EXCEPTION below — it is the first, and so far the only,
 *     rise this ratchet has ever sanctioned. The ceiling is a permission, and this run
 *     is asking for more of it.
 *   - a key the previous artifact did NOT carry → write, but say so out loud. That
 *     row is the one that can be abused: "unrecognized key" and "brand-new row"
 *     look identical in an artifact, and `fileSizeExcessLines` was legitimately
 *     seeded this way on 2026-10-01. Silence is what makes the two indistinguishable.
 *   - a key the previous artifact carried and this run does not measure → refuse.
 *     Dropping a ceiling is the loudest possible weakening: it does not raise a
 *     number, it deletes the row that had one.
 *   - no previous artifact, or one that cannot be read or parsed → refuse unless
 *     the caller passes `--seed`. A corrupt ratchet must not become the excuse for
 *     a clean slate; whoever means the clean slate says so on the command line.
 *   - a ceiling that is not a finite non-negative integer → refuse on both sides.
 *     A string "2" and a `NaN` are not numbers the descent can be measured against,
 *     and comparing them would silently produce a verdict nobody earned.
 *
 * THE ONE EXCEPTION THIS RATCHET HAS EVER SANCTIONED (rid-039;
 * `docs/superpowers/specs/2026-10-09-post-mcp-current-state-roadmap.md` §3.6, where the
 * user chose this over leaving the two size rows independent).
 *   - THE RULE, IN FULL. `fileSizeOverCap` may go UP when, and ONLY when,
 *     `fileSizeExcessLines` is STRICTLY lower in the same comparison. Both rows must be
 *     present and valid on both sides of that one call: an excess row that is missing,
 *     was never measured, or is not a ceiling is not a SMALL excess, so the count rise
 *     stays refused. Equal is not a fall. Higher is not a fall. Nothing else moves — every
 *     other key refuses any rise exactly as before, and `fileSizeExcessLines` itself still
 *     refuses to rise. The comparison decides it (`.husky/monotonic/compare.mjs`, the
 *     `isCoupledRise` predicate) and returns the permitted rise in its OWN bucket, so it
 *     is never counted as refused by accident and never silent either: the permitted-write
 *     note prints the count that rose WITH the excess that fell beside it.
 *   - WHY THE PROXY HAD TO BEND. The excess lines are the debt; the file count is a coarse
 *     proxy for it, and a proxy with an independent ratchet punishes the INTERMEDIATE steps
 *     of the one fix that exists. Measured: `src/cli/commands/loop-eval-commands.ts` is
 *     1,125 lines against the 300 cap — 825 excess. Split in two, the excess falls
 *     825 → 526 and the count rises 1 → 2, and the old rule refused the descent. Split in
 *     four, the count falls to 0 and it was always allowed. The rule never forbade the
 *     SPLIT; it forbade the honest middle of the job.
 *   - WHY THIS IS NOT A BACK DOOR. Three properties, each measured by an arm in
 *     `tests/unit/lint/baseline-monotonicity-coupled-rise.test.ts` rather than promised
 *     here. (1) It is keyed to ONE pair in ONE direction, so no second row is eligible and
 *     nothing can be traded sideways. (2) The fall is not a claim the caller makes, it is
 *     the measured vector's other row: the comparison sees both numbers or it sees the
 *     refusal, and dropping the excess row to buy the count rise turns a permitted rise
 *     into a `removed` row — the loudest weakening this file already refuses. (3) It opens
 *     no second ledger: every comparison is per-row integers with no arithmetic between
 *     rows, so a million-line descent on the excess cannot buy the rise of a key that is
 *     not the count. A ratchet that can trade across rows is a budget, and this is a
 *     ceiling.
 *   - WHERE THE EXEMPTION APPLIES, AND WHY THAT IS NOT A WIDER ONE. The rule lives in the
 *     comparison, so it holds wherever the comparison runs — including the working-copy
 *     trip, which is the second trip over the same pair of vectors. That is deliberate: if
 *     only the measurement leg knew the rule, one run that legitimately wrote a count of 2
 *     against an anchor of 1 would leave a working copy the NEXT run calls LIFTED before the
 *     commit, and the remedy that refusal prints (`git checkout HEAD -- …`) would delete the
 *     number the previous run had just earned — backlog §2.35's trap, reached from the other
 *     side. The trip cannot admit a number by permitting this: it writes nothing and decides
 *     no ceiling, and the artifact's numbers are always this run's measurement, which
 *     `decide.mjs` re-judges against HEAD afterwards. It does not pass the difference in
 *     silence either — the permitted pair is printed with both sides' numbers, because a disk
 *     that differs from the anchor is a fact the operator reads, not a detail the guard keeps.
 *   - THE KNOWN AND ACCEPTED LIMIT, recorded instead of plugged. A permitted rise is NOT
 *     BOUNDED. One 1,125-line file could become a hundred 301-line files — excess 825 → 100,
 *     count 1 → 100 — and this policy permits it. That shape is accepted, and it is written
 *     here so the next reader meets it as a decision rather than as a surprise. No maximum
 *     rise exists in the code on purpose: every bound proposed for it is a number nobody has
 *     measured, and a guard that fires on a shape nobody has seen teaches operators to argue
 *     with the guard. If the degeneracy ever happens, the count row records it, out loud, in
 *     the artifact.
 *
 * WHERE "PREVIOUS" MEANS SINCE REPAIR CYCLE 1 (rid 2026-10-02-monotonicity-head-anchor).
 *   C wave 8 read the previous ceilings out of `OUT_PATH` — the working-tree
 *   artifact, which is the same file the run is about to overwrite and the same file
 *   a weakening edits. An out-of-band review measured three ways past it: delete a
 *   row and the run prints `NEWLY SEEDED` and writes it; inflate a row and the run
 *   prints `CLEARED` and writes the descent; set `"ceilings": {}` and all thirteen
 *   rows re-seed, because an empty object parses. The push leg made it worse, not
 *   better: the remedy its own refusal prints is `Regenerate it: node
 *   .husky/peaks-gate-baseline.mjs`, so an operator following the gate's instruction
 *   performs attack one. So "previous" is now `git show HEAD:` of this file, which
 *   an edit of the working tree cannot move, and the working tree is a SECOND,
 *   INDEPENDENT trip rather than the source of the numbers.
 *
 * THE ORDER THE DECISIONS RUN IN — decided here, because the arms and the code have
 * to agree about which refusal an input gets:
 *   1. Read HEAD's artifact. Unreadable, unparseable, or a `ceilings` block with not
 *      one canonical row in it → there is no baseline. Refuse and tell the operator
 *      about `--seed`; only `--seed` turns that into the documented seed path where
 *      every canonical row is reported as newly seeded. This is also the arm for a
 *      repository with no git at all: the refusal names the git error, it does not
 *      throw it.
 *   2. Compare the artifact on disk with HEAD's BEFORE measuring anything, and refuse
 *      if it LIFTS a number, DROPS a row or carries a value that is not a ceiling.
 *      Those edits are the attack whatever this run goes on to measure, and a generator
 *      that judges its own measurement against them has already lost. `--seed` does not
 *      unlock this refusal: the flag is the statement that a baseline is MISSING, never
 *      permission to write over an edited one. A working copy that is only LOWER than
 *      HEAD is a stricter request, not an attack: it is allowed through, named in the
 *      notes, and the measurement decides the number that is finally written.
 *   2b. A row the disk ADDS and HEAD never carried is the one difference whose verdict
 *      depends on the measurement, so it is DEFERRED rather than refused (backlog
 *      §2.35): refusing it outright made a slice that introduces a ceiling row unable to
 *      regenerate twice before its commit, and the remedy the refusal printed —
 *      `git checkout HEAD -- <artifact>` — would have deleted the row the previous run
 *      legitimately measured. `settleDeferredAdded` decides it once the number exists:
 *      measured at the same value → seeded, and said out loud; not measured at all → a
 *      hand-typed row, refused, and only there does the restore advice belong; measured
 *      at a different value → refused naming both, because the measurement decides.
 *   3. Audit the anchor, the artifact on disk and this run's measurement against
 *      `CEILING_KEYS` by set equality. HEAD may be missing a canonical row — that is
 *      how a new ceiling gets seeded — but only when the artifact on disk is missing
 *      it too, and never in a `--seed` run, where there is no anchor to be missing
 *      from. A disk row §2b has already refused as hand-typed is named ONCE, by §2b:
 *      the reasons are collected so an operator is not shown only the first of two,
 *      which is not a licence to show the same row twice under two headings.
 *   4. Compare HEAD's ceilings with the measurement: equal or lower on every row
 *      writes, any raise refuses, any canonical row this run stopped measuring
 *      refuses. THE ONE EXCEPTION above is decided inside this comparison, so it is
 *      neither a fifth refusal nor a step of its own.
 *   5. Write, and print which rows moved.
 */

/**
 * THE PUBLIC SURFACE, RE-EXPORTED FROM ITS HOME MODULES. This file is the stable
 * entry every import site already names (`.husky/peaks-gate-baseline.mjs` line 86,
 * the `tests/unit/lint/baseline-monotonicity*.test.ts` files, and the fixtures that
 * copy `.husky` trees); wave 9 slice 2 moved the BODIES to `.husky/monotonic/*.mjs`
 * verbatim and changed nothing here but the resolution. Siblings are imported
 * entry-relative (`./monotonic/...`) so the whole set loads in a fixture tree the
 * same way it loads in the repository — the wave 7 / slice 1 `ERR_MODULE_NOT_FOUND`
 * class, closed the same way slice 1 closed it for `.husky/gate/`.
 */
export { SEED_FLAG } from './monotonic/internal.mjs';
export {
  CEILING_KEYS,
  ceilingProblem,
  canonicalKeyProblems,
  missingCanonicalKeys,
  unseedableKeys
} from './monotonic/keys.mjs';
export { compareCeilings, parsePreviousArtifact } from './monotonic/compare.mjs';
export { describeCanonicalKeyFailure, describeMonotonicityFailure } from './monotonic/failures.mjs';
export { settleDeferredAdded, workingCopyTrip } from './monotonic/trip.mjs';
export { describeMonotonicityNotes } from './monotonic/notes.mjs';
