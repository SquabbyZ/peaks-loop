---
name: peaks-perf-audit
description: Independent performance audit skill. Reads the immutable peaks-prd handoff + the project-level perf-template.md, performs a 6-dimension perf audit, and writes a structured envelope to `.peaks/_runtime/<sessionId>/audit/perf-<rid>.md`. Decoupled from peaks-rd 5-way fan-out per slice v2.12.0 (Group A, Tier 3). Use when the slice introduces CPU-bound hot loops, I/O throughput changes, memory allocation patterns, concurrency model changes, bundle size deltas, or cold-start costs.
metadata:
  appliesTo: peaks-loop v2.12.0+
  replaces: peaks-rd 5-way fan-out perf-baseline-reviewer slot (per AC-3.x)
  sources:
    - handoff: .peaks/_runtime/<sessionId>/prd/handoff.md (sha256-locked, schemaVersion: 2)
    - template: .peaks/project-scan/perf-template.md (git-tracked, schemaVersion: 1)
    - output: .peaks/_runtime/<sessionId>/audit/perf-<rid>.md (frontmatter schemaVersion: 1)
    - schema: .peaks/project-scan/audit-output-schema.md
---

# peaks-perf-audit

> **Independent performance audit skill** — separate from `peaks-rd`'s
> in-process `perf-baseline-reviewer` sub-agent. The skill is invoked
> explicitly via `peaks perf-audit run --rid <id>` and reads the
> immutable `prd/handoff.md` + the project-level `perf-template.md`
> to produce a structured `perf-<rid>.md` artifact. Per v2.11.0 D1
> (immutable handoff) and v2.12.0 AC-3.1~3.7.

## Why a standalone skill (not the 5-way fan-out slot)

The `perf-baseline-reviewer` slot in `peaks-rd`'s 5-way fan-out had two
structural problems:

1. **Self-deceiving** — RD reviews its own work; the perf baseline is
   the slice's own `perf-baseline.md`, not a project-level reference.
2. **No stable baseline** — every slice writes a fresh baseline,
   paying the same token cost for re-derived thresholds; and
   recurring patterns (e.g. "Node 22 fs.renameSync on Windows" or
   "vitest --changed mode") are not accumulated.

v2.12.0 promotes performance review to:

1. **Project-level** — the perf template lives at
   `.peaks/project-scan/perf-template.md` (git-tracked, reviewable
   in PRs, reusable across slices).
2. **Handoff-locked** — the audit consumes the immutable
   `prd/handoff.md` (sha256-verified) so the audit cannot drift from
   the agreed goals.
3. **Independent** — invoked explicitly post-`peaks-rd`
   implementation, not as a sub-agent in the same process tree.
4. **Sediment-aware** — `peaks-txt` appends new perf baselines to
   the template's `## Known baselines inventory` at session end.

## When to invoke

