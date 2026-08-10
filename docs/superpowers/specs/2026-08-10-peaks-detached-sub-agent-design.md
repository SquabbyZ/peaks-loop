---
title: peaks-loop detached sub-agent + vendor adapter + auditor fan-out + peaks-doctor bridge
kind: design
status: draft
date: 2026-08-10
author: SquabbyZ (601709253@qq.com)
skill: peaks-code
scope: peaks-loop monorepo (adds packages/peaks-loop-internal-runtime/)
---

# peaks-loop Detached Sub-Agent · Design

> **TL;DR.** 在 peaks sub-agent dispatch 现有 in-process 模式基础上新增 `detached` 模式：orchestrator 真在 OS 起独立 LLM 子进程（headless claude / codex / copilot CLI），子进程只拿最小 prompt 切片（看不到 orchestrator 会话历史），跨 session 长跑不被中断；**子进程内部使用 peaks 0.85 / 0.95 auto-compact 协议实现无限上下文（不限费用）**；sub-agent fan-out 旁边挂 LLM-as-judge auditor；peaks-code Step 11 之前调 peaks-doctor 出 OpenSpec 提案；machine 性能护栏 + 效率基线测量作为 ship 门槛。Runtime 走 TypeScript / Node，跟 peaks-loop / peaks-loop-shared 同 monorepo lockstep 发包（避免再次踩 4.0.14 lockstep chicken-egg 坑）。

## 0. 目标 / 非目标

### 0.1 Goals（用户视角）

- G1 **真并行**：sub-agent 不再共享 orchestrator 同一 IDE 进程的 context window；N 个 rid 同时跑时互相不挤占。
- G2 **真独立上下文**：detached 子进程只拿最小 prompt 切片（`{rid, role, vendor, files, refs}`，vendor-agnostic 上限 8KB；claude ~8KB, codex ~5KB, copilot ~6KB，由 VendorAdapter.headlessArgs 决定），看不到 orchestrator 会话历史。
- G3 **orchestrator 最小占用**：orchestrator context window 不再被每个子代理的实际输出撑爆（基线 ≥ 60% 节省）。
- G4 **vendor-neutral**：同一套 dispatch 跑 claude / codex / copilot；vendor adapter registry 可扩展。
- G5 **跨 session 长跑**：子进程跟 orchestrator IDE session 解耦，24h 模式真放手。
- G6 **auditor 跟随**：rd / qa fan-out 时挂 LLM-as-judge auditor（karpathy / code-reviewer / security-reviewer），任何 auditor FAIL 触发 peaks-qa 不通过。
- G7 **peaks-doctor bridge**：peaks-code Step 11 之前自动调 peaks-doctor 出 OpenSpec 提案。
- G8 **子进程无限上下文**（用户原话）：detached 子进程内部使用 peaks 既有 0.85 / 0.95 auto-compact 协议（prompt-level 触发器），靠 compact 把 context 压回 ≤ vendor window 上限，循环继续，**理论无限**。**不限费用**（用户原话）——auto-compact 本身的 token 成本随它去。

### 0.2 Non-goals（明确不做，留 hook 给后续 slice）

- ❌ **跨机器调度**（"别人机器帮我跑"）：本轮限定单机器。
- ❌ **DAG 拓扑引擎**（rid 之间的依赖边）：仅在 §3 数据流预留 `rid.dependsOn` 字段；不做依赖引擎。
- ❌ **图谱 UI 渲染**：dashboard 加 `detachedGraphView` 容器 + 数据接口（空 div）；渲染留 hook。
- ❌ **智能 vendor 选型**：vendor 由 LLM 显式指定或 fallback 默认；不做"按 rid 特征自动选 vendor"。
- ❌ **自动 kill + 重启子进程**（守护）：违反 RL-15 红线 + token 翻倍风险；改为"感知 + 用户决策"（见 §3 LifecycleOwner 闭环）。
- ❌ **Python runtime 后端**：runtime 走 TypeScript / Node；单 lockstep 链（避免 peaks-loop-shared 既有 lockstep 教训再次踩坑）。

## 1. 架构总览

```
┌────────────────────────────────────────────────────────────────────┐
│  Layer 4 · 用户可见面                                              │
│    peaks-code SKILL.md / dashboard / status line / lease-dashboard │
└────────────────────────────────────────────────────────────────────┘
                              ▲                  ▲
┌────────────────────────────────────────────────────────────────────┐
│  Layer 3 · peaks CLI（dispatch / heartbeat / doctor / vendor）     │
│    peaks sub-agent dispatch --mode detached (新)                   │
│    peaks sub-agent heartbeat --mode detached (新)                  │
│    peaks doctor invoke --from-code (新)                            │
│    peaks vendor-detect (新)                                        │
└────────────────────────────────────────────────────────────────────┘
                              ▲                  ▲
┌────────────────────────────────────────────────────────────────────┐
│  Layer 2 · packages/peaks-loop-internal-runtime 子 package          │
│    ┌─ ProcessSupervisor   spawn / detach / PID / kill              │
│    ┌─ VendorAdapterRegistry (claude/codex/copilot headless flag)   │
│    ┌─ StatusProtocol       status file + heartbeat CLI 协议        │
│    ┌─ PromptBuilder        最小切片 {rid,role,vendor,files,refs}   │
│    └─ LifecycleOwner       闭环回收 / orphan cleanup               │
└────────────────────────────────────────────────────────────────────┘
                              ▲                  ▲
┌────────────────────────────────────────────────────────────────────┐
│  Layer 1 · OS 子进程                                                │
│    claude -p "..." --output-format json   (独立进程 1)             │
│    codex exec "..." --json                (独立进程 2)             │
│    copilot -p "..." --output-format json  (独立进程 3)             │
│    …                                                              │
└────────────────────────────────────────────────────────────────────┘
```

