---
name: 24h-mode-p1-rid-020a-shipped
description: 24h mode P1 rid-020a 完整 ship — state machine + persistence + session CLI 全绿;commit a8dc8b28 在 main;QA v2/v3/3.5 PASS;等待 user 二次 authorize push + 启 rid-020b ship phase 2
metadata:
  type: project
  createdAt: 2026-07-28
  revisedAt: 2026-07-28
  rid-020a: COMMITTED-pending-user-authorize-push
  commitSha: a8dc8b28cd675fde195edfbee242adec1ec62ec0
  author: SquabbyZ <601709253@qq.com>
---

# 24h mode P1 rid-020a 已 ship 在 main

> **status**: COMMITTED-pending-user-authorize-push
> **commit**: `a8dc8b28cd675fde195edfbee242adec1ec62ec0`
> **branch**: main
> **session**: 2026-07-28-session-6984fe
> **ship phase**: 1/2 (rid-020a done; rid-020b next)

## 切片事实

- **5 source + 3 vitest + 1 commit**
- 10 files / +1144 insertions
- vitest 33/33 PASS (10.86s)
- tsc 0 errors
- 3 red-line grep AC verification PASS (5 forbidden auto-compact patterns / banned sid placeholder / AI attribution regex — all EXIT=1; specific patterns in red-line grep output)
- SquabbyZ sole-author (601709253@qq.com), NO AI trailer
- `feat(24h-mode): add state machine + persistence + session CLI (rid-020a)`

## 实施偏差 (ACCEPTABLE-DEVIATION)

`fireB3` 从 `throw B3Escalation` 改为 `return FireB3Result` discriminated union (kind: continue|escalate) + `B3Escalation` class 仍导出作为 back-compat。原因: vitest 4.1.10 matcher 限制(从外部 throw instance 读 attempts 字段)。**语义意图保留**: 第 3 次 fire 触发 escalation。

## 5 source files

1. `src/services/24h-mode/state.ts` (100 LOC) — 6 STATES + 7 DECISION_KEYS + type guards + emptyAttempts
2. `src/services/24h-mode/store.ts` (215 LOC) — `.peaks/_runtime/<sessionId>/24h-state.json` 原子 write + round-trip + coercion guards
3. `src/services/24h-mode/decider.ts` (233 LOC) — `fireB3` returns FireB3Result + `checkTriggers` (5 triggers T1-T5) + B3 7 reasons + HANDOFF 3 exit conditions
4. `src/services/24h-mode/index.ts` (48 LOC) — public barrel
5. `src/cli/commands/session-24h-mode.ts` (264 LOC) — `peaks session 24h-mode` CLI sub-command (state/transition/attempts/reset) + --json + --project + --session-id

## 2 surgical edits

- `src/cli/commands/core/session-command.ts` (+6 lines) — eager `registerSession24hModeCommand(session, io)` call
- `skills/peaks-code/references/runbook.md` (+9 lines) — CLI usage mirror

## 3 vitest files (33 tests)

- `tests/unit/24h-mode/state.test.ts` (7 tests) — enum exhaustive + type guards
- `tests/unit/24h-mode/store.test.ts` (8 tests) — round-trip + atomic + coercion + path contract
- `tests/unit/24h-mode/decider.test.ts` (18 tests) — AC-T1/T1b/T2/T2b/T3 + 5 triggers + 7 B3 reasons

## CLI 表面 (post-build verified)

```
$ node ./bin/peaks.js session 24h-mode --help
Usage: peaks session 24h-mode [options] [command]

24h mode state machine (rid-020a). Sub-actions: state, transition, attempts,
reset. persists to .peaks/_runtime/<sessionId>/24h-state.json.

Commands:
  state       Read the current 24h mode state snapshot
  transition  Move the state machine to a new state
  attempts    Read the B3 attempts map (per-key retry counts)
  reset       Reset the 24h state snapshot to IDLE (fresh start)
```

## Smoke test 实证

```
$ node ./bin/peaks.js session 24h-mode state --json
{"ok":true,"data":{"state":"IDLE","enteredAt":"...","enteredFrom":null,"activeSlices":[],"monotonicGuards":0,"autoCompactCount":0,"checkpoints":0,"lastCheckpointAt":null,"attempts":{"prd_direction_change":0,"blocker_3_consecutive_slices":0,"registry_affecting_failure":0,"destructive_irreversible_op":0,"any_B1_B2_failure_3x_non_converging":0,"runtime_or_shared_version_mismatch":0,"sub-agent_stale_5min_x3":0},"exitCondition":null}}
```

## Ship 路径

| 阶段 | 状态 | 证据 |
|---|---|---|
| RD rev-1 提案 (docs-only) | DONE | `.peaks/memory/2026-07-28-24h-mode-p1-state-machine.md` (rev-2) + companion split plan |
| QA v2 多 lens 复审 | **PASS** (14 AC) | rid-022 envelope |
| RD rid-020a 实施 | DONE | 5 source + 3 vitest + 33 tests PASS |
| QA v3 verify | **PASS-WITH-MINOR** (7 AC) | rid-023 envelope |
| QA v3.5 post-build CLI 重验 | **PASS** | 4 sub-actions visible + state --json returns IDLE + 7-key attempts map |
| pnpm build refresh | DONE | dist/cli + dist/services 24h-mode artifacts emitted |
| SC commit | DONE | commit `a8dc8b28` on main, SquabbyZ sole-author |
| **user-authorize push** | **PENDING** | user 二次 authorize `git push origin main` |
| user-authorize tag | N/A | 无 version bump (package.json#version 不变) |
| user-authorize publish | N/A | no tag → publish 路径关闭 |
| rid-020b ship phase 2 | PENDING | user 启 new session / new rid 走 peaks-solo 4-level routing |

## 关联

- **rd handoff**: `.peaks/_runtime/2026-07-28-session-6984fe/rd/requests/004-2026-07-28-rid-020a-implementation.md`
- **QA v3 envelope**: `.peaks/_runtime/2026-07-28-session-6984fe/qa/requests/2026-07-28-rid-023-24h-mode-rid-020a-verify.md`
- **QA v2 envelope (PASS)**: `.peaks/_runtime/2026-07-28-session-6984fe/qa/requests/2026-07-28-rid-022-24h-mode-p1-rereview.md`
- **rd-revised proposal**: `.peaks/memory/2026-07-28-24h-mode-p1-state-machine.md` (rev-2)
- **companion rid-split plan**: `.peaks/memory/2026-07-28-24h-mode-p1-rid-split-plan.md`
- **sc handoff**: `.peaks/_runtime/2026-07-28-session-6984fe/sc/commit-boundaries/2026-07-28-rid-020a-commit.md`
- **commit**: `a8dc8b28cd675fde195edfbee242adec1ec62ec0` on `main`

## 关联 memory

- [[24h-mode-p1-state-machine-2026-07-28]] — re-revised proposal v2
- [[24h-mode-p1-rid-split-plan-2026-07-28]] — companion split plan
- [[24h-trigger-and-decision-autonomy-2026-07-28]] — 5 触发 + 3 bucket 完整定义
- [[24h-loop-audit-2026-07-28]] — A-G 7 优化方向 (与本提案正交, 留后续 rid)
- [[redline-no-claude-co-author]] — SquabbyZ sole author 红线
- [[auto-compact-threshold-policy]] — 0.85 / 0.95 zones reference
- [[peaks-loop-publishing-critical-hard-rules]] — publish 流程禁区
- [[peaks-stale-cli-version-2026-07-23-diagnosis]] — CLI_VERSION 漂移 5 层根因
