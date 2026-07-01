---
name: peaks-final-review
description: Final-review skill for Peaks. Use when a workflow needs to assemble 4-dimension business-review evidence (functional-completeness, problem-resolution, no-new-bugs, existing-functionality-intact) for human acceptance at the end of an autonomous slice. Triggers on "/peaks-final-review", "prepare final review", "4-dim review", or peaks-solo end-of-workflow handoff.
---

## Single-scope-axis naming convention

> **Read once at the top of this file; the rest of the skill is written against it.**

The `.peaks/` workspace is partitioned by a **single scope axis** (session-id, at `.peaks/_runtime/<sessionId>/...`) with a nested **sub-agent axis** under `.peaks/_sub_agents/<sessionId>/...`. Use `<sessionId>` placeholders (NEVER bare `<sid>`). The peaks-loop change-id axis was removed in slice `2026-06-29-change-id-root-removal`; reviewable artifacts now live under `.peaks/_runtime/<sessionId>/<role>/...` only. OpenSpec's independent `openspec/changes/<change-id>/` vocabulary (L4) is preserved untouched. CLI mapping: session-id → `peaks session *`; sub-agent → `peaks sub-agent *`. Regression test `tests/unit/skills/skills-skill-md-naming.test.ts` enforces (a) zero bare `<sid>`, (b) every `.peaks/_runtime/<X>/` has an axis label, (c) this callout is present.

# Peaks-Loop Final Review

Prepare 4-dim business review evidence for human acceptance. The LLM does the work; the human judges the outcome.

## Service entry point (authoritative)

The single source of truth for the 4-dim review is the service:

```ts
// src/services/final-review/final-review-service.ts
export async function prepareFinalReview(
  rid: string,
  opts: PrepareFinalReviewOptions
): Promise<FinalReviewOutput>;
```

Where `PrepareFinalReviewOptions` is:

```ts
interface PrepareFinalReviewOptions {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly llmRunner: LlmRunner; // imported from src/services/audit/audit-goal-service.js
}
```

The service is the **gate primitive** that closes the 10% human / 90% LLM loop. It reads the approved audit-goal JSON from `.peaks/_runtime/<sessionId>/audit-goal/<rid>.json`, calls an injected `LlmRunner` exactly once with a 4-dim review prompt, parses the response, and validates that all four required dimensions are present. It throws `IncompleteFinalReviewError` on malformed JSON or missing dimensions — callers MUST treat that as a gate failure (return to human for re-prompting) and never let autonomous work proceed on a partial review.

> The `LlmRunner` interface is intentionally minimal so this service reuses the same provider injection seam as `audit-goal-service` and the slice LLMArbitrator (`src/services/audit/audit-goal-service.ts:16`). No provider implementation is baked in at this layer.

## Precondition

All of the following MUST be true before invoking this skill:

- **RD complete** — implementation merged and the slice boundary recorded at `.peaks/sc/slice-decomposition/<rid>.json` (or `peaks slice check --rid <rid> --json` returns `pass`).
- **QA complete** — `test-cases` + `test-reports` + `security-findings` + `performance-findings` present under `.peaks/_runtime/<sessionId>/qa/...` and all applicable gates A/A2/A3/A4/B/C/E/F satisfied (per `skills/peaks-qa/references/qa-transition-gates.md`).
- **Security check complete** — slice 025 project-level security test plan executed; no open CRITICAL/HIGH findings.
- **Performance baseline complete** — slice 025 project-level perf baseline recorded; no regression beyond the agreed threshold.
- **Approved audit-goal on disk** — `.peaks/_runtime/<sessionId>/audit-goal/<rid>.json` exists and contains `successCriteria` (the service feeds these into the LLM user prompt verbatim).

If any precondition is missing, **STOP** and route back to the responsible skill. Do not paper over a missing artifact with a hand-written successCriteria — the review must reflect what the human originally approved.

## Invocation (CLI wrapper status — READ FIRST)

> **Pre-flight finding (HARD):** The plan prose at `docs/superpowers/plans/2026-06-25-slice-topology-multipass-phase-4.md:146` documents the invocation as:
>
> ```bash
> peaks prepare-final-review --rid <rid> --json
> ```
>
> **This CLI command does NOT yet exist.** `prepareFinalReview()` is implemented as a service in `src/services/final-review/final-review-service.ts` and is unit-tested in `tests/unit/final-review/final-review-service.test.ts`, but it is **not wired to a CLI subcommand**. A `peaks prepare-final-review` subcommand is the planned forward-looking surface; the integration sits at the service layer, not the CLI layer, today.
>
> **Pick for the future CLI wrapper file (audit recommendation):** create a new `src/cli/commands/final-review-commands.ts` matching the `peaks-<group>-commands.ts` naming convention (`qa-commands.ts`, `code-review-commands.ts`, `audit-commands.ts`). A grep of `src/cli/commands/` confirms NO `final-review-commands.ts` and NO `prepareFinalReview` import in any CLI file. Rationale: the 4-dim business review is conceptually distinct from `peaks qa *` (which is autonomous gate verification) — it is the human-acceptance terminator, not an internal gate. A separate command group preserves that boundary.

### Current call path (today, until a CLI wrapper is built)

```ts
// peaks-solo end-of-workflow, peaks-txt, or any other hand-rolled caller
import { prepareFinalReview } from './src/services/final-review/final-review-service.js';
import { auditGoalLlmRunner } from './src/services/audit/llm-runner.js'; // or your provider

const out = await prepareFinalReview('<rid>', {
  projectRoot: '<absolute path>',
  sessionId: '<sessionId>',
  llmRunner: auditGoalLlmRunner
});
```