要点：

- **orchestrator 在 Layer 3** 调 `peaks sub-agent dispatch --mode detached`，Layer 3 调 Layer 2 的 dispatcher API，Layer 2 通过 ProcessSupervisor 在 OS 起独立 Layer 1 子进程。
- **Layer 2 子进程回写**：每个 Layer 1 进程被要求（通过 vendor adapter 的 flag 模板 + 拼装的 prompt 引导）周期写 status.json 到 `.peaks/_runtime/<sid>/detached/<rid>/status.json`。Layer 2 的 StatusProtocol 读 status file，并把心跳合并到 peaks 既有 `.peaks/_sub_agents/<sid>/dispatch-<rid>-<ts>.json` 的 heartbeat 数组（兼容既有 dashboard）。
- **vendor adapter registry** 是 Layer 2 的子模块：每家 vendor 一个 adapter 文件，封装 headless flag 表 + 进度抓取 regex + 输出格式解析。`peaks vendor-detect` 扫机器后输出推荐 vendor + 评分；dispatch 时按 `vendor` 参数查 adapter；缺 vendor → fallback 到默认。
- **LifecycleOwner 闭环**：无论子进程正常退出还是异常 crash，PID / log / status file / owner-session 都被显式清理，**不留资源累积**（这是核心红线 — 见 §3）。

## 2. 组件清单

| 组件 | 位置 | 职责 |
|---|---|---|
| `ProcessSupervisor` | `packages/runtime/src/process-supervisor.ts` | spawn / detach / PID 管理 / graceful shutdown。跨平台：Windows 用 `DETACHED_PROCESS` + `CREATE_NEW_PROCESS_GROUP`；POSIX 用 `setsid` + `nohup` |
| `VendorAdapterRegistry` | `packages/runtime/src/vendor/registry.ts` | 注册 + 查找 vendor adapter；`getAdapter(vendorId)` |
| `VendorAdapter` 接口 | `packages/runtime/src/vendor/adapter.ts` | `headlessArgs(prompt, opts)` / `parseStatusLine(stdoutBuf)` / `detectInstalled()` |
| 3 个 vendor adapter | `packages/runtime/src/vendor/{claude,codex,copilot}-adapter.ts` | 各家 CLI 的 headless flag、output format regex、parse 逻辑 |
| `PromptBuilder` | `packages/runtime/src/prompt-builder.ts` | 把 `rid + role + vendor + projectFiles + references` 拼成 vendor-specific prompt，**绝不包含 orchestrator session history** |
| `StatusProtocol` | `packages/runtime/src/status-protocol.ts` | 读 `status.json`，合并到 dispatch record 的 heartbeat 数组；解析 prompt 内的 `<peaks-heartbeat .../>` 标记 |
| `LifecycleOwner` | `packages/runtime/src/lifecycle.ts` | **闭环回收**（正常退出 + 异常 crash 都清理 PID / log / status file / owner-session）；orphan reaper |
| `AutoCompactAdapter` | `packages/runtime/src/auto-compact-adapter.ts` | **G8 子进程无限上下文**：在子进程 prompt 里注入 `<peaks-auto-compact threshold="0.85\|0.95">` 标记；子进程 LLM 看到 0.85 → 主动 compact 自己的会话（写到 scratch 文件）；0.95 → 同步写 + 通知 peaks |
| `ResourceBudgetGuard` | `packages/runtime/src/guards/resource-budget.ts` | 性能护栏：runtime 自身 ≤ 200MB / ≤ 5% CPU；fan-out ≤ 8 / 子代理 ≤ 1.5GB / CPU ≤ 75% / orphan ≤ 16（见 §5 性能护栏）|
| CLI 入口 | `src/cli/commands/sub-agent/detached.ts` | `peaks sub-agent dispatch --mode detached` / `peaks sub-agent heartbeat --mode detached` / `peaks sub-agent cleanup --orphan` / `peaks vendor-detect` / `peaks doctor invoke --from-code` |
| SKILL.md 改写 | `.claude/skills/peaks-code/SKILL.md` + `references/sub-agent-dispatch.md` | `--mode` 字段；orchestrator obligations 加 1 行（"emit one-line prose before detached dispatch"） |
| Dashboard hook | `.claude/skills/peaks-code/references/lease-dashboard.html` | 加 `detachedGraphView` 容器 + 数据接口（空 div；渲染留后续 slice） |

## 3. 数据流

### 3.1 主路径：orchestrator 派发 detached sub-agent

