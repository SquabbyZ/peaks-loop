---
name: user-decision-2026-07-08-revive-peaks-solo-as-dispatcher
description: 2026-07-08 user 商讨后决定——在 4.x-beta 周期内把 peaks-solo 作为 dispatcher(分诊员)从 0 重建,不替代 peaks-code(leaf),不影响 3.x→4.x 升级路径;同步新增 `peaks skill search` CLI 解决 dispatcher 的"分诊判断源"硬依赖
metadata:
  type: feedback
  createdAt: 2026-07-08
  source: 商讨 session 2026-07-08-session-fd90c4
  status: candidate
---
<!-- peaks-feedback-promoted: layer=A -->

# User decision 2026-07-08: revive peaks-solo as dispatcher

> **Why:** 这次商讨直接挑明了 4 个产品定位裂缝:(1) "24h AI 程序员" 单体叙事 vs. 多领域蜂群现实;(2) 用户在 code 域之外的需求(信息查询 / 内容 / 健康 / issue sweep)目前没有统一入口;(3) `peaks skill search` CLI 缺失导致 dispatcher 概念没有"分诊判断源";(4) Human-NL-Choice-Only 红线要求用户只面对 1 个前门,而现状下用户必须自己挑 `/peaks-code` / `/peaks-content` / `/peaks-doctor` / `/peaks-issue-fix-orchestrator`。**peaks-solo 复活 = dispatcher 是 4 个裂缝的同一解**。

## 三件事一次说清

### 1. peaks-solo 复活 = dispatcher(分诊员),**不是** orchestrator(蜂群编排器),**不是** rename peaks-code

- **dispatcher 角色**:看用户自然语言 → 看现有 peaks-* skill 池子 → 有合适就透明转交,没有就自规划 + 检索外部工具(例:`deep-search` / `WebSearch` / `Bash` / `Edit` markdown)→ 执行 → **回头问"要不要沉淀"**
- **不是 orchestrator** —— 这一点跟 `peaks-solo-is-an-orchestrator-not-an-implementer-even-for-pure-doc-changes` 那条历史 memory 故意区分:那次"orchestrator"指 peaks-code,**peaks-solo 这次新定位比 orchestrator 更薄一层**(只分诊,蜂群在 leaf)
- **不是 rename** —— peaks-code 完整保留,4.0.0-beta.4 不动一个字,107 文件全仓库替换的事 0 发生

### 2. 4.x-beta 周期内装(不是 5.0)

- 现状:HEAD `0d8ea2d`,4.0.0-beta.4 在 main,working tree 干净
- 影响:[CHANGELOG 措辞待定 / placeholder] 一条,大意 `+ peaks-solo: dispatcher (分诊员);+ peaks skill search: 技能池检索`,不写 breaking change;具体措辞在 RD 阶段 user freeze
- 兼容性:3.x 用户继续 `/peaks-code`,4.x 用户继续 `/peaks-code`,**两条入口共存**,peaks-solo 是新加的第三条,**老入口 0 改动**
- 上线节奏:作为 4.0.0-beta.5 的 feature 单独一个 minor,不再 4.0.0 锁死

### 3. `peaks skill search` CLI 必须新建(不能用 peaks skill list 等兜底)

- 现状:经实跑 `peaks skill --help` + `peaks skill search --query "test"`,**`peaks skill search` 不存在**;现有 4 条相关子命令是 `list / runbook / lint / doctor`,**没有"按 query 检索 skill 池"的能力**
- 兜底拒绝理由:dispatcher 的"分诊判断源"必须是**结构化查询**(匹配 description / triggers / 分类标签),不是"全列然后 LLM 自己 grep"。前者是 O(n) 检索 + 结构化返回,后者是 O(n) 渲染全文本 + LLM token 消耗,**前者精确 / 后者浪费**,dispatcher 必须用前者
- 新 CLI 草图:`peaks skill search [--query <nl>] [--tag <t>] [--domain <code|content|doctor|research|...>]` —— 返回结构化数组 `{name, description, triggers, matchScore}`

## 沉淀时机:问题 1 选 B(LLM 识别 + 用户主动要求)

| 触发条件 | 谁发起 | 行为 |
|---|---|---|
| peaks-solo 自己跑完(自规划兜底路径) | LLM | 跑完**默认**问"要不要沉淀",见下 §"沉淀提议" |
| peaks-solo 转交 leaf 跑完 | leaf 自己 | **不重复问** —— leaf 内部已有自己的 sediment 流(peaks-code Step 11) |
| 用户主动说"沉淀这个" / "复用这个" / "记下来" | user | 立即走 `user_explicit` trigger 路径 |
| LLM 识别出 ≥ 2 个 reuse signals + named scenario | LLM | 走 `llm_suggested` trigger 路径,必须附 4-section brief |

**沉淀提议的 AskUserQuestion 模板**:
- (a) 沉淀为普通 lesson / convention → `peaks memory extract --apply`
- (b) 沉淀为 Loop Engineering 资产 → `peaks asset crystallize`
- (c) 改 scope 再沉淀
- (d) 不沉淀(单次性,丢弃)

**默认选项 = (a) + (b) 合并引导**:不直接默认 (d),LLM 必须给出一个正向推荐 + 一段 NL 解释为什么(对应 `llm_suggested` trigger 的 evidence brief)。

## peaks-solo 注册方式:问题 2 选 A(装进 Skill tool 的 skill 池)

