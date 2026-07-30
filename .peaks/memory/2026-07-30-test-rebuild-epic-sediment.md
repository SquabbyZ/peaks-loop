---
name: 2026-07-30-test-rebuild-epic-sediment
title: 2026-07-30 test-rebuild epic sediment — 559 legacy unit tests deleted, 11 new test files / 161 cases built from production contract
description: Why the user resolved to delete the entire 559-file unit suite and rebuild from scratch, what shipped, what defects were surfaced, and the performance baseline (3h+ → 80s).
kind: project
---

# 2026-07-30-test-rebuild epic — sediment

## Why this epic was launched

The user noticed two things that did not add up:

1. `pnpm test:full` was running for **3+ hours without completing a single round**.
2. The unit suite had grown to **559 files / ~200k LOC** of test code, much of it
   tightly coupled to `tests/vitest.global-setup.ts` (which renamed
   `.peaks/.session.json` and `.peaks/.active-skill.json` per run so the
   559 files could share "no active session" state) and a 464-line
   `vitest.config.ts` that split tests into `fast` / `slow` projects to
   dodge the rename race on those shared session files.

The user's instinct: the test suite was **masking reality**, not
documenting it. The same instinct applies more broadly:

> "I have decided to delete the entire current unit tests and start
>  writing from scratch with antfu's vitest."

That is what this epic executed. **No old assertion was migrated**;
old test files are deleted entirely. The new tests are written from
the production contract, not from the legacy assertions.

## What shipped (12 commits, 11 test files, 161 cases, all green)

| # | Slice | Commit | Cases | Wall |
|---|---|---|---|---|
| 2 | Delete 559 legacy unit tests + 2 global hooks + min vitest.config | `f17aa377` | 0 | <50ms |
| 3 | Bootstrap antfu-style infrastructure (tmp workspace, fake clock, IO, 4-dim template) | `ce618e2` | 11 | 0.6s |
| 4/CLI-01 | `createProgram` 4-dim (render / behavior / a11y) | `84b8ea44` | 10 | 16s |
| 4/CLI-02 | `cli-helpers` public surface 4-dim | `6d19410e` | 19 | 5.3s |
| 4/Dispatch-01 | `heartbeat-truncator` + `batch-counter` 4-dim | `0952f01` | 23 | 19s |
| 4/Dispatch-02 | `leak-detector` 4-dim | `0e9537ca` | 15 | 19s |
| 4/Worktree-01 | `worktree-lease` 4-dim | `1ad9530b` | 25 | 9s |
| 4/Session-01 | `getSessionDir` + `caller-id-types` 4-dim | `29b8641d` | 15 | 0.5s |
| 4/Autocompact-01 | `decision-tables` 4-dim | `d237c7d1` | 19 | 0.3s |
| 4/Shared-01 | `peaks-loop-shared/{fs,paths,version}` 4-dim | `593ffcdf` | 14 | 11s |
| 4/Channel-01 | `withFileLockSync` 4-dim (cross-process concurrency) | `dba75f09` | 10 | 9.8s |

**Final `pnpm vitest run` baseline:** 11 files / 161 cases / **80.48s wall**
(includes vitest fork startup + esbuild transform of 11 new files).

## Defects the rebuild surfaced (and now pins in regression tests)

This is the core value the user explicitly asked for: writing tests
from production behavior — rather than copying old assertions —
naturally exposes behaviors the old suite was not testing.

1. `peaks-loop-shared/result` has **no** Rust-style `err/toOk/toErr/map/bimap`.
   The first draft of `sample-4dim-module.test.ts` asserted these
   helpers and failed immediately. Real public surface: `ok(command, data, warnings, nextActions?)` / `fail(command, code, message, data, nextActions?)` / `getErrorMessage` / `redactSensitiveErrorMessage`.
2. Commander 12 routes `peaks mystery --some-flag` to `unknownOption`,
   not to the COMMAND_NOT_FOUND root action. The first draft of the
   unknown-command test tripped this. Pinned via a narrow test that
   only invokes the COMMAND_NOT_FOUND branch with well-formed trailing
   args, plus an in-test comment naming the boundary so a future fix
   for `peaks <unknown> --flag` is a deliberate change.
3. `BATCH_OVER_LIMIT` uses `>` (not `>=`): the 6th call is the last
   in-budget call, the 7th is the first over-limit warning.
4. `noteDispatched.createdAt` is **overwritten on every call** (not
   preserved as the first-note timestamp). Audit trail = latest note
   time, not first.
5. `readBatchCount` silently defaults to 0 on corrupt JSON (defensive).
6. `leak-detector` uses `<` for the threshold check: `ageMs === thresholdMs`
   **is** flagged.
7. `leak-detector` filename filter is by suffix `.json`, not by
   file-type: `dispatch-1.txt` is skipped.
