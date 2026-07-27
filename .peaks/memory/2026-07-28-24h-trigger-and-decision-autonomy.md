---
name: 24h-trigger-and-decision-autonomy-2026-07-28
description: 24h 长任务的触发条件 + 决策自主权边界 — 解决 audit 报告漏掉的"决策面"缺口；user 2026-07-28 显式提出本议题
metadata:
  type: project
  createdAt: 2026-07-28
---

# 24h 长任务触发条件 + 决策自主权边界

> **状态**：报告-only sediment，未实施，未派 sub-agent。
> **触发**：user 2026-07-28 提出"什么算 24h 长任务 / 长任务决策不需人参与"——这是 audit 报告（[[24h-loop-audit-2026-07-28]]）的**决策面缺口**。
> **scope**：本文件只补"决策面"——不动执行面代码。

## Why

audit 报告（[[24h-loop-audit-2026-07-28]]）从执行面识别了 7 个优化方向（A-G），但**没有**回答两个根本问题：

1. **触发条件**：什么算"24h 不考虑成本"的长任务？触发后整个系统行为怎么切换？什么时候退出？
2. **决策自主权**：24h 模式下哪些决策 LLM 自主做、哪些必须叫人？边界在哪？

24h 定位（[[peaks-cli-24h-ai-programmer-positioning]]）的核心是"人歇 AI 不歇" + "user 角色 = 业务/产品审阅者，不参与技术决策"——但**没有**形式化"什么算 24h"和"什么决策自动做"。后果：

- **现状 1**：现有 `auto-compact-orchestrator` / `main-session-monitor` 的阈值（0.85 / 0.95）是**通用**的，不是"24h 模式专用"。audit 报告 C 方向（24h 模式 0.70/0.85 partial）就是因为**没有 24h 模式开关**才要新加。
- **现状 2**：`peaks job` / `peaks job progress` 是"多 slice job"概念，跟"24h 长任务"不是一回事——24h 长任务可能是 1 个大 slice 跑 24h，也可能是 100 个小 slice 跑 24h。
- **现状 3**：Human-NL-Choice-Only（[[human-nl-choice-only-tenet]]）规定"user 不参与技术决策"——但**技术决策的边界**没列。code-review 通过 / auto-compact 触发 / 失败重试 几次 / sub-agent 派发 wave 切分——这些算"技术决策"还是"基础设施轮转"？

## How to apply

### 1. 24h 长任务触发条件（5 选 1，OR 关系）

| 触发 | 检测信号 | 进入 24h 模式 | 退出 24h 模式 |
|---|---|---|---|
| **T1 — 显式声明** | `peaks run --long-run` 或 SKILL.md / natural-language 显式说"跑 24h" | 立即进入 | 用户说停 / 任务 completed |
| **T2 — 任务规模阈值** | `peaks job init --slice-list` 的 slice 数 ≥ 30 **OR** estimated wall-clock ≥ 6h | 自动进入（不打断） | slices 全部 done |
| **T3 — 跑飞恢复** | monotonic-guard 触发 3+ 次 + 仍有 ≥10 未跑 slice | 自动进入（恢复模式） | 跑飞收敛 / 显式 abort |
| **T4 — 离线用户** | `peaks session resume` 检测到上次 session 距今 ≥ 4h + 仍有 uncommitted cycle / un-handled dispatch | 自动进入（resume 模式） | 用户重连 / 任务完成 |
| **T5 — 多业务并行** | 同时活跃 slice ≥ 3 个 + 跨度 ≥ 2 个 service 域 | 自动进入 | 活跃 slice 收敛到 1 |

> **设计原则**（Karpathy §2 Simplicity First）：触发是 **OR 关系自动启停**——任何一个触发自动进入 24h 模式；所有条件都不再满足时自动退出。**不要**反过来要求 user 显式说"退出 24h"。

### 2. 24h 模式下 LLM 自主决策清单（3 个 bucket）

