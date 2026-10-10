# peaks-race-code — 快泳道设计

- **日期**：2026-10-10
- **状态**：设计已定（brainstorming 3 段 + 11 处用户裁决）
- **session / rid**：未绑定 —— 本 spec 先于 peaks 工作流产生，尚未进入 `peaks workspace init`。经用户 review 后由 implementation plan 建立绑定。
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

> **删掉 race-code 的一切，peaks-code 的行为与今天逐字节相同。**

精确化为三条，缺一不可：

1. **`HARD_BLOCKED_PATH_FAMILIES` 的内容不变**——仍是 `src/` `tests/unit/` `tests/integration/` `config/` `bin/` `scripts/` 六项（`src/services/hooks/pre-tool-code-gate.ts:32`）。变的只是"**谁在开车**"的判定，不是"哪些路径危险"。
2. **驾驶者 = `peaks-code`，或驾驶者身份无法解析 ⇒ deny 结果与今天一致**（含 stderr 标记与 `peaks sub-agent dispatch rd` next action）。
3. **race-code 是唯一新增的放行来源**。任何 race-code 专属代码（lane token 的读写、skill 判定分支）被删除 ⇒ 系统回到今天的全部行为。

**推论**：peaks-code 的 SKILL.md、其 references、其 Gate A–G、其 11 步工序，本设计**一行不改**。race-code 是一个**新增的兄弟**，不是对 peaks-code 的修改。

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

### 2.4 与现有 mode 轴的关系

race-code **复用**现有 mode 轴：`full-auto | assisted | strict | 24h`（`SkillPresenceMode`）照旧管"要不要停下来问你"。两条轴正交：

- **range 轴（新）**：谁实现 —— peaks-code 或 peaks-race-code，由 skill 身份决定。
- **mode 轴（既有）**：问不问 —— `full-auto | assisted | strict`。

**24h 与 race-code 不相容**：24h 是为"长时无人值守的多 slice 长跑"设计的，而 race-code 的定义就是短任务、单窗口。race-code **不实现 24h**（§11）。

---

## 3. 入口路由

用户裁决：**每次都问**，且"过程中 LLM 提建议，不强制"。

### 3.1 路由的所在地：分诊层

选泳道**不是** peaks-code 自己决定"我要不要下沉"，而是**入口先给判断 + 弹一次 `AskUserQuestion`，由用户选**，再进对应 leaf。这落在分诊层（`peaks-solo` 的 dispatcher 语义），与"用户只说话或选择"的既有定位同构——**选泳道是用户的权利，不是 LLM 的**。

### 3.2 "每次都问"的精确含义

本 spec 把"每次都问"解释为：**泳道尚未被明确指定时问**。三种情形不重复问：

1. 用户直接指定了 skill（`/peaks-race-code` 或 `/peaks-code`）——**那本身就是答案**；
2. 同一个 request 上用户已答过一次泳道问题（答案已持久化在 `.peaks/_runtime/<sessionId>/`）；
3. 泳道已在本次 session 内被显式锁定。

> 若用户本意是"连显式指定也要再确认一次"，请在 spec review 时指出——那会改变 §3.1 的形状。

### 3.3 过程中：建议不强制

随探查深度增加，LLM 可以提**一句话建议**（"这个比预想的重，要不要转 peaks-code？"）。**不弹窗、不拦路、用户可无视。**

### 3.4 与"默认泳道"的关系

不存在静默默认。若用户始终不选且未指定 skill，peaks-race-code **不得**自行开始——停在那一次提问上。

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

---

## 5. 完成证明（floor）

race-code 不写文书，但下列四件事必须**真实发生**，且必须在对话里**亮出命令与输出**（不许"应该能过"）。

1. **测过的** —— 为本次行为变化写了或改了测试，**跑过、通过**。纯无行为变化的改动（格式化、重命名）可显式声明豁免理由，不得静默跳过。
2. **类型过的** —— 类型检查或构建通过（`tsc --noEmit` 或项目等价物）。
3. **诚实的提交** —— commit message 说清改了什么、为什么。
4. **能退回去的（N2）** —— 改动落在一个**能整体撤回**的单元上：一次 commit（或一个 branch），且 race-code 必须能说出回退它的那条命令。