Invoke this skill when the slice touches any of the 6 perf
dimensions (full list in the template's `## Perf dimensions`).
For non-perf-shaped slices (pure docs / chore / config / tests-only),
the slice MUST NOT invoke this skill — the `perf-audit run` CLI
exits with `AUDIT_NOT_REQUIRED` (per AC-3.6).

## Workflow (5 steps)

### Step 1 — Detect

```bash
peaks perf-audit detect --rid <id> --sid <sid> --project <repo>
```

Calls `detectPerfAudit()` in `src/services/audit-independent/perf-audit-service.ts`.
Returns a 5-state result (mirrors `detectSecurityAudit`):

| State | Cause | Action |
|---|---|---|
| `ready` | handoff + template + project all present | Proceed to step 2 |
| `handoff-missing` | `.peaks/_runtime/<sid>/prd/handoff.md` absent | Run `peaks prd handoff init` first |
| `template-missing` | `.peaks/project-scan/perf-template.md` absent | Run `peaks project template init` first |
| `dispatch-failed` | parent LLM threw before returning envelope | Inspect prompt template; fall back to inline LLM review |
| `envelope-malformed` | parent LLM returned non-conforming value | Verify the skill prompt matches AC-3.x output shape |

### Step 2 — Read inputs (handoff + template)

- **Handoff** — the immutable PRD-agreed goal statement. The audit
  scopes itself to the in-scope surfaces named in the handoff.
- **Template** — the project-level perf template (6 dimensions +
  threshold table + measurement methodology). The audit walks every
  dimension and declares a strategy (EMPIRICAL / STATIC / N/A).

### Step 3 — Audit (parent LLM judgement)

The parent LLM (this skill) walks the diff against the 6 dimensions,
applying the threshold table from the template. Output is a
strict-shape envelope (mirrors `SecurityAuditEnvelope`):

```typescript
interface PerfAuditEnvelope {
  verdict: 'pass' | 'warn' | 'block';
  violations: ReadonlyArray<{
    dimension: string;        // 1 of 6 from template
    severity: 'CRITICAL' | 'HIGH' | 'MED' | 'LOW';
    file: string;             // repo-relative
    line: number;             // 1-based
    hint: string;             // actionable, <200 chars
  }>;
  summary: string;            // 1-paragraph perf narrative
}
```

Validation lives in `isPerfAuditEnvelope()` in the service.

### Step 4 — Write artifact

```bash
peaks perf-audit run --rid <id> --sid <sid> --project <repo> \
  --envelope @<path-to-envelope.json>
# or via stdin
peaks perf-audit run --rid <id> --sid <sid> --project <repo> < envelope.json
```

The artifact body has the required sections per
`.peaks/project-scan/audit-output-schema.md`:

- `## Summary` — 1-paragraph narrative
- `## Baseline reference` — link to existing baseline or `N/A — no prior baseline`
- `## Measurement result` — 6-dim status table
- `## Threshold check` — measured delta vs. warn/block
- `## Findings` — bullet list with severity tag
- `## Required fixes` — actionable bullets
- `## Verdict` — block: `verdict: <pass | warn | block>` + `CRITICAL: <n>`

### Step 5 — Hand off

The `peaks-rd` aggregator picks up the artifact from
`.peaks/_runtime/<sid>/audit/` and folds it into the slice's overall
`## Verdict` per the aggregation rules in `audit-output-schema.md`
(verdict precedence `block > warn > pass`; CRITICAL counts summed;
required fixes deduped by `(file, line, hint)`).

## Hard contracts (BLOCKING)

- **No fall-back to inline template** — the skill never synthesizes
  a perf baseline from scratch. If the template is missing, the CLI
  exits with `AUDIT_TEMPLATE_MISSING` (per AC-3.5).
- **No edits to the handoff** — the skill reads the handoff as
  immutable.
- **No self-deception** — the skill is invoked **after** `peaks-rd`
  implementation, not during. The 5-way fan-out's
  `perf-baseline-reviewer` slot is removed in v2.12.0 (Group B
  Tier 4).

## Cross-references

- PRD handoff: `.peaks/_runtime/<sid>/prd/handoff.md` (sha256-locked)
- Template: `.peaks/project-scan/perf-template.md` (git-tracked)
- Schema: `.peaks/project-scan/audit-output-schema.md`
- Service: `src/services/audit-independent/perf-audit-service.ts`
- CLI: `src/cli/commands/perf-audit-commands.ts`
- Tests: `tests/unit/services/audit-independent/perf-audit-service.test.ts`
- Companion: `skills/peaks-security-audit/SKILL.md` (symmetric structure)

## Karpathy alignment

- **#1 Think Before Coding** — `## Red-line scope` of the handoff
  defines what the audit covers. Out-of-scope findings surface via
  `nextActions[]`, not violations.
- **#2 Simplicity First** — the service is ~470 LoC, well below the
  800-line file cap. Symmetric to security-audit-service.ts; the
  duplication is intentional (independent type evolution per skill).
- **#3 Surgical Changes** — the skill does not edit the handoff, the
  template, or the diff under audit. It only writes a new audit artifact.
- **#4 Goal-Driven Execution** — every audit output references a
  verifiable handoff goal via the `handoffHash` field.
