# Peaks-Solo as Dispatcher (分诊员) — 4.x-beta 周期增量设计

**Status:** Draft (post-discussion, pre-RD; 0.5 版骨架,待 user review + 续写 §4 AC / §5 实施步骤 / §6 风险 / §7 OpenSpec change-id)
**Date:** 2026-07-08
**Author:** SquabbyZ (via peaks-code 商讨 session 2026-07-08-session-fd90c4)
**Affects:** `skills/peaks-solo/` (新),`peaks skill search` (新 CLI),`skills/peaks-code/` (不动),`peaks-code` 现有 SKILL.md (待 review,可能加 "如不想自己选 / 用 /peaks-solo" 一句),`peaks content / doctor / issue-fix-orchestrator / sop` (不动,但 description 可能微调以区分职责),`.claude-plugin/marketplace.json` (新增条目),`CHANGELOG.md` (1 条),`tests/` (新 dispatcher test)
**Target version:** 4.0.0-beta.5(独立 minor,不并入 4.0.0 锁版本)
**Supersedes / relates:** 2026-07-08 商讨备忘 `user-decision-2026-07-08-revive-peaks-solo-as-dispatcher.md`(本 spec 的 §0 / §10 锚)

---

## 0. 硬约束(Hard Constraints — 2026-07-05 user directive + 2026-07-08 商讨追加)

本 spec 适用以下不可违反的约束(由 user 在 2026-07-05 + 2026-07-08 两次商讨中分别钉死):

### 0.1 来自 2026-07-05 6 条硬约束(全部继承,见 `peaks-solo-to-peaks-code-rename-session-directive`)

- **HC-1 一次到位:** 不分批、不灰度、不留半步状态。`peaks-solo` skill + `peaks skill search` CLI 必须在同一 release 同步上;不先发 skill 后发 CLI,也不先发 CLI 后发 skill。
- **HC-2 不计成本:** 不为减少工作量妥协任何决策。例如:不为省事把 `peaks skill search` 退化成 `peaks skill list | grep`、不为省事让 peaks-solo 复用 peaks-code 的 Step 0 anchor 状态(两条 skill 独立 anchor)、不为省事省掉 description 里的 NOT clause。
- **HC-3 不计时间:** 可以拆多个 sub-task 派给多个 sub-agent 并行;每个 sub-agent 完成前不进入下一个 sub-task。本 spec 至少 2 个 sub-task 独立(见 §5 占位)。
- **HC-4 禁止假绿:** 任何 sub-agent 自报"完成"必须附证据(实跑命令输出、vitest 实际 pass 数、rg 实际输出)。LLM 不允许"应该是绿了" / "理论上通过"。
- **HC-5 禁止偷懒:** 不允许为了"完成数量"跳过任何位置,除非本 spec §2.2 明示不动。
- **HC-6 全量回归:** 本次改动后必须跑 `pnpm vitest run`(全量)+ `peaks skill list`(确认 peaks-solo 出现)+ 1 次 dogfood(§5 占位),任何失败阻塞 release。

### 0.2 来自 2026-07-08 商讨追加的硬约束(本 spec 新增)

