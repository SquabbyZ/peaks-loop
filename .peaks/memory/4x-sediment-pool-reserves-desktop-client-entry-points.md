---
name: 4x-sediment-pool-reserves-desktop-client-entry-points
description: 4.x sediment-pool 设计对桌面客户端（desktop client / native app）天然预留的 4 个契约面 — 跨 IPC / 本地总线 / 事件流被复用
metadata:
  type: project
  createdAt: 2026-07-04
  source: brainstorm session for `docs/superpowers/specs/2026-07-04-peaks-maker-dynamic-skill-sediment-design.md`
---

# 4.x 沉淀池对桌面客户端天然预留的能力面

> **Why:** 用户在 2026-07-04 端到端 brainstorm 中明确指出：当下 4.x 设计天然为后续桌面客户端预留了能力。Pool + CLI + adapter 三层的契约面恰好等于一个本地 desktop shell 启动时要调的 IPC / local bus / event-stream 接口。本条不写进 spec（避免 scope creep），但必须落到 memory，否则新会话会从头推一遍"为什么当初这么设计"。

## 桌面客户端可立即复用的 4 个契约面

| # | 4.x 设计里的契约 | 桌面客户端可如何复用 |
|---|----------------|------------------|
| 1 | `peaks skill sediment list/show/search/recent` | 文件树 + search box UI 直接 gate 在这层 CLI 上；零额外 schema |
| 2 | `peaks skill sediment add-segment / add-bee` | 表单式 wizard（每字段问一题）天然就是 interviewer 流 |
| 3 | `adapter.resolveScratchDir(provider)` / `adapter.materialize(bee)` | 进程内 bus — UI 看到 scratch 路径后即可展示"哪只 bee 正在跑" |
| 4 | `bees/bee-x/run-state.json` | 心跳/进度面板直接 read-only 这一份 JSON |

## Why this matters

- 用户原话 2026-07-04："当下的改动也为后面设计桌面客户端预留好了需要的能力"。
- 这意味着 4.x 的实现不应在这些接口里"贴桌面"的细节（如 D-Bus / Windows pipe / macOS NSXPC），但应保持接口**调用粒度 = 一次 IPC 调用**（即单条 CLI 命令），不要发明"批量 RPC"。
- 桌面客户端的具体设计是另一个 future PRD，**当前不在 4.x scope**。

## How to apply

- 未来启动 peaks-desktop PRD 时，第一步回看本条 + design doc §3.1/§3.2/§6。
- 实现 4.x 时，凡是要新发明"桌面专属"协议，先 grep `~/.claude/skills/peaks-*` 是否已有 CLI 子命令可复用——**优先 CLI 加 flag，不发明新协议**。
- 与 [[peaks-loop-24h-ai-programmer-positioning]] 的关系：定位是"24h AI 程序员编排器"——客户端是该定位的可选皮肤层，不替代 orchestrator。

**Related designs / memory:**
- `docs/superpowers/specs/2026-07-04-peaks-maker-dynamic-skill-sediment-design.md`
- `docs/superpowers/specs/2026-07-03-peaks-loop-job-design.md`（同 24h 长任务技术族）
- [[peaks-loop-24h-ai-programmer-positioning]]
