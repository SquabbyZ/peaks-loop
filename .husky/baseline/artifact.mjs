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
import { SW_SCOPE_KEY, SW_SCOPE_SOURCE } from '../peaks-gate-silent-warning.mjs';

import { OUT_PATH, rel } from './paths.mjs';

/** The seven extensions the published scope names, as the artifact spells them. */
const SCOPE_EXTENSIONS = 'ts, tsx, mts, cts, mjs, cjs, js';

/**
 * THE `scope` BLOCK — the boundary the ceilings are measurements OF (rid
 * `2026-10-03-w10-rescope-a`, extended by rid `2026-10-03-silent-warning-scope`).
 *
 * Two kinds of thing live here, and the monotonicity guard reads both:
 *   - `dirs` / `rule` / `extensions`: the gate-wide population, derived from this
 *     run's tracked file list (§2.42) — never an enumeration a human edits;
 *   - `silentWarning`: ONE LEG's population, recorded as `{ source, scannedFiles }`.
 *     The silent-warning rows used to ratchet a filesystem walk of `src/` (905) that
 *     no other row shared, and the artifact had no field that could say so — so a
 *     boundary move that left `dirs` untouched was inexpressible, and 17 swallows in
 *     `packages/<name>/src` stayed uncounted. A per-leg population record is METADATA: it
 *     is not a sixteenth ceiling, `CEILING_KEYS` stays the fifteen it is, and
 *     `.husky/monotonic/keys.mjs` still owns that set.
 *
 * Built ONCE and handed to both the decision and the bytes, so the guard cannot
 * compare one spelling of the boundary while the artifact records another.
 */
export function buildScopeBlock({ files, sw }) {
  return {
    dirs: deriveScopeDirs(files),
    rule: LINT_SCOPE_RULE,
    extensions: SCOPE_EXTENSIONS,
    [SW_SCOPE_KEY]: { source: SW_SCOPE_SOURCE, scannedFiles: sw.scannedFiles }
  };
}


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
 * THE ARTIFACT BYTES AS A STRING, with nothing around them — no directory, no
 * filesystem, no second clock read (rid `2026-10-03-shadow-move-rider`, W2.1).
 * Extracted from `writeArtifact` so determinism is testable at the level the defect
 * lives at: a 280 KB committed JSON is stable only if the ONE field that reads the
 * clock is `generatedAt`, and a key-order or `Set`-iteration change is invisible to a
 * deep object compare while it is a wall of diff in a committed artifact. The
 * generator has one caller, below, so the bytes the repository commits are the bytes
 * this returns.
 */
export function artifactDocumentText({ scope, scopeBlock, lint, format, size, ceilings, files, shadow }) {
  const { coverageGapFiles, notLinted, phantomRules, syntaxErrorFiles } = lint;
  const { unparsable } = format;
  return `${JSON.stringify(
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
        // THE ENFORCED SCOPE, DERIVED not typed (rid `2026-10-03-w10-rescope-a`; and
        // since rid `2026-10-03-silent-warning-scope` it records the per-leg
        // populations too). `buildScopeBlock` above is called ONCE by the entry and
        // handed to the monotonicity decision AND to these bytes, so the boundary the
        // guard compares is the boundary this artifact records — `dirs` derived from
        // THIS run's tracked file list (a new `packages/<x>/src/` joins the run its
        // first file is tracked), the rule, the extensions, and every leg population
        // the run measured. `scopeDirs()` in `scripts/lint/lint-file-list.mjs` reads
        // `dirs` verbatim, so this block is load-bearing for the per-file ratchet, and
        // the anchor comparison reads it too: a scope change without `--rescope`
        // refuses (`.husky/baseline/rescope.mjs`).
        scope: scopeBlock,
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
    )}\n`;
}

/**
 * The one write this generator performs, and the only production caller of
 * `artifactDocumentText`. Nothing here runs before `decideWrite` has agreed: the
 * inputs recorded with each ceiling (F2) come off the same envelope the rows come
 * off, so the gate can re-derive them and refuse a mismatch.
 */
export function writeArtifact(input) {
  // `.peaks/lint/` is a tracked directory today, but the seed path above is the one
  // run that may legitimately find it absent, and a refusal to write because of a
  // missing directory is not a refusal the operator can act on.
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, artifactDocumentText(input));
  console.error(`wrote ${rel(OUT_PATH)}`);
}
