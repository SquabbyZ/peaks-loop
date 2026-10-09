---
name: mcp-e2e-verified-by-official-schema-not-by-sdk
description: 手写 MCP server 可用 @modelcontextprotocol/core 的官方 schema 校验响应来证明规范符合性；本机 claude launcher 无法非交互执行，故真实注册不可验证
metadata:
  type: lesson
  createdAt: 2026-10-09
---

# MCP server 的端到端验证：用官方 schema，而不是等 SDK

## 背景

slice ②③ 交付了一个**手写**的 MCP stdio server（不新增依赖，自己实现 `initialize`/`tools/list`/`tools/call`）。
它留下的未验证项是：**"协议面到底对不对"**——测试通过只证明"按我们的理解对了"。

## 手法（可复用）

**仓库里没有官方 MCP client，但有官方 schema。** `@upstash/context7-mcp` 带来传递依赖
`@modelcontextprotocol/core@2.0.0`，它导出的是**纯 schema**（无 `Client` 类）：

```
InitializeResultSchema · ListToolsResultSchema · CallToolResultSchema · JSONRPCErrorResponseSchema
```

于是：**拿真实往返的每个响应去喂官方 schema 的 `safeParse`**，五项全过：

```
✓ initialize result      ✓ tools/list result      ✓ tools/call result(ok)
✓ tools/call result(mem) ✓ JSONRPC error response
```

**这比"我们的测试通过"强一档**：它证明的是**符合规范定义**，而不是"符合我们的理解"。
对手写而未用 SDK 的实现，这是能拿到的最强证据之一。

> 注意：`core` 只有 schema；`@modelcontextprotocol/{server,node}` 是 server 侧。
> 仓库里**没有** client 实现。

## 本机硬边界：`claude` launcher 无法非交互执行

`peaks mcp install` 会 spawn `claude mcp add …`。而本机实测：

```
claude --version              → timeout 20s, exit 143
claude mcp list               → 同上
claude --version < /dev/null  → 同上（不是等 stdin）
（关沙箱再跑一次）              → 同上（不是沙箱）
```

`claude` 是**真 PE 可执行文件**（`MZ` 头，`AppData/Local/Author Software/nvm/.nodejs/claude`），
**连 `--version` 都不返回**。

**推论**：`peaks mcp install` 在此机器上必然失败——30 秒后按 slice ③ 新加的超时被杀。
**失败原因是被调用的 harness CLI，不是我们的代码。**

> 纠正一条曾出现过的错误归因：slice ③ RD 说"Windows 上 `claude` 是 `.cmd` shim、`spawnSync` 起不动"。
> **既不是 `.cmd`，也不是"起不动"，而是"能启动、但永远不返回"。** 它把 spec §13 里**关于 `peaks` 自己**的那一行推广到了 `claude` 上。

## 另一条实测观察（低 severity，记录备查）

`peaks_status` 的**输出形状随参数静默变化**：schema 里 `required: []`，`rid`/`role` 可选；
不给则 `request-show` **整条键消失**（2 键 / 795 B），给了才出现（3 键 / 18 KB）。

**不是吞错**（该 argv 根本没跑），但**调用方无法区分**「因未给 rid 而跳过」与「跑了但无结果」。
`peaks-status` skill 不受影响（其 Step 1b 写死 rid/role）。

## How to apply

- 验**手写协议实现**时，优先找**官方 schema/参考实现**做符合性校验，而不是只跑自己的测试。
- 拿传递依赖里的官方包做**验证**是可行的；但若要**长期**依赖它，需评估是否提升为显式 devDependency（仓库很瘦，别偷偷加）。
- 报"端到端已验证"时，**说清验到了哪一跳**。本例：server 侧已闭合，**client 侧那一跳仍未验**。
