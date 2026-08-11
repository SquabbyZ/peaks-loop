<!-- peaks-memory:start -->
---
title: detached 子代理架构 user 反馈 — headless 应该是 in-shell background，不是新 OS process
kind: feedback
date: 2026-08-11
session: 2026-08-11-session-7f7f78
session-continued: 2026-08-11-session-476090
rids: [rid-001, rid-002, future-detached-architecture]
related: [[2026-08-10-runtime-detached-design]], [[2026-08-10-runtime-detached-phase-A-baseline]], [[2026-08-10-runtime-detached-24h-user-confirm]], [[2026-08-11-dogfood-4-0-20-cli-wiring-and-vendor-detect-defects]]
---

# detached 子代理架构 user 反馈

> **优先级 = 项目元规则**（与 human-nl-choice-only / two-forms-only 同级）。任何 detached 子代理实现都必须先确认符合本反馈；不符合 = false-pass。

## user 原话（2026-08-11 / session 7f7f78 → 476090 续接时）

> "我希望的headless的claude、codex等是background的形式，类似于在有头的claude中启动shell，而不是刚才新开powershell"

直白版：

- **期望行为：** headless 子代理（claude / codex / copilot）以 background 形式运行 — 就像在**有头 Claude shell 内**启动 shell 子进程一样。
- **拒绝行为：** **不要** spawn 新的 powershell 窗口 / 新的 OS 进程 / 任何会跳出当前 shell 视觉边界的子代理。
- **心智模型：** 父 Claude 是"head"；headless 子代理是 head **内部** 的 background job；headless 任务可以独立 context、独立 auto-compact、独立 auto-spawn，但都活在 head 的可视范围内。

## Why

1. **可观察性 = 父 shell 一处可见。** user 在 head Claude 里能看到 headless 任务的进度、stderr、状态码；新开 powershell 等于让子代理脱离 user 的注意力边界，违背 "user = 业务/产品审阅者，全程只看 head 反馈" 的定位。
2. **上下文成本可控。** 新 OS process 拿不到父 Claude 的 prompt cache（无 prompt-cache 命中），in-shell subprocess 至少共享父进程的部分上下文继承语义。
3. **24h 长任务可中断 / 可恢复。** in-shell background 可被父 Claude kill / inspect / restart；OS-detached 进程失去这条生命线（除非加复杂的 IPC）。
4. **auto-compact 闭环。** peaks 的 auto-compact 阈值（0.85 / 0.95）是父 Claude 的 contract；如果子代理在独立 OS 进程里跑，auto-compact contract 对它失效 → 长任务成本失控。

## How to apply

### 立刻生效的改动（下一个 detached 切片开工前必做）

- **废弃** `packages/peaks-loop-internal-runtime/src/process-supervisor.ts` 的 `DETACHED_PROCESS + CREATE_NEW_PROCESS_GROUP`（Windows）+ `setsid + nohup`（POSIX）路径。
- **改用 in-shell background subprocess 抽象：**
  - POSIX: `child_process.spawn(..., { detached: false, stdio: 'pipe' })` + 父进程持有 stdout/stderr pipe + 父进程负责 SIGTERM/SIGKILL
  - Windows: `child_process.spawn('powershell.exe', ['-NoLogo', '-Command', '<cmd>'], { detached: false, windowsHide: true })` — **不**传 `windowsDetached: true`、**不**用 `DETACHED_PROCESS` flag
  - 所有用例统一：父 shell 是 head，子代理是 head 的 background job
- **`ProcessSupervisor` 重命名为 `InShellBackgroundSupervisor`**（或者保留 ProcessSupervisor 但加 mode=`in-shell` 并把 `detached` 标为 deprecated）。
- **保留 vendor adapter 的 `--vendor <vendor>` 选项**（仍需要识别 vendor CLI binary），但 vendor CLI 必须 in-shell 调用。

### 同步联动改动

- **CLISurface (rid-001 已 ship) 不变**：4 个新 flag `--mode / --vendor / --no-throttle / --max-concurrent` 保留 — 但 `--mode detached` 改名 `--mode background`，`--mode in-process` 改名 `--mode foreground`（语义清晰化）。语义保持：default = foreground。
- **2 个 reachability 测试**保留 spawn `node bin/peaks.js vendor-detect` 和 `sub-agent dispatch --help` 的形式，但 `dispatch --mode detached` 的实际行为断言要改成 "in-shell background subprocess path" 而不是 "OS-detached process path"。
- **memory sediment `2026-08-10-runtime-detached-design.md` / `2026-08-10-runtime-detached-phase-A-baseline.md` / `2026-08-10-runtime-detached-24h-user-confirm.md` 三件套**全部需要追加本反馈附录，或者后续切片出新版时 supersede 这三件套。

### 影响的切片（按优先级）

1. **未来 rid-detached-arch-revision（最高优）**：改写 `process-supervisor.ts` + 重命名 + 测试 + SKILL.md 同步。验收 = spawn vendor CLI 作为 in-shell subprocess + 父 shell 仍然持有 pipe + auto-compact 对子代理生效（via `transcript-estimate` 共享或独立 agent-level 0.85/0.95 阈值）。
2. **rid-002 (vendor-detect Windows ENOENT)**: 仍 out-of-rid-001 scope;但 fix 时需注意：`shell: true` 在新架构下可能被禁用（in-shell 模式已有更精确的 vendor binary 探测），改用 `where claude` / `which claude` + PATHEXT 解析。
3. **rid-003 (peaks-rd 等 bee 是 Skill 不是 Agent type)**: papercut，与本反馈独立，继续单走。

## 验收信号（pass / fail）

- **PASS**：未来 detached 切片 commit 时，commit message 引用本 sediment 且 reviewer 确认 in-shell subprocess path 落地。
- **FAIL 标记**：如果未来切片声称"detach sub-agent"但仍在用 `DETACHED_PROCESS` / `setsid`，QA 必须 fail。

## 关联阅读

- [[human-nl-choice-only-tenet]] — user 不敲 CLI 不手写 JSON 的元规则，背景就是 head 内的 assistant。
- [[peaks-loop-24h-ai-programmer-positioning]] — user = 业务/产品审阅者，全程只看 head 反馈。
- [[auto-compact-threshold-policy]] — auto-compact 是父 Claude 的 contract；in-shell subprocess 必须能继承这个 contract。
- [[2026-08-11-dogfood-4-0-20-cli-wiring-and-vendor-detect-defects]] — 同 session 发现的 rid-001 CLI surface + rid-002 vendor-detect ENOENT + rid-003 bee 命名空间。

<!-- peaks-memory:end -->