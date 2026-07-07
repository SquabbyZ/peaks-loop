---
name: 2026-07-03-v3-1-1-detect-job-recorder
description: v3.1.1 patch — peaks code detect-job / read-job-shape — Step 0.8 BLOCKING on LLM judgement, CLI is a recorder not a detector. Why keyword regex was the wrong design.
metadata:
  type: project
  createdAt: 2026-07-03
  affects: peaks-code Step 0.8, src/services/code/job-shape-decision.ts, src/cli/commands/code-commands.ts
---

# v3.1.1 — Step 0.8 detect-job recorder (shipped)

## Why this patch exists

Incident on 2026-07-03 (v3.1.0 ship day): user prompt on a real project named 35 parallel `app/*` subdirs, said "until all done", and disavowed cost. `peaks-code` matched the trigger words but did NOT enter Job mode — it ran 5 slices serially and STOPPED at 81% context with a fake-completion handoff. Memory: [[2026-07-03-v3-1-0-job-trigger-miss]].

Root cause: Step 0.8 was prose-only with no BLOCKING gate and no detector. An LLM-runner that skimmed SKILL.md treated it as advisory.

## Why the first design (keyword regex) was wrong

Initial RD spec had the CLI run regex matching against the user prompt (`/直到|全部|until all done|.../`). User pushed back: **the judgement is the LLM's job, not the CLI's**. Keyword regex is wrong because:

1. LLMs already have semantic understanding; a regex can never match all natural-language variants ("把剩下的也跑了", "搞定所有 subdir", "multi-dir batch").
2. A regex shifts the LLM's semantic understanding into code — strictly less capable.
3. Maintenance surface becomes "is the keyword list complete" instead of "is the schema OK".
4. Hardcoding contradicts peaks-loop's "24h AI programmer" positioning (the LLM is the source of truth, the CLI is the guardrail).

## The right design (shipped)

CLI is a **recorder and gate**:

- LLM reads the prompt, applies semantic judgement, and calls `peaks code detect-job --is-job <bool> --rationale <text> --suggested-job-id <jid> --suggested-strategy <single|rotating> --confidence <high|medium|low> [--force]`.
- CLI writes the decision to `.peaks/_runtime/<sessionId>/job-shape.json` (server-side stamps `decidedAt`; LLM cannot back-date).
- `readJobShapeDecision` throws `JOB_SHAPE_NOT_DECIDED` when the file is absent.
- Downstream steps (Step 1, Step 0.81, etc.) call `peaks code read-job-shape` and refuse to proceed without a decision file.

So the gate is structural: the LLM cannot bypass it by simply not calling the CLI, because the next step requires the file to exist.

## Files

- New: `src/services/code/job-shape-decision.ts` (196 LOC)
- New: `tests/unit/code/job-shape-decision.test.ts` (15 tests)
- New: `tests/integration/code-detect-job-command.test.ts` (6 tests)
- New: `tests/unit/code/code-step-08-block-guard.test.ts` (4 tests, locks the BLOCKING-on-LLM-judgement substring + runbook ordering)
- Modified: `src/cli/commands/code-commands.ts` (added detect-job + read-job-shape subcommands, ~217 LOC)
- Modified: `skills/peaks-code/SKILL.md` (Step 0.8 marked BLOCKING on LLM judgement)
- Modified: `skills/peaks-code/references/runbook.md` (runbook now detects via LLM verdict, calls detect-job BEFORE job init)
- Bumped: `package.json` 3.1.0 → 3.1.1; `src/shared/version.ts` regenerated

## Results

- 19 ACs, 19 tests, 85 pass / 0 fail across 6 test files.
- `pnpm run build` clean. `pnpm run lint:silent-warning` clean (449 files).
- QA verdict: PASS (18/18 checklist, no blocking defects).
- Karpathy self-check: §1/§2/§3/§4 all YES.

## Red-line #10 added

"Job-trigger-miss" — LLM MUST NOT skip `peaks code detect-job` even when the trigger is obvious from context. If `read-job-shape` throws `JOB_SHAPE_NOT_DECIDED`, Code MUST record a decision before proceeding. Cross-ref: [[peaks-loop-job-introduction]] for the original 9 red lines.

## Lesson for future Step gates

Any Step that has a structured CLI surface (here: `peaks job *`) but no BLOCKING prose marker + no gate enforcement + no test is **not a real gate**, even if SKILL.md names it. Treat every Step that has a CLI surface with the same rigor as Step 0 (workspace init) and Step 0.7 (resume detect) — entry-time gates need to be enforced, not just described.

Conversely: when designing a gate, decide whether the judgement belongs in the LLM (semantic, low-maintenance) or in the CLI (deterministic, high-maintenance). For "is this prompt Job-shaped?", LLM wins. For "did the LLM make a decision?" or "is the decision file well-formed?", CLI wins.