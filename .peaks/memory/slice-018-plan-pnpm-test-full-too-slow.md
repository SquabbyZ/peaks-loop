---
name: slice-018-plan-pnpm-test-full-too-slow
description: Slice 018 plan (DRAFT) — diagnose pnpm test:full 36-min wall-time by per-file profile + propose a real fix
metadata:
  type: lesson
  layer: A
---

# Slice 018 (DRAFT) — `pnpm test:full` is still 36+ min, individual files hit 150s

**Status:** plan only; awaits the full per-file profile the user is
now running in background.

## Problem (user-reported, this slice)

> "我实际使用pnpm test:full运行是36分钟左右"
> (actual `pnpm test:full` runs are ~36 min)
>
> "其中有单测的文件150多秒"
> (some single test files take 150+ seconds)

Slice 017 made `pnpm test` (the default) fast (3m19s on the
CLI subset), but the user still runs `pnpm test:full` for the
release gate. That gate is too slow.

## What we know so far

Integration slice (29 files) profiled independently:

| File | Wall |
|---|---|
| `integration/config-migrate-cli.test.ts` | 86.4s |
| `integration/ide/install-skills-dispatch.test.ts` | 84.0s |
| `integration/job-e2e.test.ts` | 83.1s |
| `integration/slice-ls-cli.test.ts` | 74.4s |
| `integration/full-migration.test.ts` | 72.8s |
| `integration/code-detect-job-command.test.ts` | 70.5s |
| `integration/preferences-cli.test.ts` | 70.5s |
| `integration/workspace-clean-cli.test.ts` | 63.2s |
| `integration/code-gate-step-08-hook.test.ts` | 61.8s |
| `integration/g7-g8-dogfood.test.ts` | 60.8s |

10 slowest integration files alone = ~728s wall. There are 29
integration files → roughly 1500-2000s integration total.

These are real CLI binary spawns (`execSync(bin/peaks.js)`) —
they cannot get fast by parallelism alone; the cost is the
Node startup + the CLI's own import graph (~5-7s per spawn) ×
the per-test spawn count.

## Hypothesis

`tests: aggregate ~6600s wall × fileParallelism=true × maxWorkers=4`
overlaps into the observed 2070-2200s wall. So the unit suite is
*already* parallelized — but the **integration layer is
40-50% of total wall** and isn't getting much parallelism overlap.

## Plan

Will be filled after the full pnpm test:full profile completes
+ per-file ranking. Likely outcomes:

(a) **Promote `pnpm test:full` to use 8 workers** (currently 4).
Risk: parity flake with slices 016b/c/d/e/f's budget bumps.

(b) **Add a `pnpm test:heavy` alias** that runs only the
integration slice (the longest 1500s) with its own budget, so
`pnpm test:full` doesn't run integration by default. Release
gate becomes two commands.

(c) **Profile-driven surgical fixes** — split the top-10 slowest
integration files into per-test parallelism (currently most
do sequential spawns; splitting may halve wall).

(d) **Plan-only**: accept 36 min as the CI floor, run locally
with `pnpm test`.

Will pick one after the profile lands. Decision principle:
"lowest-cohesion architectural fix first" — (b) requires the
least code change, (a) requires only a config flip (with a
budget-bump risk), (c) requires code surgery.

## See also

- [[slice-017-cli-default-subset-fast-default]] (made `pnpm test`
  fast, but didn't touch `pnpm test:full`)
- [[slice-016f-cliff-rebump-and-slow-lane-need]] (the prior
  plan that prioritised budget bumps; this slice is the
  per-file-profile followup)
- [[slice-014b-vitest-slowdown-real-cause-fork-accumulation]]
  (current maxWorkers=4)
