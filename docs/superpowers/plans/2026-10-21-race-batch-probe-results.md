# Race batch mode — probe results (2026-10-21)

> 实测记录。两个 probe 的答案**改变了 Task 3 的写法**，因此在此逐字保留复算命令与原始输出。
> 关联：spec `docs/superpowers/specs/2026-10-21-peaks-race-batch-mode-design.md` §4.1 / §7A.3
> 计划：`docs/superpowers/plans/2026-10-21-peaks-race-batch-mode.md`

---

## Probe A: race presence 下，Task 子代理能否改 `src/`？

**结论：A-1 —— 放行。** 子代理与父会话**共享同一个 caller id**，因此租约解析成立。

### 复算方法

派发一个 Task 子代理，让它报告自己的身份，再与租约 owner 比对。

### 原始输出（子代理回报）

```
$ node -e "console.log(JSON.stringify({session_id: process.env.CLAUDE_CODE_SESSION_ID, outer: process.env.PEAKS_OUTER_SESSION_ID}))"
{"session_id":"1e867f27-09a2-473b-a4e0-39f36fead20b"}

$ node node_modules/tsx/dist/cli.mjs src/cli/index.ts skill presence --json
{
  "ok": true, "command": "skill.presence",
  "data": {
    "active": true, "skill": "peaks-code", "mode": "24h",
    "sessionId": "2026-10-20-session-f7f45b",
    "outerSessionId": "1e867f27-09a2-473b-a4e0-39f36fead20b",
    ...
  }
}
```

租约文件（当前 session）：

```
.peaks/_runtime/2026-10-20-session-f7f45b/leases/
  presence-1e867f27-09a2-473b-a4e0-39f36fead20b-wf-1e867f27-...-compat.json
  { "callerId": "1e867f27-09a2-473b-a4e0-39f36fead20b",
    "skill": "peaks-code", "status": "preparing", ... }
```

### 三方比对

| 身份 | 值 | 相同？ |
|---|---|---|
| 父会话 `outerSessionId` | `1e867f27-09a2-473b-a4e0-39f36fead20b` | — |
| 子代理 `CLAUDE_CODE_SESSION_ID` | `1e867f27-09a2-473b-a4e0-39f36fead20b` | ✅ **与父会话相同** |
| 租约 `callerId` | `1e867f27-09a2-473b-a4e0-39f36fead20b` | ✅ **与父会话相同** |

### 推论链（每一步都可核对）

1. 子代理的 caller id **等于**租约 owner ⇒ `hasLeaseForCaller` 返回 **true**
   （`src/services/audit/enforcers/active-skill-resolver.ts:234`）
2. ⇒ `resolveActiveSkillForCaller(projectRoot, {callerId})` 解析出**租约里的 skill**
   （同文件 `:68`）
3. ⇒ `decideGateAction(tool, input, driver)` 的 driver 是**租约里的 skill**
   （`src/services/hooks/pre-tool-code-gate.ts:127`）
4. ⇒ 若租约的 skill 是 `peaks-race-code`，则 `src/` **放行**

### 之前推理错在哪

我先前读代码得到的是「子代理的 caller id ≠ 租约所有者 ⇒ deny」。**错在假设子代理有独立的 session id** —— 实测它**继承父会话的 `CLAUDE_CODE_SESSION_ID`**。所以身份链是通的。

### 对 Task 3 的影响

**Task 3 走分支 A-1（修复派子代理）。** 前提：批量模式开始前把 presence 租约的 skill 设为 `peaks-race-code`
（`peaks skill presence:set peaks-race-code --project . --mode <mode> --gate <gate>`）。

### ⚠️ 一个必须同时记住的事实

**本仓库没有装 `peaks code-gate` 这个 hook entry。** 实际装的是三个（`.claude/settings.local.json`）：

```json
{ "matcher": "Bash",       "command": "peaks code gate-step-08 --project \"${CLAUDE_PROJECT_DIR}\"" }
{ "matcher": "Bash",       "command": "peaks gate enforce --project \"${CLAUDE_PROJECT_DIR}\" --json" }
{ "matcher": "Bash|Task",  "command": "peaks code auto-compact --project ." }
```

`code-gate`（`Edit|Write|MultiEdit` 那个）在 **settings.json / settings.local.json / 用户级 settings.json 三处都搜不到**。

⇒ **本次 probe 测的是「身份解析」，不是「装好的拒绝」** —— 因为这个仓库根本没装那道闸。
⇒ 若下游项目装了 `peaks hooks install`，`code-gate` entry 会出现，**A-1 的放行路径才会真正生效**。
⇒ 这条要在 Task 3 的验收里补一句：**在装了 code-gate 的项目里复跑一次 A-1**。

