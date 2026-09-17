# peaks-loop 诊断报告

**日期**：2026-09-15 · **版本**：v4.0.49 · **提交**：`da769ac8`
**方法**：静态普查 + Windows 真机抽点 + 定向历史追溯
**基准**：peaks-loop 自己声明的承诺（CLAUDE.md 硬禁令 / Red Line RL-0..RL-10 / capability-baseline 的 15 条 journey 不变量 / README 与参赛稿的对外声明）

---

## 0. 方法与边界

**做了什么**
- `peaks codegraph` 索引更新至 1,184 文件 / 16,215 节点（完整性已验证：收录 TS 数 = `git ls-files '*.ts'` 数）
- 三个并行 sub-agent 分别普查：承诺↔实现对账、测试套件真实性、消费者真机表现
- 真机抽点：在临时目录从零跑 `peaks workspace init` 与 `peaks hooks install`，观察生成物、升级行为、用户键保留
- 我本人亲手复核了本报告所有**一级发现**（下文标 `[实测]`）

**边界（必须说明）**
- 真机抽点**只在 Windows 上**完成。CI 矩阵是 `ubuntu-latest + windows-latest`，**macOS 完全不在其中**，所以 Mac 路径本报告无法覆盖 —— 而 `.peaks/docs/mac-auto-compact.md` 整份文档说明 Mac 有独立缺陷。**Mac 是本次审计的盲区，不是"已覆盖且无问题"。**
- 未做全量测试套件运行。诊断的是"闸门验证什么"，不是"测试过不过"。
- 下文标 `[转述]` 的条目来自 sub-agent 报告，我未逐条亲手复现；标 `[实测]` 的条目我亲自跑过命令。

**本报告在写作过程中推翻了自己三次**（见 §7），这些错误保留在案，因为它们的错法与本文诊断的病灶同源。

---

## 1. 它是什么

一个架在 Claude Code / Codex / Cursor / Trae 之上的 **Loop Engineering 编排层**。核心主张：把跑过的工作**结晶成方法资产**，用机器闸门代替口头约定。

规模：`src/` 764 文件 / 156,682 行；`tests/` 357 文件 / 81,005 行；1,870 commits / 98 tags / 4 个月；13 个顶层技能 + 9 个内部角色技能（`skills/bee/`）；约 120 个顶层 CLI 动词。

---

## 2. 健康面 —— 必须保住的

诊断需要基线。以下是我确认**真的在起作用**的东西，它们定义了"退化"的参照系：

| 项 | 证据 |
|---|---|
| **测试导入全部可解析** | 2,092 个 import 逐一解析，0 个指向已删除模块 `[转述，已复核抽样]` |
| **断言密度健康** | 3,061 个用例 / 9,247 个 `expect` = **3.0 断言/用例**。这不是空壳套件 |
| **没有 `.only`、没有 `xit`、没有 `expect(true).toBe(true)`** | 全仓 grep 确认 `[转述]` |
| **几道守卫是同类里做得好的** | `vendor-neutral-identity-guard.test.ts` 自带 negative control；`session-path-swallow-census.test.ts` 断言集合相等并含仪器对照；`verify-codegraph-tarball.test.ts` 拒绝 mock npm，跑真 `npm pack` 并含必红负例 |
| **多个文件头如实记录自己的历史失败** | `lockstep-three-packages.test.ts:1-6` 写明"本文件以前只 grep 三个字符串冒充版本比对，4.0.38 发布时它是绿的而 `RUNTIME_VERSION` 停在 4.0.36" |
| **生成物合并非破坏性** | `[实测]` 我注入 `env` 自定义键、`permissions`、自定义 hook 后重跑 `workspace init`，**三者全部存活**，`PreToolUse` 从 3 条正确增至 4 条。仓库确有对应测试 `settings-local-preserves-user-keys.test.ts` |
| **CI 的自曝习惯** | commit `b58c1c4b` 把集成套件加进 CI 时标注 **"expected red"**；`a40521e9` 直书 "undiagnosable"。多数项目会藏这两句 |
| **`.gitignore` 顶层禁令真实有效** | `[实测]` `git check-ignore -v .peaks/2026-01-01-foo/x.md` → 匹配 `.gitignore:35` |
| **工作区路径守卫真实有效** | `workspace-service.ts` 用 `lstatSync` 拒绝遗留同级目录，抛 `LegacyChangeIdSiblingError` |

