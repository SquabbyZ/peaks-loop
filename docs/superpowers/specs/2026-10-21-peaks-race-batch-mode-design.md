# peaks-race-code 批量模式 —— 设计

- **日期**：2026-10-21
- **状态**：设计已定，**未经用户逐节 review**。历经：brainstorming 4 轮 + 3 次用户裁决 + 1 次用户中途修正（诊断/修复分相）+ 2 次仓库实证核对 → 本文档；**§7A 为用户追加的上下文监控要求**（2026-10-21），基于对 `auto-compact-*` / `compact-*` / `compact-statusline` 的实地核对
- **会话**：`2026-10-20-session-f7f45b`
- **上游**：用户直接提出（非审计产物）
- **关系**：本设计是 [`2026-10-10-peaks-race-code-design.md`](./2026-10-10-peaks-race-code-design.md) 的**后续**，不改它已交付的 S0/S1/S2/S3 任一件

---

## 0. 起因

用户原话（三段）：

> peaks-race-code 的目的就是在保证 peaks-code 效果的轻微打折的前提下，提升效率，但是目前还是单 agent 模式，没有使用 peaks-loop 的多 agent 的形式来大幅度提升效率，比如改 bug，可以最大并行修改不相关的 BUG，然后全部 bug 修复完统一测试验证等高度提效的操作，还有怎么尽可能的减少 AI Coding 的返工，以及增大缓存减少 token 消耗

中途修正（关键）：

> 先对多个 bug **并行定位问题**，然后统一修复的时候再决定排几个 agent 修复
> 小的多干个需求开发也是同理

第三条修正：

> 还有写代码还有 bee 级的 peaks-rd……可以不断地优化 peaks-rd，可以强化修复的子 agent

**这个设计要解决的，是一个已成型的四段形态**：

```
① 诊断（并行 · 只读）    N 个 bug/小需求 → 根因 + 预计文件集 + 风险面判断
② 定档（本窗口 · 瞬时）  用①的实测文件集算冲突图 → 决定修复拓扑
③ 修复（拓扑待定）       带上①的诊断（不重读仓库）
④ 统一验证（一次）        test + tsc + lint 跑一遍，不是 N 遍
```

### 0.1 用户裁决记录

| # | 议题 | 裁决 |
|---|---|---|
| U1 | 能力落在哪条泳道 | **扩展 peaks-race-code 加批量模式**（不新开泳道） |
| U2 | 优化目标 | **门禁墙钟（批量统一验证）** —— 不是墙钟，不是 token |
| U3 | 诊断阶段的 agent 角色 | **(a) 复用 peaks-rd** —— 与修复同角色，前缀共享，优化 peaks-rd 两阶段同时受益 |
| U4 | 统一验证跑多宽 | **(a) 与今天 race-code 完全相同的门禁**，只是 N 次变 1 次 |
| U5 | 修复阶段拓扑 | **诊断并行先落地；修复拓扑单独一个 slice，到那时再定串行/并行/混合** |

### 0.2 「返工」的真实形态（U2 的根据）

用户对「返工」的描述：

> 是在有规范的时候，尤其是项目中有 stylelint 规范的时候，无视规范开发，然后再 pre-commit 或者 pre-push 被检查出来后再重新改

**这句话把设计问题从「代码理解」重新定义成了「规则不知情」**：

- 不是 agent 不知道代码怎么写
- 是 agent **不知道这个项目有什么规矩**，于是按通用习惯写，写完被门禁拦下，再改一遍
- 浪费的不是理解，是**一整轮实现 + 一整轮返工**

并且用户澄清：**stylelint 只是举例**。lint 是**全代码语言**的，且 peaks-loop 自身已带 ECC 与 OCR 两个更强的多语言能力。

⇒ **「无视规范」这条不能按 TS/JS + ESLint 设计。** 它必须是**项目无关 + 语言无关**的。详见 §5。

---

## 1. 承重不变量

> **删掉批量模式，peaks-race-code 的行为逐字节不变。**

精确化为四条，缺一不可：

1. **批量是加法，不是改造。** 批量模式是 race-code 的一个**可选路径**。N=1 时**完全不走**这条路径（不诊断、不预读、不定档），走今天完全相同的单任务流程。
2. **阶段①严格只读。** 诊断 agent 只做 Read / Grep / 只读命令，**不 Edit / Write / MultiEdit**。这一条不只是"为了避开闸"——它是阶段②文件集的唯一数据来源，而写冲突检测依赖那个文件集。
3. **统一验证的门禁严格度不降。** 跑的是与今天 race-code 验收门**完全相同**的那套（`fast-lane-norm.md` §1：`test pass + tsc pass + lint pass`），只是 N 次变 1 次。
4. **peaks-code 行为不变。** 批量模式不得改变 peaks-code 的 11 步工序、Gate A–G、transition 状态机。共享部分的落点见 §6。

---

## 2. 与现有仓库的关系（这一节是本设计的地基）

> **这一节的每一条都在 2026-10-21 实地核对过**，出处是文件路径与行号，不是记忆。

### 2.1 已存在、**直接复用**的件