- **HC-7 7 天 rename 红线:** 7 天内不得 rename peaks-* 任何 skill 名(包括 peaks-solo / peaks-code / peaks-content 等)。真要再改必须先开 decider session + 列出 ≥ 3 条新证据 + 同步对所有 peaks-* 引用做 grep 影响面扫描。理由:rename 永远是高成本动作,不应按 skill 维度分别处理;7 天 cover 一周迭代周期,避免被覆盖 peaks-solo 那条"2 天内改名 2 次"历史反 pattern;3 条新证据防止"复制上次理由就过"。
- **HC-8 peaks-code 0 改动:** 本次 spec 不允许修改 `skills/peaks-code/`、`bin/peaks.js` 里 peaks-code 相关 surface、`peaks-code` 任何 step 内部行为。可以改的:peaks-code 的 `SKILL.md` 第 1 段 description 末尾**加一句**"如不想自己选 / 用 /peaks-solo"(≤ 20 字,可选,等 §3 决定)。**不可**把 peaks-code 任何 step 抽到 peaks-solo。
- **HC-9 Human-NL-Choice-Only / Two-Forms-Only 兼容:** peaks-solo 内部所有用户决策点(模式选择 / 沉淀提议 / 兜底方案)走 `AskUserQuestion`,**不引入新的自由文本输入**。`peaks-solo` 是新加的入口,用户面对的前门从 peaks-code 单一变 peaks-solo 单一(同时老入口保留,见 HC-10)。
- **HC-10 老入口保留:** 3.x / 4.x 用户继续 `/peaks-code` / `/peaks-content` / `/peaks-doctor` 等,**不破坏**。peaks-solo 是新加的第三条入口,不是替代,老入口 0 改动。
- **HC-11 dispatcher 比 orchestrator 薄:** peaks-solo 是 **dispatcher(分诊员)**,**不**是 orchestrator(蜂群编排器)。dispatcher 跟 orchestrator 的差别(本 spec 显式定义,后续 spec 引用):
  - dispatcher:看自然语言 → 查 skill 池 → 转交 / 自规划 → 回头问沉淀。**不持有 implementation surface**。
  - orchestrator(peaks-code 这种):看自然语言 → 走 11 步 runbook → 直接调 prd/rd/qa/ui/sc/txt 蜂群 → 沉淀。**持有 implementation surface**(通过子蜂群间接持有)。
  - 因此:peaks-solo 不能写代码、不能写 PRD、不能跑 vitest、不能改 Loop Engineering 资产(那是用户主权)。能做的:看用户语言、查 skill 池、转交 leaf、跑通用工具(deep-search / WebSearch / Bash / Edit markdown)、提议沉淀。

### 0.3 反向设计(本 spec 与已有定位的关系)

- **不撤销** 2026-07-05 `user-decision-2026-07-05-eradicate-peaks-solo` 那次决定 —— 那次是针对"code-only 定位下 peaks-solo 跟 peaks-code 语义重复"的根除。本 spec 是针对"4.x 多 leaf 现实下 peaks-solo 作为 dispatcher 有独立价值"的复活。两者**不冲突**,理由不同。
- **不覆盖** `peaks-loop-24h-ai-programmer-positioning.md`(2026-06-28 旧定位)—— 本 spec 隐含挑战该定位(因为 dispatcher 概念扩展了"24h AI 程序员"单体叙事),但**不主动覆盖**。待未来 B 文件(`peaks-loop-positioning-loop-engineering.md`)的下一个版本决定。
- **不替换** `peaks-code` 任何功能 —— peaks-solo 是新加 dispatcher 角色,peaks-code 仍是 code-domain leaf 之一,两条 skill 平行存在。

---

## 1. 动机(Motivation)

### 1.1 长痛 vs 短痛(2026-07-08 商讨结论)

**短痛(本次承受):**
- 新增 `skills/peaks-solo/SKILL.md` + 必要的 `references/`(初期 2-3 个)
- 新增 `peaks skill search` CLI(query / tag / domain 三种匹配)
- 在 `peaks-solo` SKILL.md 写 dispatcher 角色的 description + triggers
- 1 次 dogfood:用户原话"获取 GitHub top 10"用例,作为 acceptance 证据
- 1 条 CHANGELOG(措辞待 user freeze,见 §5)
- 1 次 vitest 回归(确保 peaks-code / peaks-content / peaks-doctor 等老 skill 不动)