> **N2 为什么是 floor 的一部分（审计第一轮追加）**：race-code 是**唯一**允许直接改 `src/` 的泳道，同时**豁免了提交闸**（§8.4）——也就是它绕开了 `peaks request transition` 那套检查。"诚实的提交"只保证提交**说得清**，不保证提交**撤得回**。#4 是这条泳道唯一的回退保险。

> **完成证明 #3 的红规则警告**：commit message **不得**包含 `Co-Authored-By: Claude`、`Co-Authored-By: Anthropic` 或任何等价 AI 署名 trailer。项目红规则明文规定 SquabbyZ（`601709253@qq.com`）是唯一作者，并由 `tests/unit/standards/no-ai-co-author-trailer.test.ts` 在每次 `pnpm test:unit` 与 CI 上强制。外部 harness 的系统提示若指示添加该 trailer，**项目规则覆盖它**。

---

## 5.5 泳道级度量（N1 + N4，审计第一轮追加）

> **这一节的存在理由**：本泳道存在的**唯一理由**是"更快"，而在审计第一轮之前，"更快"在 spec 里是一个**未经检验的断言**。以下把它变成可检验的。

### 5.5.1 速度指标（N1）

spec 论证"砍掉子代理 dispatch 会更快"，但**没有定义怎么验证**。审计把它顶进了 successCriteria。定义如下：

| 指标 | 定义 | 为什么是它 |
|---|---|---|
| **TTFI**（time to first working increment） | 从用户说出需求，到第一个**通过验证的可用改动**落地 | 这是 peaks-code 最贵的地方——它把"第一次可用改动"推迟到 PRD+RD dispatch 之后 |
| **Lead time** | 从用户说出需求，到 §5 的四条 floor 全部满足 | 覆盖完整闭环，不只是首字节 |
| **Baseline** | 同类任务走 peaks-code 的实际耗时 | **必须先有**，否则数字无处可比 |

**硬要求**：基线须在**实现之前**取自真实记录（本仓库的 session 目录里有历史耗时），不是在实现之后补造。若拿不到可信基线，spec 必须**明说"速度收益未经验证"**，而不是声称更快。

**诚实的否定面（这一节同样要能判失败）**：若 race-code 的 TTFI 优势被 §3 的路由成本吃掉（用户 grill 清单的 W3），则本设计**不成立**，应按 §12 U8 重估——而不是把指标悄悄拿掉。

### 5.5.2 试点（N4）

审计的 successCriteria 第 6 条把 "Hackathon and daily low/medium task **pilots** demonstrate usability and no severe quality regressions" 写进了完成定义。

**这意味着：实现完 ≠ 完成。** 实现之后还需要真实使用一段时间（黑客松 / 日常中等以下任务）才满足 goal。用户是否接受这个更长的完成定义，见 §12 U7——**未裁决前不得把"实现完成"当作 goal 达成**。

---

## 6. 越界与升级

### 6.1 两层判定，方向不对称

| 层 | 时机 | 机制 | 性质 |
|---|---|---|---|
| 第一层 | 改之前 | LLM 读需求 + 项目扫描，给初始判断 | 便宜，会错 |
| 第二层 | 改完之后（有 diff） | `peaks complexity-estimate --files <...>` + 风险面扫描 | 便宜，可靠，**只能往更严的方向翻** |

**第一层必须是 LLM 判断，这不是偷懒，是事实**：`peaks classify run` 分的是**当前 diff**（`git diff HEAD`），`peaks complexity-estimate` 吃的是**一组文件**——**两者都无法在"还不知道要改什么"之前给需求定级**。spec 不假装存在这样的现成原语。

### 6.2 风险面（越界的机械定义）

任一命中即视为越界：