**这不是一个腐烂的项目。这是一个工程能力真实、但验证层系统性自我欺骗的项目。**

---

## 3. 病灶（按严重度）

### 一级：闸门验证的不是产物，而是关于产物的说法

**3.1 `peaks baseline audit` 伪造 15/15 通过** `[实测]`

```
$ node bin/peaks.js baseline audit --json
{"verdict":"consistent","consistencyScore":1,
 "evidence":[{"kind":"guard-run","ref":"capability-guard-runner:15",
              "summary":"15 pass / 0 fail"}],
 "requiresUserDecision":false}
```

但同一份代码里：

```
$ node bin/peaks.js baseline run-guard --journey J05 --json
{"ok":true,"data":{"status":"skipped"}}      ← exit 0
$ node bin/peaks.js baseline run-guard --json          # 文档称"默认全部 15"
{"journeyId":"J01", ...}                      ← 只跑了 J01
```

`baseline-commands.ts:104` 把 `guardSummary` 硬编码为 `{pass:15,fail:0}`，`:106-110` 的 LLM 打桩返回常量 `"consistent"`。

**这是 RL-10 指定的反漂移机制本身。它无法失败。** 且 RL-10 自己的文本把"LLM 审计可无独立上下文自证通过"列为要防的失效模式 —— 这正是它现在的行为。

**3.2 `run-guard` 对 14/15 条 journey 是静默空操作** `[实测]`

`baseline-commands.ts:79`：`opts.journey === 'J01' ? runJ01Contract(ctx) : Promise.resolve({status:'skipped'})`。未跑的 journey 返回 `skipped` 且 **exit 0** —— 调用方无法区分"跳过"与"通过"。

**3.3 13/15 守卫合约是 `existsSync` + 常见词 substring** `[转述]`

- J10 断言 `hooks-commands.ts` 含有词 `hook` —— 文件名叫 `hooks-commands.ts`
- J09 接受 `gate`（会命中 `aggregate`、`mitigate`）
- J06 断言名为 `session-resume-service.ts` 的文件含 `resume`
- J06 自己的注释写着："v2: existence is the primary check … v1 required 3 strict fragments and was **too strict**"

最后一条等于**书面承认把闸门改松以让它通过** —— RL-10 文本点名的失效模式。

**3.4 自审报告 `proseOnly: 0`，而同一份 JSON 里 44 行是 `prose-only`** `[转述]`

`classifier.ts:135-142` 把所有未匹配的 marker 标为 `informational:true`，注释直说是"so the prose-only ratio … excludes them"。闸门重新定义了分母，把自己数不到的 29% 排除在外。

**3.5 `cli-backed` 的含义是"文件存在"，不是"被执行"** `[转述]`

`backing-detector.ts:55-57`：`backing = existsSync(enforcerRef) ? 'cli-backed' : 'prose-only'`。`lint-rd-handoff-coverage.ts` 在目录里是 `cli-backed`，但全仓 grep 显示它**从未被导入、从未被调用**。

**3.6 enforcer 检查的是 SKILL.md 里的那句话，不是产物** `[转述]`

`lint-rd-handoff-coverage.ts:18-19` 用正则匹配 SKILL.md 散文里的 `do not hand off to qa without ... tech-doc`，**从不读 `.peaks/_runtime/<sid>/rd/tech-doc.md`**。这正是 4.0.49 发布说明自我总结的那句"闸门验的是描述产物的话而不是产物本身"。

---

### 二级：引用了不存在的执行者

**3.7 CLAUDE.md 点名一个不存在的守卫** `[实测]`

`CLAUDE.md:34` 称顶层目录禁令由 `tests/unit/workspace/top-level-change-id-guard.test.ts`「(8 cases, including CLI help-text) **will fail the suite**」守护。

**该文件不存在。** 四层防护中第 2 层缺失。它死于 `457b9a87`（2026-06-29）。`.peaks/PROJECT.md:29` 同样引用它。

（第 1 层 `.gitignore` 与第 3 层 `lstatSync` 均实测有效 —— 缺的是第 2 层。）

**3.8 红线的执行者不存在，且其函数零调用者** `[实测]`

`.peaks/standards/loop-engineering-guidelines.md:25` 称 lint harness「exercised by `tests/unit/standards/loop-engineering-guidelines.test.ts`」。