---

## Probe B: 压缩会不会打断在飞的诊断 fan-out？

**结论：B-2 —— 探针有盲区，而且比设计文档写的更严重：D6.e 的 deferral 在 production 路径上是死代码。**

### 复算方法

读 `evaluateAutoCompactDecision` 的 `inFlightBatch` 来源。

### 原始输出（代码事实）

`src/cli/commands/code-auto-compact-command.ts:73-86` —— **唯一的 production 调用点**：

```ts
probeInflightBatch: () => {
  // ... The empty `graphs` array is the production CLI default ...
  const out = probeInFlightBatch({ now: new Date().toISOString(), graphs: [] });
  return out.inFlightBatch === true;
}
```

`src/services/workflow/workflow-inflight-probe.ts:79` —— 探针只遍历传入的图：

```ts
for (const graph of input.graphs) {
  ...
  for (const node of graph.nodes) {
    if (node.status !== 'running') continue;
    ...
    if (age < FRESH_RUNNING_THRESHOLD_MS) inFlight = true;
  }
}
```

`graphs: []` ⇒ 循环体一次都不执行 ⇒ `inFlightBatch` **恒为 false**。

### 三步推论

1. production CLI 恒传 `graphs: []` ⇒ 探针恒返回 `inFlightBatch: false`
2. `evaluateAutoCompactDecision` 的 deferral 分支要求 `probe?.hasInFlightBatch === true`
   （`src/services/code/auto-compact-decision.ts:156`）⇒ **该分支在 production 不可达**
3. ⇒ **任何压缩都不会因为「有子代理在飞」而推迟**

### 比设计文档 §7A.3 缺口 1 更严重

设计文档写的是「探针看不见诊断 fan-out ⇒ 判定走『无在飞批次』分支 ⇒ 压缩照常触发」。**实测确认了这一点，且更进一步：那不是"探针的盲区"，是 deferral 机制在 production 整体不生效。**

D6.e（"有在飞批次时推迟压缩"）只在**测试 seam**（`PEAKS_TEST_SEAM === '1'` + `--in-flight-batch`）下可达。production 走的是另一条路。

### 触发频率被 hook 放大

`auto-compact` 的 hook matcher 是 **`Bash|Task`** ⇒ **每一次 Task 派发都会跑一次 auto-compact 探针**。
批量模式下阶段①要派发 N 个诊断 agent ⇒ **N 次探针**，每次都在同一窗口上量同一个 ratio。

而 24h / partial 模式的 auto-fire 阈值是 **0.70**（比标准模式的 0.80 更低）⇒ 在长跑里更容易在 fan-out 中途触发。

### 对 Task 3 / Task 6 的影响

| 影响 | 内容 |
|---|---|
| **Task 6 从"锦上添花"变成"硬前置"** | `progress.json` 的 `phase` 字段是**唯一**能告诉系统"现在有批次在飞"的信号 —— 探针给不了 |
| **压缩点必须是阶段边界** | 因为中途压缩**不会**被自动推迟 |
| **Task 2 的验收必须包含** | 阶段①进行中触发一次压缩，**断言诊断 agent 没被打断**（否则压缩就是打断） |

### 修复方向（本 spec 范围外，单独记）

`code-auto-compact-command.ts:84` 的 `graphs: []` 让 D6.e 失效。修它需要 production 调用点真正加载工作流图（`graphs/<wid>.json`），
那是 `auto-compact-command.ts` 的一个**独立缺陷**，不属于本 spec 的范围。⇒ 记入 backlog，**不在本 slice 里顺手修**。

---

## 两个 probe 对计划的影响汇总

| 计划位置 | 原写法 | probe 后 |
|---|---|---|
| Task 0 Step 3 / Step 6 | 跑两个 probe | ✅ **已完成**（本文档） |
| Task 3 Step 5 / Step 6 | 两个分支待定 | **只走分支 A-1**（A-1 已确认） |
| Task 6 | "无论 B 的结论如何都要做" | ✅ **确认硬前置** —— B-2 证明只有它能提供 in-flight 信号 |
| Task 2 | 加一条验收 | **加一条**：阶段①中途压缩，断言 agent 未被打断 |
| Task 3 验收 | — | **加一条**：在**装了 code-gate 的项目**里复跑 A-1（本仓库没装那道闸） |
| 新增（不在本 spec） | — | `code-auto-compact-command.ts:84` 的 `graphs: []` 使 D6.e 失效 ⇒ 记 backlog |
