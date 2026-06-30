---
name: peaks-audit
description: Gate autonomous LLM work on a 6-dimension audit + user-accepted goal. Use IMMEDIATELY after a need is expressed, BEFORE any PRD/RD/QA work starts.
---

## Single-scope-axis naming convention

> **Read once at the top of this file; the rest of the skill is written against it.**

The `.peaks/` workspace is partitioned by a **single scope axis** (session-id, at `.peaks/_runtime/<sessionId>/...`) with a nested **sub-agent axis** under `.peaks/_sub_agents/<sessionId>/...`. Use `<sessionId>` placeholders (NEVER bare `<sid>`). The peaks-cli change-id axis was removed in slice `2026-06-29-change-id-root-removal`; reviewable artifacts now live under `.peaks/_runtime/<sessionId>/<role>/...` only. OpenSpec's independent `openspec/changes/<change-id>/` vocabulary (L4) is preserved untouched. CLI mapping: session-id → `peaks session *`; sub-agent → `peaks sub-agent *`. Regression test `tests/unit/skills/skills-skill-md-naming.test.ts` enforces (a) zero bare `<sid>`, (b) every `.peaks/_runtime/<X>/` has an axis label, (c) this callout is present.

# Peaks-Cli Audit

`peaks-audit` is the **first** step in any peaks-* workflow. It turns a human-expressed need into a 6-dimension audit plus a proposed goal, and refuses to let autonomous LLM work proceed on a partial audit. It is invoked IMMEDIATELY after the need is expressed, and BEFORE any PRD, RD, or QA work begins.

## Precondition

**None.** `peaks-audit` is the entry point; no other peaks-* skill runs first. If the user hands you a raw need with no accepted goal, audit it before doing anything else.

## Hard contract — invoke IMMEDIATELY

When a workflow surfaces a human need (a sentence, a ticket summary, a voice note, a vague "I want X"), call `peaks-audit` BEFORE any other skill:

```text
need expressed  →  peaks audit-goal  →  (user accepts goal)  →  peaks-prd  →  peaks-rd  →  peaks-qa
                       ▲
                       │
              you are here on first contact
```

Do not start PRD, RD, or QA work on an unaudited need. The audit is what makes the downstream skill boundaries verifiable.

## Trigger conditions

Invoke `peaks-audit` when **any** of these are true:

- A human just expressed a software-development need and no accepted `proposedGoal` exists yet.
- A previous audit was rejected (any dimension missing, malformed JSON, or the user said "redo the audit").
- A drift detector (peaks-doctor, peaks-solo) flagged that an in-flight slice lost its goal binding.
- The user typed `/peaks-audit` or said "audit this", "scope this", "what would this take", "is this a good idea".

Do NOT invoke peaks-audit when the user is asking for a code review, a test run, or a deployment — those are downstream skills.

## Invocation

### Intended CLI form (L2.4 — not yet registered in `src/cli/commands/audit-commands.ts`)

```bash
peaks audit-goal --need "<natural language description of the need>" --json
```

> **Deviation note:** at the time of this writing, only `peaks audit red-lines` and `peaks audit static` are registered as `peaks audit` subcommands. The `audit-goal` subcommand is **not yet wired** in `src/cli/commands/audit-commands.ts`. Callers reach the primitive through the TypeScript module below. The CLI registration is tracked separately and must not be conflated with the primitive itself.

### Service-layer form (authoritative, used today)

`peaks audit-goal` is a thin wrapper around the `auditGoal()` function in `src/services/audit/audit-goal-service.ts`. Two integration paths exist today:

**1. Direct TypeScript call** (used by `src/services/final-review/final-review-service.ts`, `src/services/slice/llm-arbitrator.ts`, `src/services/slice/multi-pass-orchestrator.ts`):

```typescript
import { auditGoal, IncompleteAuditError } from './services/audit/audit-goal-service.js';
import type { LlmRunner } from './services/audit/audit-goal-service.js';

try {
  const output = await auditGoal({ need }, llmRunner);
  // output is a fully validated AuditGoalOutput
} catch (err) {
  if (err instanceof IncompleteAuditError) {
    // code === 'INCOMPLETE_AUDIT'
    // autonomous work MUST NOT proceed — return to human
  }
  throw err;
}
```

**2. File-mediated handoff** (used by `final-review-service` to read the human-approved goal):

The approved goal is persisted at:

```text
.peaks/_runtime/<sessionId>/audit-goal/<rid>.json
```