**长痛(现在不做、未来持续):**
- **用户面对 N 个 peaks-* slash command 不知道怎么选** —— 装了 peaks-loop 的人(早期用户,可能只有 10 个以下)必须自己识别"我这事是 code / content / doctor / research / other",然后自己 `/peaks-xxx`。**违反 Human-NL-Choice-Only 红线的精神**(用户不该知道这些内部细节)。
- **"我不知道 peaks-loop 有哪些 skill" 场景无解** —— 用户自然语言描述诉求时,系统按 skill description 匹配,**用户**不知道 peaks-code / peaks-content / peaks-doctor / peaks-issue-fix-orchestrator 各自是干啥的,触发不出来的就静默。
- **"一次性信息查询"(如 GitHub top 10)无归属** —— 现有 skill 池没有"研究 / 信息查询"专属 skill,这类需求 LLM 走 deep-search + WebSearch 兜底,**但兜底结果不沉淀**(无 loop engineering 价值识别)。

**做了之后:**
- 用户只面对 1 个前门 `/peaks-solo`(类似 macOS 的"主菜单"概念,而不是 1 个 App 1 个图标)
- LLM 自己分诊:code 走 /peaks-code,content 走 /peaks-content,health 走 /peaks-doctor,啥都不匹配就自规划
- 自规划跑完回头问"要不要沉淀",用户多选,把"一次性 / 可复用"区分开

### 1.2 与 peaks-loop 现有定位的兼容性

| 已有定位 | 兼容性 | 处理 |
|---|---|---|
| `peaks-loop-24h-ai-programmer-positioning.md`(2026-06-28 旧) | 部分挑战:dispatcher 概念扩展了"24h AI 程序员"单体叙事 | **不覆盖**,留给未来 B 文件 |
| `peaks-loop-positioning-loop-engineering.md`(2026-07-08 新) | 完全兼容:dispatcher 是 peak-* 蜂群的入口扩展,不影响 Loop Engineering Asset / Bee Asset / Workflow Trace / Evolution Evaluation 四层模型 | **不加段**,dispatcher 是 skill 层概念,跟 asset 层正交 |
| `human-nl-choice-only-tenet`(2026-07-04) | 100% 兼容:dispatcher 内部所有决策点仍走 AskUserQuestion | **HC-9 锁死** |
| `two-forms-only-rule`(2026-07-04) | 100% 兼容:dispatcher 是新加的入口,老入口保留,3 条入口并存 | **HC-10 锁死** |
| `peaks-loop-is-enhancement-not-new-cli.md`(2026-07-04) | 100% 兼容:dispatcher 是 peaks-* 蜂群内部的 user-facing 前门,不是新 AI CLI | **不加段** |
| RL-8 `peaks-code` 域边界 | 100% 兼容:peaks-solo 不动 peaks-code 一行 | **HC-8 锁死** |

### 1.3 为什么选 dispatcher 角色(不选 orchestrator / 不选 router / 不选 triage)

- **dispatcher 优于 orchestrator**:orchestrator 在 peaks-loop 已有专属含义(peaks-code 那种"持有 implementation surface 的 11 步 runbook"),再造一个 orchestrator 会语义重叠。dispatcher 更薄一层,只分诊不调蜂群。
- **dispatcher 优于 router**:router 是技术层概念(网络 / 消息路由),dispatcher 是用户层概念(把用户需求派给合适的人)。`peaks-solo` 是 user-facing,dispatcher 更准。
- **dispatcher 优于 triage**:triage 偏医疗(分诊、分类、紧急度评估),dispatcher 偏军事(分派、调度、命令链)。你之前明确说"指挥官决定要不要做",dispatcher 跟"指挥官"语义对齐,选 dispatcher。

---

## 2. 范围(Scope)

### 2.1 In-Scope