- 该测试**不存在**，死于 `f17aa377`（2026-07-30，一次性删除 559 个测试文件 / 108,205 行）
- `lintLoopEngineeringGuidelines` 全仓搜索：**只有定义，零调用者**

**3.9 承诺的执行动词根本没注册** `[转述]`

文档反复称 RL-0..RL-9 由 `peaks standards lint --category loop-engineering` 强制。`peaks standards --help` 只有 `init` / `update` / `migrate` —— **没有 `lint`**。整套红线撰写契约在运行时没有任何执行。

**3.10 三份权威设计文档不存在** `[实测]`

`.peaks/memory/peaks-loop-positioning-loop-engineering.md` 引用：
- `docs/superpowers/specs/2026-07-07-peaks-loop-loop-engineering-crystallization-design.md` — 不存在
- `docs/superpowers/plans/2026-07-07-loop-engineering/index.md` — 不存在
- `docs/adr/0007-peaks-workflow-primitive.md` — 不存在，且 **`docs/adr/` 整个目录都不存在**

红线文件自称"继承自"上述 spec §8/§10。**项目定位所依赖的设计文档只活在记忆的散文里。**

---

### 三级：文档与代码互相矛盾

**3.11 自动压缩：文档说 0.85，代码在 0.80 触发** `[实测]`

`src/services/code/auto-compact-modes.ts:29`：
```ts
standard: { autoFire: 0.80, preCompact: 0.85, redLine: 0.95 }
```
同文件 `:43` 的 `describeMode()` 却把自己描述为 `'standard (0.85/0.95 — v2.13.0 zero-pause contract)'` —— **漏掉真正生效的 0.80 档**。代码注释自认 0.85–0.95 那一档"in practice peaks-loop already auto-fired at the lower threshold; the pre-compact zone today is the 'already fired' zone"。

CLAUDE.md / SKILL.md 反复强调的"≥0.85 强制压缩"，**真实触发点是 0.80**。文档那条线比真闸门更松。

**3.12 红线的数量自相矛盾** `[实测]`

`loop-engineering-guidelines.md:453`：`Total red lines: 9 (RL-0..RL-9). Any new red line … will reject the change otherwise.`
`:455`：`## RL-10 — Capability Baseline / Guard / Audit`

而 lint 的 `EXPECTED_RED_LINE_IDS` 止于 `RL-9` —— **RL-10 存在但从不被校验**。

**3.13 注释声称"测量自现实"，实为硬编码** `[实测]`

`hooks-commands.ts:76-77` 注释："The summary mirrors the install shape, **NOT a hardcoded expected list**."
实为 `listExpectedEntriesForIde()` 里一份手写字面量（`:81-84`）。

（此条我曾误判为"报告安装了没装的 hook" —— 那是我查漏了文件，见 §7。真正的问题是清单来源，不是漏装。）

**3.14 装配了同一个 matcher 的两套编辑闸门，无人协调** `[实测]`

| 写入者 | 文件 | 条目 |
|---|---|---|
| `peaks hooks install` | `.claude/settings.json` | `Edit\|Write\|MultiEdit` → `peaks code-gate --json` |
| `peaks workspace init` | `.claude/settings.local.json` | `Write\|Edit\|MultiEdit` → `node "<nvm 版本目录绝对路径>/write-gate.js"` |

两者 matcher 写法顺序都不同（`Edit|Write` vs `Write|Edit`）。`settings.local.json` 那条把路径**钉死在一个 Node 版本目录**上 —— 本机存在 v22.22.1 / v24.14.0 / v26.8.1 三个版本目录，`nvm use` 切换后 `node` 按 PATH 走而脚本路径不走。属中等脆弱性，非"新装即坏"。

**3.15 两个通路装的两套东西互不修复** `[实测]`

| 通路 | 会修复陈旧的 `settings.local.json` 吗 |
|---|---|
| `peaks workspace init` | ✅ 会 |
| `peaks session primer`（每次会话自动跑） | ❌ 不会 |
| `peaks hooks install` | ❌ 不会 |

---

### 四级：消费者真机

**3.16 `npm i -g` 升级不刷新已生成的配置** `[转述，机制已在源码中验证]`

唯一写入者是 `initWorkspace`，而 `ensureSession`（`session-binding-bridge.ts:303-343`）在项目已有绑定时**提前返回**，所以首次 init 之后刷新路径不再触发。