`final-review-service` reads this file at the start of every final-review pass. The shape is exactly `AuditGoalOutput` (see Output below). The writer that produces this file is whatever upstream agent (peaks-audit, the slice LLMArbitrator, or a hand-authored call) ran the audit.

## Output: `AuditGoalOutput`

`auditGoal()` returns a frozen object with EXACTLY these top-level fields (per `src/services/audit/audit-goal-types.ts`):

| Field | Type | Meaning |
|---|---|---|
| `summary` | `string` | 1–2 sentence restatement of the need. |
| `audit` | `readonly AuditDimension[]` | EXACTLY 6 entries, one per dimension (see below). |
| `proposedGoal` | `string` | What success looks like for the work. |
| `successCriteria` | `readonly string[]` | Acceptance bullets QA can execute against. |
| `roughEffort` | `'small' \| 'medium' \| 'large' \| 'epic'` | T-shirt size, not hours. |
| `confidence` | `'high' \| 'medium' \| 'low'` | How certain the audit is of the need. |
| `rationale` | `string` | One paragraph tying the audit findings to the proposed goal. |

Each `AuditDimension` is:

| Field | Type | Meaning |
|---|---|---|
| `dimension` | `AuditDimensionKind` | One of `correctness`, `completeness`, `scope`, `risks`, `alternatives`, `constraints`. |
| `finding` | `string` | The audit observation for that dimension. |
| `severity` | `'info' \| 'concern' \| 'blocker'` | Whether the dimension is healthy (`info`), suspicious (`concern`), or fatal (`blocker`). |

→ see `references/6-dimensions.md` for the per-dimension contract + `info` / `concern` / `blocker` definitions.

## One-shot accuracy (HARD contract)

The audit MUST be good enough that a human can accept the `proposedGoal` on the **first** review. The whole point of the primitive is to compress the LLM's understanding of a need into something a human can OK in one read.

That means:

- `proposedGoal` is one sentence, not a paragraph.
- `successCriteria` are executable, not aspirational ("`peaks audit red-lines` exits 0" is good; "tests pass" is bad).
- Every dimension has a `severity`. `info` is the default; reserve `concern` for things the human should weigh in on; reserve `blocker` for things that make the work **unsafe to start**.
- `rationale` ties the findings to the goal in 3–6 sentences, no marketing.
- `roughEffort` is honest. If you do not know, say `large`. Do not pre-shrink.
- `confidence` is honest. If the LLM is guessing, say `low`. Do not over-claim.

If the audit comes back vague, the LLM was lazy. Re-prompt the LLM with the original `need` + a reminder to be specific. Do not edit the audit output by hand — the service rejects malformed JSON or missing dimensions, and an in-place patch will be silently rejected downstream.

## Failure mode (BLOCKING — read before declaring a workflow started)

`auditGoal()` is the **unit of validation**. It rejects any LLM response that:

1. Is not valid JSON.
2. Is missing any of the top-level fields (`summary`, `audit`, `proposedGoal`, `successCriteria`, `roughEffort`, `confidence`, `rationale`).
3. Has an `audit` array that does not cover all 6 dimensions (`correctness`, `completeness`, `scope`, `risks`, `alternatives`, `constraints`).

When any of these triggers, the service throws `IncompleteAuditError` with `code === 'INCOMPLETE_AUDIT'`. The error is the gate signal. Autonomous work MUST NOT proceed on a partial audit. The contract is:

- **Caller obligation** — if you catch `IncompleteAuditError`, return the error to the human (or the parent skill). Do not retry silently. Do not fill in the missing dimension yourself.
- **Downstream obligation** — `peaks-prd`, `peaks-rd`, `peaks-qa` MUST check that an accepted `AuditGoalOutput` exists in the artifact workspace before they start. If absent, they refuse to start and route back to `peaks-audit`.

This is the only validation contract the primitive enforces. It is intentionally narrow so the LLM has room to be creative, but the missing-dimension check is non-negotiable.

## When NOT to use peaks-audit

- **The user has already accepted a goal.** Re-auditing is wasteful; route to `peaks-prd` or `peaks-rd` directly.
- **The need is a refactor with no behavior change.** `peaks-rd` can run its own regression matrix without a full 6-dim audit; route there with a `refactor-only` flag.
- **The need is operational (deploy, rollback, rotate secret).** Route to `peaks-doctor` or a runbook skill, not the audit primitive.
- **You are mid-slice and the goal drifted.** Trigger `peaks-audit` again to re-bind the goal, then continue. Do not silently update the goal in place.

## References

| File | Coverage |
|---|---|
| `references/6-dimensions.md` | Per-dimension definition, severity rules, examples. |
