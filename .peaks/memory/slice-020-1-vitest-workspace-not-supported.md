---
name: slice-020-1-vitest-workspace-not-supported
description: Slice 020+1 — second slow-lane attempt failed: vitest 4.1.10's `workspace` config-key is silently ignored when set in root vitest.config.ts; sibling vitest.workspace.ts file format only accepts Vite config shape (NOT array export). Both attempts rolled back. slice-020+1 ships NO code change; vitest.config.ts now restored to slice-017 baseline.
metadata:
  type: lesson
  layer: A
---

# Slice 020+1 — Second slow-lane attempt (also rolled back)

**Date:** 2026-07-14
**Session:** 2026-07-14-session-cebb2d
**Slice:** 020+1
**Outcome:** NO code change ships; vitest.config.ts restored to
slice-017 baseline (HEAD).

## What the user confirmed

> "确认A" (Confirmed: do A — the slow-lane carve-out via
> vitest's `workspace` config-key)

The user's intuition (correct per slice-019 data): the 18-min
`workflow-autonomous-resume-validation.test.ts` is 30% of
`pnpm test:full` wall; carving it out into its own 1-fork pool
should preserve its 39s baseline while letting the rest of the
suite run cheaply.

## What I tried this slice (in order)

### Attempt 1: `vitest.workspace.ts` file exporting an array

```ts
// vitest.workspace.ts (first try)
export default [
  './tests/vitest.config.default.ts',
  './tests/vitest.config.slow.ts',
];
```

**Failed**: vitest's config-loader expected a Vite config object,
not an array. Error: "config must export or return an object".
That format only works in `.json` (`vitest.workspace.json`).

### Attempt 2: `vitest.workspace.ts` exporting defineConfig({ workspace: [...] })

```ts
// vitest.workspace.ts (second try, correct shape)
import { defineConfig } from 'vitest/config';
export default defineConfig({
  workspace: ['./tests/vitest.config.default.ts', './tests/vitest.config.slow.ts'],
});
```

**Loaded successfully** but `--project default` / `--project slow`
filters on `vitest list` and `vitest run` did NOT recognize the
workspace split. Every test still showed as `[fallback]` (the
root vitest.config.ts's `name: 'fallback'` field), meaning the
workspace array was being ignored by vitest 4.1.10's runtime
even though the config-loader accepted the file.

### Attempt 3: `workspace` field IN the root vitest.config.ts

Removed the sibling `vitest.workspace.ts` and put `workspace: [...]`
directly in the root config (a documented vitest pattern).

**Loaded successfully**, but the `vitest list` command still
showed every test as `[fallback]` — the workspace was still
ignored. AND removing the per-project `maxWorkers` /
`testTimeout` / etc. fields from the root config broke the
CLI subset: `pnpm test` reported 14 failures / 370 passed
(default 5s testTimeout too small for cli-program.core /
cli-program.stateful / cli-program.workspace tests → they all
hit `STACK_TRACE_ERROR`).

## Decision: roll back

Stopped after 3 attempts. **The right architectural fix doesn't
work in vitest 4.1.10's workspace API as I'm trying to use it.**
Reasons for stopping now:

1. **`p[,]test:full` was the only target** — the user-facing
   `pnpm test` default (CLI subset, 3m19s) was already working.
   Rolling back to slice-017 (HEAD) preserves the user's daily
   loop unchanged.
2. **3 failed attempts without a working result** — each
   additional attempt burns 5-10 min of compute + introduces
   risk of leaving a broken config in the working tree.
3. **`pnpm test` smoke verified broken after attempt 3** —
   14 failures in a 41-file subset that was previously 100%
   green is unacceptable to leave uncommitted.

Restored `vitest.config.ts` to its HEAD state. Removed the two
sibling config files (`tests/vitest.config.default.ts`,
`tests/vitest.config.slow.ts`) and the `vitest.workspace.ts`.
The slow-lane plan is documented in this sediment for a future
session to attempt again, **with a fundamentally different
approach** (see "Correct paths forward" below).

## Smoke verification (after rollback)

`vitest run tests/unit/cli --reporter=dot` →
**41 files passed, 400 tests passed, 200.04s wall**.
Matches slice-017 baseline exactly.

## Correct paths forward (for a future slice)

Three viable approaches, none of which I attempted this slice
because each requires multiple unchanged conditions to verify
the schema works:

### Path A: vitest 4.1.10 native `vitest.projects` (not `workspace`)
vitest 4.x has both `projects: [...]` and `workspace: [...]`
config-keys. The earlier slice-020 attempt used `projects: [...]`
which the docs say works but vitest 4.1.10's `extends: true`
model was broken in practice (every test listed under both
projects). The `workspace: [...]` key (a sibling file) is the
newer approach I tried this slice and got config-loader-accepted
but runtime-ignored. A future slice should investigate:
- vitest 4.2+ release notes for workspace support improvements.
- Whether `vitest.workspace.json` (NOT `.ts`) behaves
  differently — JSON shape is an array, matches the canonical
  docs and has the same loader as the `.ts` config-shell
  wrapper in attempt 2.
- Whether each sibling config MUST have `extends: false`
  (NOT `extends: true`) for the per-project fields to take
  effect.

### Path B: surgical source-level fix
Skip the slow-lane split entirely and instead modify
`src/services/workflow/workflow-autonomous-resume-helpers.ts`
to:
1. Cache `realpathSync` results per process
2. Memoize `readResumeArtifact` per `(sessionId, artifactPath)`
   combination
3. Apply the same memoization at
   `src/services/rd/rd-service.ts:hasPlannerArtifactWorkspace`

Expected gain: `createAutonomousWorkflowPlan`'s 25-30 sync FS
roundtrips per call could drop to ~5 roundtrips (mostly cache
hits), taking single-file wall from 39s to ~10s. Under
cumulative contention that's ~290s instead of 1093s — saving
~13 min of `pnpm test:full` wall without changing test
infrastructure at all.

Risks: cache invalidation if a test mutates the artifact tree
mid-run. Mitigated by per-test-file cache (clear in
`beforeEach`-style hook).

### Path C: pnpm test slimmer default
If A and B don't work, accept that `pnpm test:full` ≈ 36 min
is the floor and document it as such in the README. Local
development already runs against `pnpm test` (3m19s CLI
subset, slice-017). The full suite is acceptable as a
CI/release gate only.

## Files touched in this slice (then rolled back)

- `vitest.config.ts` — modified, restored to HEAD.
- `tests/vitest.config.default.ts` — created, deleted.
- `tests/vitest.config.slow.ts` — created, deleted.
- `vitest.workspace.ts` — created, deleted.

No source code, no test code, no script change ships.

## Why: see also

- [[slice-020-attempt-vitest-projects-rollback]] (first attempt
  using `projects: [...]` key inside vitest.config.ts; both
  failed for different reasons — this slice tried the
  workspace-key + sibling-file approach; same outcome)
- [[slice-019-pnpm-test-full-budget-fixes]] (the 169-files >
  60s profile data this slice was based on)
- [[slice-017-cli-default-subset-fast-default]] (made `pnpm test`
  fast; the floor that holds for `pnpm test:full` is still
  the structural limit we couldn't break)
