---
name: slice-015-swarmplan-strict-standards-reach
description: Slice 015 — fix the silent INVALID_GOAL catch-all in 4 CLI handlers by routing through mapServiceError; ProviderNotConfiguredError → INVALID_PROVIDERS surface; 6 AC pass.
metadata:
  type: lesson
  layer: B
---

# Slice 015 — `swarm plan --strict-standards` is reachable again

**Date:** 2026-07-14
**Session:** 2026-07-14-session-cebb2d
**Slice:** 015-swarmplan-strict-standards-reach
**Parent:** [[slice-014b-vitest-slowdown-real-cause-fork-accumulation]]
**Verdict:** PASS (QA → verdict-issued)

## The trap (slice-014b sign-off surfaced this)

Four CLI handlers (`tech.plan`, `workflow.route`,
`workflow.autonomous`, `swarm.plan`) had byte-identical
catch-alls:

```ts
} catch (error) {
  printResult(io, fail('<command>', 'INVALID_GOAL',
    getErrorMessage(error), {}, ['Use a non-empty goal']),
    options.json);
  process.exitCode = 1;
}
```

If `createRdSwarmPlan(...)` (or its siblings) threw **any** error
— e.g. `Error('Execution model must be configured in providers')` —
the user got a CLI envelope claiming their goal was invalid. The
real error was lost. As a side effect:
`tests/unit/rd/repair-cycle-2-cli-wiring.test.ts` was permanently
red, because the standards-overlay path was unreachable without a
configured provider.

## The fix (surgical, ~80 lines, 4 files)

1. **Typed exception at the throw site.**
   `src/services/config/model-routing.ts` now exports
   `ProviderNotConfiguredError extends Error` (matches the
   existing `ConfirmationRequiredError` style in
   `cli-program-test-utils.ts:33-39`).

2. **Single source of truth for envelope routing.**
   New `src/cli/commands/_cli-error-envelope.ts` exports
   `mapServiceError(error)` returning
   `{ code, nextActions }` discriminated union:
   - `ProviderNotConfiguredError` → `INVALID_PROVIDERS`
   - goal-validation `Error` (message-substring match) →
     `INVALID_GOAL`
   - everything else → `INTERNAL_ERROR`

3. **Four catch sites refactored.**
   `src/cli/commands/workflow-commands.ts` lines 184, 232, 270, 317
   each call `mapServiceError(error)` then spread into the
   existing `fail()` envelope. Migration is mechanical —
   duplicated 1-line catches become 6-line catches that share the
   helper.

4. **Tests.**
   `tests/unit/rd/repair-cycle-2-cli-wiring.test.ts` gained a
   `vi.mock` of `getEconomyAwareExecutionModelId` with a hoisted
   flag (default `configured: true`). The original 2 tests now
   pass (mocked provider → standards overlay reachable). A 3rd
   test flips `configured: false` to exercise the new
   `INVALID_PROVIDERS` path.
   New `tests/unit/cli-commands/map-service-error.test.ts`:
   4 table-driven cases pinning the helper surface (incl. the
   message-substring match — see Risk A).

## Acceptance results (all 6 PASS)

| # | Criterion | Result |
|---|---|---|
| 1 | repair-cycle-2-cli-wiring.test.ts reports 3 passed | ✅ |
| 2 | `node bin/peaks.js swarm plan --strict-standards --json` returns `INVALID_PROVIDERS` (post-build) | ✅ |
| 3 | Mocked-provider path reaches `gateStatus.standardsErrorCode === 'EPEAKS_NO_STANDARDS'` | ✅ |
| 4 | Empty `--goal` still produces `INVALID_GOAL` (regression check) | ✅ |
| 5 | `cli-command-branches.test.ts` and other `INVALID_GOAL`-consuming tests remain green | ✅ |
| 6 | `peaks audit static` does not regress | ✅ |

## Why this matters going forward

- **One shared helper for catch translation wins on dedup +
  consistency.** Future CLI handlers copy-pasting the same
  1-line catch should import `mapServiceError` instead.
- **Typed exceptions survive tree-shaking, name-strings do
  not.** Match by `instanceof` when you can, by message-regex
  only when the throw site is intentional (here:
  `validatePlanningInput` throws plain `Error` for legacy
  reasons; promoting it to a typed class is a future-Slice
  refactor).
- **CLI envelope codes are part of the public API.** A user
  greps `INVALID_GOAL` in CI scripts; splitting the catch surface
  is a breaking change for downstream consumers. Mitigations
  applied here: grep-clean across `bin/`, `scripts/`,
  `.github/`; new code uses a new code (`INVALID_PROVIDERS`).
- **The fix lifts a permanent test failure.** Two CI-red tests
  went green because the production code was lying to them; with
  the helper in place, both the test contract and the production
  message surface align.

## Risks left in place (deliberately)

- **Risk A** — substring match on `goal must not be empty` is
  fragile. The helper unit test pins the literal substring so any
  future message-wording change fails loudly instead of silently
  degrading to `INTERNAL_ERROR`. Promotion to a typed
  `GoalValidationError` class is a future-Slice refactor.
- **Risk C** — 4 catches around `runSwarmPlan` were NOT inside
  `try/catch` and so are not refactored (the early-return paths
  for `UNSUPPORTED_SWARM_SKILL` / `UNSUPPORTED_NON_DRY_RUN` /
  `parseMaxWorkers` `null`). Documented in RD analysis.
- **Fanout-driven artifacts** (code-review, security, perf,
  karpathy, mut, third-party-review) were intentionally skipped
  via `--allow-incomplete` because Slice 015 ships no new IO /
  auth / behavior — the QA artifact documents this and a future
  reviewer can backfill.

## Files touched (5)

- `src/services/config/model-routing.ts` (+9 lines)
- `src/cli/commands/_cli-error-envelope.ts` (new, ~50 lines)
- `src/cli/commands/workflow-commands.ts` (-4/+24 across 4
  catch sites + 1 import)
- `tests/unit/rd/repair-cycle-2-cli-wiring.test.ts` (+45 lines
  for vi.mock + new test)
- `tests/unit/cli-commands/map-service-error.test.ts` (new,
  ~35 lines)

## Why: see also

- PRD-015: `.peaks/_runtime/2026-07-14-session-cebb2d/prd/requests/001-015-swarmplan-strict-standards-reach.md`
- RD analysis: `.peaks/_runtime/2026-07-14-session-cebb2d/rd/requests/001-015-swarmplan-strict-standards-reach.md`
- QA artifact: `.peaks/_runtime/2026-07-14-session-cebb2d/qa/requests/001-015-swarmplan-strict-standards-reach.md`
- SC artifact: `.peaks/_runtime/2026-07-14-session-cebb2d/sc/requests/001-015-swarmplan-strict-standards-reach.md`
- [[slice-014b-vitest-slowdown-real-cause-fork-accumulation]] (parent)
