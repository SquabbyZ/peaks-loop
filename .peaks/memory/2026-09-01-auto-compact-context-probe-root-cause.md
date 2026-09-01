<!-- peaks-memory:start -->
---
title: auto-compact context probe 根因修复 — 三级链全断 + vendor-neutral + token-based 模型感知校准
kind: lesson
date: 2026-09-01
session: 2026-09-01-session-fdd7aa
rids: [rid-context-probe-vendor-neutral, rid-calibrate-transcript]
commits: [7f0f4ca2]
related: [[2026-08-01-mac-auto-compact-transcript-estimate-trigger]], [[2026-07-31-mac-auto-compact-no-env-injection]], [[auto-compact-threshold-policy]], [[2026-07-31-mac-auto-compact-esm-fake-green-and-fix]]
---

# auto-compact context probe 根因修复

> **优先级**：项目级 lesson。任何 context-probe / auto-compact 改动必须遵守本文三条约束：(1) fallback 必须 adapter 化（vendor-neutral）；(2) transcript 查找用 `outerSessionId`；(3) 比例用 token-based + 模型感知（1M/非 1M）。

## 现象

用户反馈「auto compact 不是总生效」。实测 `peaks code context-now` 永远返回 `{ ratio: 0, source: 'conservative-fallback' }` → `auto-compact-orchestrator.ts` 见 `conservative-fallback` 直接 return → auto-compact 从不 fire（`compact-history.jsonl` 从不存在）。

## 根因（三级探测链全断）

| 级 | 机制 | 失败原因 |
|---|---|---|
| ① | env-var `CLAUDE_CONTEXT_USAGE_PERCENT` | Claude Code 只往 statusline/hook 子进程注入，普通 Bash 子 shell 没有（平台限制，无解） |
| ② | statusline `~/.claude/statusline-state.json` | statusline 没装/没写（环境配置，`peaks statusline install` 补） |
| ③ | transcript 估算 `~/.claude/projects/<hash>/<sid>.jsonl` | **用了 peaks `sessionId` 去搜，但 transcript 是 `outerSessionId`（UUID）命名** → 永远搜不到 |

## 修复（三个 slice 收口为 commit `7f0f4ca2`）

1. **vendor-neutral**：Claude 的 transcript/statusline fallback 收进 `claude-code-adapter.ts` 的 `IdeCompactProfile.readContextPercentFallback`；通用 `auto-compact-reader.ts` 只调 `adapter.compact.readContextPercentFallback?.(...)`，一行 `~/.claude` 都不留。
2. **session-id**：transcript 查找改用 `outerSessionId`（`resolveOuterSessionId` 从 session binding 解析）。
3. **校准**：`ratio = contextTokens / contextWindowTokens`，其中 `contextTokens = input_tokens + cache_read_input_tokens + cache_creation_input_tokens`（从 transcript 最新 `message.usage` 反扫读取），`contextWindowTokens` 模型感知（1M → 1_000_000，非 1M → 200_000 默认，含 `1m` 后缀 + `claude-opus-4`/`claude-sonnet-4` 前缀 allowlist + `contextTokens>200K` 推断兜底）。替换了错误的 `bytes/256KB`（transcript 是全量历史、无界增长，永远 clamp 100%）。

## 关键认知

- **transcript 字节数 ≠ 上下文填充率**。transcript jsonl 是全量会话历史（含工具输出、已压缩归档内容），无界增长；真正的上下文信号是每条 `message.usage` 里的 token 计数（`cache_read_input_tokens` = 完整缓存前缀）。
- **模型上下文分 1M / 非 1M 两档**（user 2026-09-01 提出）。校准必须模型感知，否则非 1M 模型上 `contextTokens/200K` 会在 1M 模型上算错。
- **transcript 估算只能当「活性 + 粗略比例」兜底**，真信号优先级仍是 env-var > statusline > transcript。

## 验证

build 后 `node dist/cli/index.js code context-now --project .` → `source: transcript-estimate`, `rawTokens: 407173`, `capacityTokens: 1000000`, `ratio: 40.7%`（真实，不再是假 100%）。

<!-- peaks-memory:end -->