| 对象 | 改动 |
|---|---|
| `skills/peaks-solo/SKILL.md` | 新建。frontmatter `name: peaks-solo`,description 写 dispatcher 角色 + triggers,显式 NOT clause。 |
| `skills/peaks-solo/references/` | 新建 2-3 个文件:triage 决策表 / 自规划兜底工具清单 / 沉淀提议模板。 |
| `bin/peaks.js` 或 `src/cli/` 内部 | 新增 `peaks skill search` 子命令(query / tag / domain 三种匹配,返回结构化数组)。 |
| `src/services/skill/` 内部 | 新增 search 实现,基于现有 `skill.list` + skill frontmatter 解析,不支持模糊查询 → v2;v1 走 description 字面匹配 + tag 列表匹配 + domain 列表匹配。 |
| `.claude-plugin/marketplace.json` | 新增 `peaks-solo` 条目,`userInvocable: true`,`domain: "dispatcher"`,`tags: ["dispatcher", "triage", "router"]`。 |
| `CHANGELOG.md` | 1 条(措辞待 user freeze),大意 `+ peaks-solo: dispatcher (分诊员);+ peaks skill search: 技能池检索`。 |
| `tests/unit/skill-search.test.ts` | 新建,vitest 测 search 子命令 3 种匹配 + 1 个 "无 match 返回空数组" 边界。 |
| `tests/integration/dispatcher-flow.test.ts` | 新建,1 个 dogfood 测试:用户原话"获取 GitHub top 10" → peaks-solo 跑 → search 返回空 → 兜底走 deep-search → 跑完问沉淀。 |
| `package.json` | 不改(没新依赖)。 |
| `README.md` / `README-en.md` | 1 段"dispatcher 前门"说明(≤ 100 字),不改其他。 |

### 2.2 Out-of-Scope

- **不动 `skills/peaks-code/`** — peaks-code 完整保留,SKILL.md 第 1 段 description 末尾**可选**加 1 句 "如不想自己选 / 用 /peaks-solo"(≤ 20 字),等 §3.1 决定;不写也 OK,这是 HC-8 的边界。
- **不动 `skills/peaks-content/`** / `peaks-doctor/` / `peaks-issue-fix-orchestrator/` / `peaks-sop/` 等其他 leaf —— peaks-solo 只跟它们**描述里写清 NOT clause**,不动它们内部。
- **不写 `peaks asset crystallize` 新 CLI** —— peaks-solo 内部的"沉淀提议"复用现成 `peaks memory extract --apply` / `peaks asset crystallize`,不创造新 CLI。
- **不写 dispatcher 的状态机 / 持久化** —— peaks-solo 不持久化自己的 session,每次 user 自然语言触发时从 0 开始查 skill 池(用 `peaks skill search`),不读 `.peaks/_runtime/<sid>/` 任何文件。
- **不写 dispatcher 的"学习机制"** —— dispatcher 不记忆"上次这个需求走了 peaks-code,这次也走 peaks-code",每次都重跑 search(理由:dispatcher 是分诊员,不是 cache;避免 context-overflow + 避免 stale decision)。
- **不动版本号策略** —— 跟着 4.0.0-beta.5 出版,不需要单独 bump。
- **不写 OpenSpec change-id** —— 待 §7 占位决定,跟 2026-07-05 那次同 pattern(连续 work,不是新 PRD)。

### 2.3 与 4.x-beta 周期其他 in-flight 工作的关系

| 进行中的 work | 关系 |
|---|---|
| 4.0.0-beta.4 release(已 ship) | 不动;4.0.0-beta.5 单独 minor 发 peaks-solo |
| peaks-content(f354a03 已 ship) | 平行;不在同 PR |
| peaks-issue-fix-orchestrator(57a6631 已 ship) | 平行;不在同 PR |
| 2026-07-08 loop engineering crystallization(已 sediment) | 本 spec 引用其 M5 / M6 / M8 模式(crystallization / 4-section brief / dogfood),不主动对接 |

---

## 3. 设计(Design)

### 3.1 peaks-solo SKILL.md 骨架(待 RD 阶段填实)

