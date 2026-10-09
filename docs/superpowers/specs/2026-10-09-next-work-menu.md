# 后续可做的事 — 当前状态

> 本文件初版是 2026-10-09 早间的**待选菜单**。该菜单上的 N0a / N4 / N3 / N2c 当天已全部交付，
> 且调查过程中**推翻了菜单里的三处判断**。本文已改写为当前状态，不是原始菜单的存档。
> 原始菜单在 git 历史里（`2511ac63`）。

---

## 0 · 已交付（当天）

| 项 | 提交 | 结果 |
|---|---|---|
| 合并 + 推送 | `f0cc19c8` … `7032bab0` | 16 个提交落地；全量单测 **425 files / 4422 passed** |
| MCP 的 client 侧实测（N4） | 无代码 | 真 Claude Code 2.1.295 上 `✔ Connected`；随后卸载 |
| 命令层第二批（N3+N2a） | `6a1938a8` | 5 文件 → 37 模块；**mlpf 32→0**；`eslintFindings −61`、`eslintErrors −38`、`fileSizeExcessLines −2557` |
| `scripts/` 四文件（N2c） | `1e2d098a` | 16 新模块；census **153→149 文件 / 45904→43776 行**；`scripts` 桶 **4→0** |
| `peaks mcp uninstall` 假 `ok:true` | `7032bab0` | 不再把"从未给出裁决的 harness"报成"本来就没有" |

**累计 ceiling（gated）**：`eslintFindings` 2055→**1994** · `eslintErrors` 770→**732** ·
`fileSizeOverCap` 122→**117** · `fileSizeExcessLines` 35536→**32979**。

---

## 1 · 原始菜单里被**推翻**的三处判断（读这一节比读任何任务清单都值）

### 1.1 "N3 函数长度债没人看着" —— 错

`max-lines-per-function` 在 `eslintFindings`/`eslintErrors` 里，因为它在 `config/eslint/.peaks-rules.cjs`
里是 `'error'`，而门的 eslint 腿对每条非 phantom finding 都计数。

**更正后更锋利**：它**只在总量里被看着，没有按规则分列的 ceiling**，所以**可以被替换掉**
（这边减、那边增，净额为零）。命令层里这 231 条占该目录 findings 的 **43.4%**、errors 的 **78.3%**。

### 1.2 "N2c 是还债" —— 半错

`scripts/**` 与 `tests/**` 属 `shadow.scopeDirs`，`gate/legs.mjs` 只 check `partition.gated`。
**拆它们不移动任何一个 ceiling**——实测 `117 / 32979` 前后一字未动。`scripts/` 连 lint scope
都不在。它们是被 owner（2026-10-03）**刻意**排除在 ceiling 之外的。

真正被搬动的是 **census 与 shadow 块**。所以对这两个目录，诚实的成功口径是 census 的下降，不是 ceiling。

### 1.3 "W5：`gate enforce` 对所有非 Bash 工具 fail-open 是个洞" —— 不成立

```ts
if (handleMcpSurfaceGate(io, parsedStdin)) return;   // MCP 分支：最先、fail-CLOSED
if (surface.bashCommand === null && !surface.isWorktreeToolSurface) {
  emitAllowSkipped(io, options);   // Write / Edit / 第三方 MCP 从这里出去
  return;
}
const decision = await enforceBashCommand(options.project, surface.bashCommand);
```

观察是对的，**推论是错的**：

1. `enforceBashCommand` 收的是一个 **shell 命令字符串**。一次 `Write` 调用没有命令字符串可评 ——
   这一腿**在构造上就是 Bash 门**，不是"忘了管 Write"，而是**没有可评的东西**。
2. worktree 那一腿是**刻意的 tool opt-in**（注释明写）。
3. **MCP 那条 fail-closed 分支被刻意放在最前面**，注释还解释了原因：*"an MCP tool name matches
   neither the Bash matcher nor a worktree tool, so everything after this point would wave it through"*
   —— 仓库自己知道这个形状，并且已经对它做了正确的事。

**结论**：这不是待修的洞，是**范围问题**（peaks-loop 该不该管 `Write`/`Edit`）。那是产品设计题，
且一开头就要面对门里那条 Trust red line —— *"must FAIL-OPEN, never block the user's Claude Code"*。
经用户决定：**不做**。

### 1.4 另有一处我写错、已删的记录

我曾断言 *"PATH 上的 `claude` 是坏 shim（与 `npm.exe` 同 inode），所以挂死"*。
**inode/sha 的测量没错，行为结论错了**：它现在 0.37 s 答 `--version`。
症状当时是真的（30 s 超时实测两次），**机制我没搞对，且现已不可复现**。据此写的 memory 已删除。
`peaks mcp uninstall` 的缺陷与此无关——它是**代码层面**就错，不依赖撞上什么。

---

## 2 · 还剩什么

### 2.1 还债（**只有 `src/**` 值得做**，其余是 shadow）

| 目标 | 规模 | 备注 |
|---|---|---|
| `src/cli/commands` 剩余 | **35 文件 / 8124 超出行** | 已拆 10 个；仍在棘轮管辖内 |
| `src/services/*` 顶部 | `hooks-settings-service.ts` 737 · `auto-compact-orchestrator.ts` 730 · `config-service.ts` 711 | 同上 |

配方已被两批验证过：**拆分与压函数必须在同一次交付里完成**（第一批的 pass-1 曾把
`eslintFindings`/`eslintErrors` **推高** +23/+19，被拒后 pass-2 才压到 0）。

### 2.2 未验证边界（仍影响"能不能声称完成"）

| | 项 |
|---|---|
| N5 | CI `format-check` job **从未在 runner 上实跑** |
| N6 | C 层沙箱（无网络只读挂载）**从未实跑** |
| N7 | L3 端到端（PATH 上是已安装构建而非工作树） |
| N8 | S1 政策例外只在纯函数层被测；**"允许涨" ≠ "已经涨过"** |

### 2.3 工具缺陷（小、高复用）

- **N9** `peaks audit goal` 输出在约 **3.6 KB** 处截断（两次 `INCOMPLETE_AUDIT: Unterminated`）
- **N10** `peaks` 的 `.cmd` shim **吃不下含换行的参数**（`InvalidBatchScriptArg`）

### 2.4 站立的小观察

- **`.husky/pre-push` 的注释与现实相反**：它说 leg 2 是全量、936 s、"known, measured gap"；
  实测 **62 s / 601 tests**（`scripts/test-changed.mjs:186` 已把 `gate-baseline.json` 列为
  `fullFallbackExempt`，只改基线跑 **0 个测试**）。留下这句的提交 `c1c99c03` 标题正是
  *"make pre-push cheap"*。
- `tests/**` 的 comment-hygiene **不被任何门监视**（门的 `scope.dirs` 只含 `src` + `packages/*/src`）
- `git stash pop` 被 worktree gate 拦而 `stash drop` 不拦
- 本机/任何**非提权** Windows 机器，pre-push 常红（Developer Mode 关闭 → 建不了文件 symlink →
  6 条断言假设链接的测试失败；CI 的 windows runner 是提权的，故 CI 本就绿）

---

## 3 · 一条方法学（这一天里出现两次）

**门的 census 用 `git ls-files`。** 新模块在入索引前**门的任何一条腿都看不见它们**——
`peaks-gate.mjs repo` 会报 *"all ceilings held"* 却**一个都没数到**。
**先 `git add`，再量。** 第二次出现时是 RD 自己先指出来的。
