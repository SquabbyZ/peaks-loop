# 交接 — 4.1.3 发布收尾

- 日期：2026-10-10
- 分支：`main`（**已全部推送**，`origin/main...main = 0 0`）
- 上一个会话：`2026-10-09-session-90f47d`
- 状态：**4.1.3 已发布并在注册表上**；`main` 的 CI 已全绿

---

## 0. 起点：一条命令确认现状

```bash
git log --oneline -1 origin/main
git rev-list --left-right --count origin/main...main   # 期望 0 0
node .husky/peaks-gate.mjs repo                        # 期望 all whole-repo ceilings held
```

`peaks-loop@4.1.3` 已在 npm（`dist-tags.latest`），本机全局亦为 4.1.3。

---

## 1. 这一轮交付了什么

| 内容 | 提交 |
|---|---|
| 只读 MCP 能力面（`peaks mcp serve\|install\|uninstall`）+ 只读 argv 白名单证明 | `46463f85`、`fdf7807f` |
| 门禁加固（两条不会失败的门改成会失败）+ 尺寸棘轮的第一个联合判定例外 | `23fb500d`、`b3f4f795` |
| 尺寸债三批：命令层 10 文件 + `scripts/` 4 文件 | `c88e38dc`、`6a1938a8`、`1e2d098a` |
| `npx` 解析器差一级目录（静默回退到它专门要绕开的 shim） | `f0cc19c8` |
| `peaks mcp uninstall` 把"从未给出裁决的 harness"报成"本来就没有" | `7032bab0` |
| 文档与事实对齐（含推翻自己的三处判断） | `69a5f068`、`0c5fe123` |
| **4.1.3 发版**（含 `CLI_VERSION`/`RUNTIME_VERSION` 同步、CHANGELOG、tag） | `9ff721e9`、`65be0f63` |
| 两条 CI 红灯：C 层沙箱 job、integration 过时断言 | `ed5f96eb`、`db66ec83` |

**gated ceiling 全程下降，无一上升**：`eslintFindings 2055→1951`、`eslintErrors 770→709`、
`fileSizeOverCap 122→112`、`fileSizeExcessLines 35536→30352`。

---

## 2. 剩余事项（**按"会不会坑到你"排序**）

### 2.1 `test:changed` 的子集分类会漏掉一致性守卫 ← **最有价值的一条**

**证据**：推送 `6a1938a8`（命令层拆分 + 基线重生成）时，pre-push 只跑了 **71 files / 601 tests**——
`tests/unit/standards/**` 不在其中，所以钉"每个 gated 文件都必须有 `files[]` 行"的那两条守卫
**没有运行**。下一次推送改了 `.husky/`、触发全量，它们立刻变红：

```
in-scope file(s) with no files[] row in gate-baseline.json:
  src/services/distribution/mcp-install-runner.ts
```

**即：一个"新增了 gated 文件但忘了跑基线生成器"的改动，可以通过推送门。**

**为什么还没修**：这是一处**设计张力**，不是一处疏漏。`scripts/test-changed.mjs:186` 的
`fullFallbackExempt` 是**刻意**把 `gate-baseline.json` 排除在"触发全量"之外，为的是让推送便宜
（那条代码的上下文注释解释了原因）。要修就得先决定：**哪些改动必须强制跑一致性守卫**。
建议方向：当 diff **新增 gated 文件**（而非仅重生成基线）时，把 `tests/unit/standards/**` 纳入。

### 2.2 驾驶者解析不可靠，且提交闸在解析失败时**整个跳过** ← **P1**

**证据（三处，均已核对源码）**：

- `src/services/skills/presence-lease-service.ts:496-513` —— `listPresenceLeases` 按 `readdirSync(dir)` 的**原始顺序**返回，**不排序**。
- `src/services/audit/enforcers/active-skill-resolver.ts:116-130` —— 取遍历中**第一个**合格 lease；`callerId` 过滤是**可选**的（`typeof opts?.callerId === 'string'`）。
- `src/cli/commands/hook-handle.ts:131` —— `resolveActiveSkillForCaller(projectRoot)`，**没传 `callerId`**。