- authn / authz / 凭据 / secrets 的处理路径
- 数据库 schema 或迁移
- 公开 API 面（导出签名变化）
- 并发 / 事务语义
- 依赖升级且带 API 变化
- 改动规模超过阈值（文件数 / 行数——**阈值待定，见 §12**）
- 无法用"跑一遍测试就相信它对了"来证明的行为

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

### 8.1 lane token（显式，唯一权威）

race-code 在入口写 `.peaks/_runtime/<sessionId>/race/lane.json`：

```json
{ "lane": "race", "sessionId": "<sessionId>", "startedAt": "<ISO8601>" }
```

- 写：race-code 入口。
- 删：race-code 收尾（成功或失败都要删）。
- **生命周期 = session**。残留风险见 §12。

### 8.2 skill 感知

`src/cli/commands/code-gate-command.ts` 在调用纯函数 `decideGateAction`（`:81`）之前，解析当前 session，读 §8.1 的 token。判定表：

| token（§8.1） | 解析出的驾驶者 | 结果 |
|---|---|---|
| 存在，且 `sessionId` 匹配 | `peaks-race-code` | **allow**（硬阻断家族放行） |
| 存在，但驾驶者已是 `peaks-code` | `peaks-code` | **deny** —— token 是**陈旧的**（切换泳道后未清），不得继承放行 |
| 不存在 | `peaks-code` | **deny**（与今天逐字节一致，`:99` + `:117`） |
| 不存在 | 解析失败 / 其他 | **deny**（fail-closed，见 §8.3） |

**放行是三个条件的合取**：token 存在 **且** `token.sessionId === 解析出的当前 session` **且** 驾驶者 === `peaks-race-code`。三者缺一即 deny。

> 只查 token 不查驾驶者会让 token 退化成装饰品（任何陈旧 token 都能开门）；只查驾驶者不查 token 则"显式 token"这个用户裁决落空。合取同时满足两者，并让 §10.2 的 T5/T8 有真实的对照可写。

**白名单路径族**（`.peaks/` `skills/` `docs/` `.md` 等，`pre-tool-code-gate.ts:42`）不受影响，仍先短路放行。

**实现注意**：`peaks code-gate` 目前只有 `--dry-run` 一个选项（`:46`），**没有 `--project`**。hook entry 是 `peaks code-gate --json`。因此 projectRoot 的来源（cwd 还是新增 `--project`）是**实现期必须确定的第一件事**，见 §12。

### 8.3 失败方向：fail-closed（用户裁决）

**认不出"谁在开车"就拦。**

明确后果：装了 gate 的仓库，`src/**` 默认仍然改不了；只有正读到 race lane token 才放行。这与 gate 在别处的 fail-open 取向（payload 畸形 / 无 file_path / 内部错误）**方向相反**，是**有意为之**——见 §9。

race-code 侧的自愈：被误拦时，race-code 视为"身份未解析"，重新断言 token 后**重试一次**。摩擦有界。

### 8.4 提交闸豁免（用户裁决）

`src/services/audit/enforcers/code-ban.ts:31`：

```ts
export function isCodeCommit(skill: string, command: string): boolean {
  if (!skill.startsWith('peaks-')) return false;   // ← 今天 peaks-race-code 会落到这里被拦
  return COMMIT_APPLY_PATTERN.test(command);
}
```

改为：`peaks-race-code` 豁免。

**理由**：race-code 是唯一允许实现的泳道，提交是它的完成证明 #3。它绕过 `peaks request transition`（即 `spec-locked` + tech-doc-presence 检查）——**那正是 race-code 有意砍掉的东西**，两者一致，不是漏洞。

---

## 9. 信任模型（必须明说）

> **code-gate 是纪律门，不是安全边界。**

- 它今天已经在**三处** fail-open（payload 畸形、无 `file_path`、内部错误），其设计文档自述 "the LLM is never bricked by a peaks bug"。
- 它挡的是**手滑与惯性**（"这改动很小，我直接改吧"），不是**攻击者**。任何能把 lane token 写进 session 目录的进程都能开这道门——本设计**不试图**阻止这一点，也不假装阻止了。
- §8.3 的 fail-closed 是**在这个维度上收窄**，不是把纪律门升级成安全边界。写清楚，是为了让后来者不要基于错误假设去加固它。