逃生舱 `peaks upgrade --apply-init` 存在且可用，但其帮助文本自认问题："Use after a peaks-loop version bump if you do not otherwise re-run init."

**没有任何东西会告知用户其生成的配置已陈旧。** 记忆记录用户是通过**删掉项目 `.claude/` 下的 json 并重启**才解决的。

**3.17 写入一次、永不更新** `[转述]`

| 生成物 | 升级时刷新？ | 漂移检测 |
|---|---|---|
| `.claude/settings.local.json` | ❌ | 有，但需要显式 init 触发 |
| `.peaks/.claude-settings-template.json` | ❌ | 同上 |
| `.claude/settings.json` | ❌ | 仅手动重跑时才查 |
| `.gitignore` 管理段 | ❌ | **无** —— `:430` 见 header 即早退，内容变更永不传播 |
| `.peaks/standards/**` | ❌ | 需手动 `standards update` |

`claude-settings-template.ts:48-52` 自认 `TEMPLATE_VERSION` **"informational only"**，无版本戳文件。

**3.18 macOS 完全不在 CI** `[实测]`

CI 矩阵 `os: [ubuntu-latest, windows-latest]`，`.github/` 下无任何 `macos`。集成套件为显式决策的 ubuntu-only。

已知 Mac 缺陷（`.peaks/docs/mac-auto-compact.md`）由**三个叠加原因**构成，且含一条 vitest 看不见的假绿：`findTranscriptJsonl` 在 `"type":"module"` 下用体内 `require('node:fs')` → `ReferenceError` 被外层 `catch { return null }` 吞掉，而 **esbuild 注入 CommonJS shim 使 6/6 单测在完全破损的生产路径上全绿**。

残留风险明确未关闭：记忆记录 **73 个 `TODO(g2)` 遗留静默 catch**。

**3.19 9 个 IDE 适配器，1 个有测试** `[转述]`

`src/services/ide/adapters/` 9 个已注册 `IdeId`，只有 `claude-code` 有专属测试文件。`src/services/dispatch/sub-agent-dispatcher.ts` 的 4 个 dispatcher **在 `tests/` 中零引用**（含其产出的 `awaitByLlm` 字段，全仓 0 命中）。

`src/services/adapter/{codex,copilot}-adapter.ts` 是纯桩，五个方法全部抛 `ADAPTER_NOT_IMPLEMENTED`。

**3.20 postinstall 无条件创建 10 个 IDE 目录** `[转述]`

`install-skills.mjs` 对全部 10 个平台目录执行 `mkdirSync(..., {recursive:true})` —— **安装 peaks-loop 会在 `$HOME` 创建 `~/.hermes`、`~/.openclaw`、`~/.qoder`、`~/.tongyi-lingma`、`~/.zcode` 等，即使用户根本没有这些工具。**

同一份 postinstall 里有三种不同的派发策略：技能扇出全部 10 个平台、agent 只看 6 个声明了 `agentsDir` 的、output-style 只看 cwd 自动探测到的**一个**。`installProjectConfig` 是死代码（有定义、有导出、零调用）。

---

### 五级：测试套件

**3.21 整个 `tests/e2e/` 被两个配置同时排除，从未运行** `[转述]`

`vitest.config.ts:53-57` 排除 `tests/e2e/**`；`vitest.config.integration.ts:36` 也排除。全仓无任何脚本或 CI 步骤选中它。**5 个真实 E2E 测试 + 3 个 shell 脚本，自配置拆分以来一次没跑过。**

**3.22 7 个测试被一个无处设置的环境变量永久跳过** `[转述]`

`PEAKS_BUILD_AVAILABLE` 在 `.github/`、`scripts/`、`package.json` 中**零命中**。它门控着 `ac8-empirical.test.ts`（0 个测试执行）与 `plan-cli.test.ts`（**6 个测试**）。

一个以无人设置的环境变量为条件的 skip，就是穿着戏服的永久 skip。

**3.23 两条不可能失败的断言** `[转述]`

- `codegraph-init-conflict.test.ts:151` —— 上一行刚用 `join(..., CODEGRAPH_MARKER_NAME)` 构造出 `markerPath`，下一行断言它 `endsWith(CODEGRAPH_MARKER_NAME)`。注释自认目的是"避免 unused-var 告警"
- `cli-helpers.test.ts:345` —— 测试名声称 "preserves the original errorId"，但 `printErrorEnvelope` **根本没有 errorId 参数**，它每次调用都新铸一个 UUID。测试只断言"存在一个 UUID"