| 件 | 位置 | 用在哪 |
|---|---|---|
| **文件冲突波次规划器** | `src/services/dispatch/file-overlap-wave-planner.ts` | 阶段②。纯函数、无 I/O、确定性。输入 `{id, files[]}[]`，输出波次 + **每个延期的碰撞文件名与撞上了谁** |
| **DAG 节点已有 `files` 字段** | `src/services/dispatch/slice-dag-types.ts:58` | 阶段②的输入。注释明写：所有节点都声明 `files` 时才产出波次计划，否则为 `null` |
| **波次计划的现成调用点** | `src/cli/commands/dispatch-dag-runners.ts:36` `planFirstLevelWaves` | 阶段②。**全有或全无**：`descriptors.every(d => d.files.length > 0)` 为假 ⇒ 不产出计划 |
| **OCR 1.13.1 桥** | `src/services/lint/ocr-18-*` | §5。**57 种语言**按扩展名路由 |
| **OCR delegate 规则解析** | `src/services/lint/ocr-18-delegate-payload.ts:63` `buildDelegateRuleArgs(paths, range)` | §5。**接受任意路径列表**；`rangeArgs` 在无 range 时不产出 flag ⇒ 路径列表可单独使用 |
| **delegate 规则解析器** | 同文件 `:224` `parseDelegateRules` → `{groups: [{group_id, source, pattern, files[], rule}]}` | §5。规则文本按 pattern 分组，**全确定性、无 LLM、不读 key** |
| **Gate B5（ESLint，TS/JS 主门）** | `peaks lint check` | §5、阶段④ |
| **Gate B3（OCR 补充道）** | `skills/bee/peaks-rd/SKILL.md:190` | §5。**2026-10-20 才接上** |
| **ECC 策展规则集** | `ecc-universal@2.2.3/rules/` | §5。**22 个语言目录**（angular/arkts/common/cpp/csharp/dart/fsharp/golang/java/kotlin/nuxt/perl/php/python/react/react-native/ruby/rust/swift/typescript/vue/web） |
| **ECC 语言专属 agent** | `ecc-universal@2.2.3/agents/` | §5。**68 个 agent**，其中 **35 个**是语言专属的 reviewer / build-resolver |
| **共享 prose 先例** | `skills/peaks-code/references/fast-lane-norm.md` | §6。**一份规范 + 双指向 + 一个测试** —— 仓库已确立的共享机制 |
| **dispatch prompt 组装** | `src/services/context/build-dispatch-system-prompt.ts` | §7。**已经是共享件**；稳定前缀在前、变量在后，为缓存优化 |
| **工作树隔离租约** | `peaks worktree spawn` / `--isolation worktree` | Slice 3。⚠️ 分支名由 rid 派生 ⇒ **并发 agent 必须各自不同的 rid** |
| **micro-cycle（共享文件）** | `skills/peaks-code/references/micro-cycle.md` | §5。**已是共享件**，两条 lane 都读它 |
| **每轮上下文探针** | `peaks skill presence` → `context.ratioPct` / `context.action` | §7A。**每轮都跑**，是唯一不漏的探针 |
| **压缩区间判定** | `src/services/code/auto-compact-decision.ts` `evaluateCompactTrigger` | §7A。0.80 / 0.85 / 0.95 三档 |
| **压缩 + 恢复** | `peaks code auto-compact` → `writePreCompactCheckpoint` → `peaks code post-compact-detect` | §7A |
| **最佳时机建议** | `peaks compact recommend --from --to` | §7A。阶段转换表，**纯函数**，`research→planning` 与 `implementation→testing` 都是 `severity: 'yes'` |
| **什么能活过压缩** | `peaks compact survival` | §7A |
| **上下文账单** | `peaks code context-audit` | §7A。按 tool/key 拆解占用 |
| **压缩状态条** | `compact-statusline` | §7A。8 格进度条 |

### 2.2 **不**存在的件（本设计必须自己造）

| 缺口 | 证据 |
|---|---|
| race 域内**没有任何多切片概念** | `src/services/race/` 只有 4 个文件（`gate2-policy` / `gate2-evaluator` / `pilot-gate-store` / `lane-phase`）。lane 的单位是**一行 `PilotTaskRow` = 一个任务**，其 `filesChanged` 只为推导「压没压核心能力」，**不用于调度** |
| race 域**没有子代理** | `skills/peaks-race-code/SKILL.md` 首行定义：「this window edits source directly, **with no sub-agents and no paperwork**」 |
| **无 API 级 prompt 缓存** | 全仓搜 `cache_control` / `cacheBreakpoint` / `promptCache`：**零命中**。peaks-loop 不发缓存标记，也不管理缓存前缀 |
| **无「首次尝试成功率」度量** | 全仓搜 `firstAttempt` / `attemptCount`：零命中。最接近的是 `observability` 的 `repairCyclePeak` / `capHitCount` |
| **按文件集取规则的入口未暴露** | `buildDelegateRuleArgs(paths, range)`（`ocr-18-delegate-payload.ts:63`）**已经接受任意路径列表**，且 `rangeArgs`（`ocr-multilang-adapter.ts:86`）在 `from`/`to`/`commit` 未给时**不产出任何 flag** —— 即路径列表可单独使用。但**对外的 CLI 面 `peaks code-review run-ocr-18` 只有 range 参数**（`--from` / `--to` / `--commit`），没有 `--files`。阶段①要的是"**这一组文件**适用哪些规则"，所以缺的是**把这层能力暴露出来**，不是造机制 |

### 2.3 一处**必须纠正**的先前说法

本文档起草过程中，我一度把 OCR 的语言数说成 **66**。实测 `src/services/lint/ocr-18-language-routing.ts` 的 `LANGUAGE_EXTENSIONS` 是 **57 个 key**。按本仓已有的教训（`counting-a-part-and-calling-it-the-total`），**"数了一个局部却当成总量"在这里也发生过一次** —— 记下来，因为 §5 的设计正建立在"覆盖多少语言"这个数字上。