⇒ **驾驶者是"跨该 session 目录下所有 caller、按目录顺序"解析出来的。** 而**同一个问题在仓库里已经有第二个、相反的答案**：`src/services/skills/skill-presence-service.ts:198` 用
`inFlight.sort((a, b) => b.lastHeartbeat.localeCompare(a.lastHeartbeat))` 取 `[0]`（这条支撑 statusline 与 `requireUserConfirmation`）。**两个答案可以不一致。**

**更重的一处** —— `hook-handle.ts:132`：

```ts
if (activeSkill.skill !== null) {   // ← 解析不出来，整个提交闸被跳过
```

`resolveActiveSkillForCaller` 在**未绑定 session**、**session 目录缺失**、**session id 不安全**时都返回 `{skill: null, …, source: 'none'}`（`active-skill-resolver.ts:79-84` / `:104-109`）。即**提交闸今天在身份不明时是 fail-OPEN**：它拦不住任何一次解析失败。

**第三处** —— `skill-presence-service.ts:701-721` 的 `touchSkillHeartbeat` 只改**内存里**的 `presence.lastHeartbeat` 就返回，注释自述 "the legacy `active-skill.json` file is no longer touched"。**若无人周期调用 `setPresenceLease`，盘上的 `lastHeartbeat` 永不刷新**——盘上真实样本 `presence-7ee97fe3-…-compat.json` 即 `lastHeartbeat === startedAt`、`status: "preparing"`。于是 `:198` 那句"按心跳取最新"实际退化成"按 `startedAt` 取最新"。

**后果**：`peaks-*` skill 的 commit ban（"必须走 `peaks request transition`，不得直接 `git commit`"）**依赖一个可能解析错、且解析失败时不生效的信号**。两种错法都成立：① 解析到**别的** caller 的 skill ⇒ 该拦的没拦 / 不该拦的拦了；② 解析失败 ⇒ 闸**整个不跑**。

**为什么现在被注意到**：`peaks-race-code` 的设计要在这同一个信号上做"泳道答案 + 驾驶者"的合取放行（`docs/superpowers/specs/2026-10-10-peaks-race-code-design.md` §8.2 / §12 U11），**必须先修好它**。但这个 bug **独立存在、与 race-code 无关**——对抗评审的原话：*"Fix the driver resolution first, independently of this design. That is a real bug today, in the commit ban, with nothing to do with race-code."*

**未验证**：`peaks code-gate` 的 hook 子进程**是否可靠拿到** `resolveCallerProjection` 所需的调用方身份——评审明说它**没能核实**这一点。这决定下面选哪条修法（race-code spec §12 U4 也记着这条）。

**修法有三个候选，不是一回事**：

| | 做法 | 代价 / 前提 |
|---|---|---|
| (a) | 传 `callerId`，把解析限定到调用方自己的 harness session | **前提是 hook 子进程拿得到那个身份**（上一条未验证） |
| (b) | 让 resolver 按 `lastHeartbeat` 排序，与 `:198` 对齐 | 只保证"两个答案一致"，**不保证"答案是调用方的"**；且因 (c)，实际是"按 `startedAt` 取最新" |
| (c) | 先把 `touchSkillHeartbeat` 的死写修活 | **(b) 的前提**——否则"最新心跳"没有意义 |

**三者的先后与取舍本身是一个设计决定**，不是一行修复。故 S0 有自己的简短设计 + 计划，见 `docs/superpowers/plans/`。
### 2.3 提交闸在 Claude Code 上**从不运行**，在 cursor/codex 上**deny 会被吞掉**

2026-10-10 的 S0（分支 `fix/s0-driver-resolution`）里核实的两件事，都属"门看起来在、其实不在"：

**(a) 只有一个调用点，只覆盖三个适配器。**
`evaluateCodeBan` 在 `src/` 里**唯一**的调用点是 `hook-handle.ts`（即 `peaks hook handle`）。而 `HOOK_COMMAND_BY_IDE`（`src/services/skills/hooks-codegate-superpowers.ts:94-105`）把 entry 分成两组：

