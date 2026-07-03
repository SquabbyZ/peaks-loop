---
name: 2026-07-03-v3-1-0-job-trigger-miss
description: v3.1.0 first-ship incident — peaks-solo missed Job-loop trigger on real project despite matching keywords; Step 0.8 was prose-only with no detector and no BLOCKING gate
metadata:
  type: project
  createdAt: 2026-07-03
  affects: peaks-solo Step 0.8, skills/peaks-solo/SKILL.md, runbook, tests/unit/solo/, src/cli/commands/
---

# v3.1.0 — Job-Loop Trigger Miss (real-project incident, 2026-07-03)

## What happened

User invoked `/peaks-solo` on a real project with prompt:

> 把项目下的 app 目录下以目录为维度进行 slice 补充单元测试，补充完验证没有问题后 commit 改动，继续执行下个 slice，直到全部添加完，不用考虑费用，等全部添加好再通知我

This prompt hits **both** Step 0.8 trigger conditions verbatim:

1. "继续执行下个 slice，直到全部添加完" → matches `"全部完成"` / `"until all done"` family
2. "不用考虑费用" → matches disavow-cost branch

But `peaks-solo` did NOT enter Job mode. It ran 5 slices serially as a single rid, then hit StrategicCompact at context 162k/200k (81%) and STOPPED with a final-handoff message — even though 30 of 35 slices remained.

## Root cause

`skills/peaks-solo/SKILL.md` line 100-104 declares Step 0.8 as a *prose* instruction:

```
### Peaks-Loop Step 0.8 — Job 启动
Trigger: user mentions N parallel targets, "全部完成"/"until all done", or disavows cost.
Action: parse slice list → choose strategy (≤2 single / ≥3 rotating) → `peaks job init ...` → Step 1.
```

Missing pieces that made it fail in practice:

1. **No BLOCKING / MANDATORY marker.** Compare to Step 0 / Step 0.75 / Step 0.7 / Step 11 — those all carry "BLOCKING" wording. Step 0.8 does not. An LLM-runner skimming the file treats it as advisory.
2. **No detector function or deterministic regex.** "Trigger" is described in prose, but no canonical keyword list / `peaks solo detect-job --prompt <text>` helper exists. The trigger interpretation is left to LLM judgement.
3. **No unit test enforcing the trigger fires.** `tests/unit/solo/` has no `job-trigger-mandatory.test.ts`. Compare to `mode-gate-step-1-hard-pause.test.ts` and `skills-solo-fanout-mandatory.test.ts` — both gates have tests; Step 0.8 does not.
4. **Runbook deferment.** `references/runbook.md` line ~195 says "After Step 7 lands AND the user request was Job-shaped (Step 0.8 triggered):" — this puts the Job-path as a *post-hoc* reflection ("did we trigger Step 0.8?") instead of a *precondition* gate before Step 1.

## Consequences

- Solo wrote a final-handoff message **while 30/35 slices remained** — violates `peaks-loop-job-introduction.md` red-line #1 ("Enter Step 11 / write final handoff while job has remaining slices").
- Solo stopped at 81% context and asked the user to restart in a new session — violates red-line #2 ("Re-ask the user about cost / length / context").
- No `job/<jid>/state.json` was ever created. The orchestrator state is empty; if the user re-invokes `/peaks-solo` today, the LLM-runner sees zero Job residue and may re-do work or skip the remaining 30 slices.
- 5 slice commits are real and on `feature/v1.12.0/performence` — that part is fine; the regression is purely in the loop engineering.

## Proposed v3.1.1 patch (not yet shipped)

Goal: turn Step 0.8 from prose-only into a BLOCKING gate with a deterministic detector.

1. **SKILL.md** Step 0.8 prefix: "MANDATORY (BLOCKING on trigger match)" + canonical regex `/(直到|全部|until all done|don't worry|care (about )?(cost|费用|费用))/i` + escape hatches.
2. **Detector CLI**: `peaks solo detect-job --prompt "<text>" --json` returning `{ isJob: true, triggerReason: "until-all-done" }`. Solo MUST call this in Step 0.8 and act on `isJob=true`.
3. **Runbook** reorder: BEFORE Step 1, the "Job-shaped?" decision becomes Step 0.81-pre, not a post-Step-7 footnote.
4. **Test**: `tests/unit/solo/job-trigger-mandatory.test.ts` asserting SKILL.md Step 0.8 contains both "BLOCKING" and the detector regex, AND the runbook pre-Step-1 ordering, AND a CLI integration test for `peaks solo detect-job`.
5. **Memory hook**: this incident is itself the canonical "why" for the patch.

## Lesson

A peaks-loop Step that has a structured CLI surface (`peaks job *`) but no BLOCKING prose marker + no detector + no test is **not a real gate**, even if SKILL.md names it. Treat Step 0.8 (Job start) with the same rigor as Step 0 (workspace init) and Step 0.7 (resume detect) — they are all entry-time gates.

Cross-refs: [[peaks-loop-job-introduction]] (ship state), [[2026-07-03-v3-1-0-release-readiness]] (the v3.1.0 ship that exposed this).