| Bucket | 决策类型 | 是否需要 user | 失败兜底 |
|---|---|---|---|
| **B1 — 基础设施轮转** | auto-compact 触发（≥0.85 pre-compact / ≥0.95 red-line）/ monotonic-guard 触发 abort / heartbeat stale 重启 / dispatch record 持久化 / context-spillover / DAG wave 切分 / 失败重试（≤3 次） | **不需要**（user 离线时也得做） | 失败 → 进 B3 升级 |
| **B2 — 工程层选择** | sub-agent 派发策略（fan-out vs 退化串行）/ 选哪个 code-review 维度 / 选哪个 vitest file 跑 / chunk 切分大小 / mock vs real / 重试 backoff 间隔 | **不需要**（按 sediment + karpathy 规则自主决） | 失败 → 进 B3 升级 |
| **B3 — 必须 user 决策** | 任务方向变更（PRD 修订）/ 阻塞 ≥3 个连续 slice 的根因 / registry-affecting 失败（npm publish fail / 写错 dist-tag）/ 任何"破坏性 + 不可回滚"操作 / 任何 B1/B2 失败 ≥3 次仍不收敛 | **必须 AskUserQuestion** | user 决策后按新指令走 |

### 3. 决策自主权形式化（机器可检）

```yaml
24h_mode:
  trigger: T1 | T2 | T3 | T4 | T5  # any-of
  active: bool
  decisions:
    bucket_B1_infra:  # 不问 user
      - auto_compact
      - monotonic_abort
      - heartbeat_restart
      - dispatch_persistence
      - context_spillover
      - dag_wave_split
      - bounded_retry_max_3
    bucket_B2_engineering:  # 不问 user
      - sub_agent_strategy
      - code_review_lens
      - vitest_subset
      - chunk_size
      - mock_vs_real
      - backoff_interval
    bucket_B3_user_required:  # 必须 AskUserQuestion
      - prd_direction_change
      - blocker_3_consecutive_slices
      - registry_affecting_failure
      - destructive_irreversible_op
      - any_B1_B2_failure_3x_non_converging
  exit: all_conditions_clear | user_explicit_stop
```

### 4. 与现有 4 个 sediment 的一致性

- **[[human-nl-choice-only-tenet]]**：本文件是它的**实例化**——把"user 不参与技术决策"展开成 B1 + B2 = 不参与；B3 = 参与（业务/产品决策）。**不冲突**。
- **[[peaks-cli-24h-ai-programmer-positioning]]** C3：24h AI 程序员场景 + 多业务并行，**人歇 AI 不歇**——本文件的 5 个触发条件 + B1 自主清单是 C3 的**形式化**。
- **[[24h-loop-audit-2026-07-28]]**：本文件补 audit 报告漏的"决策面"；audit 报告的 A-G 是**执行面**优化。两者**互补**。
- **[[peaks-code-to-peaks-code-rename-session-directive]]** 第 2 条"不计成本 + 不计时间"是 24h 模式的**用户授权**——本文件是它的**自动启用条件**。

### 5. 实施边界（不写代码，只沉淀）

- 本文件**不**给出实现——避免被当成 PR 派发输入。
- 若 user 决定落地，**下一刀**应该是：把本文件的 `24h_mode` block 翻译成 `peaks session 24h-mode --enable | --disable | --status` CLI 子命令 + `.peaks/_runtime/<sid>/24h-mode.json` 持久化文件 + 3 个 bucket 的 guard hook。
- 涉及代码面（**仅当 user 显式派发**）：`src/services/session/24h-mode-store.ts`（新）+ `src/services/session/24h-mode-decider.ts`（新）+ `src/cli/code-commands.ts` 加 1 个 sub-command + 3 个 vitest 文件。
- **预估改动面**：~200 行新代码 + 3 vitest 文件 + 1 决策文档。

## 关联

- [[peaks-cli-24h-ai-programmer-positioning]] — 24h 定位 6 硬约束（C3 = "人歇 AI 不歇"）
- [[peaks-loop-positioning-loop-engineering]] — 4-layer asset model（24h mode 是 Bee Asset 的 mode parameter，不是新 asset）
- [[human-nl-choice-only-tenet]] — 项目元规则（本文件是它的实例化）
- [[peaks-code-to-peaks-code-rename-session-directive]] — "不计成本 / 不计时间"是本文件的前提
- [[24h-loop-audit-2026-07-28]] — 本文件补 audit 漏的"决策面"（A-G 是执行面）
- [[peaks-code-concurrent-subagent-coordination]] — 24h 多 sub-agent 并发冲突（T3 / T5 触发的依据）
- [[auto-compact-threshold-policy]] — B1.bucket `auto_compact` 的现有阈值
- [[peaks-code-orchestrator-prompt-fact-freshness]] — 派 sub-agent 前必跑 verify（B2.bucket `sub_agent_strategy` 落地要求）