```yaml
---
name: peaks-solo
description: |
  [TO_FILL] Dispatcher (分诊员) for the Peaks-Loop skill family.
  Use when the user describes a task in natural language and does NOT know
  which peaks-* skill fits. peaks-solo reads the live skill pool via
  `peaks skill search`, dispatches to a matching leaf (peaks-code /
  peaks-content / peaks-doctor / peaks-issue-fix-orchestrator / etc.) or
  falls back to self-planned execution (deep-search / WebSearch / Bash /
  Edit markdown) if no leaf matches, and then asks the user whether to
  sediment the result.

  Triggers: 自然语言描述诉求且无明确 peaks-* skill 选择 / "帮我处理这个" /
  "我不知道该用哪个" / "随便都行".

  NOT for: code-specific work (use /peaks-code) / content-specific work
  (use /peaks-content) / project health check (use /peaks-doctor) /
  issue sweep (use /peaks-issue-fix-orchestrator) / SOP authoring
  (use /peaks-sop).
metadata:
  type: dispatcher
  domain: triage
  visibility: public
  supersedes: peaks-solo (eradicated 2026-07-05, revived 2026-07-08)
  red_lines: [RL-1, RL-8, HC-7, HC-8, HC-9, HC-10, HC-11]
---
```

**SKILL.md 正文结构(RD 阶段填实):**
1. §0 角色定义(dispatcher ≠ orchestrator)
2. §1 触发条件 + 3 类匹配(source-trace / trigger-phrase / LLM-judge)
3. §2 triage 决策表(关键词 → leaf skill)
4. §3 自规划兜底工具清单(deep-search / WebSearch / Bash / Edit)
5. §4 沉淀提议 AskUserQuestion 模板(对应备忘 §"沉淀时机")
6. §5 Out of scope(不写代码 / 不写 PRD / 不跑 vitest / 不改 Loop Engineering 资产)
7. §6 边界 case(用户中途换需求 / 兜底工具失败 / 沉淀被拒后下一步)

### 3.2 `peaks skill search` CLI 草图(RD 阶段确认)

```bash
peaks skill search \
  [--query <nl-text>] \
  [--tag <tag-string>] \
  [--domain <code|content|doctor|research|triage|...>] \
  [--limit <N>]
```

**返回结构(JSON):**
```json
[
  {
    "name": "peaks-code",
    "description": "Code-domain loop engineering orchestrator ...",
    "triggers": ["/peaks-code", "peaks code", "全流程开发", "端到端迭代"],
    "tags": ["code", "orchestrator", "long-task"],
    "domain": "code",
    "matchScore": 0.92
  },
  ...
]
```

**匹配规则(v1):**
1. `--query`:对 skill description + triggers 做 case-insensitive substring match,按命中长度排序
2. `--tag`:对 skill metadata.tags 做精确 match
3. `--domain`:对 skill metadata.domain 做精确 match
4. 三者可叠加,AND 关系
5. 全部空 → 报错(强迫 caller 至少给 1 个 filter,避免"全列 + LLM 自己 grep"的反 pattern)
6. 无 match → 返回空数组,不是报错

### 3.3 triage 决策流程(RD 阶段填实伪代码)

```
1. user NL → peaks-solo 触发
2. peaks-solo 跑 peaks skill search --query "<NL>" → 拿到 candidates []
3. if candidates.length == 0:
   → 走自规划兜底(§3.4)
4. if candidates.length == 1:
   → 直接 Skill tool 调起该 skill(转交,无感)
5. if candidates.length >= 2:
   → 走 AskUserQuestion 多选("NL 描述匹配到 N 个 peaks-* skill,请选一个:")
   → 用户选 → Skill tool 调起
6. leaf 跑完 → leaf 内部自己处理 sediment(不重复问)
7. 自规划跑完 → 走 §"沉淀提议" AskUserQuestion
```

### 3.4 自规划兜底(RD 阶段填实)

