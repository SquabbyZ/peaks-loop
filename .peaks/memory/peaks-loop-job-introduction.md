---
name: peaks-loop-job-introduction
description: peaks-loop Job v1.0 — outer-wrapper construct for long multi-slice work; how to use, hard rules, when to invoke
metadata:
  type: project
  createdAt: 2026-07-03
  affects: peaks-code Step 0.8+, peaks CLI (peaks job *), .peaks/_runtime/<sid>/job/<jid>/
---

# peaks-loop Job v1.0 — Introduction (2026-07-03 ship state)

## What it solves

LLM-runners processing long multi-slice work (e.g. add UT for every `app/` subdirectory) used to stop after the first slice with "this can't fit a single session" or "this is too expensive" rationalizations, even when the user explicitly disavowed cost.

Root cause: the runbook modeled one rid = one workflow. There was no outer loop. Auto-compact (v2.13.0) keeps a single rid alive across context overflow but does not chain rids.

Solution: a `Job` construct as a first-class CLI surface (`peaks job *`) plus a runbook-level outer loop (Step 0.8/0.81/0.85/0.86/0.87). Foreground-only, real-time visible (3-layer visibility).

## When to use

Trigger conditions (Step 0.8 detection):
- User request names multiple parallel targets (subdirectories, submodules, files).
- User says "全部完成" / "until all done" / "all of them" / similar.
- User disavows cost: "不用 care 费用" / "don't worry about cost" / "一直跑".

The detection is heuristic, not semantic. Edge cases can be overridden via explicit `--main-loop-strategy` and `--exit-policy` on `peaks job init`.

## Hard rules (9 red lines)

The LLM-runner MUST NOT (per spec §6.3):
1. Enter Step 11 / final handoff while job has remaining slices.
2. Re-ask about cost / length / context.
3. Coalesce multiple slices into one rid.
4. Modify a committed slice (`git commit --amend` on `done`).
5. Fake completion (commit-sha is verified).
6. Use detached / background / daemon sub-agents.
7. Skip `peaks job subagent-cleanup` between dispatch and slice checkpoint.
8. Skip or postpone a scheduled `peaks session rotate`.
9. Suppress visibility (statusline / `--watch` are always on).

Violations emit a `peaks job block` event with the red-line number.

## Main-loop strategies

- `single` — one main LLM session drives the entire job. Default for ≤2 slices. Context grows monotonically; auto-compact fires passively.
- `rotating` — every `rotateEvery` slices (default 3), the main LLM session resets via `peaks session rotate` and resumes via `peaks session resume`. **Hard default for ≥3 slices.** This is the answer to "compact didn't help, LLM returns HTTP 400 valid params" — periodic rotation resets the kernel-level state cleanly.

LLM-initiated override `rotating` → `single` requires:
- A reason ≥10 characters.
- Predicted wall-time ≤30 minutes.
- A `mainLoopOverride` audit field in state.json.

## Sub-agent resource safety

Every `peaks sub-agent dispatch` inside a Job scope MUST declare `--budget-mb` (default 512) AND fire `peaks job subagent-cleanup --force` BEFORE the next slice checkpoint. The wrapper refuses to mark a slice done until cleanup is clean. This is a hard policy (red line #7).

## Visibility layers

1. **LLM-runner transcript** — primary; the user reads the chat.
2. **`peaks job status --watch`** — terminal poll, ANSI bar, refresh 3s.
3. **Statusline** — ambient `job: <jid> [done/total] currentSlice ETA m:s context main%. cycle`. (Currently emits to stderr via `emitJobEvent` stub; real statusline wire-up pending in a follow-up slice.)

All three are on by default. Suppression is a red-line violation.

## Known limitations (v1.0)

- `peaks session cycle-summary` and `peaks session rotate` subcommands referenced in the spec are NOT shipped in v1.0; rotation uses constructor-injected stub callbacks. Real wire-up is M6.5 follow-up.
- `emitStatuslineEvent` does not exist in the codebase; the Job event emitter logs to stderr. Real statusline event bus pending.
- `tryAcquireLock` is racy (existsSync + writeFileSync); single-process only.

## Files of interest

- Spec: `docs/superpowers/specs/2026-07-03-peaks-loop-job-design.md` (v3).
- Plans: `docs/superpowers/plans/2026-07-03-peaks-job/`.
- CLI: `src/cli/commands/job-commands.ts`.
- State machine: `src/services/job/{job-types,job-state-store,job-orchestrator,job-rotation}.ts`.
- Wrapper: `src/services/job/subagent-job-wrapper.ts`.
- Snapshot: `src/services/job/job-resource-snapshot.ts`.
- Event emit: `src/services/job/job-event-emitter.ts`.
- Skill: `skills/peaks-code/SKILL.md` (Steps 0.8 / 0.81 / 0.85 / 0.86 / 0.87).

## Related

- [[peaks-loop-24h-ai-programmer-positioning]] — core 24h AI programmer positioning this satisfies.
- [[2026-06-28-full-auto-boundary]] — full-auto = commit-end, Job is full-auto by construction.
- [[2026-06-27-auto-compact-design]] — auto-compact is the *passive* rescue inside `single` mode; rotating mode is the *active* answer.
