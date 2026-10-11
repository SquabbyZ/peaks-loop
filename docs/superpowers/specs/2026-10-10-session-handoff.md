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

## 2. 剩余事项

> ### ⏭ 新 session 从这里开始（2026-10-12 收工时写）
>
> **状态**：`origin/main = 32e77deb`，工作树干净，CI #319 全绿。今天交付两段——
> S2 的三件具名收尾（`8c1f5247` … `6098c73a`）与 §2.13 的 dashboard 埋点工作流
> （`e6bcc39e` … `32e77deb`，走的是完整 PRD → RD → QA 流程）。
>
> **按序先做这三件：**
>
> 1. **§2.14 的「QA 产物形状」** —— final-review 服务要读 `qa/test-cases`、`qa/test-reports`、
>    `qa/security-findings`、`qa/performance-findings`、`rd/bug-analysis` 等，而本轮 QA **只写了
>    verification 报告**。后果很实：**验证确实做了，但人审看不见**（四维里三维因此 `inconclusive`）。
>    修法是让 QA 的产物对上那份读取清单，不是改服务。
> 2. **§2.15 的 `peaks loop run`** —— 干净会话上 `RUN_FAILED: require is not defined`
>    （ESM vs `monotonic-runner.ts:153`）。它是 loop runtime 的**唯一入口**，而 `skills/` 里没有
>    任何 skill 调它。
> 3. **§2.13 收尾里仍开着的 U1 / U2 / U4** —— 尤其 **U2**（两个拿不到 session 的 token 站点）
>    目前是**明写的覆盖缺口**，不是遗漏。
>
> **下面各条不再严格按「会不会坑到你」排序**——2.13 / 2.14 / 2.15 是后补的。但 **§2.1**（负载型
> 假红）与 **§2.2**（本仓两条红线今天都不拦）仍然最该先读，它们会直接浪费你一次判断。

### 2.1 全量套件里有两条**负载敏感**测试，会给你假红 ← **2026-10-11 新增，最会坑你的一条**

在 S2 收尾时实测：**同一棵树**上三次全量跑，红了两次，而**红的不是同一个测试**。

| 测试 | 红法 | 单独跑 | 根因 |
|---|---|---|---|
| `tests/unit/standards/esm-relative-import-extension.test.ts` | `Error: Test timed out in 30000ms` | **18/18 通过，两次** | 它做一次**全仓 AST 遍历**并与 `git ls-files` 逐集合比对；机器被占满时超过 vitest 默认的 30s |
| `tests/unit/services/web/web-daemon-race.test.ts` | `bootCount` 得 2 而非 1 | **3/3 通过** | 并发用例，负载下两个调用方各起一个 daemon |

**为什么它会坑你**：一条红出现在你**没碰过**的目录里（`standards/`、`services/web/`），而失败形式是**超时**而不是断言——很容易被读成"我的改动弄坏了什么"，或者被当成噪声忽略。

**怎么判**：① 看失败文本是不是 `Test timed out`；② **单独跑那个文件**——两条都在单独跑时稳定通过。**别急着怀疑自己的 diff。**

**加剧因素是我自己**：为了"在合并结果上验证"连着跑了好几次全量 ⇒ 把机器占满 ⇒ 逼出超时。**连着跑全量会自己制造这个假红。**

---

### 2.2 本仓的两条红线**今天都不拦**，且 `Edit|Write|MultiEdit` 那条 entry 根本没装

- **编辑门（`peaks code-gate`）**：`.claude/settings.json` 里**没有** `Edit|Write|MultiEdit` 那条 entry（只有一条 `SessionStart`）。**装上它的那一刻起，本仓的直接 `src/**` 编辑会开始被拒**——默认 deny，因为除非你在 `peaks-race-code` 泳道里，否则解析不出驾驶者。**这是设计，不是副作用**，但它是一个**独立的决定**，且**必须由用户做**。
- **提交闸（AI 署名 trailer）**：在 Claude Code 上**从不运行**（`HOOK_COMMAND_BY_IDE` 把 claude-code 路由到 `peaks gate enforce`，而那里没有 ban）。这是 **U14**，2026-10-10 已裁决**不接**。

**为什么它会坑你**：你会以为有两条红线在保护你。**它们都不在。**
### 2.3 `test:changed` 的子集分类会漏掉一致性守卫 ← **最有价值的一条**

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

### 2.4 驾驶者解析不可靠，且提交闸在解析失败时**整个跳过** ← **P1**

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
### 2.5 提交闸在 Claude Code 上**从不运行**，在 cursor/codex 上**deny 会被吞掉**

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
### 2.6 `tests/integration/**` 不在默认 vitest 配置里

`vitest.config.ts` 的 exclude 含 `tests/integration/**`，它由 `vitest.config.integration.ts` 单独跑。