```
peaks-code SKILL.md
  │
  │ peaks sub-agent dispatch rd \
  │   --prompt "实施 rid-001: 重构 login" \
  │   --request-id rid-001 --mode detached --vendor claude
  ▼
[peaks CLI · sub-agent dispatch] (Layer 3)
  │
  │ 1) PromptBuilder.assemble(rid-001, role=rd, vendor=claude)
  │    → 5KB 最小切片 prompt:
  │      { rid, role, vendor, projectFiles=[src/auth/...],
  │        references=[PRD 路径, codegraph-context.md 路径] }
  │    ★ 不包含 orchestrator session history
  │ 2) claudeAdapter.headlessArgs(prompt)
  │    → ["-p", prompt, "--output-format", "json",
  │       "--include-partial-messages"]
  │ 3) ProcessSupervisor.spawn(adapter.binary, args, opts={detach:true})
  │    → 在 OS 起独立进程；PID 写入
  │      .peaks/_runtime/<sid>/detached/rid-001/pid
  │    → owner-session 写入 .peaks/_runtime/<sid>/detached/rid-001/owner-session
  │ 4) LifecycleOwner.register(pid, rid, owner-session)
  │    → 注册到活跃进程表；签 resource budget ticket
  │ 5) 写 dispatch record (.peaks/_sub_agents/<sid>/dispatch-*.json)
  │    → mode: 'detached', vendor: 'claude', status: 'running'
  ▼
[Layer 1 · claude -p ... 子进程]
  │
  │ 周期写 status.json：
  │   { progress: 45, state: 'running', note: '正在写 user.service.ts',
  │     ts: 1731287400 }
  │   写到 .peaks/_runtime/<sid>/detached/rid-001/status.json
  │
  │ 输出 stdout/stderr 进 log file：
  │   .peaks/_runtime/<sid>/detached/rid-001/log.txt
  │
  │ 完成时 exit code 0 + 写 final artifact:
  │   .peaks/_runtime/<sessionId>/rd/requests/rid-001.md
  ▼
[Layer 2 · StatusProtocol + LifecycleOwner]
  │
  │ 1) 读 status.json + log tail
  │ 2) 合并到 dispatch record 的 heartbeat 数组
  │ 3) orchestrator dashboard 通过 peaks sub-agent list --mode detached
  │    看到所有 detached 子代理的状态
```

### 3.2 LifecycleOwner 闭环（核心红线）

> **用户原话**："子进程跑完正常反馈给主进程后子进程被回收，就怕异常不仅无法继续还不会被回收，使得资源不断的被累积占用直至死机。"

| 子进程状态 | 检测 | LifecycleOwner 动作 | 资源释放 |
|---|---|---|---|
| **正常退出** (exit code 0) | ProcessSupervisor 监听到 exit 事件 | 1. 标记 dispatch record.status='done'<br>2. 回收 PID 文件<br>3. 归档 log.txt 到 `detached/<rid>/log-archive.txt`<br>4. status.json 归档为 `status-final.json`<br>5. owner-session 标记 complete（下次启动 reaper 跳过） | 全清 |
| **异常 crash** (exit code != 0) | 同上 | 1. 标记 dispatch record.status='crashed'<br>2. exit code + stderr tail 写到 dispatch record.error 字段<br>3. 回收 PID 文件 + log.txt + status.json（保留 crash-context.json 给调试）<br>4. owner-session 标记 crashed<br>5. 触发 peaks-qa fail 或 AskUserQuestion（24h mode 下走 B3） | 全清 + 留 crash-context |
| **超时 / stale** (5min 无 status.json 更新) | StatusProtocol 轮询（30s 一次）| 1. dispatch record.status='stale'<br>2. orchestrator 状态行加 `⚠ stale`<br>3. **不杀进程**（RL-15 红线）<br>4. 状态行 + notification 提示 user | 不动进程；user 决策 |
| **资源超限** (子进程 RSS > 1.5GB) | ResourceBudgetGuard 每 10s 采样 | 1. dispatch record.status='oom-killed'<br>2. kill 子进程（`--no-throttle` 只豁免并发数护栏，不豁免 OOM-kill；OOM 必须杀）<br>3. 全部资源清理（同 crash 路径）<br>4. prompt 切片过厚告警（必须拆小） | 全清 |
| **orchestrator session 退出** | peaks 主进程 exit | 1. **不杀子进程**（user 已 detached）<br>2. owner-session 写入当前 orchestrator sid<br>3. 下次 peaks 启动时 orphan reaper 处理 | 子进程继续跑 |
| **orphan 子进程** (peaks 死了 vendor 还在跑) | LifecycleOwner.reap (cron 周期) | 1. 找 `.peaks/_runtime/*/detached/*/owner-session`<br>2. 当前 peaks 进程不在 owner 列表 → 视为 orphan<br>3. **默认不动**（RL-15 衍生）<br>4. user 显式 `peaks sub-agent cleanup --orphan` 才 kill | user 决策 |
| **磁盘满** | ProcessSupervisor.spawn 前预检 | 1. 拒绝 spawn<br>2. dispatch record.status='disk-full'<br>3. orchestrator UI 提示清理 | 不消耗磁盘 |

