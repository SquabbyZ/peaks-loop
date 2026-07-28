---
name: rid-024-code-commands-split-shipped-2026-07-28
title: rid-024 code-commands.ts split shipped (pending commit)
kind: project
description: rid-024 refactor slice ship — split `src/cli/commands/code-commands.ts` (1058 lines) into 4 files by service-layer dependency, closing the 800-line module cap acceptable-deviation documented in rid-020b
metadata:
  type: project
  createdAt: 2026-07-28
  rid: 2026-07-28-rid-024-code-commands-split
  shipCommit: <pending user authorization>
  companion: .claude/plans/giggly-drifting-pizza.md
  priorShip: .peaks/memory/2026-07-28-rid-020b-shipped.md (acceptable-deviation documented)
---

# rid-024 code-commands.ts split — shipped

> **Status**: implementation + QA verify PASS, pending user authorize commit (peaks-loop red rule).
> **Trigger**: user 2026-07-28 显式要求 "处理 'code-commands.ts 1058 lines 800-line cap 修复'"; also closes the acceptable-deviation documented in `2026-07-28-rid-020b-shipped.md`.
> **scope**: refactor — 1 trim (code-commands.ts 1058 → 165 lines) + 3 NEW sibling files by service-layer dependency. Total LOC roughly preserved (1058 → 1148, +90 for new file headers + imports + register-function wrappers).

## Why

`src/cli/commands/code-commands.ts` was 1058 lines (post-rid-020b's +4 lines), exceeding the peaks-loop 800-line module cap enforced by `peaks request transition` (`FILE_SIZE_VIOLATION`). rid-020b's transition required `--allow-incomplete --reason` bypass to land — this slice closes that bypass.

**Approach (Option A in the plan)**: extract 7 of 9 sub-commands into 3 NEW sibling files mirroring the service layer each sub-command wraps. Public API (`CodeStep` / `CodePlan` / `CodeHooks` / `CodeRunResult` / `buildCodePlan` / `runCodeFast` / `registerCodeCommands`) stays in code-commands.ts — no test edits required.

## How to apply

### 4-file diff scope

| # | File | Action | LOC | Owns |
|---|---|---|---|---|
| 1 | `src/cli/commands/code-commands.ts` | EDIT (trim) | **165** (≤ 800 ✓) | Public types + `STEP_ORDER`/`STEP_KIND` + `buildCodePlan` + `runCodeFast` + thin `registerCodeCommands` orchestrator (delegates to 3 NEW siblings + rid-020b `code-run-command`) |
| 2 | `src/cli/commands/code-mode-gate-commands.ts` | NEW | **275** (≤ 800 ✓) | `registerCodeModeGateCommands` — owns `plan` + `should-pause` (D5 mode-gate); imports `mode-gate.ts` |
| 3 | `src/cli/commands/code-job-shape-commands.ts` | NEW | **248** (≤ 800 ✓) | `registerCodeJobShapeCommands` — owns `detect-job` + `read-job-shape`; imports `job-shape-decision.ts` |
| 4 | `src/cli/commands/code-runtime-commands.ts` | NEW | **460** (≤ 800 ✓) | `registerCodeRuntimeCommands` — owns `post-compact-detect` + `auto-compact` + `context-now` + `gate-step-08` + `emit-handoff` + helper `readActiveSid` (moved from code-commands.ts); imports `post-compact-detector` / `auto-compact-orchestrator` / `step-08-gate` / `emit-handoff` |

### Trimmed registerCodeCommands (the new orchestrator)

```typescript
export function registerCodeCommands(program: Command, io: ProgramIO): void {
  const code = program
    .command('code', { hidden: true })
    .description('peaks-code LLM-side workflow planner (slice 2 fast mode)');

  registerCodeModeGateCommands(code, io);
  registerCodeJobShapeCommands(code, io);
  registerCodeRuntimeCommands(code, io);
  registerCodeRunCommand(code, io);   // rid-020b
}
```

### QA verify (PASS)

`peaks request transition --role qa --state verdict-issued` (qa state machine: `draft / running / verdict-issued / blocked`):

- AC-R1..R8: **ALL PASS**
- code-commands.ts: 165 lines (cap 800; 5x margin)
- 3 NEW files: 275 / 248 / 460 (all well under 800)
- typecheck: exit 0
- vitest: 8 files / 67 tests / green in 39.77s
- `peaks code --help` lists all 10 sub-commands (plan, should-pause, detect-job, read-job-shape, post-compact-detect, auto-compact, context-now, gate-step-08, emit-handoff, run)
- **AC-R7 (the acceptance moment)**: `peaks request transition --state implemented` succeeded **WITHOUT** `--allow-incomplete` — the FILE_SIZE_VIOLATION cap violation is gone
- precheck: overall=ok (rootVsShared / tagCollision / changesetStaged / workspaceLockstep all green)
- surgical scope: rid-020a source + session-command + code-run-command + dashboard-* + 24h-mode source **byte-identical** to commit `cd127d02`; `_register.ts` unchanged; no test edits; no package.json / tsconfig.json / pnpm-lock.yaml changes

### Minor findings (none)

No new minor findings. The pre-existing `<sid>` matches (10 in total: 4 in code-job-shape-commands.ts + 6 in code-runtime-commands.ts) are verbatim copies of CLI option help strings (`.option('--session-id <sid>' ...)`) carried over from HEAD `cd127d02` via the surgical extract. Per Karpathy §3 (Surgical Changes), these were NOT edited. Same shape as prior rid-020a / rid-020b QA verifies.

## Caveats the user should know

- **Commit NOT performed by sub-agent** — peaks-code red rule: orchestrator owns commit; user must authorize. Commit message MUST NOT contain `Co-Authored-By: Claude/Anthropic` trailer; the only valid trailer is the meta `Co-author: SquabbyZ sole author`.
- **No test edits** — public API contract preserved verbatim: `code-commands.test.ts` still imports `buildCodePlan` + `runCodeFast` + `CodePlan` + `CodeRunResult` from `code-commands.js`; `openspec-decoupled.test.ts` still finds `registerCodeCommands` exported from `code-commands.ts` and verifies zero `openspec` references in the trimmed body.
- **`_register.ts` unchanged** — `registerCodeCommands` continues to be the single import target; the 3 NEW sibling files are reached through it.
- **Total LOC went up by 90** (1058 → 1148) due to 4 register-function wrappers + per-file imports + JSDoc. This is acceptable per Karpathy §2 Simplicity First — the alternative (one mega-file) is what we just removed.

## 关联

- `.claude/plans/giggly-drifting-pizza.md` — full rid-024 plan (Option A: 3 NEW sibling files by service dependency)
- `.peaks/memory/2026-07-28-rid-020b-shipped.md` — prior ship; the acceptable-deviation this slice closes
- `.peaks/memory/peaks-code-orchestrator-prompt-fact-freshness.md` — sub-agent prompt freshness rules (applied)
- `.peaks/memory/peaks-code-concurrent-subagent-coordination.md` — pre-write git status check rule (verified clean before dispatch)
- `.peaks/_runtime/2026-07-28-session-22381b/rd/requests/002-2026-07-28-rid-024-code-commands-split.md` — RD handoff (state=implemented)
- `.peaks/_runtime/2026-07-28-session-22381b/qa/requests/002-2026-07-28-rid-024-code-commands-split-verify.md` — QA verify (PASS)
- commit `<pending user authorization>` — ship commit (SquabbyZ sole-author, no AI co-author trailer)