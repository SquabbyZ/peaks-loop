---
name: ac-pass-list-is-not-a-completion-bar
description: 按 AC 全过收工会让 AC 清单之外的失败模式照样上线 —— 独立评审要主动超出 AC
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-09-12-session-e37ef0/txt/handoff.md
---

本切片 QA 报 **11/11 AC pass**，RD 自评审却找出 **4 条 MEDIUM**，全部落在 QA 那 11 条 AC 之外：(CR-1) `init` 的成功提示被打成 `warnings` 输出到 stderr；(CR-2) 自实现 matcher 对扩展 glob 语法静默漏报 —— "修好了"其实没修好；(CR-3) 自实现 matcher 存在灾难性回溯；(CR-4) fresh-clone 自愈在 preflight / autorefresh 路径上不可达（只有单测钉住调用，没有端到端断言）。

**Why:** "按 AC 全过"只能证明 AC 覆盖到的地方。AC 是**需求**的投影，不是**失败模式**的投影；AC 没写到的健壮性 / 输出契约 / 覆盖面缺口，测试再绿也不会有信号。而且 AC 由同一个流程写出来，它的盲区是系统性的，不是随机的。

**How to apply:** 独立评审（RD 自评审 / 第三方 reviewer）要**主动超出 AC 清单**去枚举失败模式：输出通道（stdout vs stderr）、边界输入（空串 / 超长 / 异常字符）、共享热路径的可达性、以及"这条断言钉的是调用还是可观测结果"。**不要把"AC 全过"作为收工条件**；收工条件是"新增的每一条失败模式都有对应断言或被显式记为未决项"。
