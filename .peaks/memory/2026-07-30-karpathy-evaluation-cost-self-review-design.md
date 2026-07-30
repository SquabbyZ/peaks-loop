---
name: 2026-07-30-karpathy-evaluation-cost-self-review-design
title: Karpathy 评估成本自审设计（仅 sediment + 提案，未实施）
description: peaks-code 1-2 slice 后 LLM 自报"成本过高、明天继续"的根因分析与最小变更设计提案。
kind: project
---

# Karpathy 评估成本自审设计（2026-07-30 用户新方向）

> ⚠️ **本文件仅为设计与 sediment 提案，尚未实施任何代码。** 用户在 2026-07-30 决定调整方向时明确说"先讨论"，本文是讨论沉淀。

## 用户的精确痛点

`peaks-code` 项目引入了 karpathy 4 guidelines 纪律，让 LLM 不再无脑 50 分片自由发挥——**但对 dev 速度的副作用过大**：

- 原本可以在几小时内分片完成的任务
- 现在 LLM 完成 1-2 个分片就告知"今天成本差不多了，明天继续"
- 现象出现在 **单个 slice 按 RD/QA 开发验证完成后 → 准备进入下个 slice 之前的 gap 阶段**

## 根因分析（基于已读代码）

### Karpathy 注入的两条路径

1. **Sub-agent prompt 注入**（`skills/bee/peaks-rd/references/rd-sub-agent-dispatch.md`）：
   - 4 guidelines 全文注入到 RD / QA sub-agent 的 prompt
   - 影响范围：sub-agent 本身
2. **3-way fan-out 中的 karpathy-reviewer**（`agents/karpathy-reviewer.md`）：
   - 第 3 个 reviewer sub-agent，写 `rd/karpathy-review.md`
   - 作为 `KARPATHY_REVIEW` prereq 硬门，block `peaks request transition --state qa-handoff`
   - 影响范围：**slice 与 slice 之间的过渡**

### "评估本身也是成本"是当前盲点

按 4 guidelines 中"Think Before Coding"和"Goal-Driven Execution"的要求，**所有动作都有成本**——但 peaks-code 的成本信号**只跟踪 RD/QA 写代码的成本**，不跟踪：

- `karpathy-reviewer` 5-way / 3-way fan-out 的 sub-agent 调度成本（每次切 reviewer 都要 1-2 分钟）
- `peaks job checkpoint` 的状态机 transition 时间
- `peaks request transition` 的硬门校验时间

**结果**：用户感知到的"成本过高"实际上大半是**评估成本**（fan-out sub-agent 调度 + JSON envelope 校验），不是 RD 写代码成本。

## 最小变更设计（**未实施**）

### 1. Karpathy-reviewer 输出 schema 加 "evaluation-cost" 字段

`agents/karpathy-reviewer.md` 当前输出：
```json
{ "passed": bool, "violations": [...], "gateAction": "block" | "pass" }
```

提议扩展为：
```json
{
  "passed": bool,
  "violations": [...],
  "gateAction": "block" | "warn" | "pass",
  "evaluationCost": {
    "wallMs": number,
    "subAgentsDispatched": number,
    "tokensEstimated": number,
    "sliceCodeSize": number
  },
  "costRatio": number  // evaluationCost.wallMs / sliceCodeSize
}
```

**规则**：
- `costRatio > 10`（评估 10 倍慢于 RD 写代码）→ 自动降级 `gateAction` 从 `'block'` 到 `'warn'`
- LLM 主循环看到 `'warn'` 不被强制停下，可以继续下个 slice
- `costRatio > 50` → 报告到 `.peaks/memory/`，但 gateAction 仍是 `'warn'`

### 2. Main loop 引入 `peaks job karpathy-cost-check`

`peaks job checkpoint --state done` → 启动下片前：
- 读取当前 slice 的 `rd/karpathy-review.md`
- 如果 `costRatio > 10` 且 gateAction 已是 `'warn'`，跳过强制硬门
- LLM 在 main loop prompt 中收到"karpathy cost 过高、已自动降级、继续"消息

### 3. 保留 4 guidelines 纪律本身

- 纪律不削弱——`think-before-coding` / `simplicity-first` / `surgical-changes` / `goal-driven-execution` 全文保留
- 只是把"评估本身"也视为成本对象
- 用户硬规则 4 guidelines 注入一字不删

## 与现有约束的兼容性

- ✅ 4 guidelines 注入保留（不变）
- ✅ karpathy-reviewer 仍是 3-way fan-out 的硬门（仅在 costRatio ≤ 10 时硬门有效）
- ✅ 24h-mode 自动 engage 不变
- ✅ SquabbyZ sole-author + 无 AI 副 trailer 不变
- ✅ Human-NL-Choice-Only 不变（CLI 仍由 LLM 跑）
- ⚠️ 新增字段属于 JSON schema 增量，向后兼容（旧 reviewer 读不到 costRatio 时默认走 hard gate 路径）

## 待用户 review 的关键决策

1. **costRatio 阈值 10/50 是否合理？** 经验值，未来按 `.peaks/memory/` 跑出来的实际数据调
2. **是否要再加一个 `peaks audit karpathy-cost` 定期报告**？每片都算 cost、月底 audit 一次"评估成本最高的 5 个 slice"
3. **karpathy-reviewer sub-agent 本身能否在 costRatio > 30 时主动退出**？现在 reviewer 跑完才看结果，跑完才能算 costRatio——这本身又是鸡生蛋问题

## 现状保留

**用户原话**："加强让 LLM 执行 karpathy-skills 的纪律"——**不是削弱纪律**。本提案的"加强"是：
- 让纪律**自身**也受成本-收益约束（评估本身也是成本）
- 当纪律**评估成本**超过**纪律保护的价值**时，自动降级硬门为软门
- 不是减少纪律触发频次（仍每片评估），不是削弱纪律强度（4 guidelines 全文保留）

## 下一步（待用户决定）

如用户 OK 实施：
1. 新增 `rebuild-by-domain-karpathy-cost` Job slice
2. 在 `agents/karpathy-reviewer.md` 加 `evaluationCost` schema 字段
3. 在 `peaks job checkpoint` 后插一个 `karpathy-cost-check` 命令
4. 加 4 维单测覆盖 costRatio 10/50 边界、降级路径

**预计 commit 数**：4-5 个，含 schema 加字段 + main loop 集成 + 单测。