---

## 3. 四个阶段

### 3.1 阶段① —— 诊断（并行 · 只读）

**输入**：用户给出的 N 个互相独立的项（bug 或小需求）。

**执行**：N 个 **peaks-rd** 子代理并行（U3）。每个负责 1 项。

**约束**：
- 严格只读。不 Edit / Write / MultiEdit。这不是风格偏好 —— code-gate 的 matcher 正是 `Edit|Write|MultiEdit`（`src/services/skills/hooks-codegate-superpowers.ts:180`），只读 agent 根本不进闸。
- 同一 rid 家族、同一角色 ⇒ dispatch prompt 的**稳定前缀逐字节相同** ⇒ 缓存命中（§7）。

**产出（每项一份）**：

| 字段 | 用途 |
|---|---|
| 根因 | 交给修复阶段，不必重新诊断 |
| **预计文件集** | **阶段②的唯一输入**。今天 wave plan 靠 LLM **猜** `files[]`；诊断后是**量出来的** |
| 风险面命中 | 7 条风险面（`fast-lane-norm.md` §2）。命中 ⇒ 踢出批量，走单任务流程 |
| 修复草图 | 交给修复阶段 |

**注意**：预计文件集**可能不准** —— 诊断 agent 的判断不等于最终改动。Slice 1/2 无害（串行修复无写冲突）；Slice 3 靠工作树**物理隔离**兜底，不信预测（§4.3）。

### 3.2 阶段② —— 定档（本窗口 · 瞬时）

**输入**：①的实测文件集。

**执行**：把 `{id, files[]}` 喂给 `planFileOverlapWaves`（§2.1），得到：

- 哪些项**文件集两两不相交** ⇒ 可并行
- 哪些项**碰撞** ⇒ 撞的是哪个文件、撞上了谁（规划器**自带这个理由字符串**，不需要另外发明）
- 哪些项命中风险面 ⇒ 踢出批量

**输出**：修复拓扑决定 + 一个可解释的 plan。

**已知缺陷（必须记录）**：波次规划器的匹配是**精确字符串相等**（`normalizeFiles` 只做去重+排序，**不做规范化**）。`src/a.ts` vs `./src/a.ts` vs `src\a.ts` 被当作**三个不同文件** ⇒ 假"无冲突"。且它是**建议性的** —— 算出来不阻塞任何东西。⇒ 诊断阶段产出的文件集必须**规范化**后再喂进去，否则 Windows 上的反斜杠路径会让整个冲突检测失效。

### 3.3 阶段③ —— 修复（拓扑待定，见 §4）

**输入**：①的根因+文件集+草图（**不重读仓库**）、§5 的规则清单、阶段②的拓扑决定。

**执行**：peaks-rd 子代理（U3）。**拓扑在 Slice 3 才定** —— 串行 / 并行 / 混合都行。

**每项修完立刻跑 scoped test**（`micro-cycle.md` 的 RED→GREEN→局部回扫）。这条**不是**性能优化，是**归因机制**：单 test ~100ms，红在当场；统一验证只负责**集成层**。

### 3.4 阶段④ —— 统一验证（一次）

**跑的是与今天 race-code 完全相同的验收门**（U4，`fast-lane-norm.md` §1）：

```
test pass + tsc pass + lint pass = GO
```

**只是 N 次变 1 次。严格度一格不降。**

**收益的量级**（2026-10-20 实测，本仓库）：pre-push 的 `pnpm test:changed -- origin/main` 因 diff 触及 `.peaks/**` 落到全量单元套件，**540 文件 / 5980 passed / 438.00s**。改 5 个 bug 各验一次 = 36 分钟纯等待；统一验一次 = 7 分钟。**省的是门禁墙钟，不是 token**（U2）。

**归因**：单 bug 的问题已被阶段③的 scoped test 拦在当场。阶段④红了 ⇒ 大概率是**集成层**问题（跨项互相影响），不是某一项坏了。这条要写进验收。

---

## 4. Slice 分解

> 用户裁决（U5）：诊断并行先落地；**修复拓扑单独一个 slice，到那时再定串行/并行/混合**。Slice 1+2 落地时，修复仍在主窗口（今天 race-code 的做法），所以 **Slice 3 是纯升级，不是重写**。

### Slice 1 —— 批量模式骨架 + 诊断并行

- **内容**：批量模式入口；阶段①（诊断 fan-out，只读）；阶段②（定档）；诊断产物落盘。
- **收益**：诊断墙钟 ↓
- **依赖**：无
- **不依赖**：修复拓扑、driver 解析、工作树
- **风险**：文件集预测不准 → 本 slice 无害（修复仍在主窗口，无写冲突）

### Slice 2 —— 统一验证

- **内容**：阶段④（一次门禁）；归因说明；批量产物与单任务产物的对比证据。
- **收益**：**门禁墙钟 ↓** —— 本设计的主要目标（U2）
- **依赖**：Slice 1
- **风险**：统一验证红了时的归因。缓解 = 阶段③的 scoped test

### Slice 3 —— 修复阶段并行化（拓扑在此时定）

- **内容**：阶段③改为 peaks-rd 子代理；按阶段②的波次排 N' 个；工作树隔离；合并回来。
- **收益**：修复墙钟 ↓ + 修复质量 ↑（peaks-rd 的纪律被真正用上）
- **依赖**：Slice 1、Slice 2
- **⚠️ 前置**：**先跑 driver probe**（§4.1）

### Slice 4 —— 规范预读（项目无关 · 语言无关）