**关键红线**：
- ✅ 任何子进程结束（无论成功 / crash / killed），**PID / log / status file / owner-session 100% 清理**——不留累积。
- ✅ orphan 默认不清（RL-15），user 显式 cleanup 才清。
- ✅ 资源超限自动 kill（用户授权豁免除外），不靠人防漏。
- ✅ peaks 主进程退出 = 子进程继续跑（这是 G5 的承诺）。

### 3.3 vendor 切换的降级路径

```
peaks vendor-detect
  → 扫 PATH: claude ✓, codex ✓, copilot ✗
  → 推荐 vendor: claude（评分最高）
  → 写入 .peaks/_runtime/<sid>/vendor-cache.json

rid-002 vendor=copilot
  → CLI 查 vendor-cache: copilot=false → 缺 vendor
  → 输出 vendor_missing 警告 + fallback 到 claude
  → 写到 dispatch record.warning: 'vendor fallback: copilot→claude'
```

### 3.4 字段约定（dispatch record 扩展）

```ts
type DispatchRecord = {
  // ... 既有字段 ...
  mode: 'in-process' | 'detached';   // 新增；老 record 缺省 = 'in-process'（向后兼容）
  vendor?: 'claude' | 'codex' | 'copilot';  // 新增；only for mode=detached
  // ... 既有 heartbeat[] / status / error ...
  autoCompactEvents?: Array<{   // 新增；G8 子进程无限上下文
    at: number;                  // compact 触发的 wall-clock
    threshold: '0.85' | '0.95';
    tokensBefore: number;
    tokensAfter: number;
    scratchFile?: string;        // compact 后摘要落盘路径
  }>;
  tokenUsage?: {                 // 新增；不限费用（G8），但记录供审计
    promptTokens: number;
    completionTokens: number;
    totalCostUsd?: number;       // vendor CLI 不一定暴露；可不填
  };
};
```

### 3.5 G8 子进程无限上下文 + 不限费用（用户红线）

> **用户原话**："如果子进程的任务很长的话，不要被费用过高中断，还有要使用 peaks 的 auto compact 实现无限上下文。"

**核心机制**：

1. **Prompt-level auto-compact 触发器**：子进程 prompt 里嵌一段（由 `AutoCompactAdapter` 注入）：
   ```
   <peaks-auto-compact threshold="0.85|0.95" vendor-window="200000">
   协议：
   - 当你（子进程 LLM）估算自己已用上下文 ≥ 85% vendor window
     → 主动 compact 自己的会话：把对话历史摘要写到
       .peaks/_runtime/<sid>/detached/<rid>/compact/<n>.json
     → 把摘要 + 当前任务状态拼回 prompt 头部
     → 调用 peaks runtime write-compact-event CLI 记录事件
   - 当 ≥ 95% → 同步 compact + 立刻通知 peaks 主进程
     （写 status.json note: 'compact-emergency'）
   - 不要等 peaks 主进程来催；子进程 LLM 自己监控自己的 context
   - 不限费用（用户授权）—— compact 本身消耗的 token 随它去
   </peaks-auto-compact>
   ```

2. **scratch 文件协议**：子进程 LLM 自己写 compact 摘要到 `.peaks/_runtime/<sid>/detached/<rid>/compact/<seq>.json`：
   ```json
   {
     "seq": 1,
     "at": 1731287400,
     "summary": "已完成 user.service.ts 重构；下一步：写测试",
     "decisionsKept": ["用 UUID v7", "不加 rate limit"],
     "discardedOptions": ["JWT 改 session"]
   }
   ```
   peaks StatusProtocol 检测到 scratch 文件 → 合并到 dispatch record.autoCompactEvents[]。

3. **无限的实际语义**（不是真无限）：vendor window 是硬上限（claude 200K / codex 不同 / copilot 不同），靠 compact 把 context 压回 ≤ 上限；只要 token 预算允许，循环继续，理论无限。

4. **不限费用的具体含义**：peaks runtime **不设费用上限**；用户授权即 token 随它去；只在 dispatch record 记录 tokenUsage 供审计（不报警、不 kill、不 ask）。

**红线**：
- ✅ 子进程 LLM 自己监控 context，不靠 peaks 主进程轮询（peaks 主进程轮询成本太高，且子进程 LLM 才知道自己的真实 context）。
- ✅ compact 摘要必须写盘（scratch 文件），不能只在子进程内存里——peaks 主进程 / dashboard 才能看到进展。
- ✅ compact 事件不进 orchestrator context（避免撑爆 orchestrator）；只在 dispatch record 上加索引（≤ 1KB/事件）。
- ✅ 不限费用 ≠ 不记录：tokenUsage 字段必填（vendor CLI 暴露的话），作为审计可见性。

### 3.6 vendor 切换的降级路径（保留原 §3.3，编号顺移）

## 4. 错误处理

