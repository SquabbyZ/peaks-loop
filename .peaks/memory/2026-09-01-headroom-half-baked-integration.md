<!-- peaks-memory:start -->
---
title: headroom-ai 半成品集成 — N-7 proxy 后端未接，当前 0 token 节省；省 token 主杠杆是 G7 + auto-compact + cache 对齐
kind: feedback
date: 2026-09-01
session: 2026-09-01-session-fdd7aa
rids: [feedback-headroom-half-baked]
related: [[sub-agent-headroom-forced-compression-gate]], [[2026-07-30-karpathy-evaluation-cost-self-review-design]]
---

# headroom-ai 半成品集成

> **优先级**：项目级 finding（user 反馈第 4 条）。headroom 的 proxy 后端（N-7）未接之前，`--use-headroom` / `--compress-results` 都是 no-op。

## 结论

headroom-ai 是「context 压缩 SDK」的**客户端**，不是本地压缩器。官方 README 硬性要求：`Requires a running Headroom proxy (headroom proxy) or Headroom Cloud API key`。真正压缩发生在独立的 proxy 进程或 Cloud。

## 现状（2026-09-01 验证）

- `headroom-ai@0.22.4` 在 `dependencies`，但 `headroom-client.ts` 注释明写 `Slice #010 does NOT consume the long-running headroom proxy daemon (N-7 deferred)`。
- 本机无 proxy（8787 无监听）、无 `headroom` CLI、无 `HEADROOM_*` env → 每次 `compress()` 触发 `fallback: true` → `HEADROOM_UNAVAILABLE` + `tokensSaved: 0`。
- 且为 opt-in：dispatch 需 `--use-headroom`，memory search 需 `--compress-results`，默认不碰；只覆盖 2 个触点（dispatch prompt + memory 搜索结果），不碰主编排器上下文。

## 省 token 主杠杆（优先级高于 headroom）

1. G7 sub-agent 上下文治理（metadata-only，~200 字/agent，直接丢 body）—— 最大头。
2. auto-compact 0.85/0.95 合同 —— 管主上下文。
3. prompt-cache 对齐 —— dispatch 前缀稳定 → 缓存命中。
4. G8.4 shared 通道 —— ≤1KB last-write-wins。

headroom 只在「竖起 proxy 后端 + 前两者榨干」后才值得补最后一截（30–80% dispatch prompt 压缩）。

## 后续（user 决定 defer）

「headroom 半成品 → 真接 proxy」是独立大活（N-7），四条反馈落地后再 scope。

<!-- peaks-memory:end -->
