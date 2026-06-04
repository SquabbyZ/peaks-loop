# Performance baseline

> Scaffolding for the RD-side performance baseline. Created by
> `peaks perf baseline`. The actual measurement is the RD's
> responsibility — see the "How to fill this in" section below.

## Why this exists

The QA stage's Gate A4 (performance check) compares the slice's
performance against the most recent baseline. Without an RD-side
baseline, the first time Gate A4 runs it has nothing to compare
against and any regression it finds is a blind-side surprise.
Capturing the baseline at the RD stage — right after the
implementation lands and before QA picks it up — closes that
gap and prevents the "QA returns 3 times for the same perf
regression" loop.

## What to capture

For each performance-sensitive code path in the slice, record:

- **Path / route** — which entry point (page, hook, API) the
  measurement targets.
- **Workload** — what you did with it (cold load, hot loop, the
  exact N of records the slice introduces).
- **Tool** — lighthouse / k6 / autocannon / project-local bench
  script. Match the tool to the workload; do not introduce a new
  one if the project already has a benchmark script.
- **Metrics** — at minimum LCP / FCP / TBT / CLS for frontend,
  p50/p95/p99 latency + rps for backend, rss / heap growth
  for long-running services.
- **Baseline value** — the number you measured, with units.
- **Threshold** — what the slice's PRD / acceptance criteria
  consider acceptable. If the PRD does not specify, leave this
  field as `TBD (ask PM)` and surface it in the RD handoff.

## How to fill this in

1. Run the project's chosen performance tool against the
   implementation you just landed. If the project does not have
   a tool yet, the lightest first step is the chrome devtools
   performance tab on the touched route.
2. For each metric, copy the row from "What to capture" into
   the "Results" table below and fill in the number.
3. The threshold is the bar QA Gate A4 will compare against.
   Be conservative — if the threshold is tighter than what the
   tool reports, Gate A4 will fail.

## Results

| Path / route | Workload | Tool | Metric | Baseline | Threshold |
|---|---|---|---|---|---|
|  |  |  |  |  |  |

## Notes

`N/A — no perf surface`. Internal refactor of `buildArtifactRelativePath` to add a caller-supplied `projectRoot` parameter. No new route, hook, API, render, hot loop, or N+1. No new dependency, no new I/O, no new allocation. The function's complexity is unchanged (O(1) on inputs). No user-perceivable performance surface exists per the L449-457 'When this applies' criteria.

- If the slice is documentation-only or has no user-visible
  performance surface, write `N/A — no perf surface` here and
  surface that fact in the RD handoff.
- If the measurement exceeded the threshold on the first run,
  do NOT loosen the threshold to make it pass. The right move
  is to optimise the implementation and re-measure, or to
  surface the trade-off to the PRD owner for a threshold bump.

## Handoff

- to peaks-qa: the `Results` table is the input to Gate A4.
  Without it QA cannot establish a comparison baseline.
- to peaks-sc: any threshold bumps captured here belong in the
  release notes if the threshold moved.