| 故障 | 检测点 | 处理 | 影响范围 |
|---|---|---|---|
| 子进程 spawn 失败（vendor CLI 不存在） | ProcessSupervisor.spawn 返回 spawn error | dispatch CLI 返回 NON_ZERO_EXIT;dispatch record.status='spawn-failed';orchestrator UI 显示失败原因 + vendor-detect 提示 | 1 个 rid |
| 子进程 5 分钟无 status.json 更新 | StatusProtocol 轮询（30s 一次）| dispatch record.status='stale';orchestrator 状态行加 `⚠ stale`;**不杀进程**（RL-15）| 1 个 rid |
| 子进程 OOM / 段错误 / 异常退出 | LifecycleOwner 监听到 exit code != 0 | 全清资源 + dispatch record.status='crashed' + 24h mode 下 B3 AskUserQuestion | 1 个 rid |
| vendor CLI 输出格式变化（regex 不匹配） | VendorAdapter.parseStatusLine 解析失败 | stdout 全文写到 log.txt;不写入 status.json;dispatch record.lastError='vendor-parse-failed';但进程不杀 | 进度看不到；进程继续 |
| orchestrator session 退出 | LifecycleOwner session-exit 钩子 | 不杀子进程;owner-session 写入当前 sid | G5 兑现 |
| 磁盘满 | ProcessSupervisor.spawn 前预检 | 拒绝 spawn;dispatch record.status='disk-full';orchestrator UI 提示清理 | 1 个 rid |
| orphan 子进程（peaks 死了 vendor 还在跑） | LifecycleOwner.reap（cron 周期）| 找 owner-session,当前 peaks 进程不在 owner 列表 → 视为 orphan;默认不动;user 显式 cleanup 才 kill | RL-15 衍生 |
| 资源超限（CPU / 内存 / fan-out 数） | ResourceBudgetGuard 每 10s 采样 | 自动 throttle（排队下批 fan-out）;严重时 kill 单进程 + 全清资源 | 全局 fan-out |
| **子进程 auto-compact 失败**（G8） | 子进程 LLM 写到 scratch 文件失败 / 超 vendor window 仍超限 | dispatch record.lastError='auto-compact-failed';status.json note='compact-stuck';**不 kill**（用户授权不限费用，让子进程继续尝试）；orchestrator UI 提示 user | 1 个 rid；G8 退化为 vendor CLI 默认行为 |
| **token 费用超 vendor 服务端限额** | vendor CLI 拒绝继续（HTTP 429 / quota exceeded） | 同 vendor-parse-failed 路径;dispatch record.lastError='vendor-quota-exceeded';进程不杀，让 vendor 自己处理 | vendor 服务端问题；peaks 不介入 |

### 4.1 红线交叉检查（peaks 既有红区必须保留）

- ✅ **SquabbyZ sole-author rule**（`CLAUDE.md` 红线）：子代理 prompt 复用既有 verbatim block，禁 Co-Authored-By trailer。
- ✅ **Human-NL-Choice-Only + Two-Forms-Only**（`CLAUDE.md` 项目规则）：detached mode 不引入新 user-facing CLI verb；用户只通过 LLM / 自然语言 / AskUserQuestion 触发。
- ✅ **0.85 / 0.95 auto-compact**（SKILL.md N+2 节）：detached mode 跟 in-process 同样遵守；Layer 2 StatusProtocol 不读 orchestrator 上下文，不污染 context。**G8 子进程内部 auto-compact 协议正是基于这条协议**。
- ✅ **不限费用**（G8 用户红线）：peaks runtime 不设费用上限；token 预算随用户决定；只记录 tokenUsage 字段供审计，不报警、不 kill、不 ask。
- ✅ **24h mode zero-pause contract**：detached mode 让 24h 真放手（子进程跟 orchestrator session 解耦），是契约的"完成"，不是破坏。
- ✅ **worktree 3-layer governance**（L1/L2/L3）：sub-agent commit / push 由 orchestrator 持有；prompt 复用既有 verbatim "Do NOT commit / push" block。
- ✅ **Code is itself a skill running in the current session**：orchestrator 不跳出当前会话做 detached 派发；只是把"派发"这一步变成 spawn 外部子进程，orchestrator 仍在当前会话等 dashboard 数据。
- ✅ **RL-15 stale 是警告不是失败**：进程不主动 kill，user 决策。
- ✅ **RL-8 scope**：detached mode 是 peaks-code 的 mode 扩展，不开 sibling skill。
- ✅ **G8 不破坏既有 auto-compact**：子进程自己监控自己的 context（prompt-level 触发器），不靠 peaks 主进程轮询；compact 摘要写盘不进 orchestrator context。

## 5. 测试策略 + 效率基线 + 性能护栏

### 5.1 五层测试（vitest 4.1.10，不要升 5.x）

#### Layer 1 · 单元
- `tests/unit/runtime/process-supervisor.test.ts`：spawn / detach / PID file / graceful shutdown / Windows `CREATE_NEW_PROCESS_GROUP` / POSIX `setsid`。Mock OS 调用，不真起进程。
- `tests/unit/runtime/vendor/{claude,codex,copilot}-adapter.test.ts`：headlessArgs / parseStatusLine / detectInstalled。每个 adapter ≥ 20 case（含 edge case：CLI 不存在 / stdout 空 / 输出格式漂移）。
- `tests/unit/runtime/prompt-builder.test.ts`：验证生成的 prompt **不含** orchestrator session 历史（grep forbidden marker 进 prompt 必须 throw）。
- `tests/unit/runtime/status-protocol.test.ts`：status.json schema 校验 / heartbeat 合并 / stale 判定。
- `tests/unit/runtime/lifecycle.test.ts`：正常退出 / crash / oom-killed / orphan / cleanup 各种路径全覆盖。
- `tests/unit/runtime/guards/resource-budget.test.ts`：各种超阈值场景 → throttle / kill / warn 路径。
- `tests/unit/cli/sub-agent-detached.test.ts`：CLI envelope 字段（mode / vendor）契约测试。
- `tests/unit/runtime/auto-compact-adapter.test.ts`：G8 子进程无限上下文。验证 `<peaks-auto-compact>` 标记注入到 prompt；compact 事件字段（threshold / tokensBefore / tokensAfter / scratchFile）符合 schema；prompt-level 触发器不污染 orchestrator context。

