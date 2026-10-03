/**
 * `.husky/baseline/artifact.mjs` — the three assembly blocks that turn this
 * run's measurements into the artifact bytes (rid
 * `2026-10-02-wave9-generator-split`, HEAD lines 616–627 as `buildFileRecords`,
 * 629–662 as `buildCeilings`, 735–798 as `writeArtifact`).
 *
 * THE ROWS ARE STILL SEEDED FROM THE ENVELOPE AND NEVER FROM A LITERAL: every
 * value in `ceilings` is a destructured measurement, which is why the legs arrive
 * as records and why the guard arms that read
 * `fileSizeOverCap: size.env.overCap` still find that text — pooled over the
 * generator module set (backlog §2.28), because since this split it no longer
 * lives in the entry. `writeArtifact` is still called AFTER `decideWrite`, so no
 * row is written by a run that a guard refused.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { LINT_SCOPE_RULE, deriveScopeDirs } from '../lint-scope.mjs';

import { OUT_PATH, rel } from './paths.mjs';

/** The per-file rows: eslint classification plus the prettier verdict. */
export function buildFileRecords({ scope, lint, format }) {
  const { classify, messagesByFile } = lint;
  const { prettierCleanByFile } = format;
  // ---- write -----------------------------------------------------------------
  const files = {};
  for (const file of scope) {
    const v = classify(messagesByFile[file]);
    files[file] = {
      eslint: v.notLinted ? 0 : v.eslint,
      eslintErrors: v.notLinted ? 0 : v.eslintErrors,
      coverageGap: v.notLinted ? false : v.coverageGap,
      notLinted: Boolean(v.notLinted),
      prettierClean: prettierCleanByFile[file] ?? false
    };
  }
  return files;
}

/**
 * THE FIFTEEN ROWS, assembled before anything is written, because they are what
 * `decideWrite` compares. Destructured from the leg records rather than typed:
 * a literal here would freeze a ceiling in place of the measurement.
 */
export function buildCeilings({ lint, format, tscErrors, sw, size }) {
  const { coverageGapFiles, errors, findings, notLinted, phantomFindings, syntaxErrorFiles } = lint;
  const { prettierDirty, unparsable } = format;
  // THE FIFTEEN ROWS, assembled before the artifact is written, because they are
  // what the comparison below reads. Nothing here may type a number: every value is
  // a measurement this run made, for the same reason the census and the
  // silent-warning rows refuse a literal.
  const ceilings = {
    eslintFindings: findings,
    eslintErrors: errors,
    eslintPhantomFindings: phantomFindings,
    eslintCoverageGapFiles: coverageGapFiles.length,
    eslintSyntaxErrorFiles: syntaxErrorFiles.length,
    eslintNotLintedFiles: notLinted.length,
    prettierUnformatted: prettierDirty,
    prettierUnparsableFiles: unparsable.length,
    tscErrors,
    silentWarningCatchReturnNull: sw.catchReturnNull,
    silentWarningEmptyCatch: sw.emptyCatch,
    fileSizeOverCap: size.env.overCap,
    // THE SAME ENVELOPE, THE OTHER SCOPE (rid `2026-10-02-hooks-size-rows`, §2.32):
    // the files over the cap and the LINES over those caps, counted over `.husky/` —
    // the directory the ratchet itself lives in, which was outside
    // `FILE_SIZE_SCOPE_DIRS` and so was measured by nothing at all. Both come off the
    // SAME census run's `hooks` block, and neither may be typed. They sit BEFORE
    // `fileSizeExcessLines` deliberately: the fixture arms of
    // `tests/unit/lint/baseline-monotonicity-seeding.test.ts` anchor their own
    // patch-on-a-copy on the last row of this object, and a new row that lands after
    // it silently un-anchors that guard.
    fileSizeHooksOverCap: size.env.hooks.overCap,
    fileSizeHooksExcessLines: size.env.hooks.excessLines,
    // THE SAME ENVELOPE, THE OTHER UNIT (rid `2026-10-01-file-size-excess-row`):
    // the files over cap above, and the LINES over those caps. Nothing may type
    // this number either — it is the census's own `excessLines`, the figure the
    // gate prints in its scope note and, from this row on, enforces.
    fileSizeExcessLines: size.env.excessLines
  };
  return ceilings;
}

/**
 * The artifact bytes, and the one write this generator performs. Nothing here
 * runs before `decideWrite` has agreed: the inputs recorded with each ceiling (F2)
 * come off the same envelope the rows come off, so the gate can re-derive them
 * and refuse a mismatch.
 */