| 适配器 | hook 命令 | 提交闸 |
|---|---|---|
| claude-code / hermes / openclaw | `peaks gate enforce` | **无**（`gate-commands.ts` 里 ban/commit 零引用） |
| trae / cursor / codex | `peaks hook handle` | 有 |

⇒ **你在用的 Claude Code 上，Code Commit Ban 这条红线从不执行。**

**(b) 即使在那三个适配器上，cursor 与 codex 的 deny 也到不了宿主。**
`formatDecisionResponse`（`src/services/ide/hook-protocol.ts:66-74`）对除 `claude-code` 与 `trae` 之外的 IDE **抛异常**；`hook-handle.ts` 在 `emitDecision` 之前调用它，且整个 action 包在 `try` 里，于是异常落到 "internal error, allowing command" 这条 fail-open 分支。

⇒ **实际生效的只有 trae 一个适配器**；cursor/codex 上该闸、以及既存的 SOP 闸与根污染闸，deny 全被转成 allow。

**S0 已做的事**：修了这条闸依赖的"谁在开车"（作用域化 + 排序对齐），并按用户裁决**不**把闸接进 `gate enforce`（那是改变 Claude Code 既有行为的独立决定）。**未做**：cursor/codex 的格式化缺陷、以及把闸接进 Claude Code。

**(c) 附带一条残留**：两条路径都**不查租约年龄上界**（`gcStalePresenceLeases` 存在但未被咨询）。一个永不 terminalize 的 `status: "preparing"` 租约，可以在该项目 session 内**持续**拦下每一次 `git commit`。修它要先定阈值——S0 有意留给单独立项。
### 2.4 `tests/integration/**` 不在默认 vitest 配置里

`vitest.config.ts` 的 exclude 含 `tests/integration/**`，它由 `vitest.config.integration.ts` 单独跑。

**后果**：两条 CI 红灯（C 层沙箱、integration 过时断言）**同时**躲过了：本机全量单测
（4431 条）、pre-push 门、以及 **4.1.3 的整个发布流程**。它们在 CI 上红着，而本地永远绿。

**注意**：这**大概率是刻意的**（集成测试慢）。不要顺手改配置——先决定"本地/推送时该不该跑它"。

### 2.5 `git push origin <tag>` 单独推，**永远**过不了本仓的 pre-push 门

**证据**（4.1.3 发布时实测两次）：
```
peaks-gate: origin/main resolves to HEAD (…), so the changed set is empty by construction.
REFUSING to report that as a pass: "nothing to compare" and "compared and clean" are
different results, and only one of them is evidence.
```

**这句话本身是对的**（空变更集不许报成功，是本轮加固的成果），但它与"发布靠推 tag"**结构冲突**：
发布提交早在推 `main` 时就被门验过，而推 tag 永远没有新提交可比。

**所以每一次发布都必须靠一次 `--no-verify`** —— 恰好是本仓钩子注释里警告过的那个形状
（*"a gate people skip is worse than no gate"*）。本仓历史用的是一次推两个 ref
（`git push origin main vX.Y.Z`），那样变更集非空。**修它要动 `.husky/pre-push`，属门机器，须单独立项。**

### 2.6 还债（只有 `src/**` 会动棘轮）

| 目标 | 规模 |
|---|---|
| `src/services/skills/hooks-settings-service.ts` | 超出 **737** |
| `src/services/code/auto-compact-orchestrator.ts` | 超出 **730** |
| `src/services/config/config-service.ts` | 超出 **711** |
| `src/cli/commands` 剩余 | **35 文件 / 8124 超出行** |

**配方已三批验证**：拆分与压函数**必须在同一次交付里完成**（第一批只拆 → `eslintFindings` **+23**；
第二、三批一次做完 → **−61 / −43**）。差别在顺序，不在用心。

**⚠️ `scripts/**` 与 `tests/**` 是 shadow 人口，不受任何 file-size ceiling 约束**（拆它们不移动任何 ceiling——
实测前后均 `117 / 32979`）。只做 `src/**`。