#### Layer 2 · 集成（不调真 LLM）
- `tests/integration/runtime/spawn-detached.test.ts`：真 spawn mock vendor CLI（5 行 echo + sleep 脚本），验证 status.json 路径 / PID 文件 / log 文件 / 心跳合并 / 资源清理。
- `tests/integration/runtime/vendor-detect.test.ts`：在 PATH 加 mock vendor 二进制，跑 `peaks vendor-detect`，验证推荐排序。
- `tests/integration/runtime/dispatch-detached-e2e.test.ts`：调 `peaks sub-agent dispatch rd --mode detached` + mock vendor，验证 dispatch record 字段 / heartbeat 数组 / CLI envelope 2.1.0 兼容。
- `tests/integration/runtime/cleanup-orphan.test.ts`：模拟 orphan 子进程（spawn detached sleep + 退出 peaks），再启 peaks 跑 cleanup。
- `tests/integration/runtime/lifecycle-closure.test.ts`：每个生命周期路径验证 **PID / log / status file / owner-session 100% 清理**（核心红线）。
- `tests/integration/runtime/auto-compact-flow.test.ts`：G8 集成。模拟子进程 LLM 写到 scratch 文件 + 写 compact 事件，验证 StatusProtocol 合并 + dispatch record.autoCompactEvents[] 字段正确 + 多次 compact 累积（≥ 5 次连续 compact 不破坏 dispatch record 完整性）。

#### Layer 3 · E2E（dogfood on peaks-loop 自己，CI 默认 skip）
- `tests/e2e/runtime/peaks-loop-selfdogfood.test.ts`：在 peaks-loop 自己的 src/ 上跑 1 个 rid（最小切片），用真实 vendor CLI（CI 设环境变量启用）。`describe.skip` 除非 `process.env.PEAKS_E2E_RUNTIME === 'true'`。

#### Layer 4 · 跨平台
- Windows 11（你机器）+ POSIX（GitHub Actions ubuntu-latest）+ macOS-latest 三平台跑 spawn-detached + vendor-detect + lifecycle-closure。
- 重点 case：Windows `DETACHED_PROCESS` 缺 → 子进程挂掉 / POSIX `setsid` 缺 → 子进程跟 orchestrator 一起退。

#### Layer 5 · 假绿防御（关键——5 个最近 sediment 都是反 fake-green）
- **silent catch audit**：所有 runtime 模块里 `try {} catch {}` 必须显式 log + 抛 ActionableError；空 catch = vitest fail。
- **ESM mock 反 fake-green**：`vi.hoisted` + `vi.mock` 模式（4.0.4 publish sediment 已固化）。
- **prompt 切片 grep guard**：单元测试有 1 case 是"必须不含某个 forbidden marker"；cross-check 不能被 .env / fixture 绕过，forbidden marker 用 `@@@ORCHESTRATOR_SESSION_HISTORY_BOUNDARY@@@`，build 阶段进 fixture，runtime 阶段绝不出现在 prompt 里。
- **dispatch record 漂移**：dispatch record 字段升级时，老 record 仍能跑（向后兼容）；新字段缺失时给明确 migration 路径。
- **CLI_VERSION lockstep**：runtime 子 package 跟 peaks-loop-shared 一样锁 peaks-loop 版本；publish 流水线复用 4.0.14 lockstep 模式（`gate-cli-version` step 复用）。
- **Lifecycle 闭环 audit**：每次子进程结束（无论成功 / crash），必须验证 PID 文件 / log.txt / status.json / owner-session 4 个文件全部不存在（or 已归档）；任何残留 = vitest fail。

### 5.2 效率基线测量（ship 门槛）

每个 Phase ship 之前**必须**跑下面 4 个基线测量，**任何一项未达基线不能 ship**：

| 指标 | 基线 | 测量方法 | 测量时机 |
|---|---|---|---|
| **orchestrator context 节省率** | ≥ 60% | 对比"老 in-process 跑 N=5 rid" vs "新 detached 跑同样 N=5 rid"，量 orchestrator context window 增量（KB） | 每个 Phase ship 前 |
| **并行 wall-time 缩短率** | ≥ 30%（N=5 rid 时） | N=5 rid 同时跑，从 dispatch 到全部 verdict 的 wall-clock | Phase A + B ship 前 |
| **token 成本节省率** | ≥ 20% | 量 peaks-cli 日志 + vendor CLI 日志里的 token 计费；orchestrator 不重复读子代理全文是关键 | Phase A ship 前 |
| **子代理输出质量不掉** | peaks-qa verdict 通过率 ≥ 老模式基线 | 同样 rid 跑两遍（in-process 一次 + detached 一次），对比 qa-test-cases 通过率 | Phase A ship 前 |

