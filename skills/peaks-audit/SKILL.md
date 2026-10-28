---
name: peaks-audit
description: Gate autonomous LLM work on a 6-dimension audit + user-accepted goal. Use IMMEDIATELY after a need is expressed, BEFORE any PRD/RD/QA work starts.
---

<!-- peaks:loop-hygiene — HAND-MAINTAINED block, NOT generated; byte-identical in every SKILL.md, enforced by tests/unit/skills/loop-hygiene-block.test.ts. Edit one, edit all 25. -->

## Loop hygiene (every turn — MANDATORY)

**Skill header.** While this skill is active, open every turn with
`Peaks-Loop Skill: <skill> | Peaks-Loop Role: <role> | Peaks-Loop Gate: <gate> | Peaks-Loop Context: <ratio%> (<zone>) | Next: <one short action>`.
Every turn, not only the first — it is how the user knows which skill is driving.
`Role` and `Context` are machine facts: copy them from `peaks skill presence --json`
(`data.role`, `data.context.ratioPct`, `data.context.action`) — never invent them.

**Context is this skill's own business.** Run `peaks skill presence --json` every turn and
read its `context` block. When `action` is `auto-fire`, `pre-compact`, or `red-line`,
run `peaks code auto-compact --project .` **yourself**, then continue. Tell the user the
ratio in one line if it helps, but never hand them the compaction step: asking the user to
run `/compact` is the regression the zero-pause contract forbids. This holds in **every
mode** — standard *and* 24h. The mode moves the threshold, never the obligation.

**Read before you edit.** Read a file before your first `Edit` / `Write` / `MultiEdit` on
it — the normal way to work here — for every path outside `.peaks/**` (source, tests, docs,
config); `.peaks/**` writes are exempt.

**Expect one denial per file anyway — and do NOT pre-empt it.** A `PreToolUse` gate (ECC's
"Fact-Forcing Gate") denies the FIRST edit a session makes to any given path, once, by
design. Reading does NOT prevent it: the gate keys on the path's first touch, not on whether
you read it. **Do not recite its four questions before every edit** — it asks when it wants
them, and reciting unprompted burns a round-trip per file for nothing. Answer only when a
denial actually arrives.

