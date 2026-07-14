---
name: slice-016b-cli-command-branches-parallelism-budget
description: Slice 016b — bumps cli-command-branches.test.ts only the unhealthy-as-parallelized test from 10s → 30s to survive the maxWorkers=4 skill-doctor contention. Single-file runs still complete in <1s.
metadata:
  type: lesson
  layer: A
---

# Slice 016b — `cli-command-branches` parallelism timeout budget

**Date:** 2026-07-14
**Session:** 2026-07-14-session-cebb2d
**Slice:** 016b (micro-cycle on top of 016)
**Outcome:** single-file CLI test now passes 111/111 across the
9-file slice-014b/014b/015/016 verification matrix; 0 failures.

## What surfaced

After Slice 016 (commit c3bad88) shipped the g8 race-mode fix,
the user-facing verification across every file slice 014b →
016 had touched, run in parallel mode, surfaced 1 remaining
failure:

  FAIL tests/unit/cli-command-branches.test.ts > createProgram >
    'reports failed doctor and skill doctor checks'
  Error: STACK_TRACE_ERROR … Test timed out in 10s

`STACK_TRACE_ERROR` is vitest's serialization of a per-test
**timeout**, not an assertion failure. The test body does:

```ts
test('reports failed doctor and skill doctor checks', async () => {
  …  // mocks branchState.runDoctor
  const { registerCoreAndArtifactCommands } =
    await import('../../src/cli/commands/core-artifact-commands.js');
  const doctorResult = await runRegisteredCommand(
    registerCoreAndArtifactCommands, ['doctor', '--json']);
  …
  const skillResult = await runRegisteredCommand(
    registerCoreAndArtifactCommands, ['skill', 'doctor', '--json']);
  …
}, 10_000);  // <-- 10s default timeout
```

The test invokes **real** `skill doctor` machinery — only
`doctor-service.runDoctor` is mocked; the skill-doctor command
branches through the unmocked handler in
`src/cli/commands/core-artifact-commands.ts` and into the real
`src/cli/program.ts` import graph.

Single-file run completes in <1s. Under `maxWorkers: 4` (set in
`vitest.config.ts`) combined with 8 other CLI-touching test
files (workspace standards, rd-service, etc.), two sequential
`runRegisteredCommand` calls × 4 forked workers concurrently
loading the heavy `src/cli/program.ts` import graph + the
unmocked skill-doctor path can race for FS / module-resolve
time on Windows. Wall-clocks around 10-15s were observed in
the 9-file combined run.

## The fix (1 hunk, ~10 lines)

Bumped only the unhealthy-as-parallelized test's local timeout
from 10s → 30s:

```diff
-}, 10_000);
+}, 30_000);
```

30s is **well above** the worst-case observed (15s in the 9-file
combined run) and **well below** vitest's per-test budget cliff.

Importantly: **this is a budget, not a swallow.** The slice-014
`Promise propagation` lesson is unrelated — that fix was about
inner-Promise rejections being lost (`launchConcurrent` not
chaining `.then(r, e)`); here, the inner `Promise.all` IS
chaining. The test is doing exactly what it says, it just needs
more time under heavy fork contention.

## Why not mock the skill-doctor service?

Mocking would be the "principled" non-band-aid fix but requires:

- Identifying the skill-doctor service export
- Adding a `vi.mock` block at the top of the test (matches
  `tests/unit/cli-program.test-utils.ts:25-30` style for the
  MiniMax provider)
- Re-running the test to verify the mock actually plumbs
  correctly through `registerCoreAndArtifactCommands`

That's 20-30 minutes of work for marginal signal — the test
already runs in <1s when isolated, the mocked path would also
exercise the same routing contract. The 30_000 budget is the
minimal fix that satisfies "no loose ends" without expanding
the slice into a service-mocking refactor.

If this test starts hitting even 30s in the future, the
right next move IS to mock the skill-doctor service.

## Files touched

- `tests/unit/cli-command-branches.test.ts` (1 line behavior
  + ~12 lines of "why" comment)
- `.peaks/memory/slice-016b-cli-command-branches-parallelism-budget.md`
  (this file)
- `.peaks/memory/MEMORY.md` (index entry)

## Verification

`vitest run tests/unit/g8-shared-channel.test.ts
tests/unit/services/retrospective/heartbeat.test.ts
tests/unit/dispatch-record-writer.test.ts
tests/unit/cli-commands/map-service-error.test.ts
tests/unit/cli-command-branches.test.ts
tests/unit/cli-program.core.test.ts
tests/unit/rd/repair-cycle-2-cli-wiring.test.ts
tests/unit/services/job/job-resource-snapshot.test.ts
tests/unit/workspace/workspace-migrate-f3-cleanup.test.ts
--reporter=dot`

→ **9 files passed, 111 tests passed, 0 failed**, 54.70s wall.

## Why: see also

- [[slice-014-vitest-slowdown-and-race-repeat]] (Promise
  propagation lesson — unrelated to this budget fix but
  worth linking so future readers don't confuse the two)
- [[slice-014b-vitest-slowdown-real-cause-fork-accumulation]] (parallelism unlock)
- [[slice-015-swarmplan-strict-standards-reach]] (the slice whose commits exposed this file's flakiness under parallelism)
- [[slice-015b-test-full-run-flake-evidence]] (carry-over evidence)
- [[slice-016-g8-shared-channel-race-mode]] (preceding slice)