- **内容**：按诊断出的文件集，取「这些文件生效的规则」，注入修复 prompt。详见 §5。
- **收益**：返工 ↓（**一次写对**，而不是先错后改）
- **依赖**：Slice 1（需要文件集）

### Slice 5 —— micro-cycle 加 lint 腿

- **内容**：在 `references/micro-cycle.md`（**共享文件**）的循环里加一条 lint 腿：写完立刻跑 scoped lint，红了在**同一上下文**里改。
- **收益**：返工 ↓（修改从提交时提前到 10 秒时）
- **依赖**：无
- **共享性**：**这是 peaks-rd 的改进，两条 lane 同时受益**（§6）

### Slice 6 —— 批量进度落盘（上下文监控的地基）

- **内容**：`batch/<batchId>/progress.json`（逐项追加，不是最后一次性写）；压缩后从它恢复；阶段边界的压缩提示接线（§7A.4 设计 B/C）。
- **收益**：压缩后**不丢批量进度**；且用户知道最佳 compact 时机
- **依赖**：Slice 1
- **为什么必须是独立 slice**：它是**唯一**一个新造件（§7A.5），其余两块是接线。且它**独立可交付** —— 就算 Slice 3 永远不做，落盘本身也让批量模式在崩溃/压缩后能恢复

---

### 4.1 driver probe —— Slice 3 的第一步（必须先实测，不能推理）

**问题**：Task 派发的子代理，能不能改 `src/`？

**读代码得到的推理（互相矛盾，所以不能靠它下结论）**：

- `decideGateAction` 只在 driver **恰好等于** `'peaks-race-code'` 时放行硬阻断家族（`src/services/hooks/pre-tool-code-gate.ts:127`）
- driver 解析要 `hasLeaseForCaller(projectRoot, callerId)` —— **租约所有者**才算数（`src/cli/commands/code-gate-command.ts:81`）
- ⇒ 子代理的 caller id 若不等于租约所有者，解析为 `null` ⇒ **deny**

**但与事实矛盾**：今天 peaks-code 的 RD 子代理**确实在改 `src/`**，且 peaks-code 工作正常。所以上两条推理里**至少有一条我读错了**。

**收窄后的真问题**（这才是要测的）：

> `peaks-code` presence 下放行 —— 这已被事实证明。
> **`peaks-race-code` presence 下放不放行 —— 未验证。**

仓库自己也知道这块没定：`.peaks/docs/backlog.md` §7.4 与 race 设计文档 §12 U4 都把「gate 读不到 session」记为未决。

**Slice 3 的第一步就是一个 probe**，按结果选分支：

| probe 结果 | Slice 3 走哪条 |
|---|---|
| race presence 下放行 | 排 N' 个 peaks-rd 子代理，拓扑按波次定 |
| 不放行 | 三个候选：① 修复留主窗口（退回 Slice 1/2 形态，**门禁收益仍在**）② 子代理自己 `presence:set peaks-race-code`（但它得是租约所有者）③ 修 driver 解析（改 `hasLeaseForCaller` 语义） |

**Slice 1、2、4、5 都不依赖这个 probe。** 这是把批量模式分层交付的全部意义。

---

## 5. 「无视规范」怎么防 —— 项目无关 · 语言无关

> 这是 U2 的根据，也是本设计里最容易做错的一块。**先纠正我自己的一个错误**：我最初设计的是"新增一个读项目 ESLint 配置的 service" —— **那是重新发明轮子**，因为 OCR 的 delegate 机制已经把规则解析做完了，而且是项目无关、语言无关的。

### 5.1 「生效规则」有三个来源，缺一不可

| 层 | 问题 | 来源 | 现状 |
|---|---|---|---|
| **L1 项目自己的规矩** | 「这个项目的门禁会拒绝什么？」 | 项目的 lint 配置（ESLint / stylelint / gofmt / …） | `peaks lint check` 只能**验证**，不能**提取规则** |
| **L2 语言的评审标准** | 「这种语言的代码该怎么写？」 | **OCR delegate rule** —— 接受任意路径列表，返回按 pattern 分组的规则文本，**全确定性、无 LLM、不读 key** | 机制已有；**CLI 面缺 `--files`**，只暴露了 range 参数（§2.2） |
| **L3 策展的语言规则集** | 「这种语言的通用规矩？」 | **ECC `rules/<lang>/`** —— 22 个语言目录；**ECC `agents/`** —— 68 个 agent，35 个语言专属 reviewer / build-resolver | 已随依赖装好 |

**三层都要，因为它们回答的是不同的问题。** 一个 Go 项目没有 ESLint，但有 gofmt/go vet；一个 TS 项目可能没有 stylelint，但有 ESLint + ECC 的 typescript/react 规则 + OCR 的 typescript 通道。

### 5.2 怎么做到"项目无关"

**不写任何语言分叉。** 机制是「**问项目自己声明了什么**」，而不是「我们支持哪些语言」：

1. **探测**：项目声明了哪些 lint 工具？（读 `package.json` scripts、`Makefile`、`pyproject.toml`、`go.mod`、CI 配置……）
2. **提取**：对阶段①的文件集，**用项目自己的工具**取生效规则。ESLint 有 `eslint --print-config <file>`；stylelint 有对应物；OCR delegate 的服务层已接受路径列表（`buildDelegateRuleArgs(paths, range)`），**需要把 `--files` 暴露到 CLI 面**（§2.2）。
3. **兜底**：项目没声明任何 lint 工具 ⇒ **明说"本项目未声明 lint 工具"**，而不是静默跳过（**这是本仓反复吃过的教训**：`a-count-cannot-distinguish-zero-findings-from-never-ran`）。

