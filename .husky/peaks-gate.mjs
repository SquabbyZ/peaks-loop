#!/usr/bin/env node
/**
 * peaks-gate — the ratchet gate driven by husky.
 *
 * WHY A RATCHET AND NOT A STRICT CHECK
 * ------------------------------------
 * Measured 2026-09-19: 1178 of 1266 source files are unformatted, eslint
 * reports 6597 findings across 1233 files, and `tsc -p tsconfig.json` reports
 * 142 errors. A hook that failed on "any lint error" would block every commit
 * from the first one, on files the committer never touched — and a gate that
 * is dead on arrival is not a strict gate, it is a gate people learn to bypass
 * with `--no-verify`.
 *
 * So this gate enforces the property that IS satisfiable today and that still
 * closes the door on new debt:
 *
 *   staged mode  — a file you touch may not be WORSE than it was; a file that
 *                  did not exist before must be clean outright. The file list
 *                  comes from lint-staged (the index).
 *   changed mode — the SAME per-file rule, applied to the files the commits
 *                  being pushed touched. Same comparison, different source of
 *                  the file list. This is what pre-push runs.
 *   repo mode    — the whole-repo totals may not grow. CI only (slice B5).
 *   silent-warning mode — the two silent-warning legs on their own: same
 *                  detector, same `check`, same ceilings as `repo` mode, without
 *                  eslint / prettier / tsc. It exists so a unit test can inject
 *                  a swallow and watch THIS leg go red (slice a3).
 *   file-size mode — the over-cap census leg on its own: same census, same
 *                  `check`, same ceiling as `repo` mode, for the same reason — a
 *                  unit test has to hand it one over-cap file and watch THIS leg
 *                  go red (rid 2026-09-30-cap-unify-01). A named-file list needs
 *                  `--control-arm`: a subset cannot fail a whole-tree row, so
 *                  without the flag the leg refuses instead of printing one
 *                  (repair cycle F1).
 *
 * The ceilings in `.peaks/lint/gate-baseline.json` are lowered slice by slice
 * by the cleanup program. At zero these same hooks are the strict gates,
 * unchanged — nothing here has to be rewritten to get there.
 *
 * AN UNLINTED FILE IS NOT A CLEAN FILE
 * ------------------------------------
 * `parserOptions.project` does not cover `packages/**` or `scripts/**`, so
 * eslint fails those files with "not found in any of the provided project(s)"
 * BEFORE it parses them. 71 files are in that state. Counting that artifact as
 * a lint finding would (a) inflate the ceiling with 71 numbers that are not
 * debt and (b) make every NEW file under those two directories permanently
 * unclean, i.e. uncommittable. Both were true of the first draft of this
 * script. So coverage gaps and syntax errors are classified out of the
 * findings, tracked on their own ceiling lines, and never traded against real
 * debt. A coverage gap also MASKS a real syntax error — eslint stops at the
 * project error and never parses — so the two must not share a counter.
 *
 * Exit codes: 0 pass, 1 gate failed (commit/push must be blocked), 2 usage.
 * An EMPTY change set exits 0 but says so in full sentences — see reportEmpty().
 */
import { lintFileList } from '../scripts/lint/lint-file-list.mjs';
// `../.husky/`, NOT `./`: a gate COPY has to be able to load. `lintFileList` is
// reached the same way (`../scripts/lint/…`) because `tests/unit/lint/lint-file-list-parity.test.ts`
// runs a scratch copy of THIS file from `.tmp/` — one level under the repo root, so
// `<copy dir>/..` is the repo root — to prove its own CONTROL arm goes red. When
// this file grew a sibling helper (repair cycle F5) the copy stopped loading at
// all: `ERR_MODULE_NOT_FOUND` on `.tmp/peaks-gate-file-size.mjs`, exit 1, no output,
// and the control arm failed with "the gate exited (1) before printing its scope
// line" — a guard that cannot be watched failing is a guard that is decoration. The
// copy-safe spelling costs nothing in-tree (`../.husky/x` from `.husky/x` is the
// same file) and is what keeps the enforcement surface copyable. If you are about
// to "clean this up" to `./`, run that parity test first.
import { changedMode } from '../.husky/gate/changed.mjs';
import { repoMode } from '../.husky/gate/repo.mjs';
import { fileSizeMode, silentWarningMode, stagedMode } from '../.husky/gate/modes.mjs';

// THE REPO-MODE FILE LIST IS DECIDED AT THE ENTRY, ON PURPOSE. The parity guard
// copies THIS file alone and weakens the line below; see `.husky/gate/repo.mjs`.
function repoFileList() {
  // The same list `pnpm lint` lints: `git ls-files` x the published scope, from
  // the one module that owns it. This used to be a local `execFileSync('git',
  // ['ls-files'])…filter(inScope)` with `inScope` built from this file's own
  // `CODE_EXT`, i.e. a second copy that no test read (see the SCOPE_DIRS note).
  const files = lintFileList();
  return files;
}

// ---------------------------------------------------------------------------
const mode = process.argv[2];
const code =
  mode === 'staged'
    ? await stagedMode(process.argv.slice(3))
    : mode === 'changed'
      ? await changedMode()
      : mode === 'repo'
        ? await repoMode(repoFileList())
        : mode === 'silent-warning'
          ? await silentWarningMode(process.argv.slice(3))
          : mode === 'file-size'
            ? fileSizeMode(process.argv.slice(3))
            : (console.error(
                'usage: peaks-gate.mjs <staged|changed|repo|silent-warning|file-size> ' +
                  '[--control-arm] [files...]'
              ),
              2);
process.exit(code);