**3.24 一条守卫在被守护对象改名时静默失效** `[转述]`

`statusline-cli-integration.test.ts:229`：`if (!existsSync(srcPath)) { /* skip */ continue; }` —— 删掉被守护的源文件，守卫静默放行。

---

### 六级：执行期新发现（只有真的跑流程才会撞到）

以下两条是在**执行治理 Job 的过程中**发现的，静态审计看不到 —— 需要真的去用这套流程才会暴露。

**3.25 `peaks workflow init` 不解析会话绑定，静默落到 `unknown-sid`** `[实测]`

```
$ peaks session info --active --json     → sessionId: "2026-09-15-session-784bf0"  (source: canonical)
$ peaks workflow init --skill peaks-code → sessionId: "unknown-sid"
```

同一项目、同一绑定文件（`.peaks/_runtime/session.json` 存在且被 `session info` 正确解析）。`unknown-sid` 是文档里的**最终兜底值**，说明三条解析路径全部落空：
- 与 `--project` 的路径形式无关（`.` 与绝对路径都复现）
- 同项目的 `peaks session checkpoint` 解析**正常**

**后果是实打实的**：图被写到 `.peaks/_runtime/unknown-sid/graphs/`，随后 `peaks workflow node prepare --workflow <wid>` 在正确会话目录下找不到图，直接 `PEAKS_GRAPH_NOT_FOUND`。

**且这不是回归** —— `unknown-sid` 桶里躺着 **2026-09-01 起、至少 4 个不同 caller id** 的产物：

| caller id | 日期 |
|---|---|
| `12e57453-f838-4a40-b2a0-118b5eaded1c` | 09-01 / 09-02 |
| `90742f29-4074-4c14-acd7-2984851a606f` | 09-07 |
| `bd89a11a-b66d-443c-b8b7-e9aa813190c2` | 09-12 |
| `41d14175-50f5-4352-bac1-bc0b4656940d` | 09-15 |

其中包含命名的历史工作流图（`wf-auto-compact-vendor-neutral`、`wf-feedback-4-items`、`wf-headroom-removal`、`wf-prompt-cache-align`）。**即 `workflow init` 对谁都没解析成功过。**

绕行：显式传 `--session-id <sid>`，图与 lease 即落到正确位置。

**3.26 SKILL.md 称 `--graph-node <nid>` 是 REQUIRED，实际不传也能派发** `[实测]`

`skills/peaks-code/SKILL.md` 的 Code-Gate 段落明确写 "`--graph-node <nid>` is REQUIRED (RD §4 D4c). Prepare the node first…"，但 `peaks sub-agent dispatch --help` 的选项表里**没有这个参数**，且实测不传 `--graph-node` 派发成功。

此条与记忆 `peaks-loop-consumer-project-gaps` 记录的第 3 条消费者缺陷（"`peaks dispatch` 要求 `--graph-node`，而 `workflow node prepare` 从不写图"）**是同一根因的两面** —— 文档描述的能力与 CLI 实际能力不一致，只是方向相反。

---

**3.27 `skills/**` 下大规模悬空引用 —— 且引用完整性守卫的作用域不含它** `[实测]`

根因是一次移动：`de0872b7`（2026-07-05）"demote 9 internal skills from `skills/` to `skills/bee/`" **移动了 9 个技能，但没有更新指向它们的路径**。手工点验三处，全部证实：

| 引用处 | 被引用者 | 实测 |
|---|---|---|
| `skills/bee/peaks-qa/SKILL.md` | `tests/unit/skills/skills-skill-md-naming.test.ts` | **不存在** |
| `skills/bee/peaks-perf-audit/SKILL.md` | `skills/peaks-security-audit/SKILL.md` | **不存在**（实际在 `skills/bee/` 下）|
| `skills/bee/peaks-qa/references/qa-fanout-contract.md` | 自指 `skills/peaks-qa/references/qa-fanout-contract.md` | **不存在**（实际在 `skills/bee/` 下）|

**而 S4 新增的 `repo-citation-integrity.test.ts` —— 那个专为抓这一类而生的守卫 —— 抓不到：**

