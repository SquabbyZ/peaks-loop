---
name: single-observation-is-not-a-property
description: single-observation-is-not-a-property
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-09-12-session-e37ef0/txt/handoff-4-0-45.md
---

orchestrator 基于**一次** `review-complete` 就向用户报告「闸已经能端到端跑通」；随后自己复跑 **3/3 全败**（1 次输出截断 + 2 次 "no text block"）。

**Why:** 那次成功是运气，但它在报告里被写成了性质。这正是本轮反复出现的形状 ——「我看到的」被当成「实际是的」；只不过这一次犯它的是 orchestrator 自己，说明这个失效模式与角色无关、与是否"知道这条道理"也无关。任何含非确定性（LLM 输出、网络、时序）的结论，一次观测不构成证据。

**How to apply:** 任何「X 能工作」的结论，若 X 含非确定性，必须**连跑多次并给出分布**（本仓库此前的做法就是「连跑 3 次，每次全部 4/4」）。单次绿不足以支撑「能工作」，只能支撑「这次没坏」。