测量脚本位置：`benchmarks/runtime-detached/`（新目录，独立于 tests/），每次 ship 前跑一次，结果写 `.peaks/memory/2026-MM-DD-phase-X-baseline.md`。

### 5.3 性能护栏（机器不能跑爆）

| 护栏 | 阈值 | 测量方法 | 失败动作 |
|---|---|---|---|
| **peaks runtime 自身内存常驻** | ≤ 200MB（含 peaks daemon + dispatcher + 所有 adapter） | `process.memoryUsage().rss` idle 采样 | 超过 → 排查内存泄漏；不 ship |
| **peaks runtime 自身 CPU 常驻** | ≤ 5%（idle 时） | 1 分钟采样 `process.cpuUsage()` 平均 | 超过 → 排查轮询频率 / 心跳合并 bug |
| **单 fan-out 最大并发子代理数** | ≤ 8（开发机 16GB 内存基准） | peaks-rd / peaks-qa fan-out 时，子代理数 + 各自 RSS 总和 ≤ 80% 物理内存 | 超过 → 自动 throttle（排队 fan-out）|
| **子代理单进程内存上限** | 1.5GB（vendor CLI 默认 headless 模式）| PID 对应进程 RSS；超过 → kill + 全清资源 + prompt 切片过厚告警 | 失败 → 拆小 prompt |
| **磁盘写入速率** | status.json ≤ 1KB/30s；log file ≤ 10MB/rid（超出滚动）| 监控 status.json 写入频率 + log file 大小 | 超过 → status file 频率降至 60s；log 启用 rotate |
| **CPU 占用上限（fan-out 中）** | peaks runtime + 所有子代理 ≤ 75% 物理核心 | 10s 一次采样 | 超过 → 自动 defer 下批 fan-out |
| **orphan 子进程数上限** | ≤ 16（一次 session 残留）| LifecycleOwner 计数 | 超过 → 强制 cleanup orphan + 警告 |

**失败语义（红线）**：
- ✅ 任何护栏被触发 = 不 ship，不豁免。
- ✅ 用户可显式 `--no-throttle --max-concurrent 16`（默认 8）；用户承担风险。
- ✅ 效率基线 + 性能护栏一起跑，每个 Phase ship 前必跑。

### 5.4 验收门槛（slice ship 条件）

- ✅ unit ≥ 95%（避开既有 B1 coverage 工具天花板教训；用 self-hosted c8 + narrowed istanbul 模式）
- ✅ integration 100% 绿（含真 OS 进程）
- ✅ E2E 在 3 平台 × 1 真 vendor × 1 rid dogfood 跑通（手触发，不拦 CI）
- ✅ `peaks audit red-lines` 不新增红线违例
- ✅ `peaks doctor --json` 不报 critical
- ✅ 既有 106/106 + 119/52/0/0 audit 通过（worktree L2-extended 既有数据）

## 6. 迁移 / 发布

### 6.1 Monorepo 改造

1. 在 `packages/` 下加 `peaks-loop-internal-runtime/`（pnpm workspace 自动识别）。
2. `peaks-loop-shared` 现状不动；`peaks-loop-internal-runtime` 与 shared 平级。
3. `peaks-loop` 顶层 monorepo package.json 加 workspace dep：`"@peaks-loop/runtime": "workspace:*"`。
4. 既有 publish 流水线（`.github/workflows/publish.yml`）改：
   - 加 `peaks-loop-internal-runtime` 进 publish 列表。
   - 顺序：先发 runtime → 再发 shared → 再发 peaks-loop（避免 chicken-egg；4.0.14 lockstep sediment 已固化顺序）。
5. `gate-cli-version` step 扩到 3 package（peaks-loop / peaks-loop-shared / peaks-loop-internal-runtime）必须同版本号。

### 6.2 后向兼容

- `peaks sub-agent dispatch` 默认 mode = `in-process`（保持 100% 向后兼容；既有 106/106 test 不动）。
- `--mode detached` 是新 flag，opt-in。
- `peaks vendor-detect` / `peaks doctor invoke --from-code` 是新 CLI 顶层。
- dispatch record 新增 `mode` / `vendor` 字段；老 record 兼容（mode 缺省 = `in-process`）。

### 6.3 阶段 ship（避免一次性 big-bang）

- **Phase A**（detached mode + vendor adapter claude + G8 子进程无限上下文 + 不限费用）：核心 + claude adapter + AutoCompactAdapter，ship 后用户可 `--mode detached --vendor claude` 真用，子进程能跑任意长时间（auto-compact 续命 + 不限费用）。**G8 必须在 Phase A 一起 ship**，不能延期——无限上下文是核心承诺。
- **Phase B**（vendor adapter codex + copilot + peaks vendor-detect 全面）：加另外 2 个 adapter。
- **Phase C**（auditor fan-out）：peaks-rd / peaks-qa 的 reviewer 模板支持 `--mode detached`；不开新 CLI flag，跟既有 reviewer 模板无缝集成。
- **Phase D**（peaks-doctor bridge）：peaks-code Step 11 之前加 `peaks doctor invoke --from-code --json`，doctor 输出的 OpenSpec 提案落 `.peaks/_runtime/<sid>/doctor/proposal.md`。
- **Phase E**（dashboard detachedGraphView 容器）：dashboard 加 hook（空 div + 数据接口），后续 slice 填渲染。

