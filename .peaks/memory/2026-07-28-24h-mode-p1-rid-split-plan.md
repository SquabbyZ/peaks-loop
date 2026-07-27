---
name: 24h-mode-p1-rid-split-plan-2026-07-28
description: rid-020a + rid-020b 双切片实施计划 — 配合 v2 re-revised proposal（2026-07-28）; rid-020a = state-only, rid-020b = code-run + SKILL.md + peaks-solo routing
metadata:
  type: project
  createdAt: 2026-07-28
  companion: .peaks/memory/2026-07-28-24h-mode-p1-state-machine.md (v2 re-revised)
---

# peaks-code 24h mode — rid-020a + rid-020b 双切片实施计划

> **状态**：实施计划 sediment（companion to v2 re-revised proposal），未派 sub-agent。
> **触发**：v2 proposal F4 + S5 修复要求拆分原 rid-020 为 rid-020a（state-only）+ rid-020b（code-run + integration + SKILL.md）。
> **scope**：rid-020a 5 source + 3 vitest; rid-020b 4 source + 2 vitest + 3 SKILL.md; 共 2 commits, 2 rids。

## Why

qa (qa/requests/2026-07-28-rid-020-24h-mode-p1-review.md F4) + self (qa/requests/self-review-2026-07-28-rid-020.md F4 qa-missed #1) 双 lens 都认定原 rid-020 不可执行：

1. `peaks code run` sub-command 不存在（src/cli/commands/code-commands.ts 仅注册 `code` / `plan`）
2. `code-commands.ts` 已经 1053 行（>800 行 module cap）
3. `peaks dashboard long-run --since 24h` 是新 CLI surface（self S1）— 不能留作 "orthogonal A-G"

**结论**：拆 rid-020a + rid-020b，commit boundary 1:1 同步。

## rid-020a — state machine + persistence + session CLI（state-only）

**rid**：`2026-07-28-rid-020a-24h-mode-state-machine`
**type**：feature
**预估 wall-clock**：~半日（4-6h）
**commit boundary**：1 commit

### 文件清单（5 source + 3 vitest）

| # | 文件 | 类型 | 行数估算 | 用途 |
|---|---|---|---|---|
| 1 | `src/services/session/24h-mode-store.ts` | new | ~80 | 持久化层（State enum + AttemptsMap + 24h-mode.json 读写） |
| 2 | `src/services/session/24h-mode-decider.ts` | new | ~120 | 5 触发判断 + B3 触发 7 条 + T3/T4 auto-24H_ACTIVE 路径 |
| 3 | `src/cli/session-24h-mode.ts` | new | ~60 | `peaks session 24h-mode --enable/--disable/--status/--json` CLI |
| 4 | `tests/unit/session/24h-mode-store.test.ts` | new | ~150 | 持久化 case（enable / disable / status / 跨 session / 边界） |
| 5 | `tests/unit/session/24h-mode-decider.test.ts` | new | ~250 | 5 触发 + 7 B3 reasons + 3-gate BRAINSTORM stop + B1xB3 3 组合（AC-T1/AC-T2/AC-T3） |
| 6 | `tests/unit/cli/session-24h-mode.test.ts` | new | ~150 | CLI 4 flag + json mode |

**总**：5 source + 3 vitest = 8 文件；~810 行新代码；3 vitest 文件全绿。

### Acceptance Criteria（5-7 条）

- **AC-A1**: 24h-mode-store 持久化跨 session 可读（24h-mode.json 在 `.peaks/_runtime/<sessionId>/`；跨 session case 在 vitest 验证）
- **AC-A2**: 24h-mode-decider 5 触发条件（T1/T2/T3/T4/T5）全部 unit-test 通过
- **AC-A3**: 3-gate BRAINSTORM stop condition — intent/outOfScope/risks/acDraft 字段全部必填，缺任一 gate 阻止 exit BRAINSTORM 状态
- **AC-A4**: T3/T4 auto-24H_ACTIVE 路径（不强制 USER_CONFIRM，emit 单向 status-line 通知）
- **AC-A5**: B3 触发完整 7 条（含 `runtime_or_shared_version_mismatch` + `sub-agent_stale_5min_x3`）全部 unit-test 通过
- **AC-A6**: B1xB3 组合 3 case 全部 unit-test 通过（AC-T1: attempts[decisionKey]=1 continue / AC-T2: attempts[decisionKey]=3 throw B3Escalation / AC-T3: per-key independence）
- **AC-A7**: `peaks session 24h-mode --enable/--disable/--status/--json` 4 个 flag 全部 CLI test 通过

### commit message

```
feat(24h-mode): add state machine + persistence + session CLI (rid-020a)

- src/services/session/24h-mode-store.ts: persist 6-state machine + AttemptsMap
- src/services/session/24h-mode-decider.ts: 5 trigger conditions + 7 B3 reasons
- src/cli/session-24h-mode.ts: peaks session 24h-mode sub-command
- 3 vitest files: 24h-mode-store / 24h-mode-decider / session-24h-mode
- T3/T4 auto-24H_ACTIVE path; BRAINSTORM = reference-only bridge with 3-gate stop

Co-author: SquabbyZ sole author (peaks-loop red rule)
```

### 转 rid-020b 前置检查（rid-020a ship gate）

- [ ] 8 文件全部存在 + 编译通过 + lint 0 错
- [ ] 3 vitest 全绿（passed/total/skipped 数记录）
- [ ] `peaks standards init --project . --dry-run` 通过
- [ ] 无 typecheck / lint 错误
- [ ] `peaks audit red-lines` 退出 0
- [ ] `peaks skill lint --category loop-engineering-readiness` 退出 0
- [ ] 任何 24h 相关 source / vitest 文件都不出现 banned 字串（5 forbidden auto-compact + legacy 阈值 tier 描述；运行时路径占位符一律 `<sessionId>`）
- [ ] 1 commit + SquabbyZ sole author（peaks-loop red rule）

## rid-020b — code-run sub-command + integration + SKILL.md + peaks-solo routing

**rid**：`2026-07-28-rid-020b-24h-mode-integration`
**type**：feature
**预估 wall-clock**：~半日（4-6h）
**commit boundary**：1 commit

### 文件清单（4 source + 2 vitest + 3 SKILL.md）

| # | 文件 | 类型 | 行数估算 | 用途 |
|---|---|---|---|---|
| 1 | `src/cli/commands/code-run-command.ts` | new | ~120 | `peaks code run --24h` sub-command（F4 修复路径：独立文件, 不直接编辑 code-commands.ts） |
| 2 | `src/cli/commands/code-commands.ts` | edit (+2 lines) | +2 | line 182 区域加 `registerCodeRunCommand(code, io)` + 1 行 import |
| 3 | `src/cli/commands/dashboard-long-run.ts` | new | ~80 | `peaks dashboard long-run --since 24h` sub-command（S1 修复） |
| 4 | (register `dashboard long-run` 在 peaks CLI 根) | edit | ~5 | CLI root 注册调用 |
| 5 | `tests/unit/cli/code-run-24h-flag.test.ts` | new | ~120 | flag 接受/拒绝 + 走脑暴/跳过脑暴（T3/T4 路径） |
| 6 | `tests/unit/cli/dashboard-long-run.test.ts` | new | ~100 | since 解析 + 指标读取 + 边界 case |
| 7 | `skills/peaks-code/SKILL.md` | edit (+90 lines) | +90 | line 43 `## Code-Change Red Line` 之后插入 `## 24h mode` 章节（F5 修复插入坐标） |
| 8 | `skills/peaks-code/references/runbook.md` | edit | ~30 | mirror 新 CLI 用法（`peaks session 24h-mode --enable/--disable/--status` + `peaks code run --24h` + `peaks dashboard long-run --since 24h`） |
| 9 | `skills/peaks-solo/SKILL.md` | edit | ~30 | 加 4-level precedence 表 + 24h keyword 子章节 + 3 special case |
| 10 | `skills/peaks-solo/references/triage-decision-table.md` | edit | ~15 | 24h keyword row + code-domain-evidence 列 + 3 special-case 行 |

**总**：4 source（含 2 edit + 2 new）+ 2 vitest + 3 SKILL.md edit = 9 文件；~592 行新代码（含 markdown）+ 2 vitest 全绿。

### Acceptance Criteria（5-7 条）

- **AC-B1**: `peaks code run --24h` flag 接受 + 触发脑暴 reference-only bridge + T3/T4 路径跳过脑暴直接 auto-24H_ACTIVE
- **AC-B2**: `peaks dashboard long-run --since 24h` 读取 24h-mode.json + 输出 5 类指标（dispatch 数 / auto-compact 数 / monotonic 触发数 / sub-agent 失败数 / checkpoint 频率）+ 边界 case
- **AC-B3**: peaks-code SKILL.md `## 24h mode` 章节插入位置正确（line 43 后, line 47 前）；章节文本通过 `peaks skill lint --category loop-engineering-readiness`
- **AC-B4**: `peaks audit red-lines` 退出 0（红线 grep 列表参考 `.peaks/memory/auto-compact-threshold-policy.md` §红线 / Anti-pattern）；5 forbidden auto-compact strings + legacy 阈值 tier grep `skills/peaks-code/SKILL.md` 返回 0 匹配
- **AC-B5**: peaks-solo SKILL.md 4-level precedence 表 + 24h keyword 子章节落地；3 special case 行（dispatcher+24h / content+24h / doctor+24h）完整
- **AC-B6**: peaks-solo/references/triage-decision-table.md 24h row + code-domain-evidence 列 + 3 special-case 行落地
- **AC-B7**: 全部 5 vitest 文件（rid-020a 3 + rid-020b 2）unit + integration 集成 run 全绿；`peaks release precheck --project . --json` 退出 0

### commit message

```
feat(24h-mode): add code-run sub-command + SKILL.md chapter + peaks-solo routing (rid-020b)

- src/cli/commands/code-run-command.ts: peaks code run --24h sub-command
- src/cli/commands/code-commands.ts: 1-line registerCodeRunCommand call
- src/cli/commands/dashboard-long-run.ts: peaks dashboard long-run --since 24h
- 2 vitest files: code-run-24h-flag / dashboard-long-run
- skills/peaks-code/SKILL.md: ## 24h mode chapter at line 43 (after Code-Change Red Line)
- skills/peaks-code/references/runbook.md: mirror new CLI usage
- skills/peaks-solo/SKILL.md: 4-level precedence + 24h keyword + 3 special case
- skills/peaks-solo/references/triage-decision-table.md: 24h row + code-domain column

Co-author: SquabbyZ sole author (peaks-loop red rule)
```

### rid-020b ship gate

- [ ] 9 文件全部存在 + 编译通过 + lint 0 错
- [ ] 5 vitest 全绿（rid-020a 3 + rid-020b 2；passed/total/skipped 数记录）
- [ ] `peaks standards init --project . --dry-run` 通过
- [ ] `peaks audit red-lines` 退出 0
- [ ] 5 forbidden auto-compact strings + legacy 阈值 tier grep `skills/peaks-code/SKILL.md` 返回 0 匹配
- [ ] `peaks skill lint --category loop-engineering-readiness` 退出 0
- [ ] `peaks release precheck --project . --json` 退出 0
- [ ] 1 commit + SquabbyZ sole author（peaks-loop red rule）
- [ ] **不** push / tag / publish（per peaks-loop red rule, 必须 user 显式 authorize）

## 总估算

- **2 commits, 2 rids**, all source code change is in rid-020b
- rid-020a = state-only（持久化 + 状态机 + 决策 + session CLI）
- rid-020b = integration surface（code-run sub-command + dashboard + SKILL.md 3 处 + peaks-solo routing）
- 墙钟合计 ~1 工作日（half-day × 2）
- vitest 总计 5 文件 / ~770 行 / ~35 test cases（rid-020a 3 + rid-020b 2）
- markdown 总计 5 文件（proposal + 提案 + rid-split + 后续 shipped sediment）/ ~80 KB

## 关联

- `.peaks/memory/2026-07-28-24h-mode-p1-state-machine.md` — v2 re-revised proposal（本计划来源）
- `.peaks/_runtime/2026-07-28-session-6984fe/qa/requests/2026-07-28-rid-020-24h-mode-p1-review.md` — qa 4 blocker（触发 F4 拆 rid）
- `.peaks/_runtime/2026-07-28-session-6984fe/qa/requests/self-review-2026-07-28-rid-020.md` — self review 5 finding（S1 触发 dashboard 进 rid-020b; S5 触发 commit boundary 拆分）
- [[24h-trigger-and-decision-autonomy-2026-07-28]] — 5 触发 + 3 bucket 原型（rid-020a §5 触发来源）
- [[24h-loop-audit-2026-07-28]] — A-G 7 优化方向（与本计划正交, 留后续 rid）
- [[auto-compact-threshold-policy]] — rid-020b §AC-B4 红线 grep 列表来源