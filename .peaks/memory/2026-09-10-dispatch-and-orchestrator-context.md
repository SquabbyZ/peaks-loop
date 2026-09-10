---
name: 2026-09-10-dispatch-and-orchestrator-context
description: 省 token 的两个真实杠杆 —— 派发提示词 boilerplate 瘦身（−18%）与编排器上下文审计（779KB/586组，长尾而非单点）；附 Slice 2 自相矛盾的反面案例
metadata:
  type: lesson
  affects: build-dispatch-system-prompt, context-audit, SKILL.md 输出纪律
  related: 2026-09-10-memory-system-overhaul
---

# 派发提示词瘦身 + 编排器上下文审计（2026-09-10）

**Date:** 2026-09-10
**Session:** 2026-09-07-session-245530
**Released:** 4.0.36

## 一句话

省 token 有两个真实杠杆：**派发提示词里 52% 是可压缩的重复 boilerplate**，以及**编排器自身上下文从未被度量**（首次审计：779 KB / 586 组，Top-5 仅占 15% —— 是长尾）。

## 实测数据

**派发提示词**（每次 16.8 KB）：
- CLI 注入 boilerplate ≈ 8.8 KB（52%），跨派发逐字重复；本会话 20 次 = 261 KB，其中 176 KB 是重复。
- 压缩后 7 个角色**字节一致**：rd/qa/sc/prd 3897 → **3191 B（−18.1%）**。

**编排器上下文**（`peaks code context-audit` 首次量化）：
```
totalBytes 779,671 | entries 697 | groups 586
Top-5 合计仅 ~15%：
  32,484 B  Read  README.md ×3
  27,539 B  Read  sub-agent-dispatch.md
  23,234 B  Bash  sub-agent dispatch rd ×20
```

**`--summary` 压缩效果**：memory reindex 9,371→1,924（−79.5%）、memory list 59,239→1,680（−97.2%）、doctor 14,319→1,883、request list 20,790→1,683。

## Lesson 1 — 先度量，再优化；没有度量的优化是猜

**现象**：在加 `context-audit` 之前，我们对"token 花在哪"只有感觉。一测才发现是**长尾**（586 组，Top-5 仅 15%），而不是"某个大块"。

**How to apply**：优化前先建**可见性**（本次 `context-audit` 就是那个仪表）。否则会去修一个不是瓶颈的东西。

## Lesson 2 — 长尾问题的解法是纪律，不是单点修复

**现象**：Top-5 只占 15%，抓任何一个都省不下多少。

**How to apply**：长尾 → 改**行为规则**（"单次输出 >2 KB 禁止直接进上下文"）+ 提供**有界视图**（`--summary`）。单点修复只对尖峰有效。

## Lesson 3 — 反面案例：自相矛盾的规格会产出净负收益

**现象**：Slice 2（共享契约文件）我要求"所有绑定规则仍内联"却又要"搬到共享文件"——**没有内容可搬**，结果只剩一条指针，每次多 165 B，纯亏。RD 如实报了"净增字节"，我据此回退。

**How to apply**：写规格时自检"这个改动**减掉了什么**"。如果答案是"什么都没减，只是加了一层引用"，那它不是优化。

## Lesson 4 — 质量护栏要机器可验证

**现象**："别牺牲质量"是口号，无法验收。

**How to apply**：把它变成**断言**——本次用"规则存在性"测试（`BINDING_RULE_TOKENS` 21/21、runner 5/5 全角色），压缩后必须全绿。任何"压缩"改动都应配这类守卫，否则下一次压缩会悄悄吃掉规则。

## 反模式（不要做）

- 不要把大 JSON 直接 dump 进编排器上下文（用 `--summary` 或落文件后选择性读）。
- 不要在没有度量仪表的情况下做 token 优化。
- 不要写"只加引用不减内容"的所谓优化。
- 不要把质量护栏停留在口号上——变成测试断言。

## 待办

- 剩余 23 个记忆文件无 kind（3 个归档 + 20 个被引用），doctor 持续报 warning（准确状态，非故障）。