**ECC 与 OCR 的位置**：
- **ECC** 是**策展层**（L3），与项目无关 —— 它提供"这种语言的通用规矩"，且它已经以 npm 依赖的形式装好，`peaks ecc install` 能落到 `~/.peaks/agents/ecc/`。
- **OCR** 是**语言路由 + 规则解析层**（L2），57 种语言，已接进 peaks-rd 的 Gate B3。
- **项目的 lint 配置**是**L1**，唯一需要新写的部分。

### 5.3 Slice 4 的形状

```
peaks lint rules --files <file...> --project <repo> --json
```

返回：每个文件生效的规则清单（来源标注 L1/L2/L3），供阶段③的 prompt 内联。

**不做的事**：不做新的 lint 引擎，不解析 stylelint 配置格式，不维护语言表 —— OCR 已经路由了 57 种语言，ECC 已经策展了 22 种。

### 5.4 Slice 5 的形状

`references/micro-cycle.md`（**共享文件**）的循环加一条腿：

```
RED   → 写/改测试
GREEN → 修实现
局部回扫 → 跑同 file 的所有 test
NEW   → 跑 scoped lint（peaks lint check --scope <file>）
         红 → 在同一上下文里改 → 重跑本腿
```

**为什么这条腿是"当场 10 秒"而不是"提交时"**：现在 lint 只在 pre-commit / pre-push 才跑，那时 agent 已经换上下文、甚至已经推进到别的 bug。**返工的代价不在 lint 本身，在"发现得晚"。**

---

## 6. 共享部分 —— 哪些放在共享层

> 用户提问：「部分也是可以受益于 peaks-code，是不是做的共享部分里」。**是。** 这一节给出切分。

### 6.1 切分原则

沿用 race 设计文档 §4.4 已确立的机制：**一份规范 + 双指向 + 一个测试**。

⚠️ **反向警告（§4.4 原文）**：**不要抽过头。** 不得把两条泳道抽成一个"lane 框架"（"可控严格度引擎"、"泳道抽象层"）。判据：**两处文字若不能逐字相同，就不该抽。**

### 6.2 切分表

| 件 | 落点 | peaks-code 是否受益 |
|---|---|---|
| **规范预读**（§5.3） | `src/services/lint/` 新服务 + `peaks lint rules` | ✅ **是** —— peaks-rd 现在也是"写完才 lint"。预读让 peaks-rd 的 Gate B5/B3 从"抓"变成"先知道" |
| **micro-cycle lint 腿**（§5.4） | `references/micro-cycle.md` —— **已是共享文件** | ✅ **是** —— 两条 lane 共读 |
| **dispatch prompt 组装** | `build-dispatch-system-prompt.ts` —— **已是共享件** | ✅ 复用，不改 |
| **文件集 → 波次** | `file-overlap-wave-planner.ts` —— **已是共享纯函数** | ✅ 复用，不改 |
| **诊断阶段 prompt 形态** | 复用共享 composer；只加"只读"约束 | ⚪ 形态共享，约束是本 lane 的 |
| **批量编排**（账本 / 只读诊断 fan-out / 统一验证） | race-code 批量模式 | ❌ **本 lane 独有** |
| **修复拓扑决策**（串行/并行/混合） | Slice 3 | ❌ 本 lane 独有 |

### 6.3 一条推论：**「强化修复子代理」=「强化 peaks-rd」= 一份改动两条 lane 受益**

这是 U3（诊断与修复**都**用 peaks-rd）最值钱的地方：

- 修复子代理**就是** peaks-rd ⇒ 对 peaks-rd 的任何改进，**自动**被批量模式继承
- Slice 4（规范预读）改进的是 peaks-rd ⇒ **peaks-code 的完整泳道同时受益**
- Slice 5（lint 腿）改进的是共享的 micro-cycle ⇒ **两条 lane 同时受益**
- ⇒ **不需要为批量模式单独养一套"更强的修复 agent"** —— 养好 peaks-rd 就行

---

## 7. token 与缓存

### 7.1 现状（核对过，不是推测）

- **零 API 级缓存**：全仓 `cache_control` / `cacheBreakpoint` / `promptCache` **零命中**。peaks-loop 不发缓存标记。
- **但已有缓存友好的排布**：`build-dispatch-system-prompt.ts` 把 `LIFECYCLE_RULES`、`FACT_FORCE_GATE_BLOCK` 等**恒定字节块**放在 prompt 开头，注释明写「maximizing Anthropic prompt-cache prefix reuse」；变量块（context % / project memory / task）留在最后。CHANGELOG 4.0.26 记为「dispatch 前缀稳定化」。
- **缓存 token 只被"计量"，不被"优化"**：`claude-code-adapter.ts` 读 `cache_read_input_tokens` / `cache_creation_input_tokens`，**仅用于算上下文占用率**（驱动 auto-compact）。

### 7.2 批量模式带来的 token 变化

**增加**：N 个诊断 agent，每个都读一遍它负责的那块仓库。

**减少**：
1. **修复阶段不重读仓库** —— ①的根因+文件集+草图直接交给修复阶段。这是最大的一笔。
2. **前缀共享** —— N 个诊断 agent 同一角色、同一前缀 ⇒ 缓存命中（U3 的直接收益）。

**净**：**未实测**。这是本设计里我**没有数据**的一项。⇒ Slice 1 的验收里应包含一次**前后 token 计量对比**，用 `harness-context-witness` 已有的 `cache_read_input_tokens` 通道读数。

