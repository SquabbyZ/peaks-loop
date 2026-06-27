# peaks-perf-audit — Audit Protocol Reference

> **Operational reference** for the `peaks-perf-audit` skill. This file
> is the parent LLM's step-by-step playbook: how to read the inputs,
> walk the 6 dimensions, declare a measurement strategy, score
> severity, and emit the envelope. The service
> (`perf-audit-service.ts`) handles the I/O; this reference handles
> the **judgement**.

## Inputs

| Input | Source | Required | Notes |
|---|---|---|---|
| Handoff | `.peaks/_runtime/<sid>/prd/handoff.md` | YES | sha256-locked; verify before reading body |
| Template | `.peaks/project-scan/perf-template.md` | YES | 6 dimensions + threshold table + methodology |
| Diff | git working tree vs. `HEAD` | YES | The slice's changed files |
| Red-line scope | handoff's `## Red-line scope` | YES | Out-of-scope surfaces go to `nextActions[]`, not violations |
| Optional: prior baseline | slice 025 `peaks perf baseline` output | NO | The template's `## Known baselines inventory` references stable baselines; first-run baseline is N/A |

## Output envelope (strict shape)

```typescript
interface PerfAuditEnvelope {
  readonly verdict: 'pass' | 'warn' | 'block';
  readonly violations: ReadonlyArray<{
    readonly dimension: string;        // 1 of 6 from template
    readonly severity: 'CRITICAL' | 'HIGH' | 'MED' | 'LOW';
    readonly file: string;             // repo-relative
    readonly line: number;             // 1-based
    readonly hint: string;             // <200 chars, actionable
  }>;
  readonly summary: string;            // 1-paragraph perf narrative
}
```

The service's `isPerfAuditEnvelope()` rejects any deviation.

## Walking the 6 dimensions

For each dimension, the skill MUST do the following:

1. **Read the dimension's scope** — what files / paths in the diff
   touch this dimension.
2. **Declare a strategy** — exactly one of:
   - `EMPIRICAL` — runs the actual measurement (e.g. `time` for CPU,
     `node --heap-prof` for memory, `wc -c` for bundle size). Used
     when the change has a runnable artifact.
   - `STATIC` — inspects the diff and the codebase to estimate
     impact (e.g. new sync loop in async path → high CPU risk).
     Used when empirical measurement is infeasible.
   - `N/A (with rationale)` — the dimension does not apply to this
     slice (e.g. cold-start cost for a CLI subcommand that always
     runs to completion). Rationale required.
3. **Measure or estimate** — produce a delta value (e.g. "+15% CPU",
   "+5% bundle", "static risk: high").
4. **Compare to threshold** — read the template's threshold table
   (warn / block) for the dimension and mark the dimension as
   `clean` / `warn` / `block` / `n/a`.
5. **Emit violations** — one entry per finding, with `(file, line,
   hint)` tuple. The triple is the dedup key in the aggregator.

### Dimension-by-dimension checklist

#### 1. CPU-bound path latency (warn +20% / block +50%)

- [ ] New hot loops? O(n²) where O(n) was sufficient?
- [ ] Regex backtracking risk (nested quantifiers)?
- [ ] JSON serialization in tight loops?
- [ ] Sync I/O in async path?

#### 2. I/O throughput (warn +15% / block +40%)

- [ ] File read/write batching: are reads/writes coalesced?
- [ ] Network round-trips: N+1 query risk?
- [ ] Stream vs buffer: large file reads streamed or slurped?

#### 3. Memory allocation (warn +25% / block +60%)

- [ ] Large object retention (closures, module-scope caches)?
- [ ] GC pressure (per-iteration allocations)?
- [ ] Buffer reuse (manual pools / `Buffer.alloc` vs `Buffer.from`)?
- [ ] Closure capture (large outer-scope captures)?

#### 4. Concurrency model (warn: microtask saturation / block: >100ms event-loop block)

- [ ] Single-threaded event loop stalls (sync loops, JSON.parse on huge blobs)?
- [ ] Microtask queue saturation (Promise.all over huge arrays)?
- [ ] Worker pool sizing (CPU-bound work off-loaded)?

#### 5. Bundle / artifact size (warn +30% / block +80%)

- [ ] Code split chunks: are large libs lazy-loaded?
- [ ] Dead code: unused exports / polyfills?
- [ ] Polyfill bloat: ES5 shims in modern targets?
- [ ] Dependency weight: bloated transitive deps?

#### 6. Cold-start cost (warn +10% / block +25%)

- [ ] First-call latency (eager init of unused modules)?
- [ ] Module load time (top-level awaits / heavy imports)?
- [ ] Lazy initialization gaps (eager work in module body)?

## Measurement methodology

Per dimension, the skill chooses **EMPIRICAL / STATIC / N/A** and
records the strategy in the audit output's `## Measurement result`
section. EMPIRICAL is preferred when the slice has a runnable
artifact (binary, library, CLI). STATIC is the fallback.

```bash
# Empirical examples
time node ./bin/peaks.js slice check --rid <rid>  # CPU + cold-start
node --heap-prof ./bin/peaks.js slice check 2>&1 | head -100  # memory
wc -c dist/peaks.js  # bundle size
du -sh node_modules/<new-dep>  # dep weight
```

When the slice has no runnable artifact (pure docs / config / types),
declare N/A on every dimension with a single rationale.

## Severity scoring

| Severity | Trigger |
|---|---|
| `CRITICAL` | Block threshold tripped (e.g. +80% bundle size); direct user-visible perf regression |
| `HIGH` | Block threshold tripped on a secondary path; or warn threshold tripped by 2x |
| `MED` | Warn threshold tripped; defense-in-depth; not user-visible today |
| `LOW` | Style / hygiene; future-risk; not measurable in current scope |

When in doubt, mark one severity lower and add a `Recommended:`
entry explaining the escalation reason.

## Verdict aggregation

| Condition | Verdict |
|---|---|
| Any `CRITICAL` violation | `block` |
| Any `HIGH` violation (no `CRITICAL`) | `block` |
| Any `MED` violation (no `HIGH` / `CRITICAL`) | `warn` |
| Only `LOW` violations | `warn` |
| No violations | `pass` |

A dimension marked `block` MUST produce at least one `HIGH` or
`CRITICAL` violation; otherwise the dimension marking is inconsistent
and the skill re-marks.

## Sediment (peaks-txt handoff)

At session end, `peaks-txt` sediment step (Group C) appends new
recurring baselines to the template's
`## Known baselines inventory` table. The skill's `## Recommended`
section is the source of new sediment rows; the format is:

```
| # | Baseline | First established (rid) | Source | Status |
| N | <one-line baseline> | <rid> | peaks-perf-audit | active |
```

## Failure modes

- **Handoff sha256 mismatch** — `readAndVerifyHandoff` returns null.
  Surface via `nextActions[]`; do not proceed to step 2.
- **Template missing** — `readPerfTemplate` returns null. Surface
  via `nextActions[]` pointing to `peaks project template init`.
- **Envelope rejected by service** — `isPerfAuditEnvelope` returns
  false. Re-emit until valid; do not write a malformed artifact.

## Cross-references

- Service: `src/services/audit-independent/perf-audit-service.ts`
- Template: `.peaks/project-scan/perf-template.md`
- Schema: `.peaks/project-scan/audit-output-schema.md`
- Companion: `skills/peaks-security-audit/references/audit-protocol.md`