### 2.7 已关闭 / 仍开着的"未验证边界"

- ✅ **C 层沙箱**——不再是欠账：`ed5f96eb` 之后它在 CI 上**真的运行并通过**，且两条注入对照
  （去掉 `unshare -n` / 去掉 `setpriv`）各自证明了臂会红。**注意它此前从未真正执行过**。
- ✅ **MCP 的 client 侧那一跳**——真 Claude Code 2.1.295 上实测 `✔ Connected`。
- ✅ **本地 integration 套件的读数现在可信了**。`workspace-init-home-guard` 的 `envelopeOf` 原先
  把 stderr 拼在 stdout 后面再 `JSON.parse`，于是 **`node:sqlite` 每次调用必打的
  `ExperimentalWarning` 会把它撑爆**——**在本地 Node 24 上该文件是红的，而 CI（Node 22）是绿的**。
  已改成只解析 `result.stdout`（先分别捕获两条流、确认信封在 stdout 上，再收窄）。
  **在你见到这份文档之前，任何"本地 integration 有红"的判断都可能是这个助手的假象。**
  同一构造在其它文件里**只有变形**（有的更健壮、有的只在 stderr 含 `}` 时脆），本 slice 未动。
- ⬜ **`format:check` job 在 runner 上实跑**（CI 里绿，但需确认它真的评了东西）。
- ⬜ **L3 端到端**（PATH 上是已安装构建而非工作树）。
- ⬜ **S1 政策例外的端到端触发**（机制只在纯函数层被测；"允许涨" ≠ "已经涨过"）。

### 2.8 `peaks-reviewer` 是半成品：**跳过被报成通过** ← **同一类 "pass-shaped output"**

**现状**：`peaks reviewer status` → `{configured: false, reason: "no-reviewer-config"}`。`~/.peaks/config.json`
里**没有 `reviewer` 段**（只有 `version` / `currentWorkspace` / `workspaces` / `language` / `economyMode` /
`swarmMode` / `tokens` / `proxy`）。

**根因是刻意的，而且拒得对**（`src/services/reviewer/reviewer-config.ts:77`）：

```ts
if (!Array.isArray(providersRaw) || providersRaw.length < 2) {
  // A4.1 explicitly requires >=2 providers; with <2 we treat the
  // section as absent so the reviewer is skipped cleanly.
  return { ok: false, reason: 'no-reviewer-config' };
}
```

要求 **≥2 个 provider 族**，否则整段当作不存在。**它拒绝假绿，而不是产出假绿**——这个判断是对的。

**但跳过路径的形状是错的**（`src/services/reviewer/reviewer-service.ts` 的 `skippedEnvelope`）：

```ts
function skippedEnvelope(reason: string): ReviewerEnvelope {
  return { reviewerId: REVIEWER_ID, modelId: 'skipped', modelFamily: 'skipped',
           passed: true, violations: [], gateAction: 'allow', reason };
}
```

**一次"根本没做评审"被报成 `passed: true` + `gateAction: 'allow'`。** 任何读 `passed` / `gateAction`
的下游看到的都是绿；只有去读 `reason` 字符串才知道那是跳过。这与 §3.4 记的教训是**同一类**。

**这台机器上够不着第二个族**：`ollama` 未安装（PATH 无该二进制、`:11434` 无响应），`openai` 无凭据；
本次（`peaks audit goal`）实测 `providerBinding: anthropic-messages-api`、`model: deepseek-flash[1M]`
——即唯一的族是 deepseek。

**"没做全"具体是四项**：

1. `src/cli/commands/reviewer-commands.ts` 只注册了 `run`（:35）与 `status`（:81）——**没有 `reviewer config`
   子命令**。配置只能手写 `~/.peaks/config.json`，或走 `peaks config set --key reviewer.providers --value '<json>'
   --layer user`（**此路未经实测**）。若只有前者，则违反 Human-NL-Choice-Only（用户不得手写 JSON）。