### 7.3 一条不该做的

**不要为了缓存去改 `build-dispatch-system-prompt.ts` 的块顺序。** 那个顺序是**有意**的，且有测试钉住（`missingRuleTokens` 守卫）。缓存优化靠的是**新代码别破坏前缀**，不是重排旧块。

---

## 7A. 上下文监控 —— 防止 100% 会话直接挂掉

> 用户追加要求：「把上下文监控加上吧，就怕上下文 100% 会话直接挂掉，适度地提醒用户上下文的使用情况，合理的提出告知用户什么时候是最佳的 compact 时机，可以先 compact 再继续」。

### 7A.1 为什么批量模式比单任务模式**更需要**这一节

单任务模式下上下文涨得慢。批量模式下有三处叠加：

1. **N 个诊断 agent 的报告同时回来** —— 一次几十 KB 到上百 KB 灌进编排器窗口。
2. **仓库里已有实测**：20 份子代理最终报告 ≈ 60 KB ≈ **15K token**，占编排器窗口的显著比例（`build-dispatch-system-prompt.ts` 的 `REPORT_CAP_BLOCK` 注释记录了这个测量）。
3. **压缩在批量模式下会被推迟**（§7A.3）—— 恰恰是最需要它的时候。

⇒ **批量模式是「上下文爆掉」这个故障最可能发生的地方。**

### 7A.2 现状（核对过，不是推测）

**已有的三块，**全部**在跑：

| 件 | 位置 | 做什么 |
|---|---|---|
| **每轮探针** | `peaks skill presence` → `context.ratioPct` / `context.action` | 每轮报上下文占用率与所在区间。**这是唯一每轮都跑的探针** |
| **区间判定** | `src/services/code/auto-compact-decision.ts` `evaluateCompactTrigger` | 0.80 / 0.85 / 0.95 三档 |
| **自动压缩** | `peaks code auto-compact` | ≥0.80 自己跑，不问用户 |
| **压缩点** | `writePreCompactCheckpoint` | 写 checkpoint（形状对齐 `peaks session checkpoint`） |
| **恢复** | `peaks code post-compact-detect` | 压缩后找回最深完成的门 |
| **用户可见的状态条** | `compact-statusline` | 8 格进度条（queued→preparing→compacting→verifying→completed / failed / stalled） |
| **最佳时机建议** | `peaks compact recommend --from --to` | 阶段转换表（research→planning→implementation→testing→debugging），纯函数 |
| **什么能活过压缩** | `peaks compact survival` | 静态表 |
| **上下文账单** | `peaks code context-audit` | 按 tool / key 拆解占用，给出 top consumer |

**所以「提醒用户占用率」和「告知最佳 compact 时机」这两件事，能力上已经存在。** 缺的**不是**新机制，是**批量模式怎么用它们**。

### 7A.3 两个真缺口

#### 缺口 1：压缩在批量模式下会被推迟，而推迟的判定会误判批量

`evaluateAutoCompactDecision` 有一条 `in-flight-batch` 分支：

```
0.85 ≤ ratio < 0.95 且 hasInFlightBatch ⇒ shouldCompact: false, reason: 'in-flight-batch'
```

**D6.e 的原意是好的**：有子代理正在跑，此时压缩会把它们打断。

**但在批量模式下，"有子代理在跑"是常态而不是例外** —— 阶段①就是 N 个诊断 agent 在并行。于是：

> 批量模式下的编排器窗口，**在最需要压缩的时候系统性推迟压缩**。

而且 `hasInFlightBatch` 由**图探针**给出（`auto-compact-orchestrator.ts:207` 注释明写 production MUST come from the graph probe）。批量模式的诊断 fan-out **不是**工作流图节点 ⇒ **探针看不见它** ⇒ 判定会走"无在飞批次"分支 ⇒ **压缩照常触发**，但此时 N 个诊断 agent 正拿着共享仓库在工作。

⇒ **两种结果都不对**：一种压早了打断 agent，一种压晚了让窗口爆掉。

**这一条必须实测，不能推理**（与 §4.1 同类问题）。

#### 缺口 2：压缩之后，批量进度会丢

`writePreCompactCheckpoint` 写的 checkpoint 内容是：

```json
{ "mode": "full-auto", "currentPlan": "...", "openQuestions": [],
  "recentDecisions": [], "recentArtifactPaths": [], "todoState": [], ... }
```

**`openQuestions` / `recentDecisions` / `recentArtifactPaths` / `todoState` 全部是空数组** —— 注释明说「We seed empty arrays; the post-compact LLM rehydrates from the auto-decisions log + open question list」。

对单任务模式这没问题（状态在编排器脑子里，压缩后从产物重建）。

**对批量模式是致命的**：压缩发生在阶段①与阶段③之间时，**编排器窗口里那些"哪几项已诊断、哪几项待修、各项的文件集"全部消失**。而这些**不在任何落盘产物里** —— 阶段①的诊断产物是逐项写的，但**"哪些项还没诊断完"这个状态**只存在于编排器的上下文里。

⇒ 压缩一次，批量模式的进度就退回到"重新诊断"。

### 7A.4 设计：三条

#### 设计 A —— 批量进度落盘（**这是解缺口 2 的**）

**新增一个批量进度产物**，与阶段①的诊断产物同目录：

```
.peaks/_runtime/<sid>/batch/<batchId>/progress.json
```

内容（**形状对齐 `peaks job` 的 `progress.json`**，让既有的 resume 机制能读）：

