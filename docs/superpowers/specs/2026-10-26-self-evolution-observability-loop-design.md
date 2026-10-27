# 自进化闭环的可观测底座 — 设计（v1）

- 日期：2026-10-26
- 状态：**设计已成形，未实施**
- 范围：`peaks-loop` 自身（技能层 / 门禁层 / 棘轮层）
- 前置事实核对时间：2026-10-26（本文所有"实测"结论均为当日实跑输出或当日读源码，非推测）

> **怎么读这份文档**
> - **只想知道要做什么、做完长什么样** → 读 **§0**（大白话）和 **§8**（一页纸速览）。够了。
> - **要实施** → 读 §1（依据）、§2（设计）、§4（切片判据）。§1.5 / §1.6 是外部调研，别跳过。
> - **技术细节**（schema 字段、命令参数、指标定义）都在 §2，不需要先读 §1.5 才能看懂。

---

## 0. 用大白话说这份 spec

### 0.1 你现在遇到的是什么问题

你想改 `skills/bee/peaks-rd/SKILL.md`，然后想知道"**这次改动到底有没有让事情变好**"。

现在没有办法知道。不是因为没努力，而是**这个仓库从来没记过"技能到底是怎么被执行的"**。具体地说，有两个洞：

**洞一：判断"干得好不好"的那把尺子本身是坏的。**

现在判断一个 slice 干得好不好，看的是 QA 说"通过"。但历史数据里有这种情况：

> 门禁**根本没被检查过**（`bypassing ONLY the file-size gate ... none of them was evaluated`），QA 照样给了"通过"。

而且汇总报表把这种 slice 记成了**成功** —— `fail count` 显示 0，可表里有 8 个 `✗`。

**"通过了"和"真的做对了"之间有道缝。缝有多大没人知道，因为没人记。** 这道缝在专业上叫"近失"（near-miss）。

**洞二：连"哪里出了问题"都看不到。**

你跑 `peaks observability report`，它会告诉你 `total events 0`、"没有任何 slice 记录"。

**但仓库里其实有 1533 条事件。** 命令默认只查今天这个空的 session，所以显示 0。你据此得出的"没有数据"的结论，是查询口径造出来的假象。

而且就算查对了 session，最关键的信息也被扔掉了：门禁说"你缺 3 个文件"，事件里只记了 `missingCount: 3`（一个数字），**没记是哪 3 个**。那条信息当时就在内存里，被 `.length` 换掉了。

### 0.2 改完之后你会看到什么

**三条新命令：**

```
$ peaks observability near-miss
近失率: 8 / 40 个通过的 slice 是靠跳过门禁换来的 (20%)
  rid-t2-presence-cross-session        跳过的门禁: file-size-ratchet  (从未被评估)
  rid-t2-repo-agents-md-bootstrap      跳过的门禁: declared-type-corroboration
  ...
```

```
$ peaks observability hotspots
技能            缺了什么                  次数   置信度
peaks-rd        audit/security-<rid>.md    12   exact
peaks-rd        rd/bug-analysis-<rid>.md    5   exact
peaks-qa        qa/test-reports/<rid>.md    3   inferred
```

```
$ peaks observability report          # 报告最前面多一节"近失"，其次是"卡点 Top-N"
```

**以及一份能读的历史**：`peaks observability status --all-sessions` 能看到全仓库的 1533 条事件，而不是 0。

### 0.3 "自进化"具体长什么样

改完之后，一次真实的改进循环是这样：

```
1. 跑数据      → near-miss 报出：近失集中在 declared-type-corroboration 门禁
2. 定位        → hotspots 报出：peaks-rd 漏写 audit/security-<rid>.md 12 次
3. 提案        → 系统给一张候选清单：
                 "peaks-rd 的第 4 步（派发安全审计）遵守率 0.4，
                  近失贡献 7 次。建议：提升为 hook 强制。"
4. 改          → 人（或 LLM）把它改成一条 hook 规则 —— 不是改文案，是让系统没法跳过
5. 验证        → 下一个窗口重跑同一指标：近失率从 20% → 5%，遵守率 0.4 → 1.0
6. 留痕        → 这条改动连同"改前 20% / 改后 5%"记进 evolution_evaluation 表，
                  以后能查、能回滚
```

**和现在的区别**：现在改 SKILL.md 靠感觉，改完不知道有没有变好，下次还会改回去。

### 0.4 为什么分四步做，不能一次做完

有硬依赖：**没有数据 → 不知道该改谁 → 提不出靠谱的提案 → 没法验证改动是好是坏。**

所以四步之间设了两道闸，**闸不过就不许往下做**。特别是第 3 步和第 4 步之间：没有配对实验（同一个任务、同一个技能改前改后各跑一次）验证的改动，**只能停在"等人决定"，不许自动采纳** —— 否则就成了"我觉得变好了"。

### 0.5 这份 spec 明确不做的事

- **不自动改写 SKILL.md** —— 只给候选清单和证据，怎么改由你（或 LLM）决定
- **不把"通过率"当成目标** —— 通过率在技能质量上是失明的（见 §1.6），降级成参考指标
- **不读运行时私有会话记录** —— 轨迹从 peaks-loop 自己的 hook 层来，隐私面小得多
- **不搬外部代码** —— 只借设计思想，实现自己写
- **不一次给 25 个技能都写规范** —— 先试点 `peaks-rd` + `peaks-race-code`

---

## 1. Problem

### 1.1 用户的原话

> 现在我感觉 peaks-code、peaks-race-code、peaks-rd 等等都是偏黑盒的，想优化技能、脚本、等等完全是一头雾水的，没有实际的日志等数据，根本没有方向，也无法[实现] peaks-loop 这个项目自进化。

这句话里有两个可以分开验证的命题：

- **P1（可观测性）**：技能与门禁的行为不可见 → 无法定位"哪里该改"。
- **P2（自进化）**：没有自进化的闭环 → 无法让改动被度量、被保留、被回滚。

本文的结论是：**P1 基本为假，P2 为真**，且 P2 的病灶可以用一句话定位。

### 1.2 现状审计（实测）

**(a) 仪器已经存在，而且有真实数据。**

事件流在 `.peaks/_runtime/<sessionId>/metrics/slices.jsonl`（`src/services/observability/jsonl-store.ts:35`）。全量扫描本仓库 12 个 session：

| 类别 | 条数 |
|---|---|
| `slice-transition` | 1180（77%） |
| `dispatch` | 322 |
| `lease` | 29 |
| `checkpoint` | 2 |
| **合计** | **1533** |

schema 声明了 **10 个** category（`src/services/observability/observability-schema.ts:21`）。**已声明但在全部记录历史中从未发出过的有 6 个**：`cycle` / `token-usage` / `monotonic-trigger` / `mode-gate` / `context-trigger` / `post-compact`。

（补充核对：这 6 个**全都有 emitter** —— `cycle` / `token-usage` / `monotonic-trigger` 在 `observability-service.ts`，`mode-gate` 在 `code-mode-gate-should-pause-envelope.ts`，`context-trigger` 在 `context-check-command.ts`，`post-compact` 在 `post-compact-detector.ts`。）**所以问题不是"没写"，是"条件触发，而我们那 12 个 session 没走到那些流程"** —— 例如 `cycle` / `monotonic-trigger` 只由 loop runtime 触发。声明了却不交付数据，本身就是一种黑盒：schema 承诺了一件它不做的事。

**(b) 最有价值的信息在最后一米被丢弃。**

`src/services/artifacts/prerequisite-transition-event.ts:35`：

```ts
missingCount: opts.result.missing.length
```

而 `opts.result.missing` 的类型是 `Array<{ path: string; description: string; kind: 'absent' | 'body' }>`（`src/services/artifacts/artifact-prerequisites.ts:97`）—— 每个缺件的**路径、描述、是"文件不存在"还是"内容标记缺失"**都已在内存里，然后被 `.length` 换成了一个整数。

538 次带 prereq 判定的迁移中，**113 次 prereq 失败**。这 113 次失败目前只留下一个数字。

而 `path` 的首段就是产出该 artifact 的角色（`rd/` `qa/` `audit/` `prd/` `sc/`），`missing` 列表本身就是"哪个技能没交活"的**确定性归属源** —— 不需要 LLM 配合，不需要新协议。

**(c) 真正的"为什么"存在，但只以自由文本存在，且只覆盖了一小部分。**

113 次失败中，**只有 14 条带 `detail.reason`**（其余 99 条只留了计数）。这 14 条里写着门禁层的真缺陷，反复出现三类：

1. **门禁作用域与 slice 作用域不一致** —— tree-wide 的 file-size / type-corroboration 门禁按整个工作树判定，平行 slice 的未提交源码让 chore slice 永远过不了。
2. **状态机缺值导致 fail-closed 拦下正确产出** —— QA 写出 `verified` / `completed`，而角色状态机只定义 `draft / running / verdict-issued / blocked`，state-order 门禁把已完成的工作判为失败。
3. **认领表不完整使反撒谎兜底整体静默失效** —— 22 个 RD artifact 中 19 个没有 `## Changed paths` 段，兜底因此不启用。

这三条都是**门禁 / 契约层**的缺陷，不是技能文案的缺陷。它们现在只躺在 JSONL 里，没有任何人或命令会读。

**这 14 条的样本量极小，但每一条的诊断精度极高** —— 它们不是"某个门禁失败了"，而是"这个门禁的语义和 slice 的语义不一致"。这正是当前系统最缺的那种信息。

**(c2) 而这 14 条之所以只能以自由文本存在，是因为门禁层根本没有被事件化。**

`src/services/artifacts/rd-transition-gates.ts`（223 行）负责 RD 三个相位（`implemented` / `qa-handoff` / `handed-off`）的门禁判定，产出 `RdGateViolation`（`source-touched` / `source-unclaimed` / `diff-unavailable`）与 bypass 说明文本 —— 但**它不发任何观测事件**，schema 里也没有 `gate` 这个 category。

**门禁层对事件流完全不可见。** 一次门禁 pass / block / bypass，除了偶然被 prereq 事件的 `reason` 捎带（且只在同时伴随 prereq 失败时，全历史仅 14 次），不留任何结构化痕迹。

而 (c) 认定的那三类反复出现的缺陷**全部在门禁层**。**最该被优化的那一层，恰恰是唯一一层完全没被观测到的。**

**(d) "看不见" 有一部分是口径造成的假象。**

`src/cli/commands/observability-commands-queries.ts:43`：

```ts
export function resolveSessionId(optionSession, projectRoot) {
  if (optionSession !== undefined) return optionSession;
  return getSessionIdCanonical(projectRoot) ?? undefined;   // ← 有绑定时永远命中
}
```

于是 `readAllSessionEvents` 的全量分支（同文件 `:59` / `:105` / `:146` / `:196`）**在 CLI 路径上不可达**，而所有查询默认走 canonical session。实跑：

```
$ peaks observability report --project . --period month
- scope: session `2026-10-26-session-fb8cc6`
| total events | 0 |
| total slices | 0 |
| fail count   | 0 |
_No slice transitions recorded for this period._
```

同一时刻仓库里有 1533 条事件。**跑一次默认命令看到的是"零"，于是得出"没有数据"——这个结论本身是数据产生的假象。** 指到有数据的 session 才看得见：

```
$ peaks observability report --project . --session 2026-10-23-session-5e40e0 --period month
| total events | 550 | | total slices | 40 | | repair-cycle peak | 5 |
```

那张表里 **8 个 slice 的 final state 停在 `qa-handoff`**（时长 733.9m / 710.2m / 102.9m / 81.5m / 74.6m / 6.2m / 6.0m / 49.4s）—— 就是"进去了出不来"。