export function writeArtifact({ scope, lint, format, size, ceilings, files, shadow }) {
  const { coverageGapFiles, notLinted, phantomRules, syntaxErrorFiles } = lint;
  const { unparsable } = format;
  // `.peaks/lint/` is a tracked directory today, but the seed path above is the one
  // run that may legitimately find it absent, and a refusal to write because of a
  // missing directory is not a refusal the operator can act on.
  mkdirSync(dirname(OUT_PATH), { recursive: true });

  writeFileSync(
    OUT_PATH,
    `${JSON.stringify(
      {
        version: 3,
        generatedAt: new Date().toISOString(),
        note:
          'Ratchet baseline for the husky gate. Every ceiling may only go DOWN — if a regeneration ' +
          'raises one, that is a regression to fix, not a number to commit. Lint counts exclude ' +
          'coverage gaps, syntax errors and findings from ruleIds the pinned plugin does not ' +
          'define; each excluded class has its own ceiling line so that no artifact and no config ' +
          'bug can hide inside a number traded against real debt. Generated by ' +
          '.husky/peaks-gate-baseline.mjs with explicit file paths + --no-ignore.',
        invocation: {
          explicitPaths: true,
          noIgnore: true,
          linted: scope.length - notLinted.length
        },
        // THE ENFORCED SCOPE, DERIVED not typed (rid `2026-10-03-w10-rescope-a`):
        // the pattern lives in `.husky/lint-scope.mjs`; `deriveScopeDirs` enumerates
        // from THIS run's tracked file list, so a new `packages/<x>/src/` joins the
        // artifact's dir list the run its first file is tracked. `scopeDirs()` in
        // `scripts/lint/lint-file-list.mjs` reads these dirs verbatim — this block is
        // load-bearing for the per-file ratchet, and the anchor comparison reads it
        // too: a scope change without `--rescope` refuses (`.husky/baseline/rescope.mjs`).
        scope: {
          dirs: deriveScopeDirs(scope),
          rule: LINT_SCOPE_RULE,
          extensions: 'ts, tsx, mts, cts, mjs, cjs, js'
        },
        // REPORTED, NEVER GATED (H3): the debt that sits OUTSIDE the enforced scope,
        // measured by the same legs, so a future widening re-measures it instead of
        // discovering it. Not in `CEILING_KEYS`; nothing compares these numbers.
        shadow,
        phantomRules: [...phantomRules],
        ceilings,
        // The unit the row above is counted in, copied off the census envelope
        // rather than restated: `split('\n').length` and `wc -l` differ by one per
        // file, so 174 files is a 174-line ambiguity unless the artifact says
        // which convention produced it.
        fileSizeLineConvention: size.env.convention,
        // THE CEILING'S INPUTS, RECORDED WITH THE CEILING (repair cycle F2). Binding
        // only the convention left the number free to mean anything: measured by the
        // security audit on 2026-09-30, caps 300/500 → 174, 400/600 → 162, retiring
        // the cap to 800 → **40 and a GREEN gate**, and dropping `ts` from the
        // extension list → 5 over cap out of 43 counted files, which the
        // `countedFiles <= 0` trip cannot see. A ratchet whose input can be
        // re-decided underneath it is not a ratchet, so `.husky/peaks-gate.mjs` now
        // re-derives these four fields from a live census run and REFUSES the leg on
        // any mismatch. They come from the envelope, never from a literal, so this
        // generator cannot record an input it did not measure.
        fileSizePolicyInputs: {
          defaultCap: size.env.caps.defaultCap,
          testsCap: size.env.caps.testsCap,
          scopeDirs: size.env.scope.dirs,
          scopeExtensions: size.env.scope.extensions,
          // THE SECOND SCOPE'S INPUTS, RECORDED THE SAME WAY (§2.32). The hooks rows
          // ratchet a number produced by a cap, a directory list, an extension list and
          // a unit; without these four fields a re-decision of any of them would move
          // `fileSizeHooksOverCap`'s meaning and the gate would call that green. They
          // come off the envelope's `hooks` block, so this generator cannot record an
          // input it did not measure.
          hooksCap: size.env.hooks.caps.hooksCap,
          hooksScopeDirs: size.env.hooks.scope.dirs,
          hooksScopeExtensions: size.env.hooks.scope.extensions,
          hooksLineConvention: size.env.hooks.convention
        },
        coverageGapFiles,
        syntaxErrorFiles,
        notLinted,
        prettierUnparsable: unparsable,
        files
      },
      null,
      2
    )}\n`
  );
  console.error(`wrote ${rel(OUT_PATH)}`);
}