| 兜底工具 | 适用场景 | 限制 |
|---|---|---|
| `deep-search` skill | 信息查询 / 研究类 | 装在 LLM CLI 平台时自动出现,peaks-solo 不主动 install |
| `WebSearch` / `WebFetch` | 实时性高的查询(超过训练数据) | 内置工具,无需 install |
| `Bash` | 数值计算 / 系统命令 / git 操作 | 不写 src/** 业务代码(那是 peaks-code 域) |
| `Edit` / `Write` | 改 markdown / 改 yaml / 改 .peaks/memory/ 文件 | 不改 src/** 业务代码(同上);不改 `skills/peaks-{code,content,doctor,...}/` 任何 leaf skill 文件 |
| `peaks memory extract` | 跑完提议沉淀 | 走现成 CLI,不重写 |

### 3.5 沉淀提议 AskUserQuestion 模板(对应备忘 §"沉淀时机")

```
本次结果是否沉淀?
(a) 沉淀为普通 lesson / convention → peaks memory extract --apply
(b) 沉淀为 Loop Engineering 资产 → peaks asset crystallize
(c) 改 scope 再沉淀(LLM 继续追问)
(d) 不沉淀(单次性,丢弃)

默认推荐: (a) — LLM 必须给一段 NL 解释为什么推荐 (a) 或 (b)
```

**触发条件矩阵(对应备忘 §"沉淀时机" 表格):**

| peaks-solo 跑完类型 | 是否问 | 触发 trigger |
|---|---|---|
| 转交 leaf 跑完 | **不问** | (leaf 内部 Step 11 处理) |
| 自规划兜底跑完 | **默认问** | `success_default_prompt` |
| 用户主动说"沉淀这个" | **立即问** | `user_explicit` |
| LLM 识别 ≥ 2 个 reuse signals | **附带 4-section brief 问** | `llm_suggested` |

---

## 4. 验收标准(Acceptance Criteria)[TO_FILL — RD 阶段补全]

> 占位。RD 阶段必须 fill,每条 AC 必须可观察 / 可命令验证 / 不可有"应该是"。

- [ ] AC-1 `peaks-solo` skill 在 `peaks skill list` 出现,description 包含 "Dispatcher" 字样
- [ ] AC-2 `peaks skill search --query "code"` 返回 peaks-code(matchScore > 0)
- [ ] AC-3 `peaks skill search --query "xxxxx"` 无 match 时返回 `[]`,不报错
- [ ] AC-4 用户原话"获取 GitHub top 10" → peaks-solo 跑 → search 返回空 → 兜底走 deep-search → 跑完问沉淀(dogfood evidence 必须含这 4 步的实跑输出)
- [ ] AC-5 peaks-solo 不能写 src/** 业务代码(测试:模拟 peaks-solo 收到"改 src/cli/index.ts" 需求时,必须转交 peaks-code 或拒绝,不直接 Edit)
- [ ] AC-6 peaks-code 0 改动(git diff 验证:本 PR 不触碰 `skills/peaks-code/SKILL.md` 之外的内容)
- [ ] AC-7 3.x / 4.x 老用户 `/peaks-code` / `/peaks-content` / `/peaks-doctor` 继续可用(vitest 全量绿)
- [ ] AC-8 7 天内不再 rename peaks-* 任何 skill 名(HC-7 自我约束,本 PR 不引入新 rename)
- [ ] AC-9 全量 vitest 绿(`pnpm vitest run`)
- [ ] AC-10 CHANGELOG 1 条,措辞 user freeze

---

## 5. 实施步骤(Implementation Steps)[TO_FILL — RD 阶段填实 + 配 plan index]

> 占位。RD 阶段必须出 plan index(类似 `docs/superpowers/plans/2026-07-07-peaks-loop-loop-engineering/index.md`),列出每步的 sub-agent dispatch 任务、依赖关系、并行可能性。

**草图(本 spec 0.5 版,RD 阶段细化为 5-7 步):**

1. **S1**(可并行):新建 `skills/peaks-solo/SKILL.md`(dispatcher 描述) + 新建 `skills/peaks-solo/references/triage-decision-table.md`
2. **S2**(可并行):实现 `peaks skill search` CLI + 写 `tests/unit/skill-search.test.ts`
3. **S3**(依赖 S1 + S2):在 `peaks-solo/SKILL.md` 写 triage 决策流 + 沉淀提议模板 + 自规划兜底工具清单
4. **S4**(依赖 S3):写 `tests/integration/dispatcher-flow.test.ts`(dogfood 自动化版本)
5. **S5**(依赖 S4):更新 `marketplace.json` + `CHANGELOG.md` + `README.md`(各 1 处)
6. **S6**(依赖 S5):全量 vitest + 1 次手工 dogfood(用户原话"获取 GitHub top 10")
7. **S7**(依赖 S6):memory sediment(本 spec 的 brief + 4-section evidence + LLM 识别 reuse signals)

---

## 6. 风险(Risks)[TO_FILL — RD 阶段补全]

> 占位。RD 阶段必须列 ≥ 5 条 risk,每条带 mitigation。

**草图(本 spec 0.5 版):**

- R1 `peaks skill search` 性能:20 个 skill 池下 query 匹配 < 50ms,扩到 200 个 skill 时是否仍 < 200ms? mitigation:加 limit 默认 10,加分页。
- R2 dispatcher 分诊错:L1 匹配到 peaks-code 但实际是 content 需求,转错。 mitigation:在 AskUserQuestion 多选里加 (e) "都不对,我自己跑"。
- R3 自规划兜底无 boundary:LLM 用 Bash 跑了 rm -rf 之类的危险命令。 mitigation:在 peaks-solo SKILL.md §5 Out of scope 显式列危险操作清单。
- R4 与 peaks-content / peaks-doctor 等 leaf 描述重叠。 mitigation:peaks-solo description NOT clause 必须显式 NOT 每个 leaf,leaf 自己的 description 也加 1 句"用户如想自动分诊,可用 /peaks-solo"。
- R5 dispatcher 自己变第二个 orchestrator:L1 越权,开始写代码 / 跑 vitest。 mitigation:RL-N(新红,本 spec 提议命名 `RL-10 peaks-solo cannot own implementation surface`)。

---

## 7. OpenSpec change-id / Plan 链接[TO_FILL]

> 占位。RD 阶段决定:
> - 是否需要 `openspec/changes/<change-id>/` 流程?(参考 `2026-07-05` 那次是"连续 work,不是新 PRD",本 spec 可能同 pattern)
> - plan index 路径:`docs/superpowers/plans/2026-07-08-peaks-solo-dispatcher/index.md`?(待定)

---

## 8. 相关(References)

- `user-decision-2026-07-08-revive-peaks-solo-as-dispatcher.md` —— 本 spec 的 §0 / §10 锚(2026-07-08 商讨结论)
- `peaks-solo-to-peaks-code-rename-session-directive.md` —— 2026-07-05 6 条硬约束(本 spec §0.1 继承)
- `user-decision-2026-07-05-eradicate-peaks-solo.md` —— 2026-07-05 eradicate 决策(本 spec §0.3 不撤销)
- `peaks-solo-is-an-orchestrator-not-an-implementer-even-for-pure-doc-changes.md` —— 旧定位的"orchestrator"语义(本 spec §0.2 HC-11 故意区分)
- `peaks-loop-positioning-loop-engineering.md` —— 2026-07-08 Loop Engineering 定位(本 spec §1.2 完全兼容)
- `peaks-loop-24h-ai-programmer-positioning.md` —— 2026-06-28 旧定位(本 spec §1.2 部分挑战但不覆盖)
- `human-nl-choice-only-tenet.md` —— Human-NL-Choice-Only 红线(本 spec HC-9 100% 兼容)
- `two-forms-only-rule.md` —— Two-Forms-Only 红线(本 spec HC-10 100% 兼容)
- 2026-07-05 spec `peaks-solo-to-peaks-code-rename-design.md` —— 格式参考(本 spec 的 0 硬约束 / 1 动机 / 2 范围 3 段结构对照)