每个 Phase 一次 publish（4.0.x → 4.0.x+1 → ...）；不在一次 publish 里 ship 全部 5 phase。

### 6.4 文档 / 知识沉淀

- `.peaks/memory/2026-MM-DD-runtime-detached-sub-agent-design.md`（design sediment，复制本 spec 摘要）
- `.peaks/memory/2026-MM-DD-vendor-adapter-registry.md`（vendor adapter 设计模式）
- `.peaks/memory/2026-MM-DD-peaks-doctor-bridge.md`（doctor ↔ code 跨 skill 协议）
- `.peaks/memory/2026-MM-DD-phase-X-baseline.md`（每个 Phase ship 前效率基线测量结果）
- `docs/superpowers/specs/2026-MM-DD-detached-sub-agent-design.md`（本 spec 自身）
- `docs/superpowers/specs/2026-MM-DD-detached-sub-agent-plan.md`（后续 writing-plans 出 plan）

### 6.5 红线交叉检查（re-listed from §4.1，迁移阶段也必须满足）

- ✅ **no Co-Authored-By trailer**（sub-agent prompt verbatim block 复用既有）
- ✅ **Human-NL-Choice-Only + Two-Forms-Only**（不引入新 CLI verb 给用户）
- ✅ **24h mode 是 flag 不是 sibling skill**（detached mode 不开 peaks-24h-detached）
- ✅ **peaks-loop enhancement-not-new-cli**（detached mode 是 peaks sub-agent dispatch 的 mode 扩展，不是新 CLI 工具）
- ✅ **worktree L1/L2/L3**（既有红线不动；sub-agent prompt 已有 verbatim "Do NOT commit / push" block）
- ✅ **Memory sediment Step 11**（每个 Phase ship 后必出 sediment）

## 7. 风险 / 副作用 / 缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| vendor CLI 升级改了 headless flag → adapter parse 失败 | 高 | 进度看不到；进程继续跑 | §5.1 Layer 1 adapter test ≥ 20 case 含输出漂移；§5.4 ship 门槛含 E2E 真 vendor dogfood |
| vendor CLI 拒绝 headless 模式（用户未订阅 / 限流） | 中 | dispatch record.status='spawn-failed' | spawn 失败走标准错误路径；vendor-detect 在 PATH 检测阶段就发现 |
| Windows `DETACHED_PROCESS` 跟 console session 耦合（用户登出后进程被杀） | 中 | G5 失效 | §5.1 Layer 4 跨平台验证登出场景；plan B 提供 wrapper 脚本（`cmd /c start /B`） |
| orchestrator 自己 context 仍然撑爆（detached 模式但状态文件太大） | 低 | G3 失效 | §3.1 status.json ≤ 1KB/30s；§5.3 磁盘写入速率护栏 |
| LifecycleOwner 回收有漏洞 → 子进程累积 | 低 | 机器死机（用户最怕的） | §3.2 LifecycleOwner 闭环 + §5.1 Layer 2 `lifecycle-closure.test.ts` 100% 路径覆盖 + §5.1 Layer 5 Lifecycle 闭环 audit |
| peaks-loop-shared 升级时 runtime 跟不上升 | 低 | lockstep 漂移（4.0.14 教训） | §6.1 publish 顺序 + `gate-cli-version` step 复用 |
| 用户机器 vendor CLI 版本太旧 | 中 | adapter 不兼容 | §5.1 Layer 1 detectInstalled 阶段报告 vendor 版本；不匹配 → vendor-detect 警告 |
| peaks-code SKILL.md 改写 5 处 → 漏改某处 | 中 | LLM 误用 in-process 模式 | §5.4 ship 门槛含 `peaks audit red-lines` 不新增违例 |

## 8. 实施顺序（给后续 writing-plans 参考）

1. **monorepo 骨架**：建 `packages/peaks-loop-internal-runtime/` + workspace dep。
2. **LifecycleOwner + ProcessSupervisor**（先闭环后功能）：先确保 spawn / detach / 闭环清理能跑通 mock vendor。
3. **VendorAdapterRegistry + claude adapter**：先 1 个 vendor 验证通路。
4. **PromptBuilder + StatusProtocol**：让子进程真能反馈进度。
5. **AutoCompactAdapter（G8 核心）**：在 prompt 注入 `<peaks-auto-compact>` 标记；scratch 文件协议；compact 事件合并到 dispatch record。**Phase A 必须一起 ship**。
6. **CLI 入口**：`peaks sub-agent dispatch --mode detached` 真能跑。
7. **Phase A dogfood**：peaks-loop 自己的 src/ 上跑 1 个 rid。
8. **vendor-detect CLI**。
9. **效率基线 + 性能护栏**：每个 Phase ship 前必跑。
10. **Phase B**：codex + copilot adapter。
11. **Phase C**：auditor fan-out 模板。
12. **Phase D**：peaks-doctor bridge。
13. **Phase E**：dashboard hook（空 div）。
14. **Memory sediment**：每个 Phase ship 后必出。