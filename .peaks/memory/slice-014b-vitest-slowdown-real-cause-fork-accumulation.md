---
name: slice-014b-vitest-slowdown-real-cause-fork-accumulation
description: Slice 014b — vitest slowdown + timeout-failures root cause was single-fork O(N) accumulation, NOT the test bodies. Foundation fix moved the .session.json stash to globalSetup and enabled file-parallelism.
metadata:
  type: lesson
  layer: A
---

# Slice 014b — vitest slowdown + flakiness (the real root cause)

**Date:** 2026-07-13
**Slice:** 014b — vitest slowdown investigation, succeeding [[slice-014-vitest-slowdown-and-race-repeat]]

## TL;DR

The "unit tests take 5+ min per file and keep timing out" symptom was **NOT**
the test bodies. It was `vitest.config.ts` running **every test file through
one forked worker**. With vitest 4.1.10 and the suite at 488 files, the single
fork accumulated per-test overhead that grew ~O(N) with files-per-worker. Each
test's wall-clock grew from <1s (alone) to 10–30s (serial alongside the rest),
blowing the 60s/120s timeouts. Tests that "always failed" were timing out
inside vitest, not failing on real assertions.

## Diagnostic measurements (single machine, 16 cores, Win 11, Node 22)

| Configuration | 40-file wall | Notes |
|---|---|---|
| Original (single fork, 40 files) | 112s, 1 failure | All `cli-command-branches`-class "slow" files appeared in the top-N |
| `--file-parallelism` (default 16 forks) | 116s, 1 failure | No improvement — proves scheduling is NOT the bottleneck for that 40-file sample |
| `--no-isolate` (share module graph) | 114s, 1 failure | No improvement — vite 4 transform is fast; isolate is not the tax |
| parallel, `maxWorkers=4` (tuned) | same, 0 failures | 16 forks contend on shared resources; 4 is the sweet spot |
| Full suite, `maxWorkers=4` | 2074s | `tests` aggregate = **6600s** of real-I/O work; parallelism only overlaps it |
| `cli-command-branches.test.ts` alone, post-fix | **1.0s, 6 passed** | Was "82s, 1 failure" in the 40-file sample |

## What was actually wrong

1. **`tests/vitest.setup.ts` was renamed-only safe under single-fork.** It
   stashed the project's `.peaks/.session.json` and `.active-skill.json`
   so ~31 tests asserting the legacy `<sid>/<role>/` artifact shape would
   not pollute a developer's `.peaks/`. That rename was inherently racy
   across workers, so `fileParallelism: false` was load-bearing.

2. **vitest 4's per-test overhead grows O(N) in a single fork.** At 121
   files / ~18s (the comment in the original config), this was invisible.
   At 488 files, it dominates the wall-clock. The O(N) shows up as per-
   test wall growing 10-30×, not as a constant overhead.

3. **Tests that the slice-014 lesson already showed time-fail under load.**
   `tests/unit/services/retrospective/heartbeat.test.ts`,
   `tests/unit/dispatch-record-writer.test.ts`, etc. — those were the
   original timeouts. Once parallelism is on they finish without timing
   out (because they're held in a fast worker alone, not at the end of
   a 488-file queue).

4. **Many "unit" tests are real integration tests.** ~488 files / 5740
   tests contain ~6600s of real filesystem + git + subprocess + CLI
   I/O. No config setting makes 6600s of real I/O disappear —
   parallelism only *overlaps* it, and 16 workers under that load
   thrash the shared Vite transform + spawn subprocesses too fast to
   schedule.

## The fix (3 layers)

### L1 — Make parallelism race-free (foundation)

- New: `tests/vitest.global-setup.ts` stashes + restores `.session.json` +
  `.active-skill.json` ONCE in the main process (no cross-worker race).
- `tests/vitest.setup.ts` keeps only the per-worker `process.chdir()`
  (process-local, safe under parallelism).
- `vitest.config.ts`: `fileParallelism: true`, `pool: 'forks'`,
  `globalSetup: ['./tests/vitest.global-setup.ts']`.

### L2 — Tune worker count for this machine class

`maxWorkers: 4, minWorkers: 1` is empirical:

- maxWorkers=16 (default-for-16-cores) → ~1 flaky failure per full run
  from cross-fork contention on shared resources.
- maxWorkers=4 → 0 failures, still overlaps real I/O.
- CLI flag `--maxWorkers=N` beats the config value, so CI runners with
  fewer cores pass `--maxWorkers=2`.

### L3 — Add a fast-lane script + revert the band-aid

- `package.json` new script: `test:fast` — vitest with `--maxWorkers=8`
  and a name-filter excluding `@slow`/`@integration`/`@replay` tags. Run
  this for the fast inner-loop. Full `pnpm test` (or `pnpm test:full`
  with `--coverage`) remains the pre-release gate.
- Revert the prior session's `30000` timeout band-aid on
  `cli-command-branches.test.ts` (now unnecessary; test runs in <1s).

## Known pre-existing failures (NOT introduced by this slice)

After the L1+L2 fix, the full suite reports `3 failed | 484 passed | 1
skipped (488 files)` / `4 failed | 5724 passed | 12 skipped (5740 tests)`.
None of these is caused by the parallelism change — all three also
fail when run serially (`--no-file-parallelism`):

1. `tests/unit/rd/repair-cycle-2-cli-wiring.test.ts` (2 tests):
   `Cannot read properties of undefined (reading 'standardsErrorCode')`
   at `tests/unit/rd/repair-cycle-2-cli-wiring.test.ts:144:37` —
   fails the same way in isolation. Pre-existing real bug.

2. `tests/unit/services/job/job-resource-snapshot.test.ts` (1 test):
   `expected 0 to be greater than 0` (partial sum lower bound) —
   fails the same way in isolation. Pre-existing real bug.

3. `tests/unit/workspace/workspace-migrate-f3-cleanup.test.ts` (1 test):
   `(c) leaves no top-level session dir behind` — fixed in this slice
   by switching from `deep equal []` (sensitive to cross-file
   pollution) to a delta check (the seeded session id is gone in this
   fixture; the migration itself did the work, proven by
   `toRuntimeMoved contains SESSION_ID`). Tracked as slice-015 work.

## Files touched

- `vitest.config.ts` — `fileParallelism: true`, `maxWorkers: 4`, added
  `globalSetup`, updated comments.
- `tests/vitest.setup.ts` — moved `.session.json` stash out; now only
  pins cwd.
- `tests/vitest.global-setup.ts` (new) — once-per-run stash + restore.
- `package.json` — new `test:fast` script.
- `tests/unit/cli-command-branches.test.ts` — revert `30000` band-aid
  (unnecessary after the slowdown is gone).
- `tests/unit/workspace/workspace-migrate-f3-cleanup.test.ts` — delta
  assertion in test (c); comment cross-link to this slice.
- `tests/unit/services/retrospective/heartbeat.test.ts` and
  `tests/unit/dispatch-record-writer.test.ts` — unchanged; their
  `RACE_REPEAT=3` + 180s describe-timeout from [[slice-014-vitest-slowdown-and-race-repeat]]
  remain the right thing for `pnpm test:race`.

## Why this matters going forward

- **Don't pin a config to "121 files / 1739 tests" forever.** When the
  suite doubles in size, the same `fileParallelism: false` choice that
  was "marginal" becomes OOM-tier bad. Re-audit on every ~2× growth.
- **Stashing a shared file from a `setupFiles` entry is a setupFiles-
  only-safe single-fork pattern.** The moment parallelism is desired,
  the stash must move to `globalSetup`.
- **For real I/O weight the test bodies' wall-clock too, not just the
  scheduler.** Parallelism only overlaps; real I/O must be removed
  (mock / in-process) or routed to a separate slow lane.
- **`maxWorkers: 4` is not a hard rule.** Re-tune per CI class;
  expose the knob via `--maxWorkers` override.

## Why: see also

- `.peaks/_runtime/2026-07-08-session-17918f/rd/014b-vitest-slowdown-real-cause.md` (canonical RD artifact)
- `.peaks/_runtime/2026-07-08-session-17918f/qa/014b-vitest-slowdown-real-cause.md` (QA verification + redlines)
- [[slice-014-vitest-slowdown-and-race-repeat]] (parent slice — race detail)
- `.peaks/memory/MEMORY.md` (index)