2. `status` 把"完全没配"与"只配了一个族"报成**同一个** `no-reviewer-config`——`≥2` 这个要求**从工具里
   discover 不到**。且 `nextActions: []`，是个没有出路的死胡同（本仓其它 peaks 命令都会给 nextActions）。
3. 跳过与通过形状相同（见上）。
4. **零专用测试**。`grep -rl "reviewer-service\|reviewer-config\|peaks reviewer" tests/` 只命中
   `tests/integration/workflow-eval-commands-e2e.test.ts`，而那是个**名字碰撞**（"independent-security-perf-audit"）。

**后果**：anti-fake-green G4 **事实上不存在**，而没有任何东西在需要它的那一刻说出来。
`peaks-race-code` 的设计（`docs/superpowers/specs/2026-10-10-peaks-race-code-design.md` U9）已把这一条
如实记为"独立模型审计未达成"，没有拿 fresh-context 子代理冒充独立模型。

**做全的最小集**：① 给 `reviewer config` 一个 CLI 面；② 跳过不得报 `passed: true`；③ `status` 区分三态并把
`≥2` 要求写进 `nextActions`；④ 补测试。

### 2.9 工具缺陷（小、高复用）

- `peaks audit goal` 输出在约 **3.6 KB** 处截断（两次 `INCOMPLETE_AUDIT: Unterminated`）
- `peaks` 的 `.cmd` shim **吃不下含换行的参数**（`InvalidBatchScriptArg`）

---

## 3. 这一轮的教训（**别再踩**）

### 3.1 `git ls-files` 陷阱 —— 一天之内造成**三次**具体而错误的结论

门的 census 读 `git ls-files`。**未 `git add` 的新文件对门的每一条腿都不可见**：
`peaks-gate.mjs repo` 会报 *"all ceilings held"* 却一个都没数到；基线生成器会报
*"only `generatedAt` changed"* —— 那是一句由"文件未被跟踪"制造出来的**假话**。

**先 `git add -A`，再跑门与生成器。** 拿到"看起来什么都没变"的结果时，**先查文件是否被跟踪**。

### 3.2 两次 CI 误诊，纠正我的是日志而不是推理

- 我说 *"C 层失败是因为 root 绕过 chmod"* → **根本没走到那里**（corepack 先死）。
- 我说 *"integration 失败是 `workspace-init-home-guard`"* → **CI 上是另一条测试**。

**教训**：本地复现到的失败 **不等于** CI 上的失败。**先拿日志**。而 GitHub 的 job 日志
**需要登录**（API 的 `/logs` 403、网页显示 "Sign in to view logs"）。

### 3.3 两个 RD 并行跑在**同一个工作区**会互相污染门的读数

文件不冲突 ≠ 互不干扰：**门量的是整棵树**。rid-046 的门读数被 rid-047 的未提交改动带偏
（`comment narrative 22→23`、`excess +6`）。**并行派发时，要么分 worktree，要么接受门读数只在两者都停下后才有意义。**

### 3.4 一条做对的判据

**"pass-shaped output"** 在 CI 层同样存在：job 可以因为是 green 而绿，也可以因为**步骤被跳过**而绿。
判定 `ed5f96eb` 是否真的修好了，靠的不是 run 的 `conclusion`，而是**逐 step 的结论**
（两条对照 step 是 `success` 而非 `skipped`）+ **读过它们的 YAML**（success 只有在臂以指定方式变红时才可达）。

---

## 4. 文档与记忆

| 文件 | 内容 |
|---|---|
| `2026-10-09-peaks-mcp-readonly-surface-design.md` | MCP 能力面的设计之record（厂商中立；Claude/Windows 只住在 §13 适配层） |
| `2026-10-09-next-work-menu.md` | **当前状态**（已由菜单改写）——含被推翻的三处判断 |
| `2026-10-09-post-mcp-current-state-roadmap.md` | 路线图 + 状态块 |
| `2026-10-09-hardening-round-handoff.md` | 门加固那一轮的记录 + 补记 |
| `.peaks/memory/*.md` | 491 条；本轮新增的几条见 `next-work-menu` 的教训表 |
