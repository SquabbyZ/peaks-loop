---
name: 2026-06-27-v2-12-independent-security-perf-audit
description: v2.12.0 release decision — collapse peaks-rd 5-way fan-out to 3-way by moving security-reviewer + perf-baseline-reviewer into standalone audit skills (peaks-security-audit + peaks-perf-audit). Single source of truth for the v2.12.0 collapse contract.
metadata:
  type: project
  sourceArtifact: .peaks/_runtime/2026-06-27-session-b483e6/rd/requests/001-v2-12-independent-security-perf-audit.md
  releaseTag: v2.12.0
  groupSplit: "A (Tier 1+2+3), B (Tier 4+5), C (Tier 6), D (Tier 7), E (Tier 8+9)"
  createdAt: 2026-06-27
---

# v2.12.0 — Independent Security + Perf Audit Skills (slice 2026-06-27)

## What changed (the decision)

The peaks-rd parallel review fan-out was a **5-sub-agent** pattern in v2.11.x:

1. `code-reviewer` → `rd/code-review.md`
2. `security-reviewer` → `rd/security-review.md`
3. `perf-baseline-reviewer` → `rd/perf-baseline.md`
4. `qa-test-cases-writer` → `qa/test-cases/<rid>.md`
5. `karpathy-reviewer` (hard gate) → `rd/karpathy-review.md`

The security + perf audit slots were not actually independent — they ran
inside the RD fan-out, were dispatched by the RD main loop, and wrote
RD-owned artifacts. Their outputs were treated as "RD's view of security/perf"
rather than independent expert audit. Plus the project-level threat
model + perf baseline were regenerated every slice, which was pure token
waste (a 3-slice sequence produced 3 copies of the same project-level
artifact).

**v2.12.0 collapse**: the `security-reviewer` + `perf-baseline-reviewer`
slots moved OUT of the RD fan-out into two new **standalone audit skills**:

- `peaks-security-audit` (skill id: `peaks-security-audit`)
- `peaks-perf-audit` (skill id: `peaks-perf-audit`)

Each has its own CLI subcommand (`peaks security-audit run` /
`peaks perf-audit run`), consumes the immutable peaks-prd handoff
(`.peaks/_runtime/<sessionId>/prd/handoff.md`) and the project-scoped
audit templates under `.peaks/project-scan/{security-template,
perf-template, audit-output-schema}.md`, and writes its output to
`.peaks/_runtime/<sessionId>/audit/security.md` /
`audit/perf.md`.

The RD fan-out is now **3 sub-agents**: `code-reviewer` +
`qa-test-cases-writer` + `karpathy-reviewer`. The audit skills run
**before** RD (as a pre-RD audit pass) or **in parallel** with the
3-way fan-out via `peaks sub-agent dispatch peaks-security-audit` +
`peaks sub-agent dispatch peaks-perf-audit`.

## Why (the rationale)

1. **True independence**: the audit skills run as their own skill
   conversations, not as RD sub-agents. They have their own prompts,
   their own context, their own stop rules, and they consume the
   immutable handoff instead of writing to RD's scratchpad.
2. **Token savings**: project-level threat model + perf baseline are
   stable across slices. The audit skills cache them as the
   `## Project baseline` block of each audit output, then only emit
   the per-slice delta.
3. **Prereq enforcement**: the `AUDIT_SECURITY` + `AUDIT_PERF` +
   `AUDIT_REQUIRES_HANDOFF` prereqs in
   `src/services/artifacts/artifact-prerequisites.ts` mechanically
   block `peaks request transition --state qa-handoff` until the
   audit outputs are written and the handoff frontmatter is verified.
   RD cannot accidentally skip them.
4. **Cleaner fan-out**: 3 sub-agents is easier to reason about than 5.
   The `code-reviewer` + `qa-test-cases-writer` + `karpathy-reviewer`
   trio is the "RD review" set; the audit skills are the "pre-RD audit"
   set.

## Architecture

```
peaks-prd → writes immutable handoff (sha256 + schemaVersion: 2)
            ↓
peaks-security-audit (CLI: peaks security-audit run)
peaks-perf-audit    (CLI: peaks perf-audit run)
            ↓ both consume the handoff + project-scan audit templates
peaks-rd (3-way fan-out: code-reviewer + qa-test-cases-writer + karpathy-reviewer)
            ↓ AUDIT_SECURITY + AUDIT_PERF + AUDIT_REQUIRES_HANDOFF prereqs gate
peaks-qa
            ↓
peaks-txt sediment → appends (audit/security.md + audit/perf.md + audit-output-schema)
```

## Pinning (the contract tests)

