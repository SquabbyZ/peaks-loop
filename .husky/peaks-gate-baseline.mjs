#!/usr/bin/env node
/**
 * Regenerates .peaks/lint/gate-baseline.json — the ceilings the husky gate
 * ratchets against. Run it after a cleanup slice has landed, to lower a
 * ceiling to the new measured value:
 *
 *   node .husky/peaks-gate-baseline.mjs
 *
 * It measures, it never guesses: every number written here is read off the
 * tools in this run. Read the diff before committing it anyway — what the
 * ceilings may not do is go UP. Since rid `2026-10-02-baseline-monotonicity` that
 * sentence is enforced here as well as written into the artifact, and since its
 * repair cycle (`2026-10-02-monotonicity-head-anchor`) the number it is enforced
 * against is read out of git — `git show HEAD:.peaks/lint/gate-baseline.json` —
 * rather than out of the file this run is about to overwrite, which is the file a
 * weakening edits. The working copy is audited against that anchor as a second,
 * independent trip, the ceiling key set is audited against `CEILING_KEYS`, and any
 * of the three refusals stops the run before a byte changes
 * (`.husky/peaks-gate-baseline-monotonic.mjs`). Before those slices the rule was
 * only a sentence in the file's own `note`, and on 2026-10-01 the generator raised
 * `prettierUnformatted` 0 → 7 and exited 0.
 *
 * WHY EXPLICIT PATHS + --no-ignore
 * --------------------------------
 * The obvious invocation — `eslint src tests packages scripts` — silently
 * skipped 33 files, because `.peaks-rules.cjs` sets `ignorePatterns:
 * ['skills/', ...]` to exclude the repo-root prose directory and ESLint reads a
 * trailing-slash pattern with no inner slash the way .gitignore does: it
 * matches a directory of that name at ANY depth. `src/services/skills/`,
 * `src/skills/`, and two test directories — 33 files, production source among
 * them — were recorded as "0 findings" without ever being parsed.
 *
 * Passing the file list explicitly and disabling ignore patterns removes that
 * whole failure mode. It is safe here only because the arguments are always
 * FILES and never directories: `--no-ignore` on a directory would descend into
 * node_modules.
 *
 * CLASSES THAT ARE NEVER BLURRED INTO `findings`
 * ---------------------------------------------
 * `coverageGap`    — parserOptions.project does not cover the file; eslint
 *                    fails it before parsing. Also MASKS real defects, since
 *                    parsing never happens.
 * `syntaxError`    — in the project, cannot be parsed. A real defect.
 * `phantomRules`   — a ruleId the config names but the pinned plugin does not
 *                    define. Fires on EVERY parsed file, so counting it as debt
 *                    both inflates the ceiling by ~2400 and makes "a NEW file
 *                    must be clean" unsatisfiable. The set is derived from the
 *                    messages, never hardcoded, so it cannot go stale.
 * `notLinted`      — eslint reported nothing at all for a file we asked about.
 * `unparsable`     — prettier cannot parse it.
 * Each has its own ceiling line. None is ever counted as a lint finding, so
 * none can be traded against real debt.
 */

// THE SPLIT (rid `2026-10-02-wave9-generator-split`). HEAD's 799 lines were one
// straight-line script with a top-level `await`; a script has no seams to cut, so
// its regions became functions in `.husky/baseline/` that take the bindings their
// producer built and return the bindings a later region read — the dataflow table in
// the envelope is that contract, region by region. WHAT IS NOT A REWRITE: the order
// of these calls is HEAD's order of execution, every refusal still runs before the
// write that follows it, and every diagnostic still prints from inside the leg that
// measured it — and the paragraph under THE PIPELINE names the test that measures that
// claim leg by leg, so it is not this file's own word for it. HEAD's own import
// block (54–86) is the only thing here that is replaced rather than moved: each
// symbol it named is imported by the module that now uses it, and `FS_CEILING_KEY`
// was dead in HEAD and is not carried anywhere.
import { guardAnchor } from './baseline/anchor.mjs';
import { measureCensusLeg } from './baseline/census-leg.mjs';
import {
  buildCeilings,
  buildFileRecords,
  buildScopeBlock,
  writeArtifact
} from './baseline/artifact.mjs';
import { decideWrite } from './baseline/decide.mjs';
import { measureEslintLeg } from './baseline/eslint-leg.mjs';
import { measurePrettierLeg } from './baseline/prettier-leg.mjs';
import {
  RESCOPE_FLAG,
  rescopeRun,
  shadowStderrLine,
  shadowTally,
  scopeTally
} from './baseline/rescope.mjs';
import { measureScope } from './baseline/scope.mjs';
import { measureSilentWarningLeg, measureTscErrors } from './baseline/tool-legs.mjs';
import { shadowScopeDirs } from './lint-scope.mjs';