**后果**：两条 CI 红灯（C 层沙箱、integration 过时断言）**同时**躲过了：本机全量单测
（4431 条）、pre-push 门、以及 **4.1.3 的整个发布流程**。它们在 CI 上红着，而本地永远绿。

**注意**：这**大概率是刻意的**（集成测试慢）。不要顺手改配置——先决定"本地/推送时该不该跑它"。

### 2.7 `git push origin <tag>` 单独推，**永远**过不了本仓的 pre-push 门

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

### 2.8 还债（只有 `src/**` 会动棘轮）

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

### 2.9 已关闭 / 仍开着的"未验证边界"

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

### 2.10 `peaks-reviewer` 是半成品：**跳过被报成通过** ← **同一类 "pass-shaped output"**

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

### 2.11 工具缺陷（小、高复用）

- `peaks audit goal` 输出在约 **3.6 KB** 处截断（两次 `INCOMPLETE_AUDIT: Unterminated`）
- `peaks` 的 `.cmd` shim **吃不下含换行的参数**（`InvalidBatchScriptArg`）
### 2.12 S2（`peaks-race-code` 快泳道）已交付；三件具名活已于 2026-10-11 全部收尾，S3 仍未做

**状态（2026-10-11 更新）**：S2 是 `main` = `48861a11`（14 个提交、20 个文件）。**已全部推送**；随后三件具名活的收尾是 `8c1f5247` / `c99b1923` / `86564285`，也已在 origin 上并被 CI 验过（run #313、#314）。下文的"未推送"字样指的是写作当时。
**设计权威**：`docs/superpowers/specs/2026-10-10-peaks-race-code-design.md`（本轮又修了 4 处）。**计划**：`docs/superpowers/plans/2026-10-10-peaks-race-code-s2.md`。

**S2 的终审判定是 Merge**，但终审与各任务级评审**具名留下了三条**（都不在本支内）：

1. **`exit 2 + stderr` 通道零端到端覆盖** —— `tests/unit/hooks/code-gate-driver.test.ts` 的四条新用例**全走 `--dry-run`**，所以 hook 实际消费的那个契约（`process.exit(2)` + stderr）**在两种 payload 拼写下都从未被断言过**。终审说这是**唯一一条它会署名的**。约四行。
2. **loop-hygiene 块的 "22→23" sweep** —— 那块共享注释写着 "edit one, edit all **22**"，而现在有 **23** 个 skill（14 顶层 + 9 `bee/`）。**假计数被发了 23 份**，新加的 `skills/peaks-race-code/SKILL.md` 第 6 行就带着它。改它要**原子地动全部 23 份副本 + 守卫的正则**（`tests/unit/skills/loop-hygiene-block.test.ts` 把那个数字钉在正则里），所以 S2 有意没做。**它需要一次有名字的 sweep，不能只躺在 ledger 里。**
3. **`lintPeaksAuditRuntime` 的 wire-or-delete** —— `src/services/audit/enforcers/lint-peaks-skill-runtime.ts` 导出、无 importer、无测试 ⇒ **结构上不可能失败**；而它的 catalog 条目 `rl-peaks-audit-runtime-001` 声称 `skills/peaks-audit/SKILL.md` "must declare" 三个标记，其中两个该文件里**并不存在**。**接线还是删掉，需要一个裁决。**

#### 收尾（2026-10-11，session `2026-10-11-session-5ac396`）—— 三条全部关闭

用户指名走 `peaks-race-code` 快泳道，每条一个可回退 commit（`git revert --no-edit <sha>`）。
上面三条原话**保留不动**，下面只记结果与**被实测修正的部分**：

1. ✅ **exit-2 覆盖** —— `8c1f5247`。加了一个不传 `--dry-run` 的兄弟 helper，**两种 payload
   拼写各断言一次** `exit 2` + stderr 含 `PEAKS_CODE_PROHIBITED_DIRECT_EDIT`，allow 时断言
   `exit 0`。变异对照：把 `--dry-run` 加回去，两条新用例即红。
   **修正**：原文说"四条新用例全走 `--dry-run`"，实测是**十条**（`:126-187` 六条 + `:201-244` 四条）；
   而 `code-gate-command.ts:121/:144` 在 `--dry-run` 时提前 return，所以 `:172-176` 的真契约
   **在 Node 命令这一侧一条都没被断言过**。全仓唯一那条 exit-2 断言只覆盖 shell 兄弟、且只用 legacy 拼写。
