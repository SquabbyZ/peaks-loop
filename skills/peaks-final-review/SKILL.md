---
name: peaks-final-review
description: Final-review skill for Peaks. Use when a workflow needs to assemble 4-dimension business-review evidence (functional-completeness, problem-resolution, no-new-bugs, existing-functionality-intact) for human acceptance at the end of an autonomous slice. Triggers on "/peaks-final-review", "prepare final review", "4-dim review", or peaks-code end-of-workflow handoff.
---

<!-- peaks:loop-hygiene — generated block; keep byte-identical in every SKILL.md -->

## Loop hygiene (every turn — MANDATORY)

**Skill header.** While this skill is active, open every turn with
`Peaks-Loop Skill: <skill> | Peaks-Loop Gate: <gate> | Next: <one short action>`.
Every turn, not only the first — it is how the user knows which skill is driving.

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

The service is the **gate primitive** that closes the 10% human / 90% LLM loop. It reads the approved audit-goal JSON from `.peaks/_runtime/<sessionId>/audit-goal/<rid>.json`, **collects real evidence from disk** (`qa/test-reports`, `qa/test-cases`, `qa/security-findings`, `qa/performance-findings`, `rd/{tech-doc,bug-analysis,code-review,security-review}.md`, `prd/handoff.md`), inlines it into the 4-dim review prompt under byte bounds, calls an injected `LlmRunner` exactly once, parses the response, and validates that all four required dimensions are present. It throws `IncompleteFinalReviewError` on malformed JSON or missing dimensions — callers MUST treat that as a gate failure (return to human for re-prompting) and never let autonomous work proceed on a partial review.

> **Evidence-backed verdicts (added 2026-09-12).** The service previously sent the model only `successCriteria` and no evidence at all, so it could not honestly grade anything — a real run returned 4/4 `inconclusive`, and a model willing to confabulate could have returned `pass`. Verdicts are now gated **structurally**, not by prompt wording: any `pass` whose supporting sources were all missing/empty is rewritten to `inconclusive` + `confidence: low` (`fail` is never softened), and `allPass` is derived from the gated verdicts so it can only narrow. Every non-`found` evidence source renders an explicit `STATUS: MISSING (<why>)` in the prompt, so the model always knows what it does not know.

> The `LlmRunner` interface is intentionally minimal so this service reuses the same provider injection seam as `audit-goal-service` and the slice LLMArbitrator (`src/services/audit/audit-goal-service.ts:16`). No provider implementation is baked in at this layer.

## Precondition

All of the following MUST be true before invoking this skill:

- **RD complete** — implementation merged and the slice boundary recorded at `.peaks/sc/slice-decomposition/<rid>.json` (or `peaks slice check --rid <rid> --json` returns `pass`).
- **QA complete** — `test-cases` + `test-reports` + `security-findings` + `performance-findings` present under `.peaks/_runtime/<sessionId>/qa/...` and all applicable gates A/A2/A3/A4/B/C/E/F satisfied (per `skills/peaks-qa/references/qa-transition-gates.md`).
- **Security check complete** — slice 025 project-level security test plan executed; no open CRITICAL/HIGH findings.
- **Performance baseline complete** — slice 025 project-level perf baseline recorded; no regression beyond the agreed threshold.
- **Approved audit-goal on disk** — `.peaks/_runtime/<sessionId>/audit-goal/<rid>.json` exists and contains `successCriteria` (the service feeds these into the LLM user prompt verbatim).

If any precondition is missing, **STOP** and route back to the responsible skill. Do not paper over a missing artifact with a hand-written successCriteria — the review must reflect what the human originally approved.

## Invocation

> **Correction (2026-09-12).** An earlier revision of this file claimed `peaks prepare-final-review`
> "does NOT yet exist" and told callers to hand-roll a `prepareFinalReview()` caller instead.
> **That was wrong.** The CLI wrapper exists and is registered —
> `src/cli/commands/final-review-commands.ts` (`W5 Fix M2`), command registered at its line ~130.
> The hand-rolled snippet that used to sit here also had the wrong flag shape (`--rid <rid>`);
> **the rid is positional**. Use the CLI.

```bash
peaks prepare-final-review <rid> [--session-id <sid>] [--project <path>] [--llm-provider <name>] [--json]
```

- `<rid>` is **positional** (not `--rid`). It resolves to `.peaks/_runtime/<sessionId>/audit-goal/<rid>.json`.
- `--session-id` defaults to the active workspace binding when omitted.
- **`--llm-provider` defaults to `stub`, and `stub` is the only provider that works today.**
  `stub` runs no real review — it returns a scaffold envelope so CI can prove the route is reachable.
  Verified 2026-09-12: passing a real provider (`--llm-provider anthropic`) returns
  `status: not-applicable` / `serviceWired: false` / `providerBinding: unknown` and tells you to re-run
  with `stub`; the CLI's own nextAction calls real-provider binding "a follow-up slice". So there is
  currently **no reachable path to a real 4-dim review** — confirming the route works is all `stub`
  can do.
- `--json` is required for machine consumption (peaks-code, peaks-txt, downstream CI).

Calling the service directly (`prepareFinalReview(rid, { projectRoot, sessionId, llmRunner })`) remains
valid for callers that need a custom `LlmRunner` injection seam, but it is no longer the only path.

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

> **⚠️ This dimension currently cannot pass — read before acting on it (verified 2026-09-12).**
> `pre-post-diff` is a declared `EvidenceKind`, but **nothing in peaks-loop produces that artifact**.
> The evidence actually mapped to this dimension is `rd/tech-doc.md` (design intent) and
> `prd/handoff.md` (scope / non-goals) — neither is a baseline diff, and the model correctly
> reports that ("the only FOUND source… is a design-intent document, not a regression assessment").
> `peaks scan api-diff <doc>` is *not* a producer: it diffs an API **document**, not the code surface.
>
> **Consequences:** `allPass === true` is **unreachable by construction**, for every workflow.
> This dimension will return `inconclusive` with an empty `evidence[]` even when the work is
> perfect. Treat that as a **tooling** state, not as evidence of a regression — and do **not**
> "fix" it by re-mapping `qa/test-reports` into this dimension's `supports`, which would turn the
> gate green without producing the baseline diff the definition above requires.
>
> **Real fix (unbuilt):** a producer for the pre/post baseline diff (test-count delta, public-API
> surface snapshot) written to `.peaks/_runtime/<sessionId>/final-review/api-diff.txt`, then mapped
> into this dimension's `supports`. Until that ships, `needsAttention` always contains this
> dimension — a permanently-red gate that reviewers will otherwise learn to ignore.

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
| `tests/unit/final-review/final-review-service.test.ts` | Service-level unit tests (8 cases: evidence inlining, the no-evidence⇒no-`pass` gate, prompt bounds, plus contract guards). |
| `docs/superpowers/plans/2026-06-25-slice-topology-multipass-phase-4.md:127` | Phase-4 plan prose (Task 14). |
| `skills/peaks-qa/SKILL.md` | Upstream QA skill — 4-dim review is downstream of all QA gates. |
| `skills/peaks-audit/SKILL.md` | Sibling skill — produces the `audit-goal` JSON that this skill consumes. |
