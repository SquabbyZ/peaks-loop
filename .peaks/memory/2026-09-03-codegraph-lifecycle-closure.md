<!-- peaks-memory:start -->
---
title: 2026-09-03 codegraph 生命周期闭环 — slice 完成自动 refresh + RD 规划前强制 pre-read
kind: lesson
date: 2026-09-03
session: 2026-09-03-session-d49394
rids: [rid-2026-09-03-codegraph-autorefresh, rid-2026-09-03-codegraph-preread]
commits: [7b9fe627, b6599b56]
---

# codegraph 生命周期闭环（pre-read + post-refresh）

## 一句话总结

把 codegraph 从"LLM 自觉执行的编排规范 prose"升级为**系统强制闭环**：① RD 规划前 pre-dispatch preflight 自动 init/index + 读有界结构注入 RD prompt；② slice/request 完成边界（`job checkpoint --state done` / `request transition --state qa-handoff`）自动 `codegraph index` 刷新。两个都是 CLI-internal / dispatch-compose 内嵌（vendor-neutral、不可绕过），非 IDE hook。

## 现象 / 根因

用户反馈两点：(1) "不知道有没有完成每步任务后自动用 codegraph 更新数据"；(2) "规划开发任务前也要先读下 codegraph 吧"。查证：4.0.25 只写了 prose（`codegraph-orchestration.md` §"Post-slice incremental re-index": orchestrator MUST proactively run `peaks codegraph index`），**零代码自动触发**。RD 侧只用 `affected <files>`（改后看影响），规划前不读全局结构。

## Fix 内容

- **Slice A（autorefresh）**：`codegraph-autorefresh.ts`（refreshCodegraphAfterSlice + isCodegraphPresent, best-effort fail-silent, 仅在 `<root>/.codegraph/` 存在时 index, 不 auto-init）+ `job-commands.ts`（checkpoint --state done 成功后触发）+ `request-commands.ts`（role=rd 且 state=qa-handoff 成功后触发）。16 BDD 测试。
- **Slice B（preread）**：`codegraph-preflight-service.ts`（buildCodegraphPreflightBlock：ensure index init-when-absent / skip-when-fresh / foreign-schema fail-soft + 读有界 files --json, cap 40 dirs / 12 root files）+ `build-dispatch-system-prompt.ts`（可选 codegraphBlock：undefined 保持 legacy byte-identical, null → unavailable note, string → verbatim; 顺序 L1→lifecycle→context→codegraph→memory→task）+ `dispatch-commands.ts`（仅 role='rd' preflight, 每个失败路径 → null 优雅降级）。13 BDD 测试。

## Lesson 1 — "hook on slice-complete" 的最优形态是 CLI-internal，不是 IDE PostToolUse hook

**现象**：user 初始措辞"用 hook"，RD 选 Option 1（CLI-internal trigger）并获 user 接受。

**Why**：真实需求 = "slice 完成边界自动跑 codegraph index"。字面 PostToolUse Bash hook (a) 依赖 IDE hook 安装面且可被绕过（LLM 在无 hook 上下文跑命令就不触发）；(b) 每步 Bash 都 fire（需 parse + exit 0）；(c) 无正确性增益。CLI-internal 在 checkpoint/transition 命令内触发：vendor-neutral、不可绕过、恰好在真 slice 边界 fire 一次。

**How to apply**：未来"某事件后自动做 X"先问"事件在 CLI 有真命令锚点吗？"有 → 命令内部触发（un-bypassable + vendor-neutral）；只有 IDE 层事件才有 → 才考虑 hook。不要被"hook"字面措辞带偏；向 user 说明 tradeoff 后选更优形态（本次 AskUserQuestion 确认）。

## Lesson 2 — 发版 commit 别用 shell 里带反引号的 heredoc/多行引号

**现象**：Slice A 第一次 `git commit -m "..."` 消息含 `` `peaks codegraph index` `` 等反引号，被 Git Bash 命令替换吞掉，commit 消息残缺（`runs  best-effort` / `job-commands.ts:  triggers`）。amend 用 -F 消息文件修复。

**Why**：Git Bash 在双引号 -m 参数里执行反引号内命令。项目 commit 消息频繁含 code 短语反引号，几乎必踩。

**How to apply**：commit 消息含反引号/`$`/复杂内容 → 写到临时文件再 `git commit -F <file>`（或 -m 用单引号且不用反引号）。本次 Slice A/B 都改用 -F 后干净。

## Lesson 3 — 版本面全量核对清单（4.0.28 教训落地版）

bump 后 commit 前核对 4 处一致 = root version：
1. root `package.json#version`
2. `packages/peaks-loop-shared/src/version.ts` `CLI_VERSION`
3. `packages/peaks-loop-internal-runtime/src/index.ts` `RUNTIME_VERSION`
4. `packages/peaks-loop-internal-runtime/src/index.ts` `RUNTIME_NPM_VERSION` == internal-runtime package.json version

## 验证证据
- QA 双 rid verdict = pass;scoped 16+13 测试全过;full suite 983 pass / 987,仅 3 个已知 red-on-base（dispatch vendor-registration + statusline stale ×2）
- 清理：D:\peaks-loop\.codegraph 无残留;孤儿 `.peaks/.codegraph/`（14:48 回根前遗留,仅空 marker）已删（user 确认）

## Red-line 遵守
- 无 Co-Authored-By trailer;SquabbyZ 唯一作者
- 编排器未直接 Edit/Write src/**;全部经 `peaks sub-agent dispatch rd/qa`

## 反模式（不要做）
- 不要把 post-slice refresh 挂到每步 Edit/Write（太重）——只在 slice/request 完成边界
- 不要在 dispatch compose 用可能阻塞的方式做 codegraph preflight（必须 fail-soft,codegraph 挂了 RD 照常走）
- 不要回到 `.peaks/.codegraph/`（4.0.28 已回根,本 slice 的 preflight/refresh 都只认 `<root>/.codegraph/`）
<!-- peaks-memory:end -->
