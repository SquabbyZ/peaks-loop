#!/usr/bin/env node
/**
 * scripts/git-hook-env.mjs — strip the environment git injects into a hook.
 *
 * WHY THIS EXISTS (measured 2026-10-05, on the 4.1.1 push). `.husky/pre-push` runs
 * `pnpm test:changed` as its second leg, and this repo's trigger list sends that leg to
 * the FULL unit suite. git exports `GIT_DIR` (and friends) to every hook, the runner
 * inherits it, and the suite inherits it from the runner. Dozens of tests build a scratch
 * repository with `git init` in `mkdtempSync` and then `git commit` into it — with
 * `GIT_DIR` pointing at the host repository, those commits land IN THE HOST. The measured
 * result of one pre-push run: 233 arms red across 50 files (vs 0 red for the identical
 * suite outside the hook), and 169 commits whose subjects are `fixture` / `baseline` /
 * `init` written onto the branch being pushed. `git reset --hard` and a backup tag cleaned
 * the branch; nothing reached `origin`, because the leg failed before the push left the
 * machine.
 *
 * The one-file proof of the mechanism: export `GIT_DIR` alone and
 * `tests/unit/services/scan/file-size-scan.test.ts` goes from 19/19 passed to 18 failed.
 *
 * WHY A SEPARATE MODULE AND NOT A CONSTANT IN `test-changed.mjs`: that script runs its
 * whole main flow at import, so a test cannot import a constant from it without executing
 * a suite. A pure module is testable at the level the defect lives at — which is the same
 * reason `.husky/monotonic/keys.mjs` and `.husky/file-size/*.mjs` exist.
 *
 * Only the CHILD's environment is scrubbed. The runner's own `git rev-parse` / `git diff`
 * keep whatever git handed them, so nothing here changes how the diff is computed.
 */

/**
 * The variables git exports to a hook process. `GIT_*` is not enumerated wholesale on
 * purpose: `GIT_TRACE`, `GIT_HTTP_*` and a user's `GIT_*` settings are nobody's business
 * to delete, and removing them would make the hooked suite differ from a manual run in a
 * NEW way while fixing it in one old way. Every entry below is a variable whose value
 * relocates git's own context away from the working directory.
 */
export const GIT_CONTEXT_VARS = Object.freeze([
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_PREFIX',
  'GIT_QUARANTINE_PATH',
  'GIT_NAMESPACE'
]);

/**
 * A copy of `env` with git's context variables removed. Returns a NEW object (never
 * mutates `process.env`, which the runner's own git calls still need) and preserves
 * everything else, including key order for the survivors.
 */
export function scrubGitHookEnv(env = process.env) {
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    if (!GIT_CONTEXT_VARS.includes(key)) out[key] = value;
  }
  return out;
}