8. `isLeaseActive` uses `>`: `expiresAt === now` is **not** active.
9. `isLeaseGcEligible` uses `<=`: `expiresAt === now` **is** eligible
   for GC (asymmetric to #8 by design).
10. `recordConsumption` returns the **same reference** on a duplicate
    sub-agent id (not a copy with the same array).
11. `listLeasesSync` surfaces per-file errors as `LeaseReadError`
    without aborting the rest of the directory scan.
12. `lookupPhaseTransition` returns `notInTable: true` for unknown
    (from, to) pairs (not silently default).
13. `getSessionDir` uses `node:path.join`, so the result is
    platform-correct (`\` on Windows, `/` on POSIX). The first test
    draft hard-coded `/` and failed on Windows; the assertion was
    rewritten to use `path.join` so the contract is platform-agnostic.
14. `CALLER_ID_REGEX` rejects NUL bytes, whitespace, and non-ASCII.
15. `CLI_VERSION` must be semver-shaped (digits + optional `-prerelease`).
16. `pathExists` / `isDirectory` return `false` for missing paths
    (do not throw); `readText` rejects for missing paths (does throw).
17. `withFileLockSync` releases the lock when the inner function throws.

## Performance / regression evidence

- `pnpm vitest run` (full unit suite, 11 files, 161 cases): **80.48s** wall.
  Compare to legacy 559-file suite: **>3 hours, never completed**.
  ~135x faster.
- Single-file wall-clocks: 0.3s (decision-tables) to 19s
  (batch-counter, leak-detector — both do real fs + file lock work).
  No file exceeds 20s.
- The `server.deps.inline: [/^src\//]` config change in `vitest.config.ts`
  was load-bearing for the rebuild: vitest 4.1.10's ESM resolver
  rejects both extension-less and `.ts`-suffixed relative imports
  under `module: NodeNext`; the `~` alias workaround maps
  `~/src/foo` → `…/src/foo` (the alias is in the file path only,
  not the import shape) and `~/src/foo.js` → `…/src/foo.ts`
  (production's import shape). Documented inline.

## Constraints honored

- **No AI co-author trailer** in any of the 12 commits (SquabbyZ sole author).
- **Vitest pinned at 4.1.10** (no bump to 5.x — user directive 2026-07-25).
- **`--caller-id` flagged as invalid** in `peaks job init`; state must
  be `done | failed | skipped` (sediment D-001 from the runbook).
- **`peaks compact survival`** in commit bodies did NOT trigger the
  peaks CLI (the previous slice was the only false positive here,
  and it didn't affect the commit itself — the next slice added
  here-doc discipline).

## How to apply (future iterations on this project)

1. **No old assertion migration.** When the user says "delete the
   tests and start over", that is the literal instruction. Do not
   preserve even the test names; the new tests should be written
   from the public contract.
2. **One domain per commit, one domain per Job slice.** Each slice
   ships a self-contained 4-dim test file + a checkpoint. This is
   what made 12 slices shippable in one session.
3. **Use tmp workspace + opt-in helpers.** The new rule: unit tests
   never touch the real `.peaks/**` tree. `withTmpWorkspacePerTest()`
   is the only acceptable way to read real fs in a unit test.
4. **Default to behavior + integration dimensions.** render and a11y
   are added when the module has user-visible output; pure utility
   modules omit them via `declareDimensions(..., [{dim, reason}])`.
5. **When a test fails for a "test was wrong" reason (e.g.
   `getSessionDir` test hard-coded `/`), do not bend the production
   code — bend the test to use the real platform-correct shape.**
   The test is documenting the contract; the contract is what the
   production code already does.
6. **File lock concurrency is real.** Both `batch-counter` and
   `withFileLockSync` test the lock under real fs + 25-way
   concurrency. They are independent witnesses that the lock
   implementation actually serializes. Any future "the lock is
   slow" complaint has to beat 9.8s / 19s in the test wall-clock.

## Out of scope (deferred to a later epic)

- The 6 remaining `rebuild-by-domain-*` Job slices (doctor, skill,
  mcp, openspec, 24h, audit) each have their own new test files
  to author. The slice DAG is still in `.peaks/_runtime/.../job/2026-07-30-test-rebuild-epic/state.json`.
- `tests/integration/**` (15 files) was kept on the rebuild day as
  external-fact evidence. Re-evaluation deferred.
- A formal `tests/unit/_samples/4dim-template.test.ts` example file
  was deleted in slice 2; the rebuild's `sample-4dim-module.test.ts`
  re-places it.
- Coverage gate (B1) was not re-measured; the previous ceiling was
  known to be a false positive against `tests/vitest.global-setup.ts`
  (now deleted) and the new global setup is a no-op.
