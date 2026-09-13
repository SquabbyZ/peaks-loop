---
name: codegraph-dangling-marker-autorefresh-fix
description: "codegraph 自动刷新失效的根因（悬空 marker 被误判\"已初始化\"）+ 方向3修复，4.0.31 已发布"
metadata:
  type: project
  node_type: memory
  originSessionId: 90742f29-4074-4c14-acd7-2984851a606f
  modified: 2026-09-07T16:29:36.291Z
---

# codegraph 自动刷新失效根因 + 修复（4.0.31）

**Date:** 2026-09-08（session 2026-09-07-session-245530）

## 根因（一个语义混淆）

`.peaks-loop-marker` 的语义是"peaks-loop 管理此目录"，但下游把它当成了"codegraph 已初始化"。真实判据应是 **`codegraph.db` 存在**（= 上游 `isInitialized`）。

链条：`peaks workspace init` 的 auto-stake（rid-CG-001）只 `mkdir` + 写 marker、**不跑上游 `codegraph init`** → 留下无 `codegraph.db` 的悬空 `.codegraph/` → 三个消费点（`defaultCodegraphInitGuard` / `isCodegraphPresent` / `buildCodegraphPreflightBlock`）都按"有 marker"判为已初始化 → post-slice 自动刷新跑 `index` 静默失败（"CodeGraph not initialized"，fail-silent 没人看到）。

## 修复（方向 3 = 源头 + 消费端）

1. `codegraph-service.ts` 新增 `isCodegraphInitialized()`（探 `codegraph.db`）；init-guard 对"marker 有但 db 无"返回 `fresh`（可重跑 init）。
2. `workspace/init-command.ts` auto-stake 改真跑上游 `codegraph init`。
3. `codegraph-autorefresh.ts` + `codegraph-preflight-service.ts` 按 db 判定，悬空态自愈（先 init 再 index）。

关键事实：上游 `codegraph init`（不带 `--index`）**快 ~1s 且离线安全**（只 `Parser.init()` WASM，语法 WASM 全在 node_modules），"慢/离线"顾虑只适用于 `index` 全量建库，不适用于 `init`——所以 auto-stake 真 init 不违背"workspace init 保持快"的设计。

## Why

"归谁管"（marker）与"能不能用"（db）是两个正交布尔，混用会让半初始化状态变成无法自愈的死局（init 变 no-op + index 静默失败）。

## How to apply

集成第三方工具的数据目录时：用工具自己的"已初始化"判据（这里是 db 文件）做可读写判定，别拿自家 marker 当代理；auto-stake/兜底动作要真正产出工具要的数据结构，而不是只打一个空标记。

## 发布（4.0.31）

- commit `11533cfe`（fix）+ `562dbb70`（release bump），tag `v4.0.31`，publish.yml **completed/success**，`peaks-loop@4.0.31` + 4 子包已上 npm。
- 版本面 4 处：root pkg = CLI_VERSION = RUNTIME_VERSION = 4.0.31；RUNTIME_NPM_VERSION 0.0.16 == internal-runtime pkg。
- ci.yml 仍红：`pnpm/action-setup@v4` **pre-existing**（5 个 job 全在该步骤失败，与本次改动无关，publish.yml 用 corepack 绕开）。见 [[2026-09-03-codegraph-root-revert-and-env-1m-window]]。