### Planned call path (after the CLI wrapper lands)

```bash
# Forward-looking — does not work yet. Track under
#   src/cli/commands/final-review-commands.ts
peaks prepare-final-review --rid <rid> [--session-id <sid>] --json
```

`--rid` is required and resolves to `.peaks/_runtime/<sessionId>/audit-goal/<rid>.json`. `--json` is required for machine consumption (peaks-solo, peaks-txt, downstream CI). The wrapper will resolve `--session-id` from `.peaks/_runtime/current-change` when omitted, matching the workspace binding pattern used by `peaks request *`.

## Output

A `FinalReviewOutput` (`src/services/final-review/final-review-types.ts:50`):

```ts
interface FinalReviewOutput {
  readonly rid: string;
  readonly generatedAt: string;                   // ISO timestamp
  readonly dimensions: readonly DimensionEvidence[]; // EXACTLY 4
  readonly overallSummary: string;                 // one paragraph
  readonly allPass: boolean;                       // all 4 verdicts === 'pass'
  readonly needsAttention: readonly DimensionKind[]; // dims that are 'fail' or 'inconclusive'
}
```

Each `DimensionEvidence` carries:

- `dimension` — one of the four required `DimensionKind` values
- `verdict` — `pass | fail | inconclusive`
- `summary` — one short paragraph
- `evidence` — list of `EvidenceItem` (`{ kind, description, artifact?, link? }`) with `EvidenceKind` ∈ `test-result | test-coverage | manual-spot-check | pre-post-diff | regression-suite | ac-mapping`
- `confidence` — `high | medium | low`

The service enforces that **all 4 dimensions are present**; a missing dimension throws `IncompleteFinalReviewError` and the call is a gate failure. Treat `allPass === true` + empty `needsAttention` as a clean handoff to the human. Anything else — `allPass === false`, a `fail` verdict, or an `inconclusive` verdict — must come back to the LLM loop with a re-prompt (do not ask the human to interpret raw LLM output).

## The 4 dimensions (one-line summary)

Full evidence contract per dimension: `references/4-dimensions.md`.

1. **functional-completeness** — every AC from the approved audit-goal maps to a passing test (`evidence.kind === 'ac-mapping'` + `test-result`).
2. **problem-resolution** — there is a targeted test for the original problem case (`evidence.kind === 'test-result'` against the original repro).
3. **no-new-bugs** — the regression suite is green AND the LLM surfaces 0 net-new failures (`evidence.kind === 'regression-suite'` + `manual-spot-check`).
4. **existing-functionality-intact** — a pre/post baseline diff (test count, public API surface, key behavior) shows no unintended drift (`evidence.kind === 'pre-post-diff'`).

## Human's role

The human reviews evidence, **judges business outcomes (NOT code)**. The LLM produces structured evidence; the human's job is to:

- confirm that `allPass === true` corresponds to the business outcome they actually want (not just "tests are green");
- decide what to do with `needsAttention` items — accept the LLM's verdict, override a `pass` to `fail` when the evidence is weak, or send the slice back to RD with a re-prompt;
- gate the release / archive action based on `allPass` + their own business review, not just on the LLM signal.

The LLM does NOT decide whether the work is shipped. The LLM only assembles evidence. The human is the final reviewer of business outcomes; the service is the gate that gives them structured evidence to review.

## Boundaries

- Do not modify the audit-goal at `.peaks/_runtime/<sessionId>/audit-goal/<rid>.json` — the service reads it as-is. If criteria need to change, route back to `peaks-audit` and re-approve.
- Do not call `prepareFinalReview()` twice for the same `(rid, sessionId)` without first surfacing the prior result to the human. Each call costs one LLM invocation and may diverge.
- Do not substitute the 4-dim review for the QA gate family (A/A2/A3/A4/B/C/E/F). The 4-dim review is a human-acceptance surface, not a regression gate. QA gates must pass first.
- Do not write the review output to git. The LLM output is ephemeral — keep it under `.peaks/_runtime/<sessionId>/final-review/<rid>.json` (gitignored) and reference it from the change-id-scoped handoff at `.peaks/_runtime/<changeId>/handoff/<rid>-<change-id>.md` if downstream review needs it.
- Do not allow autonomous work to proceed on a `IncompleteFinalReviewError` — that is a gate failure, not a recoverable runtime error.

## Compact handoff

When handing off, emit: rid, `allPass`, `needsAttention[]`, output path, source service version (commit hash of `src/services/final-review/final-review-service.ts`), LLM provider used, and one-line summary. Link to the full `FinalReviewOutput` JSON instead of pasting it.

## References

| File | Coverage |
|---|---|
| `references/4-dimensions.md` | Per-dimension evidence contract, verdict semantics, examples. |
| `src/services/final-review/final-review-service.ts` | Authoritative service implementation. |
| `src/services/final-review/final-review-types.ts` | `FinalReviewOutput`, `DimensionEvidence`, verdict/evidence/confidence enums. |
| `src/services/audit/audit-goal-service.ts:16` | Line of evidence that `LlmRunner` is reusable across audit + final-review (service-level integration). |
| `tests/unit/final-review/final-review-service.test.ts` | Existing service-level unit tests (5 cases). |
| `docs/superpowers/plans/2026-06-25-slice-topology-multipass-phase-4.md:127` | Phase-4 plan prose (Task 14). |
| `skills/peaks-qa/SKILL.md` | Upstream QA skill — 4-dim review is downstream of all QA gates. |
| `skills/peaks-audit/SKILL.md` | Sibling skill — produces the `audit-goal` JSON that this skill consumes. |
