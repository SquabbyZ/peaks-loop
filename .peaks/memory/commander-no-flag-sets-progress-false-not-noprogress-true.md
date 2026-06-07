---
name: commander-no-flag-sets-progress-false-not-noprogress-true
description: Commander.js --no-X flags set options.X = false, NOT options.noX = true. Reading `options.noX === true` is always wrong after a --no- prefix. Test the actual CLI parser, not the service layer.
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-06-07-session-84feb7/txt/handoff-013-2026-06-07-hooks-install-no-progress-flag.md
---

Commander.js's `--no-X` flag translation: when a CLI command declares `.option('--no-progress', '...')`, commander parses the user's `--no-progress` into `options.progress = false` (note: the BASE name, with `false`). It does NOT set `options.noProgress = true`. Code that reads `options.noProgress === true` after a `--no-progress` flag is therefore always a silent no-op.

**Bug class exemplar (slice #013):** The initial RD attempt at `src/cli/commands/hooks-commands.ts:93` wrote `const skipProgress = options.noProgress === true;`. Unit tests in `tests/unit/hooks-settings-service.test.ts` passed because they bypassed the CLI parser and called `applyHookInstall(..., { skipProgress: true })` directly at the service layer. The bug was invisible until QA ran a tmpdir e2e dogfood that spawned the real CLI binary and checked the JSON envelope for the actual install shape. Fix: `const skipProgress = options.progress === false;` (commander's translation of `--no-progress` is `options.progress = false`).

**Why this bug class is dangerous:**
- Single-process unit tests that import the action handler directly (calling `await action(options)`) often bypass commander's flag parsing, so they don't catch it
- The CLI binary DOES parse the flag, but only an e2e tmpdir dogfood (or a CLI-spawning test) exercises the real path
- A naive grep for `options.noProgress` in the codebase returns the buggy code with no warning — the type system doesn't catch it (commander infers `progress?: boolean` from the option name; `noProgress?: boolean` is a separate property the user has to define explicitly, which is why the read returns `undefined`)
- The fix is one character (`true` → `false`) but the type signature also has to change to match commander's convention

**How to apply:** When adding a `--no-X` flag to any peaks CLI command:
1. Define the option: `.option('--no-X', 'description')`
2. Read it as: `const skipX = options.X === false;` (NOT `options.noX === true`)
3. Update the `HookCliOptions`-like type: `X?: boolean` (NOT `noX?: boolean`)
4. Test it: write at least one CLI-parse test that spawns the real binary (`node dist/src/cli/index.js <cmd> --no-X ...`) and asserts the JSON envelope reflects the intended behaviour. Don't rely on service-layer unit tests alone.
5. Code review: when a `--no-X` option appears in a diff, immediately verify the read-side uses `options.X === false`, not `options.noX === true`.

**Related:** `static-scan-must-cover-skills-tree-not-just-src` (dual-surface scan coverage for paths; this is dual-surface test coverage for CLI parsing — service-layer unit tests alone miss commander-flag bugs).

**Future fix candidates:** A static scan in `tests/unit/cli/` that greps all `options\.no\w+ === true` and `options\.no\w+ \?` patterns in `src/cli/commands/*.ts` and asserts each is paired with a corresponding `--no-X` option declaration. The scan would have caught slice #013's bug at typecheck time. Out of scope for the slice; tracked for slice #014.
