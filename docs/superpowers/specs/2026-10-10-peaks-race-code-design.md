# peaks-race-code — 快泳道设计

- **日期**：2026-10-10
- **状态**：设计已定，**尚未经用户 review**。历经：brainstorming 3 段 + 11 处用户裁决 → `peaks audit goal` 第一轮（accepted with amendments）→ fresh-context 对抗评审（**10 项发现，推翻 3 项设计选择**）→ 用户对全部修正的裁决 → `peaks audit goal` 第二轮 rev2（**2 BLOCKER + 采纳 scope 拆分**）→ 拆为 **4 个 slice**（§13）→ **U5 / U7 裁决（均为 B）**：泳道问题改为"每次问 + 预选默认"（并随 pilot 状态切换），"实现完"与"可信到能默认提供"拆成两个门 → **S0 已交付并合入 main**（2026-10-10，`98f314d6`，见 `docs/superpowers/plans/2026-10-10-driver-resolution-and-commit-ban.md`）→ **§2.5 核实新增**：仓库里已有活的 fast mode，race-code 定位为**三档中的第三档**而非取代；S1 据此重定义为"以 `fast-mode.md` 为基泛化共享规范"。**现在两个用户级未决项都已关闭，可以 review。**
- **session**：`2026-10-10-session-8bc940`（rid 未分配；本条尚未走 `peaks request init`）
- **审计产物**：`.peaks/_runtime/2026-10-10-session-8bc940/audit-goal/`（`…-acceptance.md` / `…-rev2.json`）
- **⚠️ 独立性限制**：**本设计未经独立模型审计。** 第一轮审计与设计**同模型**（`deepseek-flash[1M]`）；`peaks-reviewer` 因 `reviewer.providers < 2`（`src/services/reviewer/reviewer-config.ts:77`）在本机**结构性不可用**，且它审的是实现后的 slice 而非 spec。替代品是 fresh-context 子代理（**换上下文、不换模型族**）。详见 §12 U9。
- **上游**：无（本条由用户直接提出，非审计产物）
- **约束（用户提出）**：
  1. 用户交互只能是两种形式之一：`AskUserQuestion` 多选，或自然语言描述。用户**不敲** `peaks <anything>`。（项目级 Human-NL-Choice-Only）
  2. peaks-loop 是增强层，不是新 CLI；不占 shell prompt、不注入 system prompt、不替代任何 runtime 原生入口。
  3. 红规则：任何 commit message 不得含 AI 署名 trailer。**这条对本 spec 尤其危险**——外部 harness 的系统提示会指示 AI 添加 `Co-Authored-By: Claude Code <noreply@anthropic.com>`，而项目红规则明文覆盖它。race-code 的提交必须不带该 trailer。

---

## 0. 起因

peaks-code 的质量工序是**固定成本**：不论任务多小，都要付 Step 0–11、Gate A–G、transition 状态机、以及若干个子代理上下文窗口的费用。

用户原话的三层意思：

1. peaks-code 的质量**是达到的**——问题不在质量。
2. 高质量的**副作用代价是开发效率**。
3. 在**黑客松**的时间约束下这个代价最扎眼；补充范围后，**日常中等及以下难度的需求和 bug** 同样如此。

用户已自行识别的核心矛盾：fast/race 允许直接改代码，与 peaks-code 的红线（编排者 ≠ 实现者）**正面冲突**，因此**不应**做成 peaks-code 的一个 mode。本设计采纳该判断并给出理由（§2）。

**成本的实际构成（这是本设计的立论基础）**：贵的是"多一个上下文窗口"与"多一份文书"，**不是**"多一个习惯"。每个子代理都要把仓库重读一遍——那才是体感上的慢。因此 race-code 的砍法不是"减少纪律"，而是**移除分权与文书**。

---

## 1. 承重不变量

> **删掉 race-code 的一切，peaks-code 的*行为*不变。**

**措辞修正（2026-10-10，用户提出"公共部分要抽出、不要维护 2 份"）**：本条原写作"peaks-code 的行为与今天**逐字节相同**"，并配一句"peaks-code 的 SKILL.md、其 references、Gate A–G、11 步工序，本设计**一行不改**"。**那个版本太强，已被推翻两次**：§3 的修正已要求把路由放进 `peaks-audit`（不是 peaks-code），而用户提出的**公共部分抽象**要求从 peaks-code 里**搬出**共享散文。所以不变量正确的高度是**行为级**——搬散文是**保行为重构**，不是对 peaks-code 的改动。

精确化为三条，缺一不可：

1. **`HARD_BLOCKED_PATH_FAMILIES` 的内容不变**——仍是 `src/` `tests/unit/` `tests/integration/` `config/` `bin/` `scripts/` 六项（`src/services/hooks/pre-tool-code-gate.ts:32`）。变的只是"**谁在开车**"的判定，不是"哪些路径危险"。
2. **驾驶者 = `peaks-code`，或身份无法解析 ⇒ deny 结果与今天一致**（含 stderr 标记与 `peaks sub-agent dispatch rd` next action）。
3. **race-code 是唯一新增的放行来源**。任何 race-code 专属代码（泳道判定分支）被删除 ⇒ 系统回到今天的全部行为。

**推论**：peaks-code 的 **Gate A–G、11 步工序、步骤顺序、它对子代理的用法**——全部不变。允许动的只有两类，且都必须**保行为**：① 把 §4.4 列出的共享散文**搬出**到规范文件；② 为共享散文加指向。race-code 是一个**新增的兄弟**，不是对 peaks-code 的修改。

---

## 2. 定位：race 是一条泳道轴

### 2.1 命名

`peaks-<lane>-<domain>`。`race` 是泳道，`code` 是领域。

用户裁决（**泳道轴，认可家族**）：spec 按轴写，家族形状成立。但——

> **今天只实现 `peaks-race-code` 一个成员。** 其他领域的 `peaks-race-<domain>` 需要各自的 spec 与审阅，**不自动继承**本 spec 的任何条款。家族形状是"以后不必重开这场争论"，不是"新成员自动合法"。

每个成员（含本成员）都必须：import `.peaks/standards/loop-engineering-guidelines.md`，携带逐字节相同的 loop-hygiene 块，并通过 `peaks skill lint --category loop-engineering-readiness` 与 conformance 审计。

**对 RL-8 的关系**：RL-8 的失败模式是"非 code 能力被偷渡进 peaks-code"与"其他领域被写成 peaks-code 的变体"。`peaks-race-code` 是 code 领域，不触发前者；它的名字形状接近后者的字面，故在此显式声明：**race 是泳道轴，不是 peaks-code 的变体**——它与 peaks-code 共享领域，不共享实现权。

### 2.2 与 peaks-code 的关系

| | peaks-code | peaks-race-code |
|---|---|---|
| 实现者 | 另一个上下文窗口（RD 子代理） | **当前窗口** |
| 评审 | 独立评审 + QA 分离 | 自审 |
| 留证 | 11 步工序 + Gate A–G 文件链 | 一条极短记录 |
| 分权 | 编排者 ≠ 实现者 | **无分权** |
| 适合 | complex / 高风险 / 要留证 | trivial / simple 的日常需求与 bug |

### 2.3 为什么不是 mode

peaks-code 的红线（编排者 ≠ 实现者）是它**分出多个上下文窗口的后果**，不是它的目的。24h 之所以能做成 flag，是因为它**没动红线**，只挪了阈值（`skill-presence-service.ts` 的 `mode` 轴只控制 `requiresConfirmation`，不碰 gate）。

race-code 要动的是红线本身。若把它做成 peaks-code 内部的一条"quick 泳道"，同一个 skill 里就会既禁止又允许直接改源码——红线降级为一个开关，"编排者不是实现者"不再是 peaks-code 的身份。

race-code **不继承**该红线，因为它的前提（分权）在 race-code 里不存在。所以这不是"违反红线"，是**走另一条泳道**。

**决定性证据（2026-10-10 核实）：peaks-code 里已经有一个活的 fast mode，而它的形状就是这条论证。**
`skills/peaks-code/references/fast-mode.md` + `peaks code plan --fast`（`code-mode-gate-plan-command.ts:25`，`buildCodePlan` 真的会 `skipped: opts.fast && isSkippable` 与 `repairLoop: !opts.fast`）。它跳过 memory 全量加载、standards preflight、QA 修复环——**但红线一字未动**。

> **换句话说：这个仓库已经做过一次"让 peaks-code 变快"的实验。答案不是"让编排者去改代码"，而是"跳仪式、留红线"。** 这正是本节论证的实证版本：红线是 peaks-code 的身份，仪式才是它可以谈的东西。
>
> 由此 race-code 的定位不再需要靠推理——它是**必须连红线一起放下**时的产物，而那件事**结构上无法**表达为 peaks-code 的一个开关。

详见 §2.5。

### 2.4 与现有 mode 轴的关系

race-code **复用**现有 mode 轴：`full-auto | assisted | strict | 24h`（`SkillPresenceMode`）照旧管"要不要停下来问你"。两条轴正交：

- **range 轴（新）**：谁实现 —— peaks-code 或 peaks-race-code，由 skill 身份决定。
- **mode 轴（既有）**：问不问 —— `full-auto | assisted | strict`。

**24h 与 race-code 不相容**：24h 是为"长时无人值守的多 slice 长跑"设计的，而 race-code 的定义就是短任务、单窗口。race-code **不实现 24h**（§11）。

### 2.5 与既有 fast mode 的关系：**三档，不是取代**（2026-10-10 核实后新增）

核实发现仓库里**已经有**一条快泳道，且是活的（见 §2.3 末段）。必须正面回答"那 race-code 是什么"，否则仓库里会有两个都叫"快"的东西而没人说得清该用哪个。

**三条泳道，只在一条轴上分岔**——**编排者能不能实现**：

| | 分权（编排者 ≠ 实现者） | 仪式 | 现状 |
|---|---|---|---|
| **peaks-code**（全量） | ✅ | 全 11 步 + Gate A–G | 已有 |
| **peaks-code `--fast`** | ✅ | memory 全量加载 / standards preflight / QA 修复环 **跳过** | **已有**（`fast-mode.md`） |
| **peaks-race-code** | ❌ **取消** | 零子代理、零 Gate 链、零文书 | 本 spec |

**决定：race-code 不取代 fast mode。** 两者是同一光谱上的不同点：
- fast mode 适合"值得独立实现者窗口、但不值得全 11 步"的任务——速度来自**砍仪式**。
- race-code 适合"窗口切换本身就是那个成本"的任务——速度来自**砍分权**。

取代掉 fast mode 会损失中间那一档：有些任务确实需要独立评审，只是不需要 PRD/swarm/SC/TXT。

**对 §4.4 共享内容的影响（这是本节的实际后果）**：既然两条快泳道并存，真正**逐字共享**的散文比 §4.4 原先估计的**更窄**：

| 候选 | 两条泳道都适用？ |
|---|---|
| **验收门**（`test pass + tsc pass + lint pass`） | ✅ **真的共享**——fast mode 已写着它，race-code §5 的 #1/#2 是同一件事 |
| **"何时不该走快泳道"（风险面）** | ✅ **真的共享**——两条泳道都需要一个"这不归快道管"的判据 |
| 完成证明 #3（诚实提交）/ #4（能退回） | ❌ race-code 独有——fast mode 不自己 commit |
| floor 其余、Gate A–G | ❌ 不共享 |

⇒ **S1 的重定义**（§4.4 / §13）：不是"抽出 §5 + §6 全文"，而是**以 `fast-mode.md` 为基，把「快泳道验收门 + 风险面」泛化为一份规范**，两条泳道各自指向它。

**顺带记一条漂移（同一类毛病，本轮第三次）**：`peaks code plan <change-id>` 的 CLI 帮助与 `fast-mode.md` 都在说 `change-id`，但 change-id 维度已在 `2026-06-29-change-id-root-removal` 删除，且 handler 的形参就叫 **`sessionId`**（`code-mode-gate-plan-command.ts:31`）。**帮助与文档都在用一个不存在的概念。** → §12 U13。

---

## 3. 入口路由

用户裁决：**每次都问**，且"过程中 LLM 提建议，不强制"。**但 2026-10-10 的独立评审推翻了本节的原始落点**（§3.1）。

### 3.1 路由的所在地：`peaks-audit`，不是分诊层

**原始写法（已废弃）**：把泳道问题放在分诊层 `peaks-solo`。**评审证明它不会触发**：

- `skills/peaks-solo/SKILL.md:7` 明写 "NOT for: code-specific work (use /peaks-code)"；
- 而 peaks-code 自己的触发词包含 `端到端/全流程/需求开发`、`全流程开发`、`端到端迭代`（`skills/peaks-code/SKILL.md:3`）。

即：用户以"端到端把 X 做了"提出需求时——**正是 §0 里感到最贵的那条路径**——分诊层根本不跑，泳道问题永远问不出来，race-code 只能靠用户**已经知道有这条命令**才能到达。§3.4 的"不得静默默认"会**空洞地成立**。

**修正后的落点：`peaks-audit`。** 三条理由：

1. 它的契约原文就是 "the **first** step in any peaks-* workflow"、`Precondition: None`，入口必经（`need expressed → peaks audit goal → …`）——**无论从哪条路径进来**，包括"全流程开发"。本次会话自己就走了一遍这个契约。
2. §11 只禁改 **peaks-code** 的文件；`peaks-audit` 不在禁列。
3. 它天然是"问一次"的位置：**一个 need 一次审计**，与 §3.2 的"同一 request 只问一次"同构。

> 评审原本建议改 **peaks-code 的 SKILL.md**——**不采纳**：那会撞破 §1 的承重不变量（peaks-code 一行不改）。放在 peaks-audit 达到同样效果且不破不变量。

### 3.2 "每次都问"的精确含义（用户裁决 U5 = **B：每次问 + 预选默认**）

**结论：每个新需求问一次，并把用户指定的 skill 预选为默认项。** 不是"未指定才问"。

**为什么改（原稿"未指定才问"已废弃）**：那个读法藏着一个**产品缺陷**——

> 用户发起日常小需求的方式大概率是 `/peaks-code` 或"端到端把这个改了"，**两者都是"已指定"**。于是那条选择题**永远不出现**，race-code 对用户**不可发现**——它的全部意义（小任务少付仪式费）**在最常见的路径上不生效**。

这与评审 **#2** 挑出的路由缺陷（机制装好了，但装在你不会经过的地方）**是同一类错误的第二次出现**。原稿没发现这一点。

**规则**：

| 情形 | 行为 |
|---|---|
| 用户**未**指定 skill（自然语言描述需求） | 弹一次选择题，**无预选** |
| 用户**已**指定 skill（`/peaks-code` / `/peaks-race-code`） | 弹一次选择题，**预选指定的那条**——一次回车即过，想换就选另一条 |
| 同一 request 已答过 | 不再问 |
| 本 session 已锁定 | 不再问 |

**"预选"不是"反问"**：不是"你确定吗"，而是**把选择器的默认项设为用户已经说的那条**。于是它**同时满足**"每次都问"与"明确指定就是答案"，并让泳道这件事**每次都被看见**——选择权显式地在用户手上，而不是靠 LLM 揣摩（这正是 Human-NL-Choice-Only 的精神）。

#### ⚠️ 本节行为随 pilot 状态切换（与 §5.5.2 / U7=B 耦合）

| 阶段 | 行为 |
|---|---|
| **pilot 通过之前** | race-code **只能指名到达**。此阶段按原 Reading A 行事——已指定 skill 时**不问**。理由：一条尚未在真实任务上验证过的泳道，不该在每个需求上被推荐 |
| **pilot 通过之后** | 切到上表（每次问 + 预选），race-code 成为**默认提供**的选项 |

两个阶段拼起来是一条完整路径：**先藏着，验证过再端上来。**

**关键补充（评审后）**：上表"同一 request 已答过"的那个答案，**就是 §8 用来判定放行的那个事实**。泳道不再有第二份可自写的副本——见 §8.1。

### 3.3 过程中：建议不强制

随探查深度增加，LLM 可以提**一句话建议**（"这个比预想的重，要不要转 peaks-code？"）。**不弹窗、不拦路、用户可无视。**

### 3.4 与"默认泳道"的关系

不存在静默默认。若用户始终不选且未指定 skill，peaks-race-code **不得**自行开始——停在那一次提问上。

> **评审补充的第三种输入形式**：§3.2 情形 1 把 `/peaks-race-code` 这类**斜杠命令**当作泳道的合法答案。它既不是 `AskUserQuestion` 选择、也不是自由自然语言——是第三种形式。Human-NL-Choice-Only 的禁令措辞针对的是**CLI 动词**，且 `/peaks-code` 早已在用，所以这**大概在字面之内**；但本 spec 把它**提升为承重的决策来源**是新的。用户如要覆盖，须明说，不能假定。

---

## 4. 工序表

分界线只有一条：**贵的是"多一个上下文窗口"和"多一份文书"，不是"多一个习惯"。**

### 4.1 砍掉

| 砍掉 | 原本是什么 |
|---|---|
| **全部子代理 dispatch** | PRD、RD、QA、5 路并行评审（code-reviewer / security / perf / karpathy / qa-test-cases-writer）。**这是最大的提速来源。** |
| Gate A–G 的文件链 | 每道都要 `ls` 出文件才能前进（`references/workflow-gates-and-types.md`） |
| transition 状态机 | `spec-locked → implemented → qa-handoff → handed-off` |
| 规划与文书 | `tech-doc.md` / `bug-analysis.md` / `code-review-<rid>.md` / `audit/security-<rid>.md` / `audit/perf-<rid>.md` / `qa/test-cases/<rid>.md` / `qa/test-reports/<rid>.md` / verdict |
| 调度机制 | Step 0.8 job-shape、slice DAG、swarm fan-out、Step 2.5 best-practice scan、Step 0.7 existing-system 提取、Step 8 SC、Step 10 TXT |
| 角色上下文 | Step 2 PRD 阶段、Step 3 三层并行、Step 7 RD↔QA repair loop |

### 4.2 保留（墙钟成本≈0）

| 保留 | 为什么它不是成本 |
|---|---|
| 改之前先读文件 | 省掉一整类"改错文件/改错位置"的返工 |
| TDD 小步 micro-cycle | 5–10s/轮（`references/micro-cycle.md`），**比不写测试更快**发现错 |
| Karpathy 四条 | 先想再写 / 简单优先 / 外科手术式改动 / 目标驱动——是习惯，不是工序 |
| 动手前查 codegraph 受影响面 | 一次查询，避免改漏调用点 |
| 动手前一句话说清"要改什么、为什么" | 一句话，不是文档 |
| 根污染检查 | 不往项目根丢中间产物；race-code 不产中间产物，天然满足 |
| **完成证明四条（§5）** | 是不可协商的动作，不是文书 |

### 4.3 考虑过但未采纳的替代方案（审计第一轮记录）

审计的 `alternatives` 维度（`info` 级）提出过一条我们 brainstorming 阶段没考虑的路径：

> **"automation of routine quality checks to speed up peaks-code itself"** —— 不新开泳道，而是把 peaks-code 自己的例行质检工序自动化掉。

**不采纳的理由**：本条的诊断是"贵的是**多一个上下文窗口**"——每个子代理都要把仓库重读一遍。自动化质检减少的是子代理**内部**的工作量，并不消掉 dispatch 的成本（重读仓库这一步照样发生）。它答的不是我们识别出的那个成本。

**但它留下一条有效的警告**：如果 §5.5.1 的基线显示慢的主因**不是** dispatch 而是别的东西（例如 Gate A–G 的 `ls` 串行检查），那么这条替代方案就会**反过来变成首选**，本设计应重估。§12 U8 记了这一点。

### 4.4 公共部分的抽象（用户 2026-10-10 提出：不维护两份）

**先数清楚——净新增重复比想象的小**

| 候选 | 真会重复吗 | 处理 |
|---|---|---|
| read-before-edit | **已经共享**——它就在 loop-hygiene 块里（"Read before you edit"），22 份逐字节相同、有测试钉 | 现状，不动 |
| TDD micro-cycle | 会 | 指向 |
| Karpathy 四条 | 会（现靠指向 `skills/bee/peaks-rd/references/rd-sub-agent-dispatch.md` 的一节） | 指向 |
| **§5 的 #1/#2（测过 / 类型过）** | **会**——它与既有 fast mode 的验收门是同一件事 | **抽出**（以 `fast-mode.md` 为基，见下） |
| **§6 风险面清单** | **会**——两条泳道都需要"这不归快道管"的判据 | **抽出** |
| §5 的 #3（诚实提交）/ #4（能退回） | **不会**——race-code 独有，fast mode 不自己 commit | 留在 §5 |
| Gate A–G / transition / dispatch 契约 | 不会，race-code 明确不用 | — |
| workspace / presence / runtime 目录 | 不会，已是 CLI 共享 | — |
| 泳道路由决策 | 不会，落在 peaks-audit，两泳道共用 | — |

> **修正（2026-10-10 核实）**：上表原先把"§5 完成证明（floor）"与"§6 风险面"整体标为"净新增重复"。**实测不成立**——peaks-code 里**既没有**完成证明清单**也没有**风险面清单（它的等价物是 Gate A–G + transition 状态机，机制完全不同）。**而且仓库里已经有一条活的快泳道（fast mode），它的验收门正是 §5 的 #1/#2。** 所以共享面比原先估计的**更窄也更实**：见 §2.5。

**机制：一份规范 + 双指向 + 一个测试 —— 不是"复制 + 逐字节测试"**

仓库现有的"不维护两份"的做法是 **loop-hygiene 块：22 份逐字节相同 + 一个测试钉住**。**那是复制加测试，不是抽象。** 若 §5/§6 照办，会产生第 23、24 份副本——**正好是本次要避免的**。

用户裁决选定的机制：

1. **一份规范文件**承载 §5 与 §6 的共享散文；
2. **两个 SKILL.md 指向它**，不重述；
3. **一个测试**断言两边都没有把它重述一遍（**双向**：既断言指向存在，也断言正文里不存在第二份）；
4. 落点遵循 **RL-8 先例**——每个 peaks-* skill **import** `.peaks/standards/loop-engineering-guidelines.md`；"import"即**指向**一份规范。具体路径实现期定（§12 U12）。

**顺序：本 slice 内、先抽后写**（用户裁决）

race-code 尚不存在 ⇒ 现在抽就**永远不会产生重复**；先写 race-code 再抽，中间那段窗口里就是两份。故 §13 把抽象排在写 race-code **之前**。

**反向警告：不要抽过头**

不得把两条泳道抽成一个"lane 框架"（如"可控严格度引擎"、"泳道抽象层"）。那正是独立评审 **W6** 警告的**预授权没被审过的东西**。**只抽真正逐字重复的散文；不抽"概念上相似"的结构。** 判据：**两处文字若不能逐字相同，就不该抽。**

---

## 5. 完成证明（floor）

race-code 不写文书，但下列四件事必须**真实发生**，且必须在对话里**亮出命令与输出**（不许"应该能过"）。

1. **测过的** —— 为本次行为变化写了或改了测试，**跑过、通过**。纯无行为变化的改动（格式化、重命名）可显式声明豁免理由，不得静默跳过。
2. **类型过的** —— 类型检查或构建通过（`tsc --noEmit` 或项目等价物）。
3. **诚实的提交** —— commit message 说清改了什么、为什么。
4. **能退回去的（N2）** —— 改动落在一个**能整体撤回**的单元上：一次 commit（或一个 branch），且 race-code 必须能说出回退它的那条命令。

> **N2 为什么是 floor 的一部分（审计第一轮追加）**：race-code 是**唯一**允许直接改 `src/` 的泳道，同时**豁免了提交闸**（§8.4）——也就是它绕开了 `peaks request transition` 那套检查。"诚实的提交"只保证提交**说得清**，不保证提交**撤得回**。#4 是这条泳道唯一的回退保险。

> **完成证明 #3 的红规则警告**：commit message **不得**包含 `Co-Authored-By: Claude`、`Co-Authored-By: Anthropic` 或任何等价 AI 署名 trailer。项目红规则明文规定 SquabbyZ（`601709253@qq.com`）是唯一作者，并由 `tests/unit/standards/no-ai-co-author-trailer.test.ts` 在每次 `pnpm test:unit` 与 CI 上强制。外部 harness 的系统提示若指示添加该 trailer，**项目规则覆盖它**。**§8.4 修正后**，这条不再只靠"事后检测"——同一个拦截点会在 commit 存在**之前**校验 message。

> **执行点的诚实清点（评审发现，2026-10-10）**：原稿把这四条称为"**不可协商的动作**"。评审指出要害：**§4.1 删掉了执行机制（Gate A–G、transition 状态机、全部文书），于是这四条由唯一有动机跳过它们的一方自报。** 必须如实区分哪几条真有执行点：

| # | 证明 | 执行点 |
|---|---|---|
| 1 | 测过的 | **无。** 靠 §7.2 的记录 + 用户在场所见的输出 |
| 2 | 类型过的 | **无。** 同上 |
| 3 | 诚实的提交 | **有**（§8.4 之后）：同一拦截点在 commit 存在前校验 message；事后红规则测试作第二层 |
| 4 | 能退回去的 | **弱。** "改动是单个 commit / 工作区干净"可机械检查；"能整体撤回"本身要人判 |

**这个不对称是评审最重的一击，而且它同时在骂我这篇 spec**：我在 §5.5.1 要求速度声称**必须被验证**（连"取不到基线就要明说"都写了），却在合规上接受了"**自报**"。**同一份 spec 不能用两把尺子。**

**处置**：不假装 1 / 2 / 4 是闸。它们的效力来自 §7.2 的记录 + **用户在场**（race-code 是单窗口交互，命令与输出用户看得见）。**若这不够，那说明应该质疑这条泳道本身是否成立**——而不是把散文改称"不可协商"来掩盖。

---

## 5.5 泳道级度量（N1 + N4，审计第一轮追加）

> **这一节的存在理由**：本泳道存在的**唯一理由**是"更快"，而在审计第一轮之前，"更快"在 spec 里是一个**未经检验的断言**。以下把它变成可检验的。

### 5.5.1 指标：结构性，不是时序（N1，2026-10-10 修订）

首版把 N1 写成**时序**指标（TTFI / lead time），并要求基线"取自真实记录、不得事后补造"。**实测后否定——盘上的数据支撑不了这条要求**：

| 观察 | 数字 |
|---|---|
| 有 `metrics/slices.jsonl` 的 session | **2 / 4** |
| 记录总数 | 151（`slice-transition` 87 / `dispatch` 41 / `checkpoint` 23） |
| 有 `sliceRid` 的真实 slice | 16 |
| **41 条 `dispatch` 中归属到某个 rid 的** | **0**（全部落 `(none)` 桶；该桶 64/151 = **42%**，跨 1627 分钟） |
| 每个 rid 的记录数 | 2–13 |

三处致命：① `dispatch` 事件**不带 `sliceRid`**——而"每个任务付了几次子代理 dispatch"**正是本设计的中心断言**，这个最相关的量归不到任务上；② per-rid 的"跨度"是"发过任何事件的窗口"，**不是 TTFI**（rid-046/047/048 只有 2 条记录、跨度 **0 分钟**）；③ 42% 的记录无归属。

**修正后的指标（结构性，按构造可数）**：

| 指标 | peaks-code | peaks-race-code |
|---|---|---|
| 每个任务开启的**上下文窗口数** | ≥ 2–5（PRD / RD / QA / 5 路并行评审，随 slice 形状浮动） | **1** |
| 每个任务的**重读仓库次数** | = 上下文窗口数 | 1 |

**为什么结构性版本更好**：本设计的因果断言本来就是"peaks-code 为每个任务多开 N 个上下文窗口、每个都要把仓库重读一遍；race-code 开 1 个"。这是个**结构性**命题——不需要历史时序数据，也不需要埋点先修好。时序版本既依赖一份不完整的埋点，又把墙钟时间混进了睡眠 / 等待 / 用户思考，**归因不到设计上**。

**诚实的否定面（保留）**：若 §3 的路由成本 + §8 的身份解析往返把优势吃回去（独立评审指出的"最可能失败方式"正朝这个方向：**解析出错误的驾驶者 ⇒ race-code 被 deny ⇒ 而这次 deny 与"gate 正常工作"现象上无法区分**），则本设计**不成立**，按 §12 U8 重估。

**时序基线**归到一个独立小 slice（给 `dispatch` 事件补 `sliceRid`、给每个任务补起止标记），**不在本 spec 内**——见 §12 U10。

### 5.5.2 试点：**两个门，不是把一个门拉长**（用户裁决 U7 = B）

审计的 successCriteria 第 6 条把 "…**pilots** demonstrate usability and no severe quality regressions" 写进了完成定义。**用户裁决不照字面采纳，而是拆成两个独立的门**：

| 门 | 判据 | 关什么 |
|---|---|---|
| **门 1 — 实现** | S2 的代码交付完 + T1–T10 绿 | S2 的退出判据 |
| **门 2 — 信任** | pilot 在真实任务（黑客松 / 日常中等以下）跑过，且无严重回归 | 决定 race-code 能否**默认提供**（§3.2 的阶段切换） |

**为什么拆开是对的**：实现与信任是两件事。绑在一起会让一个已经做完的 skill 因为"还没用够次数"而**无法关闭**。而审计自己的 successCriteria #10 本来就是分段的（先修硬前提 → MVP pilot → 再默认启用）。

**门 2 的判据必须可数**（否则它是散文——§5 刚吃过一次这个教训）。四个可从 §7.2 的记录 + git/CI 历史数出来的量：

- race-code 任务数；
- 其中被**回滚**的次数；
- 其中让 **CI 变红**的次数；
- 其中**漏报风险面**的次数（事后发现命中了 §6.2 却没记录）。

**⚠️ 门 1 与 N1 的关系（澄清，避免重复计功）**：N1 的结构性指标（每任务上下文窗口数）**按构造即成立**，**不需要 pilot**。所以门 1 通过时**结构性收益已经可验证**；门 2 验的是**真实可用性**，不是速度。两者不重叠。

---

## 6. 越界与升级

### 6.1 两层判定，方向不对称

| 层 | 时机 | 机制 | 性质 |
|---|---|---|---|
| 第一层 | 改之前 | LLM 读需求 + 项目扫描，给初始判断 | 便宜，**会错**（且无机械原语可替代，见下） |
| 第二层 | 改完之后（有 diff） | `peaks complexity-estimate --files <...>` + 风险面清单（§6.2） | 便宜，**但只覆盖一部分情形**（见下） |

**第一层必须是 LLM 判断，这不是偷懒，是事实**：`peaks classify run` 分的是**当前 diff**（`git diff HEAD`），`peaks complexity-estimate` 吃的是**一组文件**——**两者都无法在"还不知道要改什么"之前给需求定级**。spec 不假装存在这样的现成原语。

**第二层的真实覆盖面（评审修正，2026-10-10）**：原稿写"可靠，**只能往更严的方向翻**"——**这是一个未经论证的断言**。实际情况：

- `estimateComplexity` 按**文件**的 LOC + export 数 + async 用量打分（`src/cli/commands/complexity-commands.ts:21-24`）——**它量的是文件，不是改动**。900 行文件里改一行读作 `complex`；删掉 400 行读作 `trivial`。
- 所以第二层**不是**能独立兜住第一层的东西。它只在"改动落在本就复杂的文件上"这一种情形里有效，**其余情形它给不出信号**。

### 6.2 风险面（**清单**，不是"机械定义"）

> **称谓修正（评审）**：原稿称本节为"越界的**机械定义**"。**名不副实**——7 条里只有 1 条是机械的（规模阈值），而它的值至今没定（§12 U2）。其余是对**一个尚未存在的 diff** 做的 LLM 判断。称它"机械"会让读者以为有一道自动闸，而实际没有。

任一命中即视为越界：

| # | 风险面 | 机械可判？ |
|---|---|---|
| 1 | authn / authz / 凭据 / secrets 的处理路径 | ❌ LLM 判断 |
| 2 | 数据库 schema 或迁移 | ⚠️ 路径可部分机械匹配（`migrations/` 之类） |
| 3 | 公开 API 面（导出签名变化） | ⚠️ 可由 codegraph / 导出面 diff 部分机械化 |
| 4 | 并发 / 事务语义 | ❌ LLM 判断 |
| 5 | 依赖升级且带 API 变化 | ⚠️ `package.json` diff 机械，API 变化判断不机械 |
| 6 | 改动规模超过阈值（文件数 / 行数） | ✅ **机械**——但**阈值未定，§12 U2** |
| 7 | 无法用"跑一遍测试就相信它对了"来证明的行为 | ❌ LLM 判断 |

**必须正视的后果**：这是一份**判断清单**，不是一道闸。它的价值取决于 §6.4 的"覆盖要记一笔"与 §7.2 的记录——**不**取决于它自身的机械性。

### 6.3 升级单向，永不静默降级

- race-code 中途发现自己越界 ⇒ **停下、告知用户、升级到 peaks-code**。不得硬推。
- peaks-code 已开车 ⇒ **不得中途"这挺简单的降级吧"**。既有原则直接复用：`peaks classify downgrade` 现在是 REFUSED 的（"peaks-loop never downgrades a classification"）。

### 6.4 用户覆盖（裁决：允许，说风险 + 记一笔）

**用户本人可以**把已判定越界的任务压回 race-code 继续。此时 race-code 必须：

1. **明确说一次风险**（一句话，不弹窗、不阻断）；
2. 把"用户覆盖 + 风险面是什么"**记入痕迹**（§7）。

不静默放行，也不硬拦。这是"用户的仓库、用户的决定"，但**不装没看见**。

### 6.5 升级后的归属（N3，审计第一轮追加）

审计的 `risks` 维度指出 "unclear ownership when a fast task escalates to peaks-code"。原 §6.3/§6.4 只说"停下、升级"，**没说升级后那个半成品工作区归谁**——这是真空白。

**规则**：

1. **工作区状态必须显式交接。** 升级时，race-code 必须回答三个问题并写进 §7.2 的记录：
   - 当前工作区是**干净的**、**半成品已提交**、还是**未提交的脏改动**？
   - 半成品是否**通过** §5 的 #1/#2（测试、类型）？（决定 peaks-code 接手时是"继续"还是"先修"）
   - 已改的文件清单 + 为什么停下。
2. **归属在交接完成的那一刻转移。** 交接记录落盘之前，工作区归 race-code（它必须保证不留下无法解释的状态）；落盘之后归 peaks-code。
3. **禁止"扔下就跑"。** race-code 不得在存在未提交脏改动、且未说明其状态的情况下退出升级流程。

> 这条之所以是硬规则而非建议：peaks-code 的 Gate A–G 假定工作区是**已知状态**。一个来源不明、可能半坏的 dirty tree 会让 peaks-code 的第一步（project scan / RD planning）建立在错误前提上。

---

## 7. 痕迹与 memory

### 7.1 `.peaks/_runtime/<sessionId>/` 必须存在

用户裁决：该目录必须。因此 race-code 仍然要跑一次 `peaks workspace init`（它也是 `peaks skill presence:set` 的前置——`presence:set` 是 fail-closed 的，要求已绑定 session）。

这一步是**一次 CLI 调用**，不是工序。

### 7.2 一条极短记录

落点 `.peaks/_runtime/<sessionId>/race/<rid>.md`。内容按实际，最少包含：

- 需求一句话
- 泳道（race）+ 是谁选的（用户选 / 用户显式指定）
- 改了哪些文件
- 四条完成证明及**实际结果**（含跑过的命令）
- 有没有命中风险面；若命中且被用户覆盖 ⇒ 记录覆盖事实

**可选（按实际）**：`codegraph-context.md`、`diff-summary.md`。

### 7.3 memory 沉淀（裁决：只风险 / 新坑才沉淀）

- 日常小改 **不**进 `.peaks/memory/`，只留 §7.2 的 runtime 记录。
- **仅当**本次改动画了风险边界、或踩到新坑时，才向 `.peaks/memory/` 沉淀一条。

理由：日常小改占绝对多数，若全量沉淀，memory 会被噪音淹没而失去信噪比——那正是 peaks-code 的 memory 现在赖以有价值的东西。

**格式：本 spec 不定义。** race-code 沉淀出的条目的字段与正文形状，**完全跟随 memory 系统当时的格式**。用户已决定另立一个 slice 给 memory 条目加 正例/反例（见 §12 U6）——race-code 是那个格式的**消费者**，不是定义者。故本 spec 对 entry 形状零约束，B 落地后 race-code 自动继承，无需回来改本 spec。

---

## 8. Gate 改造

> **本节于 2026-10-10 被独立评审推翻并重写。** lane token 机制**删除**（§8.1 说明为什么）；提交闸从"豁免动词"改为"**检查 message**"（§8.4）。

### 8.1 泳道从"用户的答案"派生，不再有 token

**原版（已废弃）**：race-code 在入口写 `.peaks/_runtime/<sessionId>/race/lane.json`（`{lane, sessionId, startedAt}`），gate 读它放行。

**评审证明它开的是一道门，不是一道减速带**：

- `.peaks/**` 在 `pre-tool-code-gate.ts` 的**白名单里首先短路**（`ALLOW_LISTED_PATH_PATTERNS`，`:42-50`；判定函数原文 "Allow-list check first — short-circuits any deny"）——**写 `lane.json` 这件事本身，gate 从不拦**。
- `peaks skill presence:set <name>` **接受任意字符串**（`skill-presence-commands.ts:215-220`；唯一的校验是 `--mode`，`:169`）。

**于是"我忘了 peaks-code 不能直接改 src/"的完整打开序列只有两步**：`peaks skill presence:set peaks-race-code` → 写 `lane.json` → 改 `src/`。**两步都在 gate 覆盖之外。** 而 §9 原话说 gate"挡的是手滑与惯性"——**改动之后这句话对最该挡的那类手滑不再成立**：偷懒者的最便宜路径从"停下"变成"改个标签"。

**修正：删掉 token。** 泳道**直接派生自 §3.2 情形 2 里用户已经做出的那个选择**——它本就已持久化在 `.peaks/_runtime/<sessionId>/` 下，是被审计过的用户决定，**不需要第二份可自写的副本**。

这同时消掉一类残留 bug：原 §12 U3 论证"token 生命周期 = session，崩溃后 session 即结束"**是错的**——它把外层 harness session 与 peaks session 混为一谈。一个 peaks session id 会跨 `/compact` 与 `peaks-resume` **复用同一 session 目录**，所以"崩溃后 token 残留"能在同一目录里活到下一次 resume。

### 8.2 判定（依赖一个必须先修的解析）

`src/cli/commands/code-gate-command.ts` 在调用纯函数 `decideGateAction`（`:81`）之前，解析"本 session 的泳道选择"。

| 用户的泳道答案（§3.2） | 解析出的驾驶者 | 结果 |
|---|---|---|
| `race`，且属于**本 session** | `peaks-race-code` | **allow**（硬阻断家族放行） |
| `race`，但驾驶者已是 `peaks-code` | `peaks-code` | **deny**——答案陈旧（切换泳道后未更新），不得继承放行 |
| 无答案 / 不匹配 | `peaks-code` | **deny**（与今天逐字节一致，`:99` + `:117`） |
| 无答案 / 不匹配 | 解析失败 / 其他 | **deny**（fail-closed，§8.3） |

**放行是两个条件的合取**：本 session 的泳道答案为 `race` **且** 驾驶者 === `peaks-race-code`。缺一即 deny。

> 只查答案不查驾驶者 ⇒ "陈旧答案继承放行"（T8）；只查驾驶者不查答案 ⇒ 泳道选择沦为摆设（T9）。合取让两者都有真实对照可写。

**白名单路径族**（`.peaks/` `skills/` `docs/` `.md` 等）不受影响，仍先短路放行。

#### ⚠️ 硬前提：解析必须先独立修好（评审发现）

现在的解析**不可靠，而且同一个问题在仓库里有两个互相矛盾的答案**：

- `listPresenceLeases`（`src/services/skills/presence-lease-service.ts:496-513`）按 `readdirSync` **原始顺序**返回，**不排序**；
- `resolveActiveSkillForCaller`（`src/services/audit/enforcers/active-skill-resolver.ts:116-130`）取遍历中**第一个**合格 lease，其 `callerId` 过滤是**可选**的（`opts?.callerId`）；
- 而 `hook-handle.ts:131` 调用时**没传 callerId** ⇒ 驾驶者是**跨该 session 目录下所有 caller、按目录顺序**解析出来的；
- 但 `readSkillPresenceFromLease`（`src/services/skills/skill-presence-service.ts:198`）**按 `lastHeartbeat` 降序**排后取 `[0]`。**同一个问题，两个答案，可以不一致。**

更糟：`touchSkillHeartbeat`（`:701-721`）只改**内存里**的 `presence.lastHeartbeat` 就返回，注释自述 "the legacy `active-skill.json` file is no longer touched"。**若无人周期调用 `setPresenceLease`，盘上的 `lastHeartbeat` 永不刷新**——盘上真实样本 `presence-7ee97fe3-…-compat.json` 即 `lastHeartbeat === startedAt`、`status: "preparing"`。"在飞"退化成"有个 lease 文件在"。

**结论**：**解析契约必须先独立修好**（传 `callerId`，或至少与 `:198` 一致地按 `lastHeartbeat` 排序），否则 §8.2 的整张表建在一个不可靠的答案上。评审指出的"最可能失败方式"正是这条：gate 解析出错误的驾驶者 ⇒ race-code 被 deny ⇒ **而这次 deny 与"gate 正常工作"在现象上无法区分**。→ §12 U11。

**自愈的说法一并撤回**：原 §8.3 写"重新断言 token 后重试一次，摩擦有界"。`presence:set` 本身是 fail-closed 的（未绑定 session 时 `PEAKS_SESSION_NOT_BOUND`，exit 1，`skill-presence-commands.ts:180-190`），所以那个重试要么循环、要么根本不会发生。**"摩擦有界"在代码里没有依据，撤回。**

**实现注意**：`peaks code-gate` 目前只有 `--dry-run`（`:46`），**没有 `--project`**；hook entry 是 `peaks code-gate --json`。projectRoot 的来源是**实现期第一件事**（§12 U1）。

### 8.3 失败方向：fail-closed（用户裁决）

**认不出"谁在开车"就拦。**

明确后果：装了 gate 的仓库，`src/**` 默认仍然改不了；只有正读到本 session 的 race 泳道答案才放行。这与 gate 在别处的 fail-open 取向（payload 畸形 / 无 file_path / 内部错误）**方向相反**，是**有意为之**——见 §9。

**⚠️ 评审发现的既存事实（与本节方向相反）**：**提交闸今天就是 fail-open**。`hook-handle.ts:132` 是

```ts
if (activeSkill.skill !== null) {   // ← 解析不出来，整个提交闸被跳过
```

而 `resolveActiveSkillForCaller` 在未绑定 session / session 目录缺失 / session id 不安全时都返回 `{skill: null, …, source: 'none'}`。**同一个信号，提交闸 fail-open，而本 spec 要求 fail-closed。** 这个不一致要写明，不能假装不存在（§12 U11）。

### 8.4 提交闸：**保留拦截点，改为检查 message**（评审修正）

**原版（已废弃）**：给 `peaks-race-code` **豁免**提交闸。评审指出**这是本设计凭空开的洞，不是继承的洞**：

- 今天 `peaks-*` skill 的 `git commit` 在 `hook-handle.ts:131-156` **执行前就被拒**——所以在一个**解析正常**的 session 里，AI 署名 trailer 的危害**根本无从产生**（该 skill 从不自己 commit，它走 `peaks request transition`，由后者内部提交）。
- 豁免之后，§5 的 #3 只能依赖 `tests/unit/standards/no-ai-co-author-trailer.test.ts`——而**那个测试自己的头部就写着**：*"this DETECTS, it does not PREVENT. A violating commit is already in history when the guard runs, and the remedy is to rewrite it before it is pushed"*（`:30-33`）。危害照旧落地，补救是改历史。

**修正**：**保留拦截点，把它的判定从"拒动词"改成"校验 message"。** 即对 `peaks-race-code` 的 `git commit`：message 干净 ⇒ **放行**；含 AI 署名 trailer ⇒ **拒**。

该拦截点本来就拿得到命令串——`isCodeCommit(skill, command)`（`code-ban.ts:31`）；`hook-handle.ts` 也拿得到 tool input。这是**整条流程里唯一能在 commit 存在之前检查 message 的时点**。约 10 行，把红规则从"事后检测"变成"**事前阻止**"。

**机制修正（rev2 审计后，2026-10-10）**：原稿把 message 校验写成**命令串启发式**，并断言 `git commit -F <file>` / heredoc / 编辑器驱动 / `--amend` 形态**判不出来**——**那是错的**，而且 rev2 的 `alternatives` 维度直接给出了更好的机制：

> **用 `.husky/` 的 `commit-msg` 钩子校验。**

`commit-msg` 是 git 原生钩子，在**消息已成形之后**触发——`-m` / `-F` / heredoc / 编辑器 **全部覆盖**。仓库本来就有 `.husky/`（如 `.husky/peaks-gate.mjs`）。**那条"已知局限"因此整个消失。**

**选定机制（用户裁决，rev2 后）**：

| 层 | 位置 | 作用 |
|---|---|---|
| **主** | `.husky/commit-msg` | 拦截**所有**提交形态；含 AI 署名 trailer ⇒ 拒 |
| **次** | `peaks code-gate` / `hook-handle` 的拦截点 | 防 hook 不在场（`--no-verify`、或 clone 后未跑 `husky install`）。用命令串启发式，**明知覆盖不全**，作为兜底而非主力 |

⚠️ **两处规则必须同源**（同一份 trailer 正则）。实现期须让次层**从主层的判定函数取规则**，不得各写一份——否则就是新增一个漂移点，而本 spec 刚在 §4.4 花了一整节反对这种重复。

**不变的一点**：race-code 仍然**自己 commit**（完成证明 #3 不因此改动）。它绕过的是 `peaks request transition`（`spec-locked` + tech-doc-presence 检查）——**那正是 race-code 有意砍掉的东西**，两者一致，不是漏洞。

---

## 9. 信任模型（必须明说）

> **code-gate 是纪律门，不是安全边界。**

- 它今天已经在**三处** fail-open（payload 畸形、无 `file_path`、内部错误），其设计文档自述 "the LLM is never bricked by a peaks bug"。
- 它挡的是**手滑与惯性**（"这改动很小，我直接改吧"），不是**攻击者**。本设计**不试图**阻止一个有意的绕过，也不假装阻止了。
  - **但这句话在评审后需要限定**：原稿接着写"任何能写 lane token 的进程都能开门"——**lane token 已被删除（§8.1）**，而删掉它的理由恰恰是同一件事：token 版本把"偷懒者的最便宜路径"从**停下**改成了**改个标签**。也就是说，token 版本的 gate 对"手滑与惯性"**已经失效**——而那正是它存在的唯一理由。**删除 token 之后，"挡手滑"这句话重新成立**，因为现在没有任何自写的开关可以打开它。
- §8.3 的 fail-closed 是**在身份这一个维度上收窄**，不是把纪律门升级成安全边界。写清楚，是为了让后来者不要基于错误假设去加固它。
- **一处必须记下的反向事实**：同为身份维度的**提交闸今天却 fail-open**（`hook-handle.ts:132` 的 `if (activeSkill.skill !== null)`）。同一个信号、两个相反方向，本 spec 只统一了 gate 那一侧，提交闸那一侧**留给 §12 U11**，不在这里偷偷改。→ §8.3 末段。

---

## 10. 测试与不变量

### 10.1 必须改动的现有测试 / 常量

| 文件 | 为什么 |
|---|---|
| `src/services/skills/skill-conformance-service.ts:46`（`SKILL_NAMES`，硬编码 13 个） | 加 `peaks-race-code`。**但别夸大它的作用**（评审）：该表只有 13 个名字，而 `skills/` 下有 22+ 个 SKILL.md——它已漏掉 peaks-solo / peaks-content / peaks-audit / peaks-final-review / peaks-reviewer 及全部 `skills/bee/*`。加进去只是让 conformance 看见它，**它不是一致性的守卫** |
| `tests/unit/services/hooks/code-gate.test.ts` | 见下方"纯函数的签名"——**`decideGateAction` 有 20 个两参调用点**（`:107`–`:219`），加必选第三参全断 |
| 新增 `skills/peaks-race-code/SKILL.md` | 必须携带逐字节相同的 loop-hygiene 块（`tests/unit/skills/loop-hygiene-block.test.ts` 遍历文件系统，漏了自己会红） |
| **`.sh` 兄弟（评审发现的漏项）** | `src/services/hooks/pre-tool-code-gate.sh` 是**同一道闸的第二份实现**，由 `src/cli/commands/hooks-commands.ts:118-137` 随 global 安装分发，且**正被本表要改的那个测试文件 spawn**（`code-gate.test.ts:231-377`）。Claude Code 上生效的是 CLI 那条 entry，所以这是**平行实现的漂移**而非当场坏掉——但本设计会**发出两道对"泳道"判断不一致的闸**，§1 的"变的只是谁在开车"只对其中一道成立。**必须二选一：同步改，或明确声明 `.sh` 不再承载泳道判定并在测试里钉住这一差异** |

**不需要改**：`tests/unit/skills/loop-hygiene-block.test.ts`（遍历文件系统，自动覆盖新 skill）。`tests/integration/code-gate-step-08-hook.test.ts` 管的是 Bash 闸，与本次无关。

#### 纯函数的签名（必须先定，评审发现）

`decideGateAction` 现为 `(tool, input)`（`src/services/hooks/pre-tool-code-gate.ts:83-86`），测试里有 **20 个两参调用点**。因此：

- 加**必选**第三参 ⇒ 20 个调用点全断 ⇒ 原稿那句"原 6 个 family + 6 个白名单 + stderr 标记 + next action 断言**必须原样保留**"**做不到**。
- **选定**：第三参**可选**，**默认值即 fail-closed 分支**（无泳道答案 ⇒ 按今天的行为 deny）。原稿从未写明这一点，是评审指出的空白。

#### 分层：三种测试不要混在一张表里（评审发现）

原 §10.2 把不同层的测试混在一起，导致 §13 的执行顺序不可能成立：

| 层 | 测什么 | 位置 |
|---|---|---|
| **纯函数** | 路径族 × 泳道答案 → allow/deny | `tests/unit/services/hooks/code-gate.test.ts`，直接调 `decideGateAction` |
| **命令 / 解析** | 泳道答案与驾驶者**从磁盘解析**出来是什么（T2/T8/T9 全在这层） | 需 CLI/解析层夹具，**不能**用纯函数测 |
| **提交闸** | `isCodeCommit` + message 校验 | `code-ban` 的单测 |

### 10.2 新增不变量测试

**非空性怎么保证（评审纠正原 T5）**：原稿写"人为把 T1 的期望翻成 allow ⇒ 套件必须变红"。**那不是测试**——套件无法观察到自己的期望字面量被人编辑过；写成代码只会变成注释或被 skip 的用例，**恰好成为它想防的那种空断言**。

可用做法是**注入一个造出来的产物**，仿 `no-ai-co-author-trailer.test.ts:248-298`（建临时 git 仓、放一个真实违规 commit、断言检查器变红）：

- **注入夹具**：造一份假的"解析结果 + 泳道答案"**输入**（不是改期望值），跑 `decideGateAction`，断言它按 §8.2 表动作。
- **非空性**由 **T1（deny）与 T3（allow）走同一代码路径、只差一个输入**保证——实现若把该路径恒定为 allow 或恒定为 deny，必有一条红。

| # | 层 | 场景 | 断言 |
|---|---|---|---|
| T1 | 纯函数 | 无泳道答案（默认分支），目标 `src/x.ts` | **必须 deny**——与今天逐字节一致 |
| T2 | 解析层 | 泳道答案读取失败 / 驾驶者无法解析，目标 `src/x.ts` | **必须 deny**（fail-closed，§8.3） |
| T3 | 纯函数 | 泳道答案 = `race` + 驾驶者 = `peaks-race-code`，目标 `src/x.ts` | **必须 allow** |
| T4 | 纯函数 | 泳道答案 = `race`，目标 `docs/x.md`（白名单族） | **必须 allow**（防白名单短路被破坏） |
| T5 | 夹具注入 | 用**注入的解析结果**驱动上表每一行 | 每行按其期望动作——**替代原 T5 的"翻期望值"** |
| T6 | 提交闸 | `peaks-race-code` + 干净 message | **放行** |
| T7 | 提交闸 | `peaks-code` 执行 `git commit` | **仍被拦**（防改动写宽了） |
| T8 | 解析层 | 泳道答案 = `race` 但驾驶者已是 `peaks-code` | **必须 deny**——防"陈旧答案继承放行" |
| T9 | 解析层 | 无泳道答案但驾驶者 = `peaks-race-code` | **必须 deny**——防"只查驾驶者，泳道选择沦为摆设" |
| T10 | 提交闸 | `peaks-race-code` + 含 `Co-Authored-By: Claude` 的 message | **必须拒**——§8.4 的核心 |
| T11 | 抽象 | 两个 SKILL.md 都指向共享规范文件，且**正文里无第二份** | 双向断言（§4.4） |

**⚠️ 原 T8 的设计已被评审否掉**：原 T8 把"驾驶者 = peaks-code"当作**输入值**注入。真实风险是**解析器返回了错的驾驶者**——注入驾驶者的测试**观察不到**这一点。故 T2/T8/T9 归**解析层**，必须驱动真实解析路径（或其注入替身）。

---

## 11. 非目标

- ❌ 不改 peaks-code 的 **行为**（§1 行为级不变量）。**允许**的只有 §4.4 的**保行为搬散文 + 加指向**——不是"一行不改"
- ❌ 不改 `HARD_BLOCKED_PATH_FAMILIES` 的内容
- ❌ 不新增独立 CLI 顶层动词（沿用 `peaks code-gate` / `peaks skill presence:set`）
- ❌ 不实现 `peaks-race-<domain>` 的其他成员（§2.1）
- ❌ 不为 race-code 建 job / slice / swarm 任何调度设施
- ❌ 不把 code-gate 做成安全边界（§9）
- ❌ **不改 memory 系统的格式**（正例/反例）—— 那是独立 slice，见 §12 U6
- ❌ 不实现 24h 模式（race-code 是短任务单窗口泳道，§2.4）
- ❌ **不抽"lane 框架"**（"可控严格度引擎"之类）——§4.4 的反向警告。只抽逐字重复的散文
- ❌ **不把 lane token 找回来**——它已被评审删除（§8.1），理由是它会把手滑者的最便宜路径从"停下"改成"改个标签"

---

## 12. 未决与风险

| # | 项 | 处理 |
|---|---|---|
| U1 | `peaks code-gate` 的 projectRoot 从哪来（cwd vs 新增 `--project` vs 改 hook entry） | **实现期第一件事**。hook entry 现行是 `peaks code-gate --json` |
| U2 | 越界的规模阈值（文件数 / 行数）具体取值 | 实现期用真实数据定；初值建议先宽后收 |
| U3 | ~~lane token 残留~~ | **已消解**——token 已删除（§8.1）。且原论证本身也是错的："崩溃后 session 即结束"把外层 harness session 与 peaks session 混为一谈；peaks session id 跨 `/compact` 与 `peaks-resume` **复用同一目录** |
| U4 | 会话身份解析本身的脆弱性（peaks CLI 子进程通常不继承 `CLAUDE_CODE_SESSION_ID`，故有 `.outer-session-cache.json`） | **本设计的最大工程风险**。fail-closed 把该脆弱性全部转化为 race-code 侧的误拦（自愈重试一次，摩擦有界） |
| U5 | ~~§3.2 对"每次都问"的解释~~ | **已裁决（B：每次问 + 预选默认），且行为随 pilot 状态切换**——见 §3.2。原稿"未指定才问"会让 race-code 在用户最常用的路径上**不可发现**，是评审 #2 那类错误的第二次出现 |
| U6 | **`.peaks/memory/` 条目加 正例/反例**（用户 2026-10-10 提出，明确选择"改全局格式"而非只补 race-code） | **独立 slice，不在本 spec 内。** 它是架构级：格式被所有产出者写（peaks-code / peaks-rd / peaks-qa / …），被 `memory-ingest-service` / `memory-rotate-service` / `memory-search-service` / `index.json` 读，且**存量条目已在盘上**（须回答迁移 vs 只对新增生效）。本 spec 只承诺 race-code 做该格式的消费者（§7.3） |
| U7 | ~~试点是否算完成定义的一部分~~ | **已裁决（B：两个门）**——见 §5.5.2。门 1（实现）关 S2；门 2（信任）关"能否默认提供"。**不采纳审计 successCriteria #6 的字面**（把 pilot 写进完成定义会让做完的 skill 无法关闭），但其**意图保留在门 2**，且判据改为 4 个可数量 |
| U8 | **§5.5.1 的基线若显示慢的主因不是 dispatch 成本** | 则 §4.3 那条被否决的替代方案（自动化 peaks-code 自身的质检工序）**反过来成为首选**，本设计应重估。这是本 spec 自身可被证伪的出口 |
| U9 | **本设计未经独立模型审计——已查实，且短期无法达成**| **事实（2026-10-10 实测）**：① 审计第一轮与设计**同模型**（`deepseek-flash[1M]`，经 `anthropic-messages-api` 绑定）。② `peaks reviewer status` 返回 `configured: false / no-reviewer-config`；根因是 `src/services/reviewer/reviewer-config.ts:77` 要求 `reviewer.providers.length >= 2`（"A4.1 explicitly requires >=2 providers…skipped cleanly"）——**该门拒绝假绿，而非产出假绿**。③ 本机只够得着一个模型族：`ollama` 未安装（PATH 无、`:11434` 无响应），`openai` 无凭据。④ **且 `peaks-reviewer` 时机也不对**：`peaks reviewer run --rid <rid>` 按 **rid 审 slice**、prompt 取自 `input.context`（≤8KB），定位是 v2.14.0 G4 anti-fake-green（"实现有没有真按 contract 做到"），**不是设计评审器**。 | **裁决（用户 2026-10-10）**：以 **fresh-context 子代理**代替，并**如实标注其性质**——换的是**上下文**（不带本对话的自我合理化），**不是模型族**（仍 `deepseek-flash`，共享同一批系统性盲点）。因此它**不构成独立审计的等价物**。真正的 `peaks-reviewer` 排到**实现之后**（那时才有 rid / contract / diff 可审）。要让独立模型审真正可用，需用户提供第二模型族凭据并写入 `~/.peaks/config.json` 的 `reviewer.providers` |
| U10 | **时序基线取不到——`metrics/slices.jsonl` 的埋点支撑不了**（§5.5.1） | 41 条 `dispatch` 事件全部无 `sliceRid`、42% 记录无归属、2/4 session 才有该文件。**归到独立小 slice**：给 `dispatch` 补 `sliceRid` + 给每个任务补起止标记。本 spec 不依赖它（N1 已改为结构性指标） |
| U11 | **驾驶者解析不可靠，且提交闸在同信号上 fail-open**（评审 #1 / #7，`hook-handle.ts:131-132`） | **本设计的硬前提，必须先独立修**：① 传 `callerId` 或与 `skill-presence-service.ts:198` 一致地按 `lastHeartbeat` 排序；② 决定提交闸在该信号上到底 fail-open 还是 fail-closed（今天与 §8.3 相反）。**不修，§8.2 整张表建在沙上**——且这是**今天就在提交闸里的既存 bug，与 race-code 无关** |
| U12 | **共享规范文件的落点**（§4.4 / §2.5） | 实现期定。候选：`.peaks/standards/`（RL-8 的 import 先例）或 skill-family 共享的 `references/`；**基**是既有的 `skills/peaks-code/references/fast-mode.md`。须满足 §4.4 的"一份规范 + 双指向 + 双向测试" |
| U13 | **`fast-mode.md` 与 CLI 帮助里的 `change-id` 已不存在**（§2.5 末段） | change-id 维度在 `2026-06-29-change-id-root-removal` 删除，handler 形参是 `sessionId`。**未裁决**：S1 顺手改 / 另立小 slice / 先不动。**不许默认忽略** |

---

## 13. 交付分解：**四个 slice**（rev2 审计裁决）

> rev2 的 `scope` 维度指出："范围过大且耦合：并行新 skill、拆除子代理/Gate/状态机、公共散文抽取、提交闸改造、驾驶者修复、指标迁移被混为一次交付，**建议拆分**。"用户 2026-10-10 裁决：**采纳，拆成四个**。
>
> **这也是本 spec 与 §1 的行为级不变量共同的答案**：S0 与 S1 各自独立有价值、可单独交付、可单独验证，**不该被快泳道的进度绑住**。

### S0 — 硬前提（**既存 bug，与 race-code 无关**）

- **内容**：`hook-handle.ts:131` 传 `callerId`（或与 `skill-presence-service.ts:198` 一致地按 `lastHeartbeat` 排序）；决定并实现**提交闸在身份不明时的失败方向**（今天 fail-open，§8.3 要求 fail-closed）。
- **类型**：bugfix（§12 U11）。**可独立发布**。
- **退出判据**：解析有测试且排序/作用域语义被钉住；失败方向有明确裁决 + 测试。
- **依赖**：无。**S2 依赖它。**

### S1 — 共享规范（**保行为重构**，2026-10-10 重定义）

- **内容**：以 `skills/peaks-code/references/fast-mode.md` 为**基**，把两样真正逐字共享的散文泛化为一份规范文件（§4.4）：
  1. **快泳道验收门** —— fast mode 已写着 `test pass + tsc pass + lint pass`；race-code §5 的 #1/#2 是同一件事；
  2. **"何时不该走快泳道"的风险面** —— 两条泳道都需要这个判据（§6.2）。
  peaks-code 的 fast-mode 路径指向它；race-code（S2）将来指向它。加**双向**测试（§4.4 / T11）。
- **类型**：refactor，**对 peaks-code 零行为变化**（§1 行为级不变量就是它的验收标准）。**注意**：这**不是**"抽取已有重复"——风险面清单目前在哪都不存在，是**新写**的；把它写成 peaks-code 的规范内容会**改变 peaks-code 的规范面**，这一点必须在 review 时显式接受，不能含糊。
- **退出判据**：T11 绿；peaks-code 既有测试全绿。
- **依赖**：无。**S2 的 SKILL.md 依赖它**（否则 race-code 会先复制一份）。
- **已知残余**：`fast-mode.md` 描述的参数名 `change-id` 已不存在（§12 U13）——S1 顺手改成 `sessionId` 还是另立，见 U13。

### S2 — 快泳道 MVP（**本 spec 的主体**）

- **内容**：`skills/peaks-race-code/SKILL.md`（含 loop-hygiene 块）+ `SKILL_NAMES`；`decideGateAction` 可选第三参（默认 fail-closed）+ `code-gate-command.ts` 解析；`.husky/commit-msg` 主层 + 拦截点次层（§8.4）；`peaks-audit` 的泳道路由（§3）；`.sh` 兄弟的处置（§10.1）。
- **退出判据（= §5.5.2 的「门 1」）**：T1–T10 绿；§10.1 的三个文件改完；`.sh` 差异有明确处置。**门 1 通过即可关闭 S2**——不因为"还没用够次数"而拖住。
- **依赖**：**S0 + S1**。

### S3 — 门 2：pilot + 指标埋点 + 阶段切换

- **内容**：
  1. **门 2（信任）** —— pilot 在真实任务上跑，按 §5.5.2 的四个可数量判定（任务数 / 回滚次数 / CI 红次数 / 漏报风险面次数）；
  2. **阶段切换** —— 门 2 通过后，把 §3.2 从"只能指名到达"切到"每次问 + 预选默认"，race-code 成为默认提供的选项；
  3. **时序埋点（可选）** —— 给 `dispatch` 事件补 `sliceRid`、给每个任务补起止标记（§5.5.1 末段）。**注意这不是门 1 或门 2 的前置**：N1 的指标按构造成立，不需要它。
- **退出判据**：门 2 的四个数达标；§3.2 的阶段切换已生效（或明确记录未通过、race-code 保持只能指名到达）。
- **依赖**：S2（没有可试用的东西就无从 pilot）。

### 每个 slice 内的顺序（仅 S2 用）

1. **U1** —— projectRoot 来源决定所有 gate 代码的形状。
2. `decideGateAction` 可选第三参 + 解析。**先写 T1/T3/T4/T5（纯函数层，TDD）**，再动实现。
3. 解析层 T2/T8/T9（需夹具）。
4. 提交闸：`.husky/commit-msg` + 次层 + T6/T7/T10。
5. SKILL.md 的工序正文（§4 / §5 / §6 / §7）。
6. **§3 的路由** —— 落在 `peaks-audit`。
7. `.sh` 兄弟的处置。

> **顺序原则**：**最危险的 gate 改动放最后**，且每一步都被红色测试约束。S2 **不碰** S0/S1 的地盘。