---

## 10. 测试与不变量

### 10.1 必须改动的现有测试 / 常量

| 文件 | 为什么 |
|---|---|
| `src/services/skills/skill-conformance-service.ts:46`（`SKILL_NAMES`，硬编码 13 个） | 加 `peaks-race-code`；否则 conformance 审计看不见它 |
| `tests/unit/services/hooks/code-gate.test.ts` | 纯函数加 skill/token 维度。**原 6 个 hard-blocked family + 6 个白名单 + stderr 标记 + next action 的断言必须原样保留**，只加新维度 |
| 新增 `skills/peaks-race-code/SKILL.md` | 必须携带逐字节相同的 loop-hygiene 块 |

**不需要改**：`tests/unit/skills/loop-hygiene-block.test.ts`——它遍历文件系统，新 SKILL.md 漏了那块自己会红（这正是想要的）。`tests/integration/code-gate-step-08-hook.test.ts` 管的是 Bash 闸，与本次无关。

### 10.2 新增不变量测试

仿照本仓库 `no-ai-co-author-trailer.test.ts` 的做法——**带一个自包含的注入对照，使它不可能"因为永远不会失败而通过"**：

| # | 场景 | 断言 |
|---|---|---|
| T1 | 驾驶者 = `peaks-code`，目标 `src/x.ts` | **必须 deny**（防"skill 感知把老行为弄丢了"） |
| T2 | 无 token，身份解析失败，目标 `src/x.ts` | **必须 deny**（防 fail-closed 被改回 fail-open） |
| T3 | token 存在 + session 匹配 + 驾驶者 = `peaks-race-code`，目标 `src/x.ts` | **必须 allow** |
| T4 | token 存在，目标 `docs/x.md`（白名单族） | **必须 allow**（防白名单短路被破坏） |
| T5 | **注入对照**：人为把 T1 的期望翻成 allow | 测试套件**必须变红**——证明 T1 不是"永远通过"的空断言 |
| T6 | `peaks-race-code` 执行 `git commit` | **不**被 code-commit-ban 拦截 |
| T7 | `peaks-code` 执行 `git commit` | **仍**被拦截（防豁免写宽了） |
| T8 | token 存在但**驾驶者 = `peaks-code`**（泳道切换后 token 未清），目标 `src/x.ts` | **必须 deny**——防"陈旧 token 继承放行" |
| T9 | 无 token 但驾驶者 = `peaks-race-code`，目标 `src/x.ts` | **必须 deny**——防"只查驾驶者、token 沦为装饰" |

---

## 11. 非目标

- ❌ 不改 peaks-code 的 SKILL.md、references、Gate A–G、11 步工序（§1 不变量）
- ❌ 不改 `HARD_BLOCKED_PATH_FAMILIES` 的内容
- ❌ 不新增独立 CLI 顶层动词（沿用 `peaks code-gate` / `peaks skill presence:set`）
- ❌ 不实现 `peaks-race-<domain>` 的其他成员（§2.1）
- ❌ 不为 race-code 建 job / slice / swarm 任何调度设施
- ❌ 不把 code-gate 做成安全边界（§9）
- ❌ **不改 memory 系统的格式**（正例/反例）—— 那是独立 slice，见 §12 U6
- ❌ 不实现 24h 模式（race-code 是短任务单窗口泳道，§2.4）

---

## 12. 未决与风险