另有一处口径不自洽：同一份输出里 summary 写 `successCount 32` / `failCount 0`，而 slice 表里恰有 **8 个 `✗`**。40 = 32 + 8，分子对得上，但失败计数是 0 —— **失败的 slice 被 summary 记成了成功**。

**(e) 自进化机制建好了，从未接线。**

Darwin 棘轮的能力是齐全的：`peaks evolution propose / evaluate / mark-keep / revert / status`（`src/cli/commands/evolution-commands.ts`），硬规则七条齐全（单目标 / 单维度 / 独立评审 / 回归怀疑者 / 阈值 / 用户确认 / 禁止自评，`src/services/evolution/evolution-types.ts:32-42`），**且 `bee`（技能）本来就是合法的进化目标**：

```
$ peaks evolution status --project . --target bee:peaks-rd
{"target_kind":"bee","target_release_id":"peaks-rd","total":0,
 "byVerdict":{"keep":0,"revert":0,"needs-user-decision":0}}
```

`.peaks/state.db` 中 `evolution_evaluation` **0 行**、`crystallization_event` **0 行**、`bee_change` **0 行**。

而 proposal 的输入是这样的（`src/cli/commands/evolution-propose-command.ts:96-118`）：

```ts
before_snapshot: {},
after_snapshot:  { after_score: prep.after },
diff:            {},
before_score:    prep.before,      // ← LLM 自报，0..10
after_score:     prep.after,       // ← LLM 自报，0..10
rubric:          {},
red_lines:       [],
source_traces:   []
```

**一行 proposal 的全部内容 = 目标 id + LLM 自报的两个分数。** DDL 里预留的快照、diff、rubric、红线、证据指针（`src/services/evolution/evolution-evaluation-schema.ts:20-55`）**五项全空**。

**(f) 反馈回路的另一半也是停的。**

`.peaks/retrospective/index.json` 停在 `2026-06-09`（88 条：60 in-flight / 11 shipped / 17 blocked），四个多月未更新。

**(g) 命名澄清。** `peaks-mut` 的 mut 是 **mutation testing（Stryker）**，不是"技能变异"；本仓库**没有** SKILL.md 优化器。外部的 `darwin-skill` 是另一套评分器，与 peaks-loop 的 Darwin 棘轮无关，接线时不可混用。

### 1.3 诊断

> **不是"没有数据"，而是：数据在最后一米被丢掉了（b）、可见口径坏了（d）、到不了那个已经建好的棘轮（e）。**
>
> 棘轮的病灶可以用一句话定位：**`before_score` / `after_score` 是 LLM 自报的数字，没有数据源。** 机制有了，尺子没有。

于是 P1 基本为假（数据在，只是答不了"该改哪儿"），P2 为真（闭环缺的不是机制，是**把自评分换成实测**的那一层）。

### 1.4 为什么不能只做"看得见"

只做可观测层（不改棘轮输入）的失败模式，**这个仓库已经演过一次**：仪表装了，retrospective 停更四个月、`evolution_evaluation` 0 行、`crystallization_event` 0 行、`bee_change` 0 行。再加一个没人开的看板，概率很高。

而跳过可观测层直接做"自动提案"的失败模式：提案的改前 / 改后没有客观依据，独立评审者评的是一份自述，回归怀疑者怀疑的也是自述 —— **垃圾进，垃圾出，但披着棘轮的外衣，看起来很严谨**。这比黑盒更危险。

**结论：闭环必须闭，但必须按"数据 → 提案 → 实测 → 判定"的顺序建，不能跳。**

---

## 1.5 外部参照（2026-10-26 调研）

按用户提议"抄作业"做的外部检索与本地勘查。**结论先行：调研推翻了本 spec 的一个核心判断 —— 见 §1.6。**

### 1.5.1 四个来源

**① Hermes（Nous Research）`hermes-agent-self-evolution`** —— MIT，2026-06 开源。核心是 DSPy + **GEPA**（Genetic-Pareto Prompt Evolution，ICLR 2026 Oral）在 agent 层（memory / skills / prompts / tools）自进化，不动模型权重。

可移植的：
- **变异由失败轨迹驱动**，不是随机重写 —— 这正是 §2.5 的 `mine` 该做的事
- **"Benchmarks are GATES, not fitness functions"** —— 基准是闸，不是适应度函数；候选可以任务分更高但因回归被否
- **"Deployment via PR (Never Direct Commit)"** + 人工评审合并 + 独立 holdout 防过拟合
- 硬约束闸：全套测试通过、size budget（技能 ≤15KB / 工具描述 ≤500 字符）、**演化文本与原文保持语义相似**、schema 冻结、不得删除安全检查、prompt 缓存不得失效、不得热替换进活跃会话
- 适应度组合：过程遵守度 + 产出有用性 + 简洁度 + 长度惩罚

不可移植：GEPA 本身（需 DSPy + Python 栈）、五阶段全量路线。

**② `skill-comply`**（ecc-universal 2.2.3，**MIT**，已在本地 `node_modules` 内）—— 形状与本需求高度同构，值得逐条读。

它的流水线：**`.md` 目标 → 自动生成 ComplianceSpec（YAML：有序步骤 + `required` + 探测器描述 + `before_step`/`after_step` 时序约束）→ 捕获工具调用 trace（JSONL）→ LLM 把事件分类到步骤 → 确定性时序判定 → 遵守率 + hook 提升建议**。

三个直接可用的设计：
- **技能被表达为"可判定的步骤序列"**，而不是散文
- **时序约束由代码判定**（LLM 只做分类，不做判定）—— 正是"评分不能是 LLM 自评"的答案
- **低遵守率的出路是"提升为 hook"**（`threshold_promote_to_hook`，默认 0.6），而不是改文案

它还有一个我原 spec 完全缺失的维度：**prompt 严格度阶梯**（支持性 → 中性 → 竞争性），用来测**prompt 独立性** —— 技能在用户没催它的时候还扛不扛得住。

**③ 论文**（见 §9 引用）：
- **SOPBench**（ICLR 2026）：用**代码化的多层验证**（outcome / step-level / trajectory-level）替代 LLM judge；一个"用最合适的工具尽快完成"的提示，就让某模型**相对通过率掉 86.2%**
- **CTA / Counterfactual Trace Auditing**（arXiv 2605.11946）：配对比较"有技能 / 无技能"的轨迹，标注 Skill Influence Pattern（构造性：Procedural Scaffolding、Edge-case Prompting；中性：Redundant Exploration；**破坏性：Surface Anchoring、Concept Bleed**）
- **Near-Miss**（IBM，arXiv 2603.29665）：**latent failure** —— agent 绕过必需的政策检查却达到了正确的最终状态
- **AgentPex / Willful Disobedience**（arXiv 2603.23806）：从 prompt / tool schema 抽取行为规则后给轨迹打分，**48/58 条 τ²-bench 满分轨迹仍存在过程违规**
- **MAC-Bench / Beyond Goodhart's Law**（arXiv 2606.07805）：提出 Compliance-Weighted Success Rate 与 Machiavellian Gap，警告 Goodhart

### 1.5.2 许可与红线

`ecc-universal` 是 MIT；Hermes 自进化仓库也是 MIT。**但本仓库的 AGENTS.md 规定外部仓库"只作策展参考，未经明确批准不得执行或安装"**。因此本设计的立场是：**移植设计思想，TS 自行实现**；若将来要直接搬 `skill-comply` 的代码，需用户单独批准并附 MIT 署名。

### 1.5.3 一条被证伪的直觉

调研前我以为"peaks-code 的 SKILL.md 44KB 太大"。**这是错的** —— peaks-loop 已经做了渐进披露（`skills/peaks-code/references/` 有 41 个引用文件，主文件加载、引用按需加载），Hermes 的 15KB 预算针对的是单文件平铺，不适用。真正成立的问题只有一个：**入口文件 44KB ≈ 11k tokens，技能是否挣回了这份开销，从未被测量过。** 这恰恰是 CTA 要问的问题。

---

## 1.6 调研推翻的核心判断（本 spec 的最重要修订）

**peaks-loop 用来判断成功的指标 —— "QA verdict 通过" —— 正是文献证明对技能质量最不敏感的指标。**

三条独立证据指向同一处：

| 证据 | 结论 |
|---|---|
| CTA | 49 个任务里 **45 个通过率毫无变化**，却出现 **696 处分歧 / 522 个 SIP 实例**（平均每任务 10.7 个）；**37 个"天花板任务"（基线通过率 ≥90%）里藏着 415/522 = 80% 的 SIP 实例**，而通过率平均只掉 0.5pp |
| AgentPex | **48/58 条 τ²-bench 满分轨迹**里仍存在过程违规 |
| Near-Miss | **8.6%–17.3%** 的 latent failure：绕过必需检查、却给出正确答案 |

**peaks-loop 的 QA verdict 是一次"最终状态是否正确"的判定，而它的门禁系统是一套"必需检查"—— 这正是 Near-Miss 的定义。** 而 peaks-loop 自己的数据已经证明了这一点：§1.2(c) 引的那 14 条 `reason` 原文，说的就是"**bypassing ONLY the X gate ... via --allow-incomplete; none of them was evaluated**"——**门禁从未被评估，QA 仍然给出了通过的结论**。

**所以本 spec 的头号产出应当是 peaks-loop 自己的 near-miss 率（近失率），而不是遵守率。** 理由：近失率是 QA verdict **结构上看不见**的那个量，而遵守率虽然更贴近病因，却需要为 25 个技能逐个编写 ComplianceSpec（成本高一个数量级）。

排序：

1. **近失率（near-miss rate）** —— "通过的 slice 里，有多少比例跳过了必需门禁且该门禁从未被评估"。**用 S1.5 的 `gate` 事件即可算，且立刻可算**。
2. **遵守率（compliance rate）** —— 逐步骤的执行率。只对少数高价值技能做（试点 2–3 个）。
3. **通过率** —— **降级为参考指标，不作为适应度**（CTA 已证明它在天花板任务上失明）。
4. **token 开销 / 用户干预次数** —— 成本侧。Hermes 官方文档推荐用"**更少的引导与更少的纠正**"衡量改进，而不是合成分数 —— 这对应 peaks-loop 已有的 `peaks user-touchpoints` 概念。

还有两个数字直接进了设计：
- CTA：**84% 的分歧发生在早期**（Orientation 44% + Implementation 40%）—— 而 peaks-loop 的观测**全部发生在验证期**（状态迁移）。**分歧发生的地方我们根本没在看。** 这要求 trace 从流程一开始就采，而不是只在迁移时采。
- CTA：技能 token 开销均值 **1.91×**，个别案例 **22.24×** —— 而 peaks-loop 的 `token-usage` 是**六个从未发出的哑 category 之一**。成本侧根本没测。

---

## 2. Design



### 2.1 分层：四条接缝

```
[S1] 证据不丢 + 轨迹采集 ──► [S2] 看得见 ──► ┃闸1┃ ──► [S3] 数据→提案 ──► ┃闸2┃ ──► [S4] 棘轮跑起来+度量
 missing[] / gate 事件        口径修 + 近失率      可指名       合规规范 +          配对验证 +
 tool-trace / presence 归属   hotspots + 合规率                 四种动作 + 约束闸    漂移检查
 哑 category 清算
```

两道闸都是**硬闸**：过不了就停，不许往下做。

### 2.2 S1 —— 证据不丢

**S1.1 缺件落地。** `prerequisite-transition-event.ts` 的 `detail` 扩展为：

```ts
detail: {
  artifactRole, to, prereqOk,
  missingCount,                                  // 保留，旧读者不受影响
  missing: Array<{                               // 新增
    path: string,
    description: string,
    kind: 'absent' | 'body',
    ownerSkill: string                           // 由 path 首段 + 文件名推出
  }>,
  ownerSkill: string                             // 缺失项的聚合归属（单数时为其一）
}
```

`ownerSkill` 的推导规则是**静态的、无歧义的**：`rd/` → `peaks-rd`；`qa/` → `peaks-qa`；`prd/` → `peaks-prd`；`sc/` → `peaks-sc`；`audit/security-` → `peaks-security-audit`；`audit/perf-` → `peaks-perf-audit`。推导规则是一张**受版本控制的常量表**（不是散落在代码里的 if），因为它同时是"技能 ↔ 门禁 ↔ artifact"的索引，后面 S3 的提案要靠它。

**归属有两个维度，都要记**：
- `ownerSkill` = **该交活的技能**没交 → 改它的 SKILL.md / 产出指令。
- `artifactRole`（已有）= **被卡住的那个角色** → 改它的流程说明。

**S1.2 哑 category 清算。** 6 个在记录历史中从未发出的 category（`cycle` / `token-usage` / `monotonic-trigger` / `mode-gate` / `context-trigger` / `post-compact`）**都有 emitter**（见 §1.2(a) 的补充核对）。因此审计的终态是三种：**① 确认为条件触发并在 schema 注释里写明触发条件**，**② 补一个让它在常规流程里也发事件的接线**，**③ 从 enum 中删除**并说明理由。留一个永远不发的 category 在 schema 里，是在向未来的读者承诺一件不会发生的事。

其中 `cycle` 与 `monotonic-trigger` 只由 loop runtime 触发（`src/services/loop/loop-observability.ts`），常规 peaks-code 流程根本不走那条路 —— 这一项的审计结论会直接决定 §2.8 的接线形态。

**S1.3 schema 演进：加字段，**不**升版本号。**

调研期间发现的陷阱，必须写进设计：`readObservabilityEvents`（`src/services/observability/observability-service.ts:109`）用 `ObservabilityEventSchema.safeParse(raw)` 逐行校验，**任何 schemaVersion 不匹配的记录被直接跳过**；而 schema 里写的是 `schemaVersion: z.literal(1)`。

**后果：一旦把版本号升到 2，仓库里全部 1533 条历史事件会瞬间变得不可读 —— 而且是静默的（safeParse 失败 → continue）。这恰好会制造出本计划要消灭的那个"零数据"假象。**

因此本设计采用**纯增量扩展，不动版本号**：

- 新字段一律 `.optional()`（`detail` 本身已经是 `z.record(z.string(), z.unknown())`，多余的键天然兼容）
- `schemaVersion` 保持 `z.literal(1)`
- **向前兼容因此得以保持**：旧版本 peaks-loop 读新文件时，多出来的 `detail` 键会被忽略而不是报错

"这一条记录是旧格式还是新格式"由**字段是否存在**来区分，而不是由版本号区分 —— 这与本仓库"事件流是向前写的 JSONL，不是需要迁移的表"的形态一致。

真要升版本号的那一天，必须同时改读者（改成 union / 判别式），并**先写一个测试断言旧记录仍可读**。

**S1.4 技能版本绑定。** 每个 session 记录一次 `skills/` 目录树的 git blob sha（会话开始时取一次），查询时与事件 join。这样"某条失败发生在 SKILL.md 的哪个版本"可查 —— 没有它，跨版本比较无从谈起。

**S1.5 门禁事件化 —— 让"缺陷最集中的那一层"变得可见。**

审计发现的事实：`src/services/artifacts/rd-transition-gates.ts`（223 行）负责 RD 三个相位（`implemented` / `qa-handoff` / `handed-off`）的门禁判定，产出 `RdGateViolation`（三种：`source-touched` / `source-unclaimed` / `diff-unavailable`）与 `rdGatesBypassNote`（bypass 时的说明文本）—— 但**它不发任何观测事件**，schema 里也没有 `gate` 这个 category。

**结论：门禁层对事件流是完全不可见的。** 一次门禁判定 pass / block / bypass，除了偶然被 prereq 事件的 `reason` 自由文本捎带（且只有同时伴随 prereq 失败时才会出现 —— 全历史仅 14 次），不留任何结构化痕迹。

而 §1.2(c) 认定的三类反复出现的缺陷**全部在门禁层**。也就是说：最该被优化的那一层，恰恰是唯一一层没有被观测到的。

因此 S1 必须新增一个 category（`gate`），每次门禁判定发一条：

```ts
{
  category: 'gate',
  sliceRid,
  detail: {
    gateId: string,          // 门禁的稳定标识（如 'file-size-ratchet' / 'declared-type-corroboration' / 'state-order'）
    phase: RdGatePhase,      // implemented | qa-handoff | handed-off
    outcome: 'pass' | 'block' | 'bypass',
    violationKind?: 'source-touched' | 'source-unclaimed' | 'diff-unavailable',
    bypassed?: string[],     // 被跳过的门禁 id 列表
    reason?: string          // 现成的 bypass 说明文本（脱敏后）
  }
}
```

**注意 `bypassed` 是一个数组** —— 现有 bypass 说明里出现过"只跳过 file-size 门禁""跳过了 state-order 门禁"这类**多门禁部分跳过**（reason 原文里就是 "Bypassing ONLY the ..." 的形式），逐个门禁分别发事件会丢失这个语义。

有了这一层，`gate-false-block-rate` 才可算（分母 = 该门禁的评估总数，分子 = 其中被 bypass 的次数），而且——更重要的——**门禁的误伤面第一次能被排序**。

**S1.7 轨迹采集 —— 从"状态迁移"升级到"过程全量"。**

调研的第二个硬结论（§1.6）：**CTA 实测 84% 的技能诱导分歧发生在早期**（Orientation 44% + Implementation 40%），而 peaks-loop 的观测**全部发生在验证期**（状态迁移）。分歧发生的地方我们根本没在看。

因此需要一条**工具调用级**的轨迹流。三个设计要点：

**(a) 轨迹源：peaks-loop 自己的 hook 层（不是读别家的 transcript）。**

peaks-loop 已经有两个 hook 事件在跑：`PreToolUse`（`src/services/hooks/pre-tool-code-gate.ts`，负责拦 Bash）与 `PostToolUse`（`src/services/hooks/presence-marker-detector.ts`）。而且 `src/services/ide/hook-translator.ts` + `hook-protocol.ts` 已经把 hook 协议在 9 个 IDE 适配器之间做了翻译。**加一个 PostToolUse 记录器，就得到一条跨运行时、跨 IDE 的工具调用轨迹** —— 这符合 AGENTS.md"适配器层是唯一做厂商翻译的地方"的原则，且不依赖任何厂商私有格式。

（读运行时自己的 transcript —— 例如 Claude Code 写在 `~/.claude/projects/` 下的会话记录 —— 属于**厂商私有格式**，若要做必须放进**活的** vendor 层 `src/services/runtime/vendors/`，**不是** `src/services/adapter/` —— 那个目录下的 claude/codex/copilot adapter 是死代码，零引用，每个方法都抛 `ADAPTER_NOT_IMPLEMENTED`。而且它是用户全部会话的明文，隐私面比 hook 大得多。默认不做。）

**(b) 归属：presence lease 已经解决了"当时是哪个技能在跑"。**

peaks-loop 的技能层本来就发 `presence:set` / `presence:clear`（每个 SKILL.md 的第一个动作就是 `peaks skill presence:set <skill> --mode <mode> --gate <gate>`）。**这意味着轨迹事件可以按时间 join 到当时激活的技能上 —— 不需要 LLM 配合，不需要新协议，归属是现成的。** 这是 peaks-loop 相对通用方案的一个结构性优势，必须用上。

**(c) 相位（phase）：由已有状态机推出，不新增概念。**

CTA 用一个有限状态机把轨迹切成 Orientation / Implementation / Validation / Debugging / Finalization。peaks-loop 的角色状态机（`draft` → `spec-locked` → `implemented` → `running` → `verdict-issued`）**本来就是这个东西**，映射即可，不需要引入第二套相位定义。

事件形状：

```ts
{
  category: 'tool-trace',          // 新增 category
  sessionId,
  sliceRid?,
  detail: {
    seq,                          // session 内单调
    ts,
    tool: string,                 // 'Bash' | 'Write' | 'Edit' | 'Read' | ...
    phase: 'orientation' | 'implementation' | 'validation' | 'debugging' | 'finalization',
    skillId?: string,             // 按时间 join presence lease 得到
    gateId?: string,              // 若被某个门禁处理
    outcome: 'allow' | 'block' | 'error',
    input?: string,               // 脱敏 + 截断
    output?: string               // 脱敏 + 截断
  }
}
```

**`outcome: 'block'` 的 tool-trace 事件是近失率的直接来源之一** —— 另一个来源是 §2.2 S1.5 的 gate 事件里 `outcome === 'bypass'` 且该门禁从未被评估。

**S1.6 追认（retro-attribution）—— 让历史 113 次失败今天就能用。**

S1.1 只对**新发生**的失败生效。历史上那 113 次 v1 事件只留了 `missingCount`，**不能被"还原"** —— 这是必须讲清楚的事实。但它们可以被**追认**，而且追认是确定性的：

prereq 表是完全可算的 —— `getPrerequisitesFor(role, newState, requestType)`（`src/services/artifacts/artifact-prerequisites.ts:478`）是一个**三元纯函数**，表本身是 `PREREQUISITES_BY_TYPE: Record<RequestType, PrerequisiteTable>`（`:442`）；而 `requestType` 就写在请求 artifact 的 `- type:` 行里，读取规则是仓库的 canonical reader（`src/services/artifacts/request-artifact-metadata.ts:57`，"最后一个可用的 `- type:` 行胜出"）。

于是对每一条 v1 失败事件：取 `artifactRole`（= role）、`to`（= newState）、按 rid 查请求的 type → 算出该次迁移的完整 prereq 清单 → 与 `missingCount` 比对：

| 条件 | 结论 | confidence |
|---|---|---|
| `missingCount === prereqs.length` | 全部缺失 | `inferred` |
| `missingCount === 1 && prereqs.length === 1` | 那一条就是缺件 | `inferred` |
| `missingCount === 1 && prereqs.length > 1` | 候选集 = 该 prereq 清单，无法定位到单条 | `ambiguous` |
| `0 < missingCount < prereqs.length` | 候选集 = 该 prereq 清单，无法定位到子集 | `ambiguous` |

**追认的置信度封顶为 `inferred`，永不到 `exact`。** 理由：追认用的是**今天**的 prereq 表，而历史事件发生在**过去**的表版本下 —— prereq 表是受版本控制的代码，它在两次记录之间改过。`exact` 只能由 v2 的前向事件给出（那份 `missing[]` 是当场实测的）。把追认结果标成 `exact` 就是在撒谎，违反仓库既有原则：缺失的过程绝不能读成一个判定。

113 次失败中 **66 次是 `missingCount === 1`**（`:58`），其中能落成 `inferred`（而非 `ambiguous`）的比例取决于各 request type 下该迁移的 prereq 清单长度 —— **这是实测出来的数字，不是估计**，S1.6 的完成判据里必须报出 inferred / ambiguous 的实际占比。

另外，14 条 v1 失败带 `detail.reason` 自由文本，其中直接写着 artifact 路径与门禁名（如 `packages/peaks-loop-mut/src/services/mut/production-stryker.ts`）—— 这 14 条由文本直接指名，置信度高于纯计数推算，但同样不是 `exact`（文本是人写的，可能过时）。三条来源的置信度分档：

| confidence | 来源 | 含义 |
|---|---|---|
| `exact` | v2 前向事件 | 当场实测的缺件清单 |
| `inferred` | 追认 / reason 文本 | 由确定性规则或人写文本推算，可能受表漂移或文本过时影响 |
| `ambiguous` | 追认候选集 | 只知道"在这份 prereq 清单里"，定位不到具体哪条 |

**三档都进热点榜，但必须显式标注，不许伪装成确定结论。** 排名默认把 `exact` 排在 `inferred` 之前（同一 count 下）。

### 2.3 S2 —— 看得见

**S2.1 口径修（三处）。**

1. `status` / `slices` / `fanout` / `report` 全部支持 `--all-sessions`（与 `repair-cycles` 对齐，见 `observability-commands-queries.ts` 顶部注释所述的既有惯例）。
2. **默认口径不变**（canonical session），但**当作用域内为 0 而别处有事件时，信封必须带一条 warning**，写明"本 session 0 条事件；其他 N 个 session 共 M 条，使用 `--all-sessions`"。理由见 §6：一个空的结果**不得被读成"没有发生过"**。
3. 修 `fail count 0` 与 slice 表 `✗` 的口径不自洽（两者必须出自同一次聚合）。

**S2.2 新命令 `peaks observability hotspots`。** 这是"看得见"的真正落点 —— 按 `ownerSkill` 聚合的卡点榜：

| 列 | 含义 |
|---|---|
| `ownerSkill` | 该交活的技能（归属源：S1.1 的 `missing[].ownerSkill`；历史数据来自 S1.6 追认） |
| `artifact` | 缺失的 artifact 路径模板（去 rid） |
| `kind` | `absent`（文件不存在）/ `body`（文件在但内容标记缺失） |
| `confidence` | `exact`（前向实测）/ `inferred`（追认或文本推算）/ `ambiguous`（候选集，未定位到单条） |
| `count` | 发生次数 |
| `sessions` | 涉及几个 session |
| `firstSeen` / `lastSeen` | 时间跨度 |
| `evidence` | 事件指针（sessionId + ts + rid） |

排序默认按 `count` 降序。`--json` 输出机器可读信封。

**S2.3 新命令 `peaks observability near-miss` —— 头号产出。**

按 §1.6，近失率是 QA verdict 结构上看不见的量，所以它必须是**一个独立的一等命令**，不是 hotspots 的一列。

判定：一次 slice 的 verdict 为通过（`verdict-issued` 且 QA 判定 pass），但存在下列任一情形 → **该 slice 是一次近失**：

- 存在 `gate` 事件 `outcome === 'bypass'`，且该 `gateId` 在该 slice 内**从未有过一次 `outcome === 'pass'` 或 `'block'` 的评估**（即"从未被评估"）
- 存在 `tool-trace` 事件 `outcome === 'block'`，但该 slice 最终仍然通过
- 存在 `slice-transition` 事件 `prereqOk === false`，随后该 slice 仍然进入了 `verdict-issued`

**输出**：`near-miss-rate`（近失 slice 数 / 通过 slice 数）+ 近失清单（每个近失附证据指针 + 当时被跳过的门禁 + reason 原文）。

**这个指标是整个自进化计划的第一号产出，因为它回答一个具体的问题：*我们过去的"通过"，有多少是靠跳过检查换来的？***

**S2.4 报告面。** `peaks observability report` 增加两节：**"近失"**（放在最前）与**"卡点 Top-N"** —— 报告是会被贴进 PR 的东西，这两件事必须出现在报告里，而不是只在一个新命令里。

### 2.4 闸1（硬闸）

> **S2 产出的热点榜必须能指名道姓地指向"某个技能的某类 artifact 缺失率 > 0"，并给出可复算的证据指针。**

指不出来 → S1 的 schema 还不够（可能是 ownerSkill 推导表覆盖不全，或 prereq 失败根本没走这条 emitter）→ **S3 不许开工**。

判据示例：`peaks observability hotspots --json` 的输出中，至少存在一条 `count ≥ 1` 且 `evidence` 非空的记录，其 `ownerSkill` 能解析到一个**真实存在的 SKILL.md 路径**。

**因为有 S1.6 追认，这道闸不必等新数据积累** —— 它可以在 S1/S2 落地当天用历史的 113 次失败来验。

#### 2.4.1 闸1 实测记录（2026-10-27）

> **实测方法**：CLI 从源码跑（`bin/peaks.js` 跑的是过期 dist，测出来的是旧代码）：
>
> ```bash
> node node_modules/tsx/dist/cli.mjs src/cli/index.ts observability near-miss --project . --all-sessions --json
> node node_modules/tsx/dist/cli.mjs src/cli/index.ts observability hotspots --project . --all-sessions --json
> node node_modules/tsx/dist/cli.mjs src/cli/index.ts observability status  --project . --all-sessions --json
> ```
>
> 磁盘行数用 `node` 逐文件数 `.peaks/_runtime/*/metrics/slices.jsonl` 的**实际行**（含 `safeParse` 会跳过的那行），不是"读得出来的条数"。
> 追认比例用仓库的 canonical reader（`src/services/artifacts/request-artifact-metadata.ts:57`，"最后一个可用的 `- type:` 行胜出"）解析每个 rid 的 request type，再喂进 `attributeV1Failure`（`src/services/observability/retro-attribution.ts`）。

**判据一 —— 热点榜指名道姓到真实技能：✓ 通过。**

`peaks observability hotspots --project . --all-sessions --json` 输出 **14 行**，每行 `count ≥ 1`、`evidence` 非空（`evidence` 长度等于 `count`）。逐行核对 `ownerSkill` 的 SKILL.md 路径**是否真的存在于磁盘**：

| # | ownerSkill | artifact | kind | confidence | count | SKILL.md 路径 | 存在？ |
|---|---|---|---|---|---|---|---|
| 1 | `peaks-qa` | `qa/test-cases/<rid>.md` | body | ambiguous | 91 | `skills/bee/peaks-qa/SKILL.md` | ✓ |
| 2 | `peaks-mut` | `mut/mut-report.json` | body | ambiguous | 78 | `skills/peaks-mut/SKILL.md` **或** `skills/bee/peaks-mut/SKILL.md` | **✗ 两处都没有**（见下） |
| 3 | `peaks-perf-audit` | `audit/perf-<rid>.md` | body | ambiguous | 78 | `skills/bee/peaks-perf-audit/SKILL.md` | ✓ |
| 4 | `peaks-prd` | `prd/handoff-<rid>.md` | body | ambiguous | 78 | `skills/bee/peaks-prd/SKILL.md` | ✓ |
| 5 | `peaks-qa` | `qa/.initiated` | absent | ambiguous | 78 | `skills/bee/peaks-qa/SKILL.md` | ✓ |
| 6 | `peaks-rd` | `rd/code-review-<rid>.md` | body | ambiguous | 78 | `skills/bee/peaks-rd/SKILL.md` | ✓ |
| 7 | `peaks-rd` | `rd/karpathy-review-<rid>.md` | body | ambiguous | 78 | `skills/bee/peaks-rd/SKILL.md` | ✓ |
| 8 | `peaks-reviewer` | `rd/third-party-review-<rid>.md` | body | ambiguous | 78 | `skills/bee/peaks-reviewer/SKILL.md` | ✓ |
| 9 | `peaks-security-audit` | `audit/security-<rid>.md` | body | ambiguous | 78 | `skills/bee/peaks-security-audit/SKILL.md` | ✓ |
| 10 | `peaks-rd` | `rd/bug-analysis-<rid>.md` | body | ambiguous | 39 | `skills/bee/peaks-rd/SKILL.md` | ✓ |
| 11 | `peaks-qa` | `qa/test-reports/<rid>.md` | body | ambiguous | 13 | `skills/bee/peaks-qa/SKILL.md` | ✓ |
| 12 | `peaks-rd` | `rd/bug-analysis-<rid>.md` | body | inferred | 11 | `skills/bee/peaks-rd/SKILL.md` | ✓ |
| 13 | `peaks-qa` | `qa/test-cases/<rid>.md` | body | inferred | 6 | `skills/bee/peaks-qa/SKILL.md` | ✓ |
| 14 | `peaks-rd` | `rd/security-review-<rid>.md` | absent | inferred | 2 | `skills/bee/peaks-rd/SKILL.md` | ✓ |

判据要求的"**至少一条**"成立（第 1 行即满足：`count = 91 ≥ 1`、`evidence` 91 条非空、`skills/bee/peaks-qa/SKILL.md` 真实存在）。**第 8 行的 owner 在 2026-10-28 修过**：`rd/third-party-review-<rid>.md` 是 **`peaks-reviewer` 的 artifact**（`artifact-prerequisites.ts` 里那条 prereq 自己写着"v2.14.0 G4 third-party reviewer (peaks-reviewer skill)"），而 owner 推导表原来只有一条 `rd/` **目录级**的行，于是**它把这份评审算给了 `peaks-rd`** —— 这张榜的全部意义就是"指名道姓到该去修的那个技能"，指错了就等于没指。推导表现在多了一条更具体的 `rd/third-party-review-` 行（按前缀长度排序，更长者先命中），第 8 行的 owner 因此是 `peaks-reviewer`，它的 SKILL.md 在 `skills/bee/peaks-reviewer/SKILL.md`，**真实存在**。

**但 14 行里有 1 行的 `ownerSkill` 指向的技能，其 SKILL.md 不在 `skills/` 树里**：

- **`peaks-mut` 的 SKILL.md 在 `src/skills/peaks-mut/SKILL.md`**（`git ls-files` 可查，tracked），而 `skills/peaks-mut/` 与 `skills/bee/peaks-mut/` **都不存在**。

**判据一的 owner 路径清单已按 2026-10-27 修订更正为三处**：`skills/<ownerSkill>/SKILL.md`、`skills/bee/<ownerSkill>/SKILL.md`、**`src/skills/<ownerSkill>/SKILL.md`**。原清单只列前两处，于是一个**合法的仓内 owner**（`peaks-mut`，以及同形状的 `peaks-maker`）被读成"解析不到"。**按更正后的清单，14/14 行的 `ownerSkill` 都能解析到一个真实存在的 SKILL.md。**

**但更正路径清单并没有把分布缺口消掉 —— 它只是让缺口可见。** 这条要作为**本轮的一个真发现**记下来：

> **artifact 契约引用了一个生产者没有被分发出去的 artifact。**

- `npm pack --dry-run --ignore-scripts --json` 的 2935 个文件里，**没有任何一个 `peaks-mut` 的 SKILL.md**（`package.json` 的 `files` 白名单只有 `skills/**`，没有 `src/skills/**`；`scripts/copy-templates.mjs` 也不复制 `src/skills`）。`skills/` 下的 15 个用户可见技能与 `skills/bee/` 下的 9 个 bee 技能**都在包里** —— **`peaks-mut` 是唯一一个 SKILL.md 存在却装不出去的技能**。
- 于是**在一个装好的 peaks-loop 上，`mut/` 的那些 artifact 没有任何生产者**。`mut/mut-report.json` 是 `rd -> qa-handoff` 的 prereq 之一（`artifact-prerequisites.ts` 的 `MUT_REPORT`），而本仓库的 `feature`/`bugfix`/`refactor` 表都要求它 —— **一条装好的 peaks-loop 会在这道门上永远失败，而门后没有技能去生产它。**
- **这与判据一是两件事**：判据一（"热点榜能指名道姓到某个技能"）现在**通过**（14/14，按更正后的路径清单）；**分发缺口是本计划发现的另一个缺陷**，它不在闸1 的三条判据里，但它**是**这轮测量暴露出来的**真问题**，交给后续切片。
- owner 推导表（`src/services/observability/owner-skill-map.ts:95`，`{ prefix: 'mut/', skill: 'peaks-mut' }`）指的名字是**对的**；缺的是这个技能**没有进 `skills/` 树**、**因而没有进包**。

**判据二 —— 近失报告说清自己观测到了什么：✓ 通过。**

`peaks observability near-miss --project . --all-sessions --json` 输出：

- **近失率 `nearMissRate = 0.1276595744680851`（12.8%）**，`nearMissSliceCount = 12`，`passedSliceCount = 94`。
- **分母 94，且带定义**：denominator 的 `definition` 明写"a slice that recorded a SUCCESSFUL `verdict-issued` attempt —— 一次 prereq 检查**通过**的 `verdict-issued` 迁移尝试，即该 slice 被宣告通过的那一刻；prereq 检查**失败**的 `verdict-issued` 尝试是**被拒绝的迁移**，不是通过"，`sliceCount = 94`。
- **分母与 status 摘要的差被摊开说了**：`statusSuccessCount = 103`，`difference.successWithoutPassMoment = 17`（其中 7 个到了 `verdict-issued` 但 prereq 判定从未被记录）、`passMomentWithoutStatusSuccess = 8`（通过了但事后被打回返工，末态不是终态happy），并附 `note` 说明两个"通过"的定义**数的是不同的 slice**。
- **那 7 个（以及更大的 9 个）为什么没有 prereq 判定记录 —— `note` 说的是"原因"，不是"缺一条轨迹"。** `note` 明写：
  > … 7 of which reached a `verdict-issued` event whose prereq verdict was never recorded, because their request type(s) `chore`, `docs` have NO `qa:verdict-issued` prerequisite row: the transition had no check to verify it against, so the check had nothing to record. The pass was never gated, rather than gated-and-unrecorded.

  **独立核实（直接数事件流，不依赖这段代码）**：到达过 `verdict-issued` 事件、却没有记录任何 prereq 判定的 slice 共 **9 个** —— **`docs` 4 个 + `chore` 5 个**，且这 9 个的 request type 的 prereq 表**都没有 `qa:verdict-issued` 这一行**（`MINIMAL_TABLE` 只有 `prd:handed-off`）。逐类型的对照是：

  | request type | 到达过 `verdict-issued` | 有 prereq 判定记录 | 没有 |
  |---|---|---|---|
  | `feature` | 44 | 44 | **0** |
  | `bugfix` | 30 | 30 | **0** |
  | `refactor` | 18 | 18 | **0** |
  | `config` | 1 | 1 | **0** |
  | `docs` | 5 | 1 | **4** |
  | `chore` | 5 | 0 | **5** |

  **这张表用仓库自己的 reader 重测过（2026-10-28）：** `hotspotRequestTypes`（`src/cli/commands/observability-commands-hotspots.ts`）—— 它按 rid 解析 request artifact 的 `- type:` 行，**声明过的胜过默认的**（`ebcd835c` 改的 tie-breaking：一个 slug 在两个角色下各有一份 artifact 时，声明过的那份是更强的证据）。**`feature` 45→44、`refactor` 17→18 就是这条 tie-breaking 换来的**：一个 slice 从 `feature` 挪到了 `refactor`，其余各行与两个总数（103 / 94 / 9）都不变。**用这个 reader 就能重新推导这张表。**

  **每一个 `feature`/`bugfix`/`refactor`/`config` slice 只要到了 verdict，都有记录在案的 prereq 判定；没有判定的全部落在 `docs`/`chore` 这两个没有 `qa:verdict-issued` prereq 行的类型上。** 那些 slice 的"通过"**不是"没被验证"，而是"那道门根本不存在"**（`src/services/artifacts/artifact-prerequisites.ts:491` 在 `requirements.length === 0` 时**提前返回**，早于 `:594` 的事件发射；所以**没有事件被漏掉 —— 压根没有东西可记**）。**一个读者若被告知"检查留下了空迹"，会去找一个并不存在的 emitter bug。**
- **逐 class 覆盖率**（`coverage` 数组，每项带 `reason` / `observable` / `scopeEventCount` / `observedSliceCount` / `nearMissSliceCount` / `rate`）：

  | reason class | observable | events | slices observed | slices flagged | rate |
  |---|---|---|---|---|---|
  | `gate-never-evaluated` | **false** | 0 | 0 | 0 | **null** |
  | `prereq-skipped` | true | 536 | 94 | 12 | 0.1277 |
  | `tool-blocked` | **false** | 0 | 0 | 0 | **null** |

- **`unobservedClasses = ["gate-never-evaluated", "tool-blocked"]`** —— 两个 class 一条事件都没有，它们的份额是**数据的缺席，不是结果**。
- **stderr 另有两条 warning 把这件事说出口**："The `gate-never-evaluated` class had NO events to observe in this scope (0 event(s)), so its share of the near-miss rate is an absence of data, not a result — the rate does not measure that class."（`tool-blocked` 同）。

**因此 12.8% 这个数字必须连着它的覆盖率读**：它**只**度量了三个 class 里的一个（`prereq-skipped`）。另两个 class 在本仓库**从未被观测过** —— `gate` emitter 晚于本仓库所有 session，`tool-blocked` 依赖的 tool-trace 采集器同样没有历史。**一个裸的 "12.8%" 会读成"近失率 12.8%"，而真相是"我们只量到了三类里的一类"。输出没有犯这个错。** ✓

**判据三 —— 历史没丢：✓ 通过（按修订后的判据）。**

| | 值 |
|---|---|
| 读者报出的 `totalEvents`（`observability status --all-sessions`） | **1530** |
| 磁盘上 `.peaks/_runtime/*/metrics/slices.jsonl` 的**实际总行数** | **1530** |
| 差 | **0** |

**相等 → 读者看到了磁盘上的每一条记录，`safeParse` 一行都没跳过。** ✓

（绝对数会漂是**保留策略**而不是 schema 损失：`MAX_METRICS_FILES = 10`（`src/services/observability/jsonl-store.ts`），`.peaks/_runtime/` 下现在有 **30 个 session 目录，其中只有 10 个带 `metrics/slices.jsonl`**，另外 20 个的指标文件已被按 mtime 剪掉。剪掉的那些行**不在磁盘上**，所以它们不进入上面这个比较 —— 比较的是"读到的"对"存在的"，两者相等。）

**追认比例（S1.6 要求的实测数字）—— 用真实 request type，来源随类型一起带出来。**

**口径（2026-10-27 修订）**：一个 request artifact **没有可用的 `- type:` 行**时，它的**有效 type 就是 `feature`** —— 那是系统自己的 `DEFAULT_REQUEST_TYPE`（`src/services/artifacts/artifact-prerequisites.ts:31`），也是**迁移当时 prereq 表实际按之索引的类型**。所以追认**必须用 `feature`**；若因为"没写下来"就换一张表，候选集会来自错误的表，而"解析不出"是**第三种同样错的答案**。

**但"有效 type"与"谁写下来的"是两个事实，必须一起报**：类型是 `feature`（真的），来源是 `default`（没人写）。所以 CLI 现在把**来源随类型一起带出来**（`requestTypeSource`），并在 `hotspots --json` 的 `attribution` 块里**把两栏分开数**。

**实测数字（`peaks observability hotspots --project . --all-sessions --json` 的 `attribution`）：**

| | 值 |
|---|---|
| 历史 v1 prereq 失败事件总数（`detail.prereqOk === false`） | **113**（全部是 v1 count-only：`detail.missing[]` 数组 **0** 条） |
| 涉及的 rid 数 | **53** |
| **计入追认的失败事件** | **111** |
| **`inferred`** | **19** |
| **`ambiguous`** | **92**（其中 1 条 `candidates` 为空 —— 该迁移的 prereq 清单本身是空的） |
| **inferred 占比（111 条中）** | **17.1%（19/111）** |
| **其中按"声明过的 type"追认** | **108** |
| **其中按"没人写下来的默认 type"追认** | **3** |
| **完全无法追认（没有 request artifact）** | **2** |
| 读不出来的 request artifact | **0** |
| 读得出但没有可用 `- type:` 行的 request artifact | **109** |

**三个数必须一起读：`inferred`/`ambiguous` 是置信度分栏，`fromDeclaredType`/`fromDefaultedType` 是**来源**分栏，`unresolved` 是第三件事（连类型都没有）。** "19 inferred" 这个数**不**回答"有多少条建立在没人写下来的类型上"——那是 `fromDefaultedType = 3`。**这两栏分开报，是因为它们是两个不同的问题。**

**与先前一次实测（19 / 89，108 条）的对账 —— 差别恰好是 3 条，全部来自同一个 rid。**

| | 先前的实测（2026-10-27 早） | 本次（修订口径） |
|---|---|---|
| 计入追认的失败事件 | 108 | **111** |
| `inferred` / `ambiguous` | 19 / 89 | **19 / 92** |
| 差异 | — | **+3 条，全是 `ambiguous`** |

那 3 条是 **`rid-t3-downstream-incremental-constitution` 的 3 次 prereq 失败**。它的 request artifact **存在**（`2026-10-26-session-fb8cc6/rd/requests/018-rid-t3-downstream-incremental-constitution.md`），但**没有可用的 `- type:` 行** —— canonical reader 返回 `requestTypeSource = 'default'`。

- **先前的实测把那 3 条整条丢掉**（按"只采信真正声明过的类型"的规则），因为它把**"没人写下来"**当成了**"没有类型"**。**这是第三个错误答案** —— 有效 type 是 `feature`，用它追认得到的候选集来自**迁移当时真正用过的那张表**，丢掉这 3 条反而让比例失真。
- **本次按修订口径计入这 3 条**，并**另外**把它们的来源单列（`fromDefaultedType`）。
- **两个数都不是"错"的，是**口径不同**；记录采用修订后的口径，因为它是**与迁移当时发生的事一致**的那个。

**剩下 2 条完全无法追认的失败**（是事实，不是缺口）：

| rid | 原因 |
|---|---|
| `tmp-measure-qa-openspec` | 磁盘上**根本没有**对应的 request artifact（`.peaks/_runtime/*/requests/` 里没有这个 slug） |
| — | （另一条是同一 rid 的第二次失败事件） |

**"unresolved" 与 "defaulted" 不是一件事**：前者是**连类型都没有**（artifact 缺失 → 什么都追认不了），后者是**类型是 `feature` 但没人写下来**（追认照做，只是来源弱）。CLI 现在**分开报**这两件事（`unresolved` vs `fromDefaultedType`），而**不再**用一个 `unparsed` 桶把"没写类型行"和"artifact 读不出来"混在一起。

**类型冲突（声明与声明不一致）：** 19 个 slug 上存在两份类型不同的 request artifact。其中 **15 个是"一份声明了类型 vs 另一份没声明"**（默认的 `feature` 不是一次竞争性的声明，不构成冲突）；**真正两个角色各声明了一个不同类型的有 4 个**：`rid-mut-report-warning-surfacing`（bugfix/feature）、`rid-size-gate-reads-ratchet`（bugfix/feature）、`rid-count-ceiling-exemption-table`（refactor/feature）、`2026-10-21-race-batch-mode`（feature/refactor）。**这 4 个 rid 里没有一个有记录在案的 prereq 失败**，所以这个冲突**不影响**上面的比例。**现在的 reader 让"声明过的"胜过"默认的"**（同一个 slug 在两个角色下各有一份 artifact 时，声明过的那份是更强的证据），实测这个改变**不影响任何数字**：19/92 与 108/3 在两种规则下都相同。

**这张榜的形状也要读对：** `prereq-skipped` 这一个 class 的 12 次近失落在 12 个 slice 上。**独立于 near-miss 代码、直接从事件流数**（取每个 slice 那次**成功的** `verdict-issued` 尝试的时刻为"通过时刻"，看那一刻之前该 slice 有没有 `rd -> qa-handoff` 的 prereq 检查尝试、尝试有没有被拒）：**11 个是"该检查从未被尝试"，1 个（`2026-10-16-coverage-ratchet-in-ci`，通过时刻 2026-10-15T17:37:42.134Z）是"检查当时正在拒绝"**。

**这 12 不是一种发现，是两种。** "从未被尝试"（11 条）说的是**这道门压根没被走到过** —— RD 还没试过交接，QA 就已经把 slice 判成通过了；"正在拒绝"（1 条）说的是**这道门走到了，并且明确说了不行**。两者的修法完全不同（前者是"门被绕过的路径"，后者是"门的判定被忽略"），**所以"12 次近失"这个标题数字必须拆开读** —— 一个读者若只看到"12"，会以为 12 次都是同一件事。

而**这 12 次全部由 `rd -> qa-handoff` 这一条迁移产生** —— `unsatisfiedKeys` 一律是 `rd -> qa-handoff`。也就是说：**RD 交 QA 之前的那道 prereq 门，是这个仓库唯一被量到的近失来源**；另两类近失（门禁从未被评估、工具被拦）在本仓库**一件都没有发生过**。

**热点榜前五行的 `confidence` 全部是 `ambiguous` / `inferred`，没有一行是 `exact`** —— 因为本仓库的历史事件全是 v1（`detail.missing[]` 从未写过），没有任何一次缺件是**当场实测**的。榜上 `count = 91` 那行的 `countMeaning` 是 **`candidate-mentions`**（候选提及数），**不是**"这个 artifact 缺了 91 次"：一次无法定位的失败会向它**不能排除的每个候选各记一次**。**这一栏必须连着 `countMeaning` 读。**

#### 2.4.2 这次实测没有覆盖到的东西

- **闸一的判据在 2026-10-27 更正后的三处路径清单下成立。** 计划 §完成定义 里的"**每行**的 `ownerSkill` 指向真实存在的 SKILL.md"**逐行可查、14/14 行都解析得到**（`peaks-mut` 那行解析到 `src/skills/peaks-mut/SKILL.md` —— 仓内真实存在、tracked）。**这次实测没有覆盖的是分发，不是解析**：`peaks-mut` 的 SKILL.md **不在 npm 包的 2935 个文件里**（`package.json` 的 `files` 白名单只有 `skills/**`），所以**一个装好的 peaks-loop 上没有任何技能生产 `mut/` 的那些 artifact**（`mut/mut-report.json` 是 `rd -> qa-handoff` 的 prereq 之一）—— **一道装好的 peaks-loop 会在这道门上永远失败，而门后没有技能去生产它。**（§2.4.1 已把它记为一条真发现；它是**后续切片**，不是本轮的修复。）
- **两个近失 class 从未被观测过**（`gate-never-evaluated`、`tool-blocked`）。12.8% 是**只覆盖三类中一类**的数字；随着 `gate` emitter 与 tool-trace 采集器在真实 session 里跑起来，这个比例会变。
- **追认的 17.1%（19/111）是用"今天"的 prereq 表算出来的**，而这些失败发生在过去的表版本下 —— 这是置信度封顶在 `inferred` 的原因（见上），**这个比例是重建，不是实测**。
- **`peaks observability report` 默认 `--period day`，在本仓库是空的**（`totalEventsInPeriod = 0`）。空的**不是**作用域（作用域有 1530 条事件），是**周期**；报告的 warning 说得很清楚："No observability events fall inside the `day` period, though the scope holds 1530 event(s) — use `--period month` to read them."。`--period month --all-sessions` 下报告的"近失"节与"卡点"节都有内容（近失 12.8%、卡点 14 行）。

**这一节同时是本轮的"后续切片"清单（2026-10-28 复核时记下）。** 以下四条**都不是本轮的修复**，它们各有各的理由：

| # | 后续切片 | 为什么现在不做 |
|---|---|---|
| **F1** | **从 `slice-transition` 流重建 live set**，让"某个 phase 一条 gate 事件都没发"也进入近失的视野 | **本轮明确不做**：declared type **只**骑在 gate 事件上（`rd-gate-event.ts` 的 `detail.declaredType`）。`slice-transition` 流里没有它，所以从那条流重建 live set **会改变这个指标的语义**（判据从"这次迁移时判定的类型"变成"猜出来的类型"）。先让 `gate` 事件真的跑起来、把覆盖率说清楚，再谈重建。**本轮先做的是把"没观测到"说出口**：覆盖输出现在带**逐 slice 的不可观测计数**（多少个 slice 根本没发过 gate 事件），报告的 Coverage 表也多一栏。 |
| **F2** | **`peaks-mut` 的分发缺口**（§2.4.1）：它的 SKILL.md 在 `src/skills/` 里、不在 npm 包的 2935 个文件里 → 装好的 peaks-loop 上 `mut/` 的 artifact 没有生产者 | 改分发要动 `package.json` 的 `files` 白名单与/或 `scripts/copy-templates.mjs`，**是发布面的改动**，不是观测面的改动；混进这一轮会把"修记录"变成"改发布"。 |
| **F3** | **runtime 根的 scratch 守卫**：仓库有 `tests/unit/standards/root-scratch-artifact-guard.test.ts` 管**仓库根**，但 `.peaks/_runtime/` 的**根**没有等价守卫 —— 而 `.peaks/_runtime/` 是**作用域轴的根**，直接躺在那里的 scratch 文件属于**任何 session 都不拥有**的位置，没有 session 的清理或 GC 会碰到它 | 守卫是**新的行为约束**，要连同它该拦的例外（`session.json`、`generated-artifacts.json`）一起定；这是它自己的一条切片。 |
| **F4** | **census 应当把 `securityArtifactTiers` 当作 source 2 来读** | census 现在**只记录**了"judged-declaration 的拒绝"这个来源，**没有读它**：那四条 `securityArtifactTiers` 路径今天之所以都被覆盖，**只是因为每一条都恰好和 prereq 表里的一条路径重合**。将来一条落在新目录下的 tier 会**既没有 owner、又在 census 之外**，覆盖测试仍然是绿的 —— **同一个洞，往下一层**。 |

### 2.5 S3 —— 从数据到提案

**S3.1 指标体系：分四层，头号产出是近失率。**

按 §1.6 的排序（近失率 > 遵守率 > 成本 > 通过率），为每个目标（技能 | 门禁）定义**可从事件流实测**的指标：

| 层 | metric id | 定义 | 方向 | 依赖 |
|---|---|---|---|---|
| **T1 头号** | `near-miss-rate` | 通过的 slice 中，"必需门禁被 bypass 且该门禁从未被评估"或"必需 prereq 被跳过"的比例 | 越低越好 | **S1.5 + S1.7** |
| **T1 头号** | `gate-false-block-rate` | 该门禁的 bypass 事件数 / 该门禁评估数 | 越低越好 | S1.5 |
| **T2** | `compliance-rate` | 已执行的必需步骤 / 必需步骤总数 | 越高越好 | S1.7 + ComplianceSpec |
| **T3 成本** | `token-overhead` | 技能激活期间的 token 消耗相对基线的倍率 | 越低越好 | `token-usage` category（当前是哑的，须接线） |
| **T3 成本** | `user-steering-count` | 一次 slice 内需要用户介入（AskUserQuestion / 纠正）的次数 | 越低越好 | 用户触点记录 |
| **T4 参考** | `artifact-missing-rate` | 缺失事件数 / prereq 检查数 | 越低越好 | S1.1 + S1.6 |
| **T4 参考** | `repair-cycles` | 返工轮数（已实现：`repair-cycle-metric.ts`） | 越低越好 | 无 |
| **T4 参考** | `median-time-to-verdict` | `draft` → `verdict-issued` 时长中位数 | 越低越好 | 无 |
| **T4 参考** | `scope-claim-rate` | 带 `## Changed paths` 段的 RD artifact 占比 | 越高越好 | 无 |

**T4 不作为适应度** —— CTA 已证明通过率在天花板任务上失明（80% 的 SIP 藏在通过率无变化的 37/49 个任务里）。T4 只用于**诊断**与**回归观察**：某个改动让 `repair-cycles` 变差，即使 T1 变好，也要记录并由人裁决。

**指标是权威量，分数是投影。** 每个 metric 配一个**写进文档的映射函数**，把实测值投到 0..10（以满足 `score_delta_min` 的既有 CHECK 约束与棘轮语义），原始实测值另存字段。`score_delta_min` 因此从"自报阈值"变成**真的回归护栏**。

**S3.1b ComplianceSpec —— peaks-loop 已经有一个，只是没这么叫。**

`skill-comply` 用 YAML 声明"这个技能的步骤序列 + 每步的探测器 + 时序约束"，再判定 trace 是否遵守。**peaks-loop 的 artifact contract 就是这个东西的另一种读法**：prereq 表已经声明了"到状态 X 时，artifact Y 必须存在且含标记 Z"，那就是一条步骤规范。

所以 peaks-loop 的 ComplianceSpec **不需要新造概念**，只需要补三样 prereq 表现在没有的：

```yaml
id: peaks-rd-handoff
source: skills/bee/peaks-rd/SKILL.md#step-4
owner: peaks-rd
version: 1
steps:
  - id: write_security_audit
    description: "派发 peaks-security-audit 并落地 audit/security-<rid>.md"
    required: true
    detector:
      description: "一次 sub-agent dispatch，role = peaks-security-audit"
      after_step: write_code_review
    verify:                          # 确定性检查优先
      artifactExists: "audit/security-<rid>.md"
scoring:
  threshold_promote_to_hook: 0.6
```

补的三样：**① owner（归属到技能）② 显式时序约束（`after_step` / `before_step`）③ required / optional 之分**。

**关键优势：peaks-loop 的 detector 大多可以确定性判定，不必像 `skill-comply` 那样依赖 LLM 分类。** 一个步骤的"被执行"通常就是"它负责的 artifact 落地了，且内容标记齐全"—— 这正是 prereq 机制已经在做的事。SOPBench 的结论（**用代码化的多层验证替代 LLM judge**）在这里直接落地：**peaks-loop 的遵守率可以是纯代码算出来的**，只有少数无法用 artifact 表达的步骤才需要轨迹分类器兜底。

**S3.2 `peaks evolution mine`。** 读事件流 → 聚类失败模式 → 产出**候选清单**（按已确认的形态：只出清单 + 证据，不自动生成 diff）。每条候选：

```
target        = bee:peaks-rd | gate:<id>
dimension     = 单一优化维度
metric        = 上面表里的某个 metric id
observed      = 该 metric 在窗口内的实测值（before）
evidence      = 事件指针 + `reason` 原文（截断到合理长度）
suggestion    = 改动方向（一句话）
```

`mine` **不写** `evolution_evaluation` 表 —— 它只产出候选清单。落库由人确认后走 `peaks evolution propose`，因此**不会污染棘轮历史**。

**证据门槛：** `mine` 只允许引用 `confidence === 'exact'` 的证据，或已被人工复核过的 `inferred` 条目。**纯 `ambiguous` 的候选集不得直接成为提案** —— 它只能作为"这一族需要人看一眼"的线索出现在榜上。

**S3.3 动作空间：自进化有四种改法，不止改文案。**

这是 `skill-comply` 的 `threshold_promote_to_hook` 与 Hermes 的约束闸共同指出的。**按成本从低到高：**

| # | 动作 | 手段 | 适用信号 |
|---|---|---|---|
| **A1** | **提升为 hook** | 遵守率低于阈值 → 把该步骤做成确定性强制（ToolGuard 式：自然语言策略 → 可执行守卫） | 单个步骤反复不执行 |
| **A2** | 改技能文案 | GEPA 式**由失败轨迹驱动**的定向变异（非随机重写） | 步骤被执行了但做错了 |
| **A3** | 调门禁契约 | 增删 prereq、放宽/收紧 `mustContain` | 门禁误伤（`gate-false-block-rate` 高） |
| **A4** | 调编排结构 | 调整 fan-out、拆分/合并技能、换相位切分 | 结构性反复返工 |

**A1 是本设计最该优先做的一档**，因为 peaks-loop 已经有 hook 层、有 gate 机制、有 `peaks gate enforce` —— **把一条老是做不到的技能步骤变成确定性强制，是这个仓库最擅长的事**，而 Hermes 与 `skill-comply` 都把它当成低遵守率的默认出路。

**S3.4 proposal 的快照与证据必须落地。** `before_snapshot` = 改前 SKILL.md 全文（或门禁定义全文）；`diff` = 真实 diff；`rubric` = 该 metric 的定义与方向；`red_lines` = 该目标不可违反的约束（取自 `.peaks/standards/**`）；`source_traces` = 事件指针 + 证据 artifact 路径。**这五项是本次改造的验收重点**：它们全部非空，`evolution_evaluation` 才第一次承载它 schema 里预留的信息。

**S3.5 指标必须能跨机器、跨时间比较。** 原始事件在 gitignored 的 `.peaks/_runtime/**` 里，CI 与新克隆都拿不到。因此每个 session 结束时，把该 session 的**聚合指标行**（不是原始事件）写到受版本控制的 `.peaks/observability/sessions/<sessionId>.json`（复用 `src/services/log/redact.ts` 的脱敏；自由文本 `reason` 必须脱敏后再落盘）。这是"改前窗口"与"改后窗口"可比的前提 —— 否则棘轮只能比较同一台机器同一段本地历史。

**S3.6 反事实配对 —— 让"改前 / 改后"从相关变成因果。**

原 spec 的"改前窗口 / 改后窗口"只是**观察性**对比：改了技能 A 之后指标变了，但不能排除是"这批 slice 恰好更难"。CTA 的方法给出了正解：**配对比较**。

- **配对单元**：同一个任务族（同一 request type + 同一 slice 类别）在技能版本 N 与 N' 下各跑一次
- **配对内容**：S1.7 的 tool-trace，按 CTA 的方式做相位对齐
- **读出的量**：不是通过率，而是 **Skill Influence Pattern 的方向与数量**（构造性 / 中性 / 破坏性）
- **成本现实**：CTA 实测配对实验 token 开销约 1.91×，个别 22×。**因此配对实验不可能覆盖所有 slice，只能对少数"候选改动"做** —— 这正好和 S3.3 的动作空间一致：先由观察性数据筛出候选，再对候选做昂贵的配对验证。

**首组配对的范围（决定 D2）**：先只跑 **1 组** —— 同一个任务族，技能版本 N 与 N' 各一次。目的不是得出统计结论，而是**把流程跑通并量出真实开销**（本仓库的 slice 规模比论文样本大，开销比值可能完全不同）。跑完之后再决定是否扩到固定任务集。

**这直接改变了 S3→S4 的门槛：没有配对验证的改动只能停在 `needs-user-decision`，不能 `keep`。**

### 2.6 闸2（硬闸）

> **`mine` 产出的每一条候选，其 `observed` 必须等于按 §2.5 定义在事件流上实算出来的值 —— 不是估计、不是 LLM 判断。**

不满足 → 指标定义不可复算 → 不许进入 S4。

### 2.7 S4 —— 棘轮真跑起来 + 度量

**S4.1 跑通一次完整棘轮。** `peaks evolution evaluate`（独立评审 + 回归怀疑者）已实现但从未执行。本切片的目标是**在真实目标上跑完一次 `propose → evaluate → mark-keep`**，让 `evolution_evaluation` 第一次有行。

**S4.2 `after` 取自实测。** 改动落地后，取改动后 K 个 slice 的同 metric 实测值作为 `after_score` 的投影。**若该改动尚未通过 S3.6 的配对验证，则 `after` 只能作为观察性证据，`verdict` 最高只能是 `needs-user-decision`。**

**S4.2b 候选必须过约束闸 —— 抄 Hermes 的这一条。**

Hermes 的一条原则值得原样借来：**"Benchmarks are GATES, not fitness functions."** —— 候选可以任务分更高，但只要触发任何一条回归闸就必须被否。peaks-loop 的对应闸：

| 闸 | 内容 | 为什么 |
|---|---|---|
| 全套测试通过 | `pnpm test` 绿 | 硬底线 |
| 近失率不得变差 | `near-miss-rate` after ≤ before | 主指标 |
| 遵守率不得变差 | `compliance-rate` after ≥ before | 次指标 |
| 成本闸 | `token-overhead` 不得超过 before 的 1.2× | CTA 实测技能开销均值 1.91×，必须设闸 |
| 语义不漂移 | 改动后的 SKILL.md 与原文的语义相似度不低于阈值 | Hermes 的硬约束，防"越改越不像" |
| 不得删除安全检查 | 演化不得移除任何 `red_lines` / 门禁 | Hermes 同款 |
| 不得热替换 | 不得把演化产物替换进进行中的会话 | Hermes 同款 |
| 独立 holdout | 用一批未参与筛选的 slice 复测 | 防过拟合 |

**S4.3 样本量不足时必须说"不足"。** K 个 slice 的窗口若不足以判定，必须让提案停在 `needs-user-decision` 并在 `rubric` 里写明样本量不足，**不得产出伪造的 delta**。这与仓库既有原则一致：缺失的过程绝不能读成一个判定。

**S4.3b 落地只走 PR，永不直提。** Hermes 的规则是 "Deployment via PR (Never Direct Commit)"，且人工评审合并、保留 Git 血缘便于回滚。本仓库的 AGENTS.md 另有更严的红线（提交作者唯一、不得带任何 AI 署名 trailer）。**两者叠加的结果是：演化产物只能以 PR 形式落到一个分支上，由人评审后合并。** `peaks evolution revert` 是回滚通道 —— 回滚的是**产物**，不是 Git 历史。

**S4.4 落地后的自动验证。** `peaks observability baseline --write / --check` 已存在（`src/services/observability/results-baseline.ts`），容差为 rate ±0.02 / peak ±1 / mean ±0.5，且**明确不是 CI 门禁**（源数据 gitignored）。棘轮每次落地后应当跑一次 `--check`，把"这次改动有没有让指标变差"变成一次显式检查。

**S4.5 与既有 baseline 的关系。** `results-baseline.json` 是**全项目结果层**的基线；本设计新增的 `.peaks/observability/sessions/*.json` 是**按 session、按技能/门禁**的指标行。两者层级不同，不合并、不替代：前者回答"项目整体健康吗"，后者回答"这个技能变好了吗"。

### 2.8 反馈回路的复接线

`.peaks/retrospective/index.json` 停在 6 月 9 日这件事，本设计**不单独修** —— 但 S3.4 的 per-session 指标落盘，正是 retrospective 该消费的东西。等 S3 落地后，retrospective 的续接可以基于指标行重建，而不是基于 4 个月前的自由文本。这是后续切片，不在本轮范围。

---

## 3. Non-goals

- **不做** SKILL.md 的自动改写。`mine` 只出候选清单 + 证据；具体怎么改由人或 LLM 另行决定。
- **不做** CI 门禁。观测数据在 gitignored 的 session 目录里，CI 拿不到；这一点 `results-baseline.json` 已经在自己的 `ciEnforceableReason` 里说清楚了，不重复制造第二个假门禁。
- **不做**对 `peaks-doctor` / `peaks-maker` / `darwin-skill`（外部）的整合。它们是不同机制。
- **不做** GEPA / DSPy 全栈移植。Hermes 用的是 Python + DSPy；本仓库是 TS + Node。**移植设计思想，不移植运行时**（§1.5.2）。
- **不直接搬用 `skill-comply` 的代码**，除非用户单独批准（AGENTS.md：外部仓库"未经明确批准不得执行或安装"）。实现走 peaks-loop 自己的 hook 层与 artifact contract。
- **不读运行时的私有 transcript**（如 Claude Code 的 `~/.claude/projects/` 会话记录）。轨迹从 peaks-loop 自己的 hook 层来（S1.7）。
- **不做**全量技能的 ComplianceSpec。试点 2–3 个，其余靠 prereq 表与近失率覆盖。
- **不做**把 `evolution_evaluation` 的 0..10 分制改成任意实数制。改为**并存**：原始 metric 是权威，分数是投影，既有 CHECK 约束与棘轮语义不变。
- **不伪造从未发出过的原始事件。** v2.11.1 起不 backfill 原始事件流是既有决定，本次沿用。**但"追认归属"不是补事件** —— S1.6 不新增任何事件，只用已发事件 + 确定性规则（prereq 表是纯函数）重算归属，且置信度封顶为 `inferred`。这条界线必须守住：追认是**再解释**，不是**再发生**。
- **不把门禁事件化说成"门禁改造"。** S1.5 只让门禁的判定**变得可见**，不改任何门禁的语义、阈值或放行条件。门禁该不该这么判，是 S3 之后由数据驱动的事。
- **不改** `peaks evolution` 的七条硬规则。那套规则是对的，缺的是喂给它的数据。

---

## 4. Slices（实施顺序与判据）

| # | 内容 | 完成判据 |
|---|---|---|
| **S1** | schema v2：`missing[]` 落地 + `ownerSkill` 推导表 + 6 个哑 category 清算 + **新增 `gate` category（门禁事件化）** + **S1.7 tool-trace 采集（PostToolUse 记录器 + presence 归属）** + session 记 `skills/` blob sha + **S1.6 追认器** | 新发生的 prereq 失败能落地"哪个技能缺了哪个 artifact"；门禁的 pass/block/bypass 全部有事件；tool-trace 能按时间 join 到当时激活的技能；历史 113 次经追认后报出 inferred / ambiguous 的实际占比；v1 行仍可读 |
| **S2** | `--all-sessions` 铺到四个查询 + 空结果 warning + 修 fail count 口径（8 个失败 slice 被记成 0）+ **`near-miss` 命令（头号产出）** + `hotspots` 命令 + 报告加"近失 / 卡点"两节 + **ComplianceSpec（试点：`peaks-rd` + `peaks-race-code`，决定 D1）** | `near-miss` 能报出近失率与清单；`hotspots --json` 输出可指名到真实 SKILL.md 路径；两个试点技能的遵守率**由确定性检查算出**（不依赖 LLM judge）；**闸1**通过 |
| **S3** | 四层指标实算器 + ComplianceSpec 判定器 + `evolution mine` + **四种动作空间（A1 提升为 hook / A2 改文案 / A3 调契约 / A4 调编排）** + proposal 五项快照落地 + per-session 指标落盘 + **S3.6 反事实配对协议** | `mine` 输出的 `observed` 与实算值逐条相等；配对协议能对同一任务族产出"有技能 / 无技能"的可对齐轨迹；**闸2**通过 |
| **S4** | 真实目标上跑通一次 `propose → evaluate → mark-keep`；`after` 取实测；**S4.2b 约束闸（8 条）**；**S4.3b 只走 PR**；样本不足说不足；落地后跑 `baseline --check` | `evolution_evaluation` 表首次有行，且该行的 `before/after_snapshot`、`diff`、`rubric`、`source_traces` **均非空**；该行至少有一条约束闸被实际评估并记录 |

S1 与 S2 可并行开工（S2 的实现不依赖 S1 的 schema，只依赖 S1 的 ownerSkill 推导表）。S3 依赖 S2 通过闸1。S4 依赖 S3 通过闸2。

---

## 5. Risks

| 风险 | 缓解 |
|---|---|
| **统计功效不足。** 全部记录历史只有 1533 条事件 / 12 个 session。多数 skill metric 的窗口会长期样本不足 | S4.3 把"不足"作为一等结论；`score_delta_min` 只在达到最小样本量后生效；绝不用小样本产出 delta |
| **指标可被优化（Goodhart）。** 门禁一旦知道自己被度量，就可能被绕过 | 指标只作**回归护栏**（改动后不得变差），不作为唯一目标；人工确认仍是硬闸；`gate-false-block-rate` 与 `artifact-missing-rate` 同时看。MAC-Bench（*Beyond Goodhart's Law*）提出的 CSR / Machiavellian Gap 正是针对这一类 |
| **用错了主指标。** 最大的风险不是"没数据"，而是"数据齐了但盯的是通过率" —— CTA / AgentPex / Near-Miss 三方独立证明通过率在技能质量上是失明的 | 本 spec 已把通过率降到 T4 参考层；头号产出是近失率；遵守率是 T2；**任何"通过率上升"的提案必须附带近失率与遵守率**（S4.2b 的约束闸已强制） |
| **轨迹采集的隐私面。** tool-trace 记录工具调用的输入输出 | 只记**脱敏 + 截断**后的 input/output（复用 `src/services/log/redact.ts`）；**不读运行时私有 transcript**（S1.7 已说明理由）；落盘前再过一遍脱敏 |
| **配对实验成本失控。** CTA 实测配对实验 token 开销均值 1.91×、个别 22× | 配对**只对候选改动做**，不做全量；观察性数据负责筛选候选；成本闸（S4.2b）拦住 token 开销超 1.2× 的候选 |
| **门禁事件会放大事件量。** 每个门禁判定发一条事件，一个 slice 的门禁判定次数是现有 slice-transition 的数倍 | `gate` 事件的 detail 不含大字段；`bypass` 的 reason 文本截断；沿用 jsonl-store 既有的 mtime 剪枝（`MAX_METRICS_FILES = 10`）。**必须在 S1 就把事件量实测出来并报数**，若超出预期则改为按"每次迁移聚合一条"而非"每次判定一条" |
| **轨迹事件量更大。** tool-trace 是每次工具调用一条，比 gate 事件还密 | `tool-trace` 采用**热窗口 + 冷摘要**：会话内最近 N 条保留明细，更早的只留聚合行；`MAX_METRICS_FILES = 10` 的 mtime 剪枝照旧。**S1 必须把事件量实测出来并报数** |
| **归属推导表会腐化。** `ownerSkill` 靠 path 前缀映射，新增 artifact 类型就可能落空 | 推导表是受版本控制的常量 + 一条测试断言"每个 prereq 路径都能解析出 ownerSkill"，新增 prereq 路径时测试会红 |
| **prereq 表漂移会让追认归错。** 追认用的是今天的表，历史事件发生在过去的表版本下 | 追认置信度封顶为 `inferred`（永不到 `exact`）；热点榜显式区分三档；S1.6 的完成判据必须报出 inferred / ambiguous 实际占比，**不允许用追认结果直接驱动 S3 的提案**（提案需引用 `exact` 或人工复核过的证据） |
| **自由文本落盘会泄漏敏感内容。** `reason` 里有路径与代码片段 | 落盘前过 `src/services/log/redact.ts`；per-session 指标行只存聚合计数与截断后的指针，不存 reason 全文 |
| **棘轮被污染。** 自动提案直接写 `evolution_evaluation` 会让历史失真 | `mine` 不写表；只有人确认后才走 `propose` |
| **范围膨胀。** "让 peaks-loop 自进化"很容易一路扩到所有技能 | Non-goals 已划界；S3 只做指标 + mine，不做自动改写 |

---

## 6. Assumptions made on the user's behalf

1. **本仓库自身的可观测性优先于对外功能。** 用户说的是"优化技能、脚本"，而这个仓库本身就是那套技能。默认理解为**先修 peaks-loop 自己**。
2. **"自进化"指带度量与回滚的闭环，不是"自动改写 SKILL.md"。** 依据是用户同时说了"没有实际的日志等数据"—— 缺的是尺子，不是手。
3. **接受一次完整改造的量级。** 用户在被问及范围时回答"我其实也没有什么思路，我需要你结合项目分析下"，即授权按分析结论定范围。四个切片跨 schema、CLI、棘轮三层，不是小改动。
4. **门禁层与技能层同等重要。** 现有失败数据里，反复出现的是门禁缺陷（作用域 / 状态机 / 认领表），不是技能文案缺陷。因此归属设计以 `ownerSkill` 为主，同时保留 `artifactRole` 维度。
5. **"抄作业"优先于自己发明。** 用户明确提议借鉴 Hermes 与外部论文。因此本 spec 的每个关键机制都注明了出处（§1.5），而不是自造一套。
6. **外部代码默认不搬。** 按 AGENTS.md，外部仓库只作策展参考。因此本设计采用"移植思想、TS 自实现"，若要直接搬 `skill-comply` 的 MIT 代码，需单独批准。
7. **通过率不是目标指标。** 用户没有反对，但这一条是调研得出的、且与用户的原始直觉（"想优化技能"）一致 —— 通过率恰恰是优化技能**不该**看的东西。

---

## 7. Open questions

### 7.1 已决定（2026-10-26）

| # | 决定 | 理由 |
|---|---|---|
| **D1** | **ComplianceSpec 试点 = `peaks-rd` + `peaks-race-code`** | `peaks-rd` 产出 artifact 最多、门禁交互最密（高价值）；`peaks-race-code` 最轻、最快出结果（快反馈）。一个高价值 + 一个快，比"三个都上"更可能跑完 |
| **D2** | **配对实验先只跑 1 组**（同一任务族 × 两个技能版本），把流程跑通、量出真实开销再谈规模 | CTA 实测开销 1.91×–22×，盲试容易失控；且 peaks-loop 的 slice 本身比论文样本大得多 |
| **D3** | **不移植 `skill-comply` 代码，只借思想** | AGENTS.md 红线（外部内容未经明确批准不得执行/安装）；且我们底座更好 —— prereq 表 + hook 层 + presence lease，判定器自写可做到**纯代码、不需 LLM judge** |

### 7.2 仍待定

1. **`ownerSkill` 推导表放哪？** 候选：`src/services/observability/`（与观测同源）vs `src/services/artifacts/`（与 prereq 同源）。倾向后者 —— 它是 artifact 语义的产物，观测只是消费者。
2. **per-session 指标行的落盘路径**：`.peaks/observability/sessions/<sessionId>.json`（非下划线段，受版本控制）是否符合 `.peaks/` 的 underscore 约定（`PROJECT.md` 记载：下划线前缀 = 临时，非下划线 = 真相源）—— 需要确认"聚合指标行"应属真相源还是临时。
3. **`mode-gate` / `post-compact` 这两个从未发出的 category**：是接线（补 emitter）还是删除（承认当前流程不需要）—— 需要先查它们的 emitter 是否存在但从未被触发。
4. **本次是否同步复接 retrospective**（§2.8）。默认不同步，列为后续切片。
5. **实施是否走 peaks-code 全流程**（`peaks audit` → prd → rd → qa）。考虑到 S1/S2 改动面小、且涉及 `evolution_evaluation` 这种契约层，是否每个切片单独走一次完整 QA，需用户定。
6. **A1（提升为 hook）的第一批候选。** 近失率算出来后，第一个该被"提升为 hook"的步骤是哪个？**这需要 S2 的近失数据才能回答，现在无法预判** —— 但设计必须保证答案出来后有一条明确的落地路径（`peaks gate enforce` + hook 安装）。

---

## 8. 一页纸速览

| 问题 | 答案 |
|---|---|
| 为什么现在做 | Darwin 棘轮有完整 CLI 但**从未跑过**，`before/after_score` 是 LLM 自报；观测有 1533 条事件但**默认口径看不见**、**缺件清单被 `.length` 丢掉**、**门禁层完全没被事件化** |
| 头号产出 | **`peaks observability near-miss`** —— 我们过去的"通过"，有多少是靠跳过检查换来的 |
| 主指标 | 近失率 > 遵守率 > token/干预成本 > 通过率（**通过率降为参考**） |
| 轨迹从哪来 | peaks-loop 自己的 hook 层（PostToolUse 记录器），归属由**已有的 presence lease** 按时间 join |
| 改什么 | 四种动作：提升为 hook / 改文案 / 调门禁契约 / 调编排结构 —— **A1 优先** |
| 怎么防自欺 | 8 条约束闸（测试、近失率、遵守率、成本、语义不漂移、不得删安全检查、不得热替换、holdout）+ 只走 PR |
| 怎么证明因果 | CTA 式配对反事实：有技能 vs 无技能的同任务族轨迹对齐 |

---

## 9. 引用

**外部代码 / 仓库**
- Hermes Agent Self-Evolution — https://github.com/Karanlashkari/hermes-agent-self-evolution/blob/main/PLAN.md （MIT；DSPy + GEPA；"Benchmarks are GATES, not fitness functions"；"Deployment via PR (Never Direct Commit)"）
- Hermes Learning Loop — https://hermes-agent.ai/features/learning-loop
- Hermes Self-Improving Skills — https://hermes-growth.dev/features/self-improving-skills
- `skill-comply`（ecc-universal 2.2.3，MIT，本地 `node_modules` 内）— 技能→ComplianceSpec→trace→分类→确定性时序判定→遵守率 + hook 提升建议
- `everything-claude-code`（AGENTS.md 指定的策展参考）— https://github.com/affaan-m/everything-claude-code

**论文 / 基准**
- SOPBench（ICLR 2026）— https://lacuna.tiptreesystems.com/paper/sopbench-evaluating-language-agents-at-following-standard-operating-procedures/art_82048e2d5f174a7da70c6c37b223c3f0
- CTA / Counterfactual Trace Auditing of LLM Agent Skills（arXiv 2605.11946）— https://www.emergentmind.com/papers/2605.11946
- Near-Miss: Latent Policy Failure Detection in Agentic Workflows（IBM，arXiv 2603.29665）— https://api.emergentmind.com/papers/2603.29665
- AgentPex / Willful Disobedience（arXiv 2603.23806）— https://www.emergentmind.com/papers/2603.23806
- MAC-Bench / Beyond Goodhart's Law（arXiv 2606.07805）— https://arxivlens.com/PaperView/ViewPdf/beyond-goodhart-s-law-a-dynamic-benchmark-for-evaluating-compliance-in-multi-agent-systems-6855-46bc4aaa
- ScopeBench — https://qingyuntop.ai/article/scopebench-agent-boundary-adherence-benchmark
- Hermes Agent Self-Evolution 报道（GEPA）— https://the-agent-report.com/2026/06/hermes-agent-self-evolution-dspy-gepa-june2026

**注**：部分 2026 年的来源是二手聚合页，核心结论已尽量回到一手（PLAN.md、arXiv 摘要）核对。
