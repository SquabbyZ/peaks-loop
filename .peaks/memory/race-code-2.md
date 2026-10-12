---
name: race-code-2
description: race-code 门 2 装上阈值 + 结构化证据 + 可机检判定
metadata:
  type: project
  sourceArtifact: .peaks/_runtime/2026-10-12-session-74bd69/txt/handoff.md
---

`peaks race pilot-status` 读 `.peaks/race/pilot-gate.json`（**跟踪**文件，因为门 2 拦的是
`skills/peaks-audit/SKILL.md` 这个跟踪改动），套 `race-gate2-policy-v1` 的 7 项阈值，返回
`pass` / `fail` / `insufficient-evidence` + 带 `observed`/`threshold` 的理由。
`peaks race pilot-gate record` 是唯一的写者（幂等 upsert，`--rid` 为键）。

**两个设计要点别弄丢**：
1. **覆盖条件是推导的，不是自报的** —— `coreCapabilityExercised` 只能由
   `filesChanged ∩ HARD_BLOCKED_PATH_FAMILIES`（import 自 `src/services/hooks/pre-tool-code-gate.ts:32`）
   或安全臂谓词算出；schema 对作者手写的 `coreCapability: true` 是**忽略**而非 honoured。
2. **`taskCount` 只数 `landed`，而安全臂统计所有记录（含 `escalated`）** —— 口径不同是**有意**的：
   升级正是安全臂正确开火的证据，只数 landed 会让计数在唯一真实样本上恰好归零。

今日实况：`task 4 / core 3 / session 1 / safetyArm 1 / 0 / 0 / 0` ⇒ `insufficient-evidence`，
两条缺口（`4<10`、`1<2`）。**这两个下限今天都不紧，作用在前瞻**：挡住「10 条全是文档/记忆修正」的样本。