2. ✅ **loop-hygiene 22→23** —— `c99b1923`。23 份副本的标记行原子替换（脚本断言每份恰好一次）。
   **修正原文的一处遗漏**：只把守卫里的数字从 22 改成 23 是不够的——**那个字面量正是假计数没被发现的
   原因**（第 110 行 `toMatch(/edit one, edit all 22/i)` 会一直附和每一份错误的副本）。已改为
   **从 `files.length` 取数**，所以下一个技能落地会让守卫**红**，而不是让 24 份副本一起悄悄变错。
   两次变异验证：全改 `99` → 计数断言红；单份漂移 → 字节一致性断言红。
3. ✅ **裁决：delete** —— `86564285`。删掉那个模块（99 行），7 条 catalog 的 `enforcerRef` 置 `null`，
   基线 `--rescope` 重生成。
   **三处与原文不符的实测事实**：① 它导出的是 **7 个** enforcer（audit/content/ide/doctor/
   issue-fix-orchestrator/sop/slice-decompose），不是 1 个；② 审计系统**已经**把它们标成
   `prose-only`（`enforcer-liveness.ts` 扫 import + `backing-detector.ts` 降级），所以
   **今天不存在假绿**——"结构上不可能失败"不等于"被当成了通过"；③ **wire 不是"接根线"**：
   把 7 个真的 import 进来、对着今天的 SKILL.md 跑，**6/7 立刻开火**（只有 `peaks-doctor` 干净），
   每条都要靠改一份随包发出的 SKILL.md 去命中一个正则。
   **行为中性已实测**：`peaks audit red-lines` 计数删除前后完全一致（`156 / 54 / 0 / 102`）。

**S3（指标埋点 + pilot）—— 仍未做"阶段切换"，但 pilot 已起跑（2026-10-11）**：
同日 4 个真实任务走完了这条泳道，门 2 的四个数 = **任务数 4 / 回滚 0 / CI 红 0 / 漏报风险面 0**。
记录在 `.peaks/_runtime/2026-10-11-session-5ac396/race/`（4 条）。
**判断：样本不足以切换阶段**，所以 race-code **仍然只能指名到达**——见 spec §3.2 的阶段表与
§5.5.2 的两道门。两点诚实注记：4 个任务里只有 1 个真正压到了这条泳道的核心能力（本窗口直改
硬阻断家族）；且它的头一次推送就在本地门上红过一次（`code-gate-driver.test.ts` 一条负载型超时，
重试即过）。

**S2 的完整审计链**（32 条 Ruling、15 条 deferred minor 的逐条 triage、逐任务证据）在 `.superpowers/sdd/2026-10-10-peaks-race-code-s2/progress.md`——**gitignored**，所以它不会随仓库走。**该不该留、什么时候删，由用户定**（S0 的 ledger 同样保留着）。

### 2.13 `peaks dashboard summary` 报的三个指标**结构上恒为 0** ← **2026-10-11 记入，2026-10-12 已交付（见本节末）**

**证据**（本会话实测，session `2026-10-11-session-5ac396`）：

```
$ peaks dashboard summary --json
{"cycleCount":0,"tokenCount":0,"dispatchCount":3,"compactCount":0,"monotonicTriggerCount":0}
```

**`dispatchCount` 是 3，而 `cycleCount` / `tokenCount` / `monotonicTriggerCount` 是 0。**
差别不在"有没有发生"，在**有没有活着的发射者**：

| category | 谁发射 | 状态 |
|---|---|---|
| `dispatch` | `src/cli/commands/dispatch-tool-call.ts:139` | 活 |
| `slice-transition` | `src/services/artifacts/{artifact-prerequisites,request-artifact-service}.ts` | 活 |
| `mode-gate` / `context-trigger` / `post-compact` / `checkpoint` / `lease` | 各一处 | 活 |
| **`cycle` / `token-usage` / `monotonic-trigger`** | **只有 `observability-service.ts:190/212/237` 三个 helper** | **死** |

那三个 helper（连同 `emitDispatchEvent`，共四个）**全仓零调用点**：`observability-service.ts:190/212/237/260` 是唯一定义，`src/` 与 `tests/` 里没有一处调用，也没有任何测试钉住它们。所以这三类事件**永远不会被写出**，而 `aggregation.ts:212/213/227/249/250/264` 一直在统计它们。

**为什么这不是一次快泳道清理**——三条改法，**B 才是真问题**：

- **A 删掉四个 helper**：行为中性（计数器本来恒 0，不会更差），但会把"没人发射"这件事**藏起来**。
- **B 让三类事件真的有发射者**：这才是真缺口。要回答"**谁该发、什么时机发、`token-usage` 的 token 从哪来**"。旁证：`dashboard-long-run.ts:144` 的 `monotonicTriggerCount` 是从 `snapshot.monotonicGuards` **另取一路**的——说明这三类本来就是**未接线的特性**，不是几行清理。
- **C 把三个指标从 dashboard 删掉**：删用户可见字段。