| 字段 | 内容 |
|---|---|
| `batchId` | 批量 id |
| `phase` | `diagnosis` / `topology` / `fix` / `verify` / `done` |
| `items` | `[{ id, label, status: pending\|diagnosed\|fixed\|verified, files[], riskSurface }]` |
| `diagnosedAt` / `fixedAt` | 时间戳 |
| `topology` | 阶段②的波次计划（可重放） |

**写点**：
- 阶段①每完成一项诊断 ⇒ 追加一条（**不是最后一次性写** —— 那样压缩正好会丢）
- 阶段②定档后 ⇒ 写一次（拓扑）
- 阶段③每完成一项修复 ⇒ 追加一条
- 阶段④后 ⇒ 标记 `done`

**压缩后怎么用**：`peaks code post-compact-detect` 已经有 `shouldAutoResume` 机制。批量模式在它之外**多读一个 `batch/<batchId>/progress.json`** ⇒ 恢复时直接知道"哪几项诊断完了、哪几项没完、文件集是什么" ⇒ **从断点续跑，而不是重跑**。

> 这是把"批次进度"从**上下文里**搬到**盘上**。与本仓已有的一致做法同源：`peaks job` 的 `progress.json` 就是为了让 `gate-step-08` 能报 `Next: slice #N of M`。

#### 设计 B —— 压缩时机：三个信号，不是单一 ratio（解缺口 1 的一半）

**现状**：只看 ratio。**批量模式下不够**，因为 ratio 只说"窗口有多满"，不说"现在压会不会打断正在跑的活"。

**提议**：批量模式的压缩判定用**两个信号**：

| 信号 | 含义 | 处置 |
|---|---|---|
| `ratio` | 窗口占用率 | 沿用 0.80 / 0.85 / 0.95 三档，**不改** |
| `batchPhase` | 当前在哪个阶段 | **阶段边界是最佳压缩点**（见下） |

**最佳压缩点 = 阶段边界**，理由是结构性的：

```
阶段①诊断(N 个 agent)→ 阶段②定档 → 阶段③修复 → 阶段④验证
        ↑                                                ↑
    此刻压缩：N 份报告刚落盘，尚未开始写代码            此刻压缩：修复已完成，验证还没跑
    —— 恢复成本最低（只需重读进度文件）
```

这正好对应用户说的「**合理的告知什么时候是最佳的 compact 时机**」。

**而 `peaks compact recommend` 已经有阶段转换表**（research→planning→implementation→testing→debugging），`peaks compact survival` 已经有"什么能活过压缩"的表。⇒ **批量模式把四个阶段映射到那套既有词汇即可**，不另造一套：

| 批量阶段 | 映射到 `recommend` 的 phase |
|---|---|
| 阶段①诊断 | `research` |
| 阶段②定档 | `planning` |
| 阶段③修复 | `implementation` |
| 阶段④验证 | `testing` |

**压缩时选 `research → planning` 或 `implementation → testing`** —— 这两条在既有表里都是 `severity: 'yes'`（"Research context is bulky; plan is the distilled output" / "Plan is in TodoWrite or a file; free up context for code"）。**既有表已经给了答案，批量模式只是把它接上。**

#### 设计 C —— 提醒用户：适度、不吵、且不违反零停顿契约

⚠️ **这里有一条必须遵守的既有红线**（`skills/peaks-code/SKILL.md` Step N+2）：

> 任何"请用户自己去运行 `/compact`"的文案都是**回归**。压缩是**系统责任**，不是用户动作。

**这条有机器守卫**：`tests/unit/cli/skill-presence-loop-hygiene.test.ts` 断言 `buildContextVerdict` 的 `nextActions` 在 0.82 / 0.9 / 0.96 三个比率下**都不含** `ask the user to compact` / `prompt the user to run` / `user should run`。⇒ **任何新的提醒文案都要走同一个 `buildContextVerdict` 通道**，否则既绕过守卫又破坏契约。

所以提醒的形状**不是**"你该压缩了"，而是**告知已经发生的事**：

| 什么时候 | 说什么 |
|---|---|
| 平时（< 0.80） | **不说**。ratio 已在 `presence` 的 `context` 块里每轮可见，用户想看就看 |
| 进入 0.80–0.85 | 一行：`上下文 82%，已进入自动压缩区` —— 陈述**已经发生的事**，不要求动作 |
| 阶段边界 | 一行：`诊断完成（N/M 项）；正在压缩 —— 这是恢复成本最低的时点，进度已落盘` —— **陈述系统正在做**，不是建议用户做 |
| ≥ 0.95 | `已请求 harness 压缩，等待中；派发未阻塞`（`compactNextActions` 现成文案） |

**关键**：`auto-compact` **照旧自己跑**，用户不需要做任何事。提醒只是让他知道**发生了什么** + **什么时候最划算**。

⚠️ **注意阶段边界那条的措辞**：它必须是「**正在压缩**」而不是「**建议现在压缩**」。前者是系统陈述，后者就是被守卫禁止的"把压缩甩给用户"。这三个比率下的文案都要走 `buildContextVerdict` 同一个通道（§7A.4 的守卫）。

⇒ 用户那句「**可以先 compact 再继续**」在这套设计里成立：压缩在阶段边界自动发生，**批量进度从盘上恢复**，工作继续。

### 7A.5 与既有机制的关系（不重造）