```ts
const CORPUS_ENTRIES = ['CLAUDE.md', '.peaks/PROJECT.md', 'README.md'] as const;
const CORPUS_DIRS = ['.peaks/standards'] as const;
```

**语料不含 `skills/**`。** 而 `REPO_ANCHORS` 正则里明明写着 `skills/` —— 锚点认识它，语料却不含它。

这与仓库记忆里那条老病同型（`vendor-neutral-identity-guard` 的前身"作用域设在不含目标路径的目录上，于是恒返回 0"）。

**规模未经权威测量。** 临时扫描器给出 `313 处引用 / 95 处不存在`，但本仓规矩明写"别自己写正则扫描，用已有的 AST 守卫"，且记忆记着临时扫描器**三版全错** —— 所以这个数字**只作线索，不作结论**。权威数字应由扩围后的守卫给出。

**未修，刻意。** 影响面大、属既有缺陷（2026-07-05 起）、且当时发布在望 —— 发布前做大范围改动是弄坏发布的标准方式。**扩围守卫会使套件变红，故必须与修复同一片进行。**

**3.28 我自己在 brief 里制造了一个悬空引用** `[实测]`

S11 的判据 6 要求"把新 flag 镜像进 `references/runbook.md` 与 `tests/unit/skill-default-runbook.test.ts`"。实测：

- `tests/unit/skill-default-runbook.test.ts` —— **不存在**
- `skills/peaks-code/references/runbook.md` 里 `baseline` 出现 **0 次**

而 S11 **拒绝**为了满足这个过时路径去伪造文档段落或测试，并把判据 6 标为"unsatisfiable as written"。

**我在修了一整轮"悬空引用"之后，自己又写了一个。** 该判据的出处是 `skills/peaks-code/SKILL.md:321`（以及 `references/runbook.md:9`、`references/workflow-gates-and-types.md:9`）—— **同一类缺陷，在 3.27 的射程之内**。

---

## 4. 病因

十条一级/二级发现形状高度一致。**它们不是十个独立缺陷，是同一个机制失效的十个投影。**

### 统一表述

> **每一次验证，其输入都来自被验证者自己，或来自一份不会再被核对的静态清单。**

| 发现 | 验证者的输入来自哪里 |
|---|---|
| 3.1 `baseline audit` 报 15/15 | 自己代码里的 `guardSummary` 字面量 |
| 3.2 `run-guard` 跳过 14 条 | 一个三元的 `opts.journey === 'J01'`，跳过即返回 exit 0 |
| 3.3 守卫合约 | 文件里有没有某个常见词 |
| 3.4 `proseOnly: 0` | 自己把数不到的标为 `informational` 排除出分母 |
| 3.5 `cli-backed` | `existsSync` —— 文件存在即算"有执行者" |
| 3.6 RD 交接 enforcer | SKILL.md 里的那句话，不是产物文件 |
| 3.7 / 3.8 / 3.10 悬空引用 | 一份曾经正确、此后再未被核对的文档 |
| 3.13 hook 清单 | 手写字面量，注释却声称它"测量自现实" |
| 3.23 不可能失败的断言 | 测试自己构造的输入 |

一旦这份输入与事实脱钩，**闸门就永远绿，且没有任何东西会告诉任何人。**

### 为什么它不能自愈

**① 缺少"闸门有效性"的元层。** 仓库里没有任何机制回答"这个闸门能不能失败"。做到这一点的三个守卫（`vendor-neutral-identity-guard` 自带 negative control、`session-path-swallow-census` 带仪器对照、`verify-codegraph-tarball` 带必红负例）是**个别现象，不是制度**。

**② "删掉实现看测试红不红"从未制度化。** 记忆里明确记着这件事（`delete-the-line-and-see-whether-the-suite-still-passes.md` —— 删掉关键行后 129 个测试全绿），但它没有变成任何强制执行层。

**③ 引用不会腐坏告警。** 文档引用文件、代码引用测试、常量引用路径 —— 当被引用者消失时，**没有任何机制报警**。所以引用可以无限期地悬空。

**④ 一次大规模删除留下了无人清扫的废墟。** `f17aa377`（2026-07-30）一次删除 **568 文件 / 108,205 行 / 559 个测试文件**，包括 `tests/vitest.setup.ts`。这次重置遗留的悬空引用至今未清 —— `stryker.vitest.config.mjs` 至今指向那两个已删路径，**变异测试按当前配置跑不起来**。