- 装成独立 skill:`skills/peaks-solo/SKILL.md` 注册,description 写 dispatcher 角色 + triggers
- triggers 写"用户自然语言描述诉求 / 找不到合适 peaks-* skill 时 / 用户说'帮我处理这个'"等
- description 必须**显式写 NOT**: NOT for code-specific work(用 /peaks-code) / NOT for content-specific work(用 /peaks-content) / NOT for health check(用 /peaks-doctor)
- 这条 description 设计跟 2026-07-05 那次"eradicate"故意相反 —— 那次说"peaks-solo 不该存在因为它跟 peaks-code 重复",这次说"peaks-solo 该存在因为它跟所有 peaks-* leaf **互补不重复**"

## 跟历史决策的关系

- **2026-07-05 eradicate peaks-solo** 那条 memory **本条不撤销**(那次是针对"code-only 定位下 peaks-solo 跟 peaks-code 语义重复"的根除,本条是针对"4.x 多 leaf 现实下 peaks-solo 作为 dispatcher 有独立价值"的复活)
- **2026-07-05 六条硬约束**(1 次到位 / 2 不计成本 / 3 不计时间 / 4 禁止假绿 / 5 禁止偷懒 / 6 存量迁移 LLM 做) **本条全部继承**,新加第七条:**7. 7 天内不得 rename peaks-* 任何 skill 名**(包括 peaks-solo / peaks-code / peaks-content 等),真要再改必须先开 decider session + 列出 ≥ 3 条新证据 + 同步对所有 peaks-* 引用做 grep 影响面扫描**(理由:rename 永远是高成本动作,不应按 skill 维度分别处理;7 天 cover 一周迭代周期,避免被覆盖 peaks-solo 那条"2 天内改名 2 次"历史反 pattern;3 条新证据防止"复制上次理由就过")**

## 跟现有红线的关系

- **Human-NL-Choice-Only(2026-07-04)**:peaks-solo 内部所有用户决策点(模式选择 / 沉淀提议 / 兜底方案)走 `AskUserQuestion`,**不引入新的自由文本输入**。本条 100% 兼容。
- **Two-Forms-Only(2026-07-04)**:peaks-solo 是新加的入口,**用户面对的前门从 peaks-code 单一变 peaks-solo 单一**;peaks-code / peaks-content / peaks-doctor 等作为可选直达通道保留(老用户 / 老 workflow 不破坏)。本条 100% 兼容。
- **RL-8 peaks-code domain boundary**:**保留**,peaks-solo 不动 peaks-code 一行 code,不把 peaks-code 任何内部 step 抽到 peaks-solo。两条 skill 平行存在,**不存在"peaks-solo 包 peaks-code"**这种结构。

## 影响面:待办建议(非承诺,待 user 二次确认)

> **本段是商讨过程中 LLM 提的下一步建议清单,不是 user 承诺的执行计划。** 任何一条要落地,需 user 二次确认(d1 备忘原则 = "先开备忘,再考虑 spec",本段属于"再考虑" 阶段)。

### 建议(4.x-beta 周期内,如 user 同意)
1. 起 spec `docs/superpowers/specs/2026-07-08-peaks-solo-dispatcher-design.md`(本次商讨结论是 spec 的 §0 / §10 锚)
2. 起 RD plan:实现 `peaks-solo` skill(SKILL.md + 必要的 references/) + 实现 `peaks skill search` CLI(query / tag / domain 三种匹配 + 结构化返回)
3. 走 RD → QA → verdict → TXT → memory sediment
4. CHANGELOG 一条,4.0.0-beta.5 单独发
5. 跑 1 次 dogfood:用户原话"获取 GitHub top 10" 这条用例,作为 acceptance 证据(必须 evidence 包含 "skill search 返回空 / 兜底走 deep-search / 跑完问沉淀")

### 偏好(非硬约束):避免
- 不动 peaks-code 一行 code
- 不把 peaks-code 任何内部 step 抽到 peaks-solo
- 避免在 peaks-solo SKILL.md 写"通用 orchestrator"这种模糊话(不推荐,但不一定错)
- 不把 `peaks skill list` 当成 `peaks skill search` 的替代品
- 不在 4.0.0 锁版本号时塞这个(必须 4.0.0-beta.5 或更高)

## 沉淀为本条(本条本身就是 .peaks/memory 文件,符合 peaks-code Step 11 sediment 流)

- 本条走 `type: feedback` 命名空间(因为是 user 决策 / 硬约束,不是项目事实),**不**走 `peaks asset crystallize` 进 loop_release / bee_release(那是 Loop Engineering 资产域,本条是 dispatcher 实施域)
- 是否未来要 `crystallize` peaks-solo 本身为 Loop Engineering 资产?**M4 ratchet 之后再说** —— 这次商讨的产物**不**自动升级为 loop engineering 资产

## 相关

- [[peaks-solo-to-peaks-code-rename-session-directive]] — 2026-07-05 改名时锁的 6 条硬约束
- [[user-decision-2026-07-05-eradicate-peaks-solo]] — 2026-07-05 eradicate 决策(本条的部分反向,但不撤销)
- [[peaks-solo-is-an-orchestrator-not-an-implementer-even-for-pure-doc-changes]] — 旧定位的"orchestrator"语义,本条故意跟它区分
- [[peaks-loop-24h-ai-programmer-positioning]] — 旧"24h AI 程序员"定位(单体程序员叙事),本条隐含挑战该定位但**不**自动覆盖
- [[peaks-loop-positioning-loop-engineering]] — 新"Loop Engineering crystallization"定位(2026-07-08 同日,本条与之方向一致)
- [[human-nl-choice-only-tenet]] — Human-NL-Choice-Only 红线,本条 100% 兼容
- [[two-forms-only-rule]] — Two-Forms-Only 红线,本条 100% 兼容