| 用户诉求 | 已有件 | 缺什么 |
|---|---|---|
| 提醒上下文占用率 | `presence.context.ratioPct` 每轮可见 + `context-now` | 批量模式下**阶段边界**的提示（设计 C） |
| 告知最佳 compact 时机 | `peaks compact recommend` 阶段转换表 | **批量四阶段 → 既有 phase 词汇的映射**（设计 B） |
| 先 compact 再继续 | `auto-compact` + `post-compact-detect` | **批量进度不落盘 ⇒ 压缩后丢进度**（缺口 2 ⇒ 设计 A） |

**⇒ 三个设计里只有设计 A 是造新件。** B 是接线，C 是接线 + 文案。

### 7A.6 新增 slice

| # | 内容 | 依赖 |
|---|---|---|
| **Slice 6** | **批量进度落盘**（设计 A）：`batch/<batchId>/progress.json` + 压缩后从它恢复 | Slice 1 |

**并入 Slice 2 的验收**：阶段边界的压缩提示（设计 B 的映射 + 设计 C 的文案）。

### 7A.7 未决

| # | 项 | 处理 |
|---|---|---|
| U-h | **压缩在批量模式下到底会不会打断诊断 agent** —— `hasInFlightBatch` 的图探针看不见诊断 fan-out（§7A.3 缺口 1） | **必须实测**。与 §4.1 的 driver probe 同类，但**更早**：它影响 Slice 2 的验收（压缩发生在阶段边界时，不能打断任何东西） |
| U-i | 压缩 checkpoint 的 `openQuestions` / `recentDecisions` / `todoState` 全空 —— 单任务模式靠"压缩后从产物重建"，批量模式靠设计 A | 设计 A 落地后，批量恢复**不依赖**这些空字段 |
| U-j | 「适度提醒」的频率 —— 每轮说会吵 | 设计 C 默认**只在 0.80+ 与阶段边界说**，平时不说。具体措辞随实现期定，但**必须过 `peaks audit red-lines`**（§7A.4 的红线） |

---

## 8. 未决与风险

| # | 项 | 处理 |
|---|---|---|
| U-a | **race presence 下 Task 子代理能否改 `src/`** —— §4.1 的 probe | **Slice 3 第一件事**。Slice 1/2/4/5 不依赖 |
| U-b | 诊断的**预计文件集可能不准** | Slice 1/2 无害；Slice 3 靠工作树物理隔离兜底 |
| U-c | **波次规划器不做路径规范化** —— `src\a.ts` 与 `src/a.ts` 被当作不同文件 | 诊断产出的文件集必须规范化后再喂入。**Windows 上不做这一步 = 整个冲突检测失效** |
| U-d | 统一验证红了如何归因 | 阶段③的 scoped test 已把单 bug 拦在当场；阶段④只负责集成层。验收里要证明这一点 |
| U-e | **token 净变化未实测** | Slice 1 验收含前后计量对比 |
| U-f | 项目 lint 工具的**探测规则**（读什么文件判断"项目声明了什么"）未定 | Slice 4 实现期定。约束：不做语言分叉 |
| U-g | ECC / OCR 在**下游项目**里是否可用（它们是 peaks-loop 的依赖，不是项目自己的） | ECC 是 peaks-loop 的 npm 依赖 ⇒ 随 peaks-loop 装 ⇒ 对下游**可用**。但**项目的 L1 规则**仍要项目自己声明 |
| U-h | **压缩在批量模式下会不会打断诊断 agent** —— `hasInFlightBatch` 的图探针看不见诊断 fan-out（§7A.3 缺口 1） | **必须实测**。比 §4.1 的 driver probe 更早影响：它决定 Slice 2 的验收标准 |
| U-i | 压缩 checkpoint 的 `openQuestions`/`recentDecisions`/`todoState` 全空 | 单任务靠"压缩后从产物重建"；批量靠 Slice 6 的 `progress.json` |
| U-j | 「适度提醒」的频率与措辞 | 默认只在 0.80+ 与阶段边界说；**必须过 `tests/unit/cli/skill-presence-loop-hygiene.test.ts`**（§7A.4 的零停顿红线 —— 那个测试才是真正的守卫，`peaks audit red-lines` 只扫描 MANDATORY/BLOCKING 标记，不查这条） |

---

## 9. 非目标

- ❌ 不改 peaks-code 的**行为**（§1 不变量 4）
- ❌ 不改 `HARD_BLOCKED_PATH_FAMILIES` 的内容
- ❌ 不新增独立 CLI 顶层动词
- ❌ 不实现 `peaks-race-<domain>` 的其他成员
- ❌ 不做新的 lint 引擎、不维护语言表（OCR 已路由 57 种，ECC 已策展 22 种）
- ❌ **不抽"lane 框架"**（§6.1 反向警告）
- ❌ 不降低统一验证的严格度（U4）
- ❌ 不在 Slice 1/2 里动修复拓扑（U5）
- ❌ **不改**压缩的 0.80 / 0.85 / 0.95 三档阈值 —— 批量模式只**接线**，不动机制（§7A.4 设计 B）
- ❌ **不写"请用户自己运行 `/compact`"的文案** —— 压缩是系统责任（§7A.4 设计 C 的红线）

---

## 10. 一句话

> 把「N 个独立 bug」从 **N 次门禁墙钟** 变成 **1 次**，把「写完才知道规矩」变成 **动手前就知道规矩**，并且**只靠强化 peaks-rd 一件事**就让两条泳道同时受益。
>
> 上下文爆掉不是批量模式的受害者，是它的**头号故障模式** —— 所以批量进度必须落盘，压缩点必须选在阶段边界，而提醒只陈述事实、不把压缩变成用户的事。
