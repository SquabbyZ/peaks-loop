---
name: custom-sop-domain-agnostic-positioning
description: Custom SOP / peaks-sop is positioned as a general workflow-gating tool; non-dev workflows are the bigger growth prospect, not just R&D.
metadata:
  type: project
---
用户决策 2026-05-29：自定义 SOP（peaks-sop 技能 + `peaks sop` 引擎）**不限于研发流程**，要定位成**通用的"流程不许跳步"工具**。用户原话："不只是研发，像其他场景才是这个工具的更好的发展前景。"

**适用面**：凡是"有先后阶段、进入下一步前必须满足可检查条件"的流程——内容发布、合规/审批清单、数据校验管线、入职/运维 runbook、个人可重复流程。研发发布只是其中一例，非研发场景往往更有价值，是更大的发展方向。

**唯一边界**：门禁必须能落成"文件存在 / 文本匹配 / 命令退出码"三种原语之一；纯人工判断要 reify 成文件信号（如 approval.md 存在、状态文件含 "Approved"）。`command` 门禁是任何可脚本化检查的万能适配器。

**已落实到产物**（2026-05-29）：peaks-sop 的 `description`(路由信号) 已显式声明 domain-agnostic + 列举非研发场景；SKILL.md 加了"Where SOPs apply"跨域示例表 + 边界说明；references/sop-authoring.md 加了内容发布/合规审批/数据管线三个完整非研发 manifest 示例；README + README-en 的自定义 SOP 节都加了"通用工具、不限研发"定位 + 指向 peaks-sop 技能。

**How to apply:** 后续介绍/文档/B 计划的定价与市场叙事都按"通用流程门禁工具"定位，不要把它窄化成研发工具。关联 [[custom-sop-and-gate-metering]]（B 按完整 SOP 数计量，更契合"几条流程"的通用心智）。
