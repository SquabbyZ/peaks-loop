---
schemaVersion: 1
templateKind: perf-audit
capturedAt: 2026-06-27T00:00:00.000Z
appliesTo: peaks-perf-audit skill
---

# Performance Audit Template (peaks-cli v2.12.0)

> **Bootstrap template** for `peaks-perf-audit` skill. Consumed by the
> skill at audit start. Modified only by peaks-txt sediment step (append-only,
> idempotent on `(concept, sourceRid)`). Lives under `.peaks/project-scan/` so
> it is git-tracked and reviewable.

> **Hard gate contract**: when this file is absent at audit start,
> `peaks perf-audit run` exits with code `AUDIT_TEMPLATE_MISSING`
> (per PRD AC-3.5).

## Perf dimensions

The perf-audit agent MUST measure or estimate impact on each of the
following 6 dimensions. The aggregation produces the audit verdict
(`pass` / `warn` / `block`).

1. **CPU-bound path latency** — hot loops, regex backtracking, JSON serialization, sync vs async I/O
2. **I/O throughput** — file read/write batching, network round-trips, stream vs buffer
3. **Memory allocation** — large object retention, GC pressure, buffer reuse, closure capture
4. **Concurrency model** — single-threaded event loop stalls, microtask queue saturation, worker pool sizing
5. **Bundle / artifact size** — code split chunks, dead code, polyfill bloat, dependency weight
6. **Cold-start cost** — first-call latency, module load time, lazy initialization gaps

## Measurement methodology

For each dimension, the agent uses one of the following 3 strategies
(declared in the audit output's `## Measurement method` field):

- **EMPIRICAL** — runs the actual measurement (e.g. `time` for CPU,
  `node --heap-prof` for memory, `wc -c` for bundle size). Used when
  the change has a runnable artifact.
- **STATIC** — inspects the diff and the codebase to estimate impact
  (e.g. new sync loop in async path → high CPU risk). Used when
  empirical measurement is infeasible.
- **N/A** — the dimension does not apply to this slice (e.g. cold-start
  cost for a CLI subcommand that always runs to completion). Rationale
  required.

The audit output MUST declare the strategy for every dimension.

## Threshold table

> This table is project-agnostic defaults. The peaks-txt sediment step
> MAY append project-specific rows when local measurements reveal
> tighter thresholds.

| Dimension | Warn threshold | Block threshold | Strategy default |
|---|---|---|---|
| CPU-bound path latency | +20% regression | +50% regression | EMPIRICAL |
| I/O throughput | +15% regression | +40% regression | EMPIRICAL |
| Memory allocation | +25% regression | +60% regression | EMPIRICAL |
| Concurrency model | microtask saturation observed | event loop blocked >100ms | STATIC |
| Bundle / artifact size | +30% size increase | +80% size increase | EMPIRICAL |
| Cold-start cost | +10% regression | +25% regression | EMPIRICAL |

The audit verdict is `block` when ANY dimension trips its block threshold;
`warn` when ANY dimension trips its warn threshold but none trip block;
`pass` otherwise.

## Audit output schema

The audit agent writes a single markdown file at
`.peaks/_runtime/<sessionId>/audit/perf-<rid>.md`.

### Required frontmatter

```yaml
---
schemaVersion: 1
artifactKind: perf-audit
rid: <request-id>
sid: <session-id>
handoffHash: <sha256 of prd/handoff.md body>
templateVersion: 1
generatedAt: <ISO 8601 timestamp>
verdict: pass | warn | block
violationsCount: <integer>
---
```

### Required body sections

- `## Summary` — one-paragraph performance narrative
- `## Baseline reference` — link to existing perf baseline (slice 025 plan artifact) or `N/A — no prior baseline`
- `## Measurement result` — table of 6 dimensions with status
- `## Threshold check` — table mapping measured delta to warn/block threshold
- `## Findings` — bullet list with severity tag
- `## Required fixes` — actionable bullet list
- `## Verdict` — block: `verdict: <pass | warn | block>`

## Known baselines inventory

> This section is **append-only**. peaks-txt sediment step appends new
> rows when a perf audit establishes a new stable baseline.

| # | Baseline | First established (rid) | Source | Status |
|---|---|---|---|---|
| (empty) | — | — | — | — |

The schema for new rows is `{ #, baseline description, first established rid, source, status }`.
The `status` enum is `active` / `superseded` / `deprecated`.