// The ratchet's own rule, one module down from the sentence that states it in the
// artifact. Pure, so every row of its decision table is testable without paying for
// a whole measurement run — see the header of that file for why an untested guard on
// a ratchet is a rumour, which is exactly what this one was, and for the order the
// refusals below run in (anchor first, working copy second, canonical set third).
// THE PIPELINE, in HEAD's order: anchor first (it refuses before a minute of eslint
// is spent on a verdict an edit already decided), then the four measurements, then
// the rows they seed, then the decision, then — and only then — the bytes. That order
// is measured rather than promised: `tests/unit/lint/baseline-split-equivalence.test.ts`
// runs TWO fixture repositories with identical inputs — one with this file as HEAD
// carries it (`git show HEAD:.husky/peaks-gate-baseline.mjs`) plus its dependency
// closure, one with this entry plus `.husky/baseline/` — and requires the same exit code,
// the same artifact bytes modulo `generatedAt`, and byte-identical stdout and stderr for
// every branch those states reach: the seed path, the legitimate second run, and each of
// the three §2.33 attacks (delete a row, lift a row, empty `ceilings`). A refused attack
// failing to leave the bytes untouched, or a refusal reaching the write, reddens it for
// the true reason. Its three mutation controls break one split leg at a time — a dropped
// refusal, a reflowed diagnostic, one word of the artifact note — and the matching leg
// goes red, so the comparison is known to be able to fail.
const anchor = guardAnchor();
// THE PARTITION (rid `2026-10-03-w10-rescope-a`): the legs still walk the whole
// measurement universe, so the out-of-scope debt stays MEASURED; the ceilings
// enforce only the gated subset, and the rest ships as shadow rows.
const measured = measureScope();
const lint = measureEslintLeg({ scope: measured.files });
const format = await measurePrettierLeg({ scope: measured.gated });
const tscErrors = measureTscErrors();
// THE LEG MEASURES THE ENFORCED SCOPE, NOT ITS OWN WALK (§2.43): `measured.gated` is
// the same array the eslint leg iterates, the prettier leg formats and `buildFileRecords`
// writes rows for. It used to be `measured.files` — the whole measurement universe —
// and the leg ignored either one, because the detector walked `src/` and reported its
// own 905 files while every other row on the screen came from 943.
const sw = measureSilentWarningLeg({ scope: measured.gated });
const size = measureCensusLeg();
const gatedLint = scopeTally(measured.gated, lint);
const shadow = {
  scopeDirs: shadowScopeDirs(measured.shadow),
  measuredFiles: measured.shadow.length,
  ...shadowTally({ shadow: measured.shadow, lint, size: size.partition })
};
// THE BOUNDARY, DERIVED ONCE (§2.42 + §2.43): `dirs` from the gated population, plus
// every per-leg population record the legs measured — here, the silent-warning leg's.
// The SAME object goes to the monotonicity decision and to the bytes, so the guard can
// never compare one spelling of the boundary while the artifact records another.
const scopeBlock = buildScopeBlock({ files: measured.gated, sw });
// Printed on EVERY run, refused or not — "0 findings" and "nothing checked"
// must never share an output (H3, §2.41's shape).
console.error(shadowStderrLine(shadow));
const files = buildFileRecords({ scope: measured.gated, lint, format });
// The ROWS describe the enforced scope: the census's own numbers, split by the
// lint-scope rule. The whole-universe inputs stay recorded beside them
// (`fileSizePolicyInputs`), so the binding still re-derives against a live run.
const sizeRows = {
  ...size,
  env: {
    ...size.env,
    overCap: size.partition.gated.overCap,
    excessLines: size.partition.gated.excessLines
  }
};
const ceilings = buildCeilings({ lint: gatedLint, format, tscErrors, sw, size: sizeRows });
// `...anchor` carries HEAD's shadow block (`headShadow`); `shadow` is this run's.
// `decideWrite` compares the two out loud and writes neither the exit code nor a key
// from that comparison (W1, rid `2026-10-03-shadow-move-rider`).
decideWrite({
  ...anchor,
  ceilings,
  shadow,
  rescope: {
    flag: rescopeRun,
    newScope: scopeBlock,
    gatedCount: measured.gated.length
  }
});
writeArtifact({
  scope: measured.gated,
  scopeBlock,
  lint: { ...gatedLint, phantomRules: lint.phantomRules },
  format,
  size,
  ceilings,
  files,
  shadow
});