**⑤ 速度。** 4 个月 / 1,870 提交 / 98 tags，月均 25 个 tag，其中 8 月最低 19、9 月已 25。一个在定义上要求"闸门 + 证据 + 独立验证"的系统，用**每天一个版本**的节奏迭代 —— 闸门的建设速度追不上被闸门覆盖的面的扩张速度。结果是闸门数量增长快于闸门质量。

---

## 5. 机制层缺口（指认，不开药方）

按本次诊断的范围，以下只**指认缺口**，不给修复方案：

1. **没有"引用完整性"这一层。** 文档→文件、代码→测试、常量→路径的引用关系，没有任何机制在被引用者消失时报错。
2. **没有"闸门有效性"的元测试。** 没有任何机制回答"这个闸门能不能失败"。缺一个反例对照组。
3. **没有强制区分"产物"与"描述产物的文字"。** 多个 enforcer 检查的是描述，不是产物，且检查方式（substring）无法区分二者。
4. **生成物没有版本戳。** 消费者项目无法判断自己的配置是否落后于包版本 —— 而包的升级路径也确实不刷新它们。
5. **审计分母可被审计对象自己重定义。** `proseOnly` 的分母由产生它的同一套代码决定。
6. **`skipped` 与 `pass` 在退出码上不可区分。** 调用方无法分辨"没跑"和"跑过了"。

---

## 6. 对外声明漂移

`CONTEST-INTRO.md` / `CONTEST-IMPACT.md` 是**对外参赛稿**，开头声明："**所有数字与代码路径都可复核**"。

| 声明 | 实际 |
|---|---|
| 冻结于 **v2.2.2 / 2026-06-14** | 当前 v4.0.49 —— 落后约 **100 个版本 / 3 个月** |
| "**269 测试文件 / 2,957 用例 100% 通过**" | 实际 **345 文件 / 3,053 用例** |
| 引用 `peaks-code-resume` | 该技能**已重命名**为 `peaks-resume`，全仓仅参赛稿与一条 6 月历史记忆提及 |
| "100% 通过" | CI 的四连修 commit（`ce05fccc` / `b50977ff` / `a40521e9` / `3a46eab6`）**全部发生在 2026-09 上旬**。该声明的有效期落在 CI 尚不能运行的三个月里 |

即：**一份声称"可复核"的对外文件，其主要数字化石于该数字尚不可复核的时期。**

（另：README hero 图仍标 **4.0.3**；capability baseline 冻结在 **4.0.8**。）

---

## 7. 附：我在本次审计中犯的三个错

保留在案，因为它们的错法与 §4 诊断的病灶同源 —— **查一个点，断言整个面**。

| # | 错误 | 真相 | 错法 |
|---|---|---|---|
| 1 | 报"测试是源码的 1.5 倍" | 实为 **0.52x**（81,005 / 156,682） | `xargs wc -l \| tail -1` 在文件多时被拆批，只拿到**最后一批**的合计 |
| 2 | 报"`hooks install` 报告安装了没装的 hook" | `peaks code-gate` **确实装了**，在 `.claude/settings.json`；我只检查了 `settings.local.json` | 查了一个文件，断言了安装行为 |
| 3 | 报"生成的 hook 路径指向不存在的位置" | 路径**有效** —— `C:/nvm4w/nodejs` 是符号链接，与目标同一份安装 | 看到两个路径不同就假定其中一个坏了，没有 `ls -ld` |

三条都与 §4 表格里那些闸门犯的是同一个错：**把局部观测当成整体结论，且没有配对照组。**

---

## 8. 一句话结论

> **peaks-loop 的工程能力是真的，它的验证层是假的。**
>
> 测试导入全部可解析、断言密度 3.0、CI 会自曝 "expected red"、生成物合并不踩用户键 —— 这些都不是摆设。但**它的闸门系统性地验证"关于产物的说法"而非产物本身，且其输入来自被验证者自己**。于是 `baseline audit` 报告 15/15 通过，而实际上只有 1 条 journey 跑过、其余静默跳过且 exit 0。
>
> 这个项目在 4.0.45–4.0.49 五个版本里一直在打这场仗，每版都修掉一个具体实例。**病根不在任何一个具体实例，在于没有一层机制回答"这个闸门能不能失败"。**