**判断：B 是特性工作，应走 `peaks-code`（PRD → RD → QA），不是快泳道。** A / C 都只是把症状藏起来。
**本会话未改一字**（工作树干净，`origin/main` = `bbe3844d`）。

**顺带一条，先别动**：`emitDispatchEvent` 的 `detail` 形状是 `{ status }`，而真实生产者 `dispatch-tool-call.ts:139-153` 发的是 `{ requestId, ide, promptBytes }`——**它表达不了本该服务的那个事件**，所以从落地起就接不上。但它的去向取决于 B 的决定（若结论是统一发射路径，它可能正是那个该被接上的点），**所以现在删它可能是删错**。

#### 收尾（2026-10-12）—— **B 已交付**，`e6bcc39e`

走的是 `peaks-code` 完整流程（PRD → RD → QA → 修复），契约先行、用户审阅后实现。三个 category 现在都有真实发射者：`cycle`（`run-driver.ts`，每 cycle **一个**事件）、`monotonic-trigger`（guard 的两个调用点；`skip` **不发**）、`token-usage`（`final-review-prepare-command.ts`，只发数字，`source: provider|estimated`）。

**QA 独立复现了 5/5 强制验收标准**，含**变异对照**（删掉发射调用 → 运行照旧 `totalCycles:2`，而 dashboard 读 0）与**独立性检查**（从原始行重算 `41+27=68` == dashboard 的 68）。

**仍开着的**：U1（死枚举值）、U2（两个拿不到 session 的 token 站点，**已记为接受了的覆盖缺口**）、U4（`estimated` 的格式）。

### 2.14 `peaks prepare-final-review` 的两条真缺陷 ← **2026-10-12 新增**

跑这个步骤是为了给 §2.13 的交付取人审证据，结果它自己暴露了两个问题：

1. **结构漂移检测器会对"排版改动"误报。** 它把 `final-review-service.ts` 的
   `export { A, type B, type C };` 单行形式改成多行块（只为加 `type LlmTokenUsage`），
   于是报告 **"REMOVED 3 export names"** —— 而那三个名字**都还在、都还在导出**，
   `index.ts` 也照旧转出。检测器是行锚正则、只看改动行（其自述 "APPROXIMATE — NOT a type
   checker"），**单行形式在 diff 里消失即被判为移除**。后果不小：四维里唯一有前后数据的
   那一维因此 `FAIL`、`allPass` 结构性为 `false`。
   **注意**：该 skill 明文声称有防这条的守卫（*"a name that appears on both sides of the
   diff … are reported as changes, not as removals"*）——**它没有生效**，值得单独查。
2. **`--session-id` 是必填的**，而 skill 写"省略时默认取活动绑定"；实测省略即
   `MISSING_REQUIRED_OPTION`。**另一条文档落后于代码。**

**同时证伪的一条**：skill 说真 provider 不可达（`--llm-provider anthropic` → `serviceWired:false`）。
**实测可达**：`status: review-complete`、`providerBinding: anthropic-messages-api`、
`model: deepseek-flash[1M]`。

**最后一条不是缺陷，是设计生效**：四个维度里三个 `inconclusive`，因为该服务要读的产物
（`qa/test-cases`、`qa/test-reports`、`qa/security-findings`、`qa/performance-findings`、
`rd/{bug-analysis,tech-doc,code-review,security-review}`）没有生成——**QA 做了验证，但没落成它要读的形状**。
它据此拒绝给 `pass`，这是对的。**下一轮应记**：QA 的产物形状要对上 final-review 的读取清单，
否则"验证过了"这件事对人审不可见。

### 2.15 `peaks loop run` 在**干净会话**上跑不起来 ← **2026-10-12 新增，先前就存在**

**复现**（RD 与 QA 各自独立撞到，且在**未修改的 `dist/` 构建**上同样复现，故与 §2.13 的改动无关）：

```
peaks loop run <rid> --session <sid> … → RUN_FAILED: require is not defined
```

根因是 ESM 与 `src/services/loop/monotonic-runner.ts:153` 的 `loadMostRecentCycleFromDir`
（该文件本次未被碰过）。**绕法**：先播种一行 `{"kind":"monotonic-cycle"}` 到该 rid 的 cycle 目录，
让"最近一个 cycle"这一读取路径不被走到。

**为什么值得单独立项**：`runLoop` **只能**经 `peaks loop run` 到达，而 `skills/` 里**没有任何 skill 调用它**
（实测 grep 为空）。也就是说 **loop runtime 的入口点自己先在干净会话上崩**——这与 §2.13 里
"`cycleCount` 只在直跑 loop 时才会动"是同一处的两个症状。AC-1 与 AC-2 都靠播种才跑通。

**本会话未修**：它超出 §2.13 的批准范围，且与 §2.13 的改动无关。


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
