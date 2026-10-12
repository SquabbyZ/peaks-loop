---
name: two-practices-gated-vs-handwritten
description: two-practices-gated-vs-handwritten —— 仓库里并存两套做法，无闸的手写产物是事实上的主流
metadata:
  type: project
  sourceArtifact: .peaks/_runtime/2026-10-12-session-74bd69/txt/handoff.md
---

判断方法（可复现）：`grep -oP '(?<=- state: ).*' <role>/requests/<rid>.md` —— **没有输出**就说明
该载体从未被 `peaks request transition` 追加过 `## Status` 块，即那一轮没走状态机。

2026-10-12 那轮（`rid-race-gate2-threshold-policy`）是久违地真去驱动状态机的一轮，一驱动就撞出
4 条结构性缺口（MUT_REPORT 无生产者、审计 CLI 因 ESM require 整体不可用、契约不提回填载体、
以及闸门与 final-review 认不同路径）。

**要回答的是「哪一套是权威」**，而不是急着改闸门表 —— `--allow-incomplete` 绕过、跑了没拦、
表只是期望，三种可能的修法完全不同。