**When one does arrive:** a denial is not a failure and the tool is not broken — your edit
was NOT applied. State the facts it asks for (importers, affected API, data schemas if any,
the user's verbatim instruction), then retry the SAME operation. The retry is allowed. Do not
switch tools, do not give up, do not retry blindly. One more thing worth knowing: an idle gap
of ~30 minutes clears the gate's "already passed" list, so a file you cleared earlier can be
denied again after a long pause. That is the gate resetting, not you regressing.
<!-- /peaks:loop-hygiene -->

## Single-scope-axis naming convention

> **Read once at the top of this file; the rest of the skill is written against it.**

The `.peaks/` workspace is partitioned by a **single scope axis** (session-id, at `.peaks/_runtime/<sessionId>/...`) with a nested **sub-agent axis** under `.peaks/_sub_agents/<sessionId>/...`. Use `<sessionId>` placeholders (NEVER bare `<sid>`). The peaks-loop change-id axis was removed in slice `2026-06-29-change-id-root-removal`; reviewable artifacts now live under `.peaks/_runtime/<sessionId>/<role>/...` only. OpenSpec's independent `openspec/changes/<change-id>/` vocabulary (L4) is preserved untouched. CLI mapping: session-id → `peaks session *`; sub-agent → `peaks sub-agent *`. Normative by documentation only — the guard that once asserted (a) zero bare `<sid>`, (b) an axis label on every runtime path, and (c) this callout's presence was deleted in `457b9a87`. Comply by convention.

# Peaks-Loop Audit

`peaks-audit` is the **first** step in any peaks-* workflow. It turns a human-expressed need into a 6-dimension audit plus a proposed goal, and refuses to let autonomous LLM work proceed on a partial audit. It is invoked IMMEDIATELY after the need is expressed, and BEFORE any PRD, RD, or QA work begins.

## Precondition

**None.** `peaks-audit` is the entry point; no other peaks-* skill runs first. If the user hands you a raw need with no accepted goal, audit it before doing anything else.

## Lane routing — ask once per request, at this entry

If every peaks-* workflow enters here, then this is where the lane question belongs: a need reaches `peaks-audit` before it reaches any other peaks-* skill, whichever words the user used to express it. The question — the full workflow (`peaks-code`) or the fast lane (`peaks-race-code`) — is answered by the user, and is never presumed by the LLM on their behalf.

| Situation | Behaviour |
|---|---|
| The user named no skill — just a need, in their own words | Ask once with `AskUserQuestion`. **No option is preselected.** |
| The user named a skill (`/peaks-code`, `/peaks-race-code`) | Ask once, with **the named lane preselected**: one Enter passes, and choosing the other lane stays available. |
| The question has already been answered for this request | Do not ask again. |
| This session is already locked to a lane | Do not ask again. |

**The phase rewrites the first two rows of that table, and nothing else.** Which of the two branches is in force is read from the tracked file `.peaks/race/lane-phase.json` and stated nowhere else in this file — what follows gives the rule for either value rather than asserting a value, so no sentence here can drift from it:

| `.peaks/race/lane-phase.json` says | Behaviour |
|---|---|
| `name-only` | **Do not ask.** An unnamed need runs the full workflow (`peaks-code`), and a named skill is respected without being questioned. The question would be **malformed rather than merely unhelpful** here: with the fast lane absent from its options it carries a single answer, and `AskUserQuestion` requires two to four — so do not re-add it to "be safe", as its absence is the design, not an oversight. |
| `offered-by-default` | The table above applies in full: ask even when a skill was named, with that one preselected, and the fast lane is one of the offered options. |

That file is **authoritative**, and it may hold exactly one key, `phase`, with exactly one of those two values: `src/services/race/lane-phase.ts` reads it and refuses anything else, and `tests/unit/skills/race-lane-phase-gate.test.ts` judges the value against the tracked evidence before this lane may be offered. Moving the phase means moving that one value, with the evidence behind it — and leaving it at `offered-by-default` while its evidence does not pass turns that guard red.

Clearing the pilot is a separate, explicit project decision — a real-task trial with no severe regression — and not something to read off a green test run. It is recorded by moving that value to `offered-by-default`; whatever the file names is what binds.

**There is no silent lane.** `peaks-race-code` starts only on the user's word: they named it, or they picked it when the question was asked. Never answer that question for them, and where it applies and they have not answered it, hold there rather than choosing a lane on their behalf.

**Mid-task, suggest; never re-ask.** When a closer look shows the task is heavier than it looked, say so in one sentence and let the user keep going — "this is past what the fast lane is for; want the full workflow instead?" A suggestion, not a popup and not a gate, and the user may ignore it.

What may take the fast lane at all is not decided here. The changes that do not belong in one, and what "done" means once one does, are stated once in `../peaks-code/references/fast-lane-norm.md`; read them there rather than from this file, and do not restate them here.

## Hard contract — invoke IMMEDIATELY

When a workflow surfaces a human need (a sentence, a ticket summary, a voice note, a vague "I want X"), call `peaks-audit` BEFORE any other skill:

```text
need expressed  →  peaks audit goal  →  (user accepts goal)  →  peaks-prd  →  peaks-rd  →  peaks-qa
                       ▲
                       │
              you are here on first contact
```

Do not start PRD, RD, or QA work on an unaudited need. The audit is what makes the downstream skill boundaries verifiable.

## Trigger conditions

Invoke `peaks-audit` when **any** of these are true:

- A human just expressed a software-development need and no accepted `proposedGoal` exists yet.
- A previous audit was rejected (any dimension missing, malformed JSON, or the user said "redo the audit").
- A drift detector (peaks-doctor, peaks-code) flagged that an in-flight slice lost its goal binding.
- The user typed `/peaks-audit` or said "audit this", "scope this", "what would this take", "is this a good idea".

Do NOT invoke peaks-audit when the user is asking for a code review, a test run, or a deployment — those are downstream skills.

## Invocation

### Intended CLI form (L2.4 — not yet registered in `src/cli/commands/audit-commands.ts`)

```bash
peaks audit goal --need "<natural language description of the need>" --json
```

> **Deviation note:** at the time of this writing, only `peaks audit red-lines` and `peaks audit static` are registered as `peaks audit` subcommands. The `audit-goal` subcommand is **not yet wired** in `src/cli/commands/audit-commands.ts`. Callers reach the primitive through the TypeScript module below. The CLI registration is tracked separately and must not be conflated with the primitive itself.

### Service-layer form (authoritative, used today)

`peaks audit goal` is a thin wrapper around the `auditGoal()` function in `src/services/audit/audit-goal-service.ts`. Two integration paths exist today:

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