| File | Cases | What it pins |
|---|---|---|
| `tests/unit/rd/karpathy-skip-on-config-docs-chore.test.ts` | ≥6 | 3-element `reviewerListFor('feat')`; karpathy-skip for config/docs/chore |
| `tests/unit/rd/deprecated-reviewer-back-compat.test.ts` | 8 | `isDeprecatedReviewer(name)` + legacy-path acceptance during 1-minor-release |
| `tests/unit/artifact-prerequisites-typed.test.ts` | (extended) | `AUDIT_SECURITY` + `AUDIT_PERF` + `AUDIT_REQUIRES_HANDOFF` prereq shapes |
| `tests/unit/services/audit-independent/security-audit-service.test.ts` | 6 | handoff-missing / template-missing / happy path / verdict-3-state / dispatch-failed / envelope-malformed |
| `tests/unit/services/audit-independent/perf-audit-service.test.ts` | 6 | same shape for perf |
| `tests/unit/services/prd/project-scan-sediment.test.ts` | +7 | `appendSecurityPattern` + `appendPerfPattern` + `appendAuditSchemaVariant` idempotency |
| `tests/unit/parallel-fan-out.test.ts` | 18 | v2.12.0 3-way SKILL.md + reference content |
| `tests/unit/skills/karpathy-5way-fanout.test.ts` | 17 | v2.12.0 collapse invariants in the karpathy test |

## 1-minor-release back-compat window

v2.12.0 keeps the legacy paths readable via `mustContainAny`:

- Legacy `rd/security-review.md` → accepted via `AUDIT_SECURITY.mustContainAny`.
- Legacy `rd/perf-baseline.md` → accepted via `AUDIT_PERF.mustContainAny`.
- Legacy `RD_FANOUT_REVIEWERS`-slot dispatch records (`.peaks/_sub_agents/<sessionId>/dispatch/{security-reviewer,perf-baseline-reviewer}.json`) → routed via `isDeprecatedReviewer(name)` to the new audit skill.

v2.13.0 hard-deletes the legacy paths. The `RD_DEPRECATED_REVIEWERS`
constant in `src/services/rd/reviewer-dispatch-policy.ts` is the
canonical list.

## What did NOT change

- `src/services/code-review/ecc-bridge.ts` — completely unchanged.
- `src/services/dispatch/sub-agent-dispatcher.ts` — cross-IDE dispatch abstraction unchanged; new audit skills reuse it.
- `src/services/agent/ecc-agent-service.ts` — ECC 64-agents subprocess wrapper unchanged.
- `src/services/prd/handoff-service.ts` + `handoff-types.ts` — sha256 + schemaVersion: 2 unchanged.
- `src/services/prd/project-scan-reader.ts` + `project-scan-types.ts` — bidirectional learning loop unchanged.
- `src/services/rd/{strategic,tactical,strategy,impl,ast-gate,types}.ts` — Plan 3 sub-stage system unchanged.
- `peaks-qa` skill (`src/services/qa/`) — v2.11.0 already trimmed to business-test only; no additions.
- `peaks-code/SKILL.md` main flow — Steps 0.55/0.6/0.7/1 unchanged.
- `peaks-prd/SKILL.md` main body — unchanged (audit skills are new consumers of the handoff, not new PRD outputs).

## Multi-CC group split (commit boundaries)

| Group | Tiers | Scope | Commit tag | Estimated LoC |
|---|---|---|---|---|
| A | 1+2+3 | Templates + new skills | v2.12.0-alpha.1 | ~700 new |
| B | 4+5 | 5→3 fan-out collapse + prereq migration | v2.12.0-alpha.2 | ~200 mod + ~50 test |
| C | 6 | peaks-txt sediment extension | v2.12.0-alpha.3 | ~100 mod + ~50 test |
| D | 7 | fan-out SKILL.md updates | v2.12.0-alpha.4 | ~50 markdown mod + ~70 test |
| E | 8+9 | Decision records + migration + CHANGELOG + version bump | v2.12.0 (release) | ~30 mod + 2 memory + 1 CHANGELOG |

Each group ran the full RD→QA loop independently. The release commit
(bumping `2.11.2 → 2.12.0`) is Group E only.

## Cross-references

- [[2026-06-27-v2-12-fanout-3way]] — fan-out shape decision (Tier 4)
- [[2026-06-27-v2-12-group-a-partial-t1]] — Group A Tier 1 partial checkpoint
- [[security-perf-plan-result-split]] — slice 025 plan/result split that the audit skills build on
- [[audit-decision-record-convention]] — `peaks audit static --record` shape
- `src/services/rd/reviewer-dispatch-policy.ts` — canonical decision table + `RD_DEPRECATED_REVIEWERS`
- `src/services/artifacts/artifact-prerequisites.ts` — `AUDIT_SECURITY` + `AUDIT_PERF` + `AUDIT_REQUIRES_HANDOFF`
- `skills/peaks-rd/references/v2-12-fanout-collapse.md` — single canonical reference for the collapse contract
- `skills/peaks-security-audit/SKILL.md` + `skills/peaks-perf-audit/SKILL.md` — new skill surfaces