| # | 项 | 处理 |
|---|---|---|
| U1 | `peaks code-gate` 的 projectRoot 从哪来（cwd vs 新增 `--project` vs 改 hook entry） | **实现期第一件事**。hook entry 现行是 `peaks code-gate --json` |
| U2 | 越界的规模阈值（文件数 / 行数）具体取值 | 实现期用真实数据定；初值建议先宽后收 |
| U3 | lane token 残留：race-code 崩溃未删 token ⇒ 该 session 后续仍被放行 | 接受。token 生命周期 = session，崩溃后 session 即结束；resume 场景下"仍放行"语义上仍正确 |
| U4 | 会话身份解析本身的脆弱性（peaks CLI 子进程通常不继承 `CLAUDE_CODE_SESSION_ID`，故有 `.outer-session-cache.json`） | **本设计的最大工程风险**。fail-closed 把该脆弱性全部转化为 race-code 侧的误拦（自愈重试一次，摩擦有界） |
| U5 | §3.2 对"每次都问"的解释 | 待用户在 spec review 时确认 |
| U6 | **`.peaks/memory/` 条目加 正例/反例**（用户 2026-10-10 提出，明确选择"改全局格式"而非只补 race-code） | **独立 slice，不在本 spec 内。** 它是架构级：格式被所有产出者写（peaks-code / peaks-rd / peaks-qa / …），被 `memory-ingest-service` / `memory-rotate-service` / `memory-search-service` / `index.json` 读，且**存量条目已在盘上**（须回答迁移 vs 只对新增生效）。本 spec 只承诺 race-code 做该格式的消费者（§7.3） |
| U7 | **试点是否算完成定义的一部分**（N4）。审计 successCriteria 第 6 条要求 pilots 证明可用性 | **未裁决。** 接受 ⇒ "实现完成"不等于 goal 达成，还需真实使用一段时间；不接受 ⇒ 须**显式否决**该条（不许默认忽略） |
| U8 | **§5.5.1 的基线若显示慢的主因不是 dispatch 成本** | 则 §4.3 那条被否决的替代方案（自动化 peaks-code 自身的质检工序）**反过来成为首选**，本设计应重估。这是本 spec 自身可被证伪的出口 |
| U9 | **本设计未经独立模型审计——已查实，且短期无法达成** | **事实（2026-10-10 实测）**：① 审计第一轮与设计**同模型**（`deepseek-flash[1M]`，经 `anthropic-messages-api` 绑定）。② `peaks reviewer status` 返回 `configured: false / no-reviewer-config`；根因是 `src/services/reviewer/reviewer-config.ts:77` 要求 `reviewer.providers.length >= 2`（"A4.1 explicitly requires >=2 providers…skipped cleanly"）——**该门拒绝假绿，而非产出假绿**。③ 本机只够得着一个模型族：`ollama` 未安装（PATH 无、`:11434` 无响应），`openai` 无凭据。④ **且 `peaks-reviewer` 时机也不对**：`peaks reviewer run --rid <rid>` 按 **rid 审 slice**、prompt 取自 `input.context`（≤8KB），定位是 v2.14.0 G4 anti-fake-green（"实现有没有真按 contract 做到"），**不是设计评审器**。 | **裁决（用户 2026-10-10）**：以 **fresh-context 子代理**代替，并**如实标注其性质**——换的是**上下文**（不带本对话的自我合理化），**不是模型族**（仍 `deepseek-flash`，共享同一批系统性盲点）。因此它**不构成独立审计的等价物**。真正的 `peaks-reviewer` 排到**实现之后**（那时才有 rid / contract / diff 可审）。要让独立模型审真正可用，需用户提供第二模型族凭据并写入 `~/.peaks/config.json` 的 `reviewer.providers` |

---

## 13. 实现顺序（粗）

1. **先定 U1**（projectRoot 来源）——它决定后面所有 gate 代码的形状。
2. `skills/peaks-race-code/SKILL.md`（含 loop-hygiene 块）+ 加入 `SKILL_NAMES`。先让 T-10.1 的自动红变绿。
3. lane token 的读写（入口写、收尾删）。
4. `decideGateAction` 加 skill/token 维度 + `code-gate-command.ts` 解析。**先写 T1/T2/T4/T5**（TDD），再动实现。
5. `isCodeCommit` 豁免 + T6/T7。
6. SKILL.md 的工序正文（§4 / §5 / §6 / §7）。
7. 分诊层路由（§3）。

> 该顺序刻意让**最危险的改动（gate）晚于最便宜的改动（SKILL.md）**，且让 gate 的改动全程被红色测试约束。
