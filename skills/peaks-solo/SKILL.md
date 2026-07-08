---
name: peaks-solo
description: |
  Dispatcher (分诊员) for the Peaks-Loop skill family. Use when the user describes a task in natural language and does NOT know which peaks-* skill fits. peaks-solo reads the live skill pool via `peaks skill search`, dispatches to a matching leaf (peaks-code / peaks-content / peaks-doctor / peaks-issue-fix-orchestrator / etc.) or falls back to self-planned execution (deep-search / WebSearch / Bash / Edit markdown) if no leaf matches, and then asks the user whether to sediment the result.

  Triggers: 自然语言描述诉求且无明确 peaks-* skill 选择 / "帮我处理这个" / "我不知道该用哪个" / "随便都行".

  NOT for: code-specific work (use /peaks-code) / content-specific work (use /peaks-content) / project health check (use /peaks-doctor) / issue sweep (use /peaks-issue-fix-orchestrator) / SOP authoring (use /peaks-sop).
metadata:
  type: dispatcher
  domain: triage
  visibility: public
  supersedes: peaks-solo (eradicated 2026-07-05, revived 2026-07-08)
  red_lines: [RL-1, RL-8, HC-7, HC-8, HC-9, HC-10, HC-11]
---

# peaks-solo — Dispatcher (分诊员)

> peaks-solo 是 Peaks-Loop 的 dispatcher,不是 orchestrator。读取技能池 → 分诊 → 转交 leaf 或自规划 → 回头问沉淀。**不持有 implementation surface**。

---

## 1. 角色定义 (dispatcher ≠ orchestrator)

**peaks-solo 是一条 dispatcher skill**,跟 `peaks-code` 这种 orchestrator 平行存在,但更薄一层:

| 角色 | 工作 | 是否持有 implementation surface |
|---|---|---|
| **dispatcher** (peaks-solo,本 skill) | 看用户 NL → 查 skill 池 → 转交 / 自规划 → 问沉淀 | **不持有**(只调度,不实现) |
| **orchestrator** (peaks-code / peaks-content / peaks-doctor) | 看用户 NL → 走 11 步 runbook → 直接调 prd/rd/qa/ui/sc/txt 蜂群 → 沉淀 | **持有**(通过子蜂群间接持有) |

**核心区分(HC-11 锁死):** peaks-solo 能看、能查、能转交、能跑通用工具(deep-search / WebSearch / Bash / Edit markdown)、能提议沉淀;**不能**写代码、**不能**写 PRD、**不能**跑 vitest、**不能**改 Loop Engineering 资产(那是用户主权)。

**与 peaks-* leaf 的关系:** peaks-solo 是新加的第三条入口,不替代任何 leaf。3.x / 4.x 老用户继续 `/peaks-code` / `/peaks-content` / `/peaks-doctor` 等,**老入口 0 改动**(HC-10)。

---

## 2. 触发条件

peaks-solo 由 LLM 在三种匹配类之一触发,**不依赖**任何固定的 slash 命令前缀:

### 2.1 Source-trace 触发

LLM 自身启动循环(如 Claude Code 启动新会话、resume 检测、auto-decide 路径)时,**没有**其它 skill 已被 dispatch,且用户描述诉求 → 走 peaks-solo 分诊。

### 2.2 Trigger-phrase 触发(主路径)

用户自然语言描述诉求 + 满足下列任一短语:

- 自然语言描述诉求且无明确 peaks-* skill 选择(主触发)
- "帮我处理这个" / "帮我看看"
- "我不知道该用哪个"
- "随便都行" / "你帮我决定"
- "我有个事需要处理" / "我想做点东西"

**反向:** 用户已明确指定 `/peaks-code` / `/peaks-content` / `/peaks-doctor` 等具体 skill → 不进 peaks-solo,直接 dispatch 到该 leaf(HC-10 老入口保留)。

### 2.3 LLM-judge 触发

用户 NL 表述是开放性、跨域、或者 LLM 无法判定属于哪个 peaks-* 域时(例如"帮我看下 GitHub trending top 10"),LLM 自己判断"这事没有专属 leaf",走 peaks-solo 兜底。

---

## 3. Triage 决策流

peaks-solo 的 triage 流严格按以下伪代码执行:

```
1. user NL → peaks-solo 触发
2. peaks-solo 跑 peaks skill search --query "<NL>" → 拿到 candidates []
3. if candidates.length == 0:
     → 走自规划兜底(§4)
4. if candidates.length == 1:
     → 直接 Skill tool 调起该 skill(转交,无感)
5. if candidates.length >= 2:
     → 走 AskUserQuestion 多选("NL 描述匹配到 N 个 peaks-* skill,请选一个:")
     → 用户选 → Skill tool 调起
     → 用户选 "(e) 都不对" → 自规划兜底(§4)
6. leaf 跑完 → leaf 内部自己处理 sediment(不重复问;HC-9)
7. 自规划跑完 → 走 §5 沉淀提议
```

### 3.1 多候选 AskUserQuestion 模板(HC-9 锁死)

```
question: "这个诉求匹配到以下 peaks-* skill,请选一个:"
options:
  - (a) <name + 一句话功能 + 适用场景>
  - (b) <name + 一句话功能 + 适用场景>
  - ...
  - (e) 都不对,我自己跑
multiSelect: false
```

**关键约束:** 必须是 AskUserQuestion,**不**允许让用户自由文本输入 skill 名(HC-9 Human-NL-Choice-Only)。

### 3.2 用户主动说"我自己来" / "不用分诊"

LLM **bail out**(返回控制权给用户,不调任何 leaf,不进自规划兜底)。

### 3.3 关键词 → leaf skill 快速映射

完整 ≥ 10 行关键词表见 `references/triage-decision-table.md`。下面只列最常见的 5 类:

| keyword | → leaf skill |
|---|---|
| code / 改 bug / 全流程 / 端到端 | `/peaks-code` |
| 文档 / article / 内容 / 写稿 | `/peaks-content` |
| 健康 / 体检 / audit 报告 | `/peaks-doctor` |
| issue / 批量修 / sweep | `/peaks-issue-fix-orchestrator` |
| SOP / 流程 / 工作流 | `/peaks-sop` |

---

## 4. 自规划兜底

当 `peaks skill search` 返回 0 个候选,或用户选"(e) 都不对",LLM 走自规划:用通用工具(deep-search / WebSearch / Bash / Edit markdown)完成用户诉求。

### 4.1 允许工具清单

| 工具 | 适用场景 | 限制 |
|---|---|---|
| `deep-search` skill | 信息查询 / 研究类(若已装) | 不主动 install |
| `WebSearch` / `WebFetch` | 实时性高的查询(超过训练数据) | 内置工具 |
| `Bash` | 数值计算 / 系统命令 / git 操作 | **不写 src/** 业务代码(那是 peaks-code 域) |
| `Edit` / `Write` | 改 markdown / 改 yaml / 改 `.peaks/memory/` 文件 | **不改 src/** 业务代码;**不改 `skills/peaks-{code,content,doctor,...}/`** 任何 leaf skill 文件 |
| `peaks memory extract` | 跑完提议沉淀 | 走现成 CLI,不重写 |

完整 allowed + blocked 清单见 `references/fallback-tool-inventory.md`。

### 4.2 自规划成功后的下一步

自规划跑完 **必须** 走 §5 沉淀提议(HC-9 Human-NL-Choice-Only);不允许静默丢弃结果。

---

## 5. 沉淀提议

自规划兜底跑完(leaf 转交跑完则由 leaf 内部 Step 11 处理,不重复问)→ peaks-solo 用 AskUserQuestion 提议沉淀。

### 5.1 AskUserQuestion 模板(HC-9 锁死)

```
question: "本次结果是否沉淀?"
options:
  - (a) 沉淀为普通 lesson / convention → peaks memory extract --apply
  - (b) 沉淀为 Loop Engineering 资产 → peaks asset crystallize
  - (c) 改 scope 再沉淀(LLM 继续追问)
  - (d) 不沉淀(单次性,丢弃)
multiSelect: false
```

**默认推荐 = (a)**(普通 lesson / convention),LLM 必须给一段 NL 解释为什么推荐 (a) 或 (b),**不**允许默认推荐 (d)。

完整 4-option 模板 + 触发条件矩阵见 `references/sediment-prompt-template.md`。

### 5.2 触发条件矩阵

| peaks-solo 跑完类型 | 是否问 | trigger |
|---|---|---|
| 转交 leaf 跑完 | **不问** | (leaf 内部 Step 11 处理) |
| 自规划兜底跑完 | **默认问** | `success_default_prompt` |
| 用户主动说"沉淀这个" | **立即问** | `user_explicit` |
| LLM 识别 ≥ 2 个 reuse signals | **附带 4-section brief 问** | `llm_suggested` |

---

## 6. Out of scope (HC-11 锁死)

peaks-solo 是 dispatcher,**不**是 orchestrator,**不**是 implementer。下面四类操作**禁止**直接在 peaks-solo 内部执行:

- **no code** — 不写 / 不改 / 不重构 `src/**` 业务代码,也不调 peaks-rd / peaks-qa / peaks-ui / peaks-sc 子蜂群(那是 peaks-code 的 implementation surface)。遇到 code-domain 需求必须转交 `/peaks-code` 或建议用户自己跑。
- **no PRD** — 不写产品需求文档(那是 peaks-code → peaks-prd 的范围)。peaks-solo 自己不持有 PRD 的生成 surface。
- **no vitest** — 不跑测试,也不写 `tests/**` 业务测试。遇到测试需求必须转交 `/peaks-test` 或 `/peaks-code`。
- **no Loop Engineering Asset mutation** — 不调 `peaks asset crystallize` 改 Loop Engineering 资产,也不写 `.peaks/standards/` / `.peaks/memory/` 之外的 peaks-loop 内部资产(那是用户主权,peak-* 技能层没有改动权)。

**唯一例外:** 沉淀提议模板里 **选项 (b)** 提到 `peaks asset crystallize` 是给用户看的,不是 peaks-solo 自动执行;真正执行由用户在 AskUserQuestion 选中后由 LLM 代跑该 CLI。

### 6.1 边角 case

| case | 处理 |
|---|---|
| 用户中途换需求 | 重新跑 §3 triage,不复用旧 candidates |
| 兜底工具失败(如 WebSearch 不可用) | 转下一种 allowed 工具;3 次失败后 AskUserQuestion 问用户是否要继续 |
| 沉淀被拒后(用户选 d) | 不重复问,直接关闭本 skill session |
| 用户在 AskUserQuestion 中输入自由文本(理论上不该发生) | 把它当作 NL 描述,重新跑 §3 triage |

---

## 相关引用

- `references/triage-decision-table.md` — 关键词 → leaf skill 完整映射表(≥ 10 行)
- `references/fallback-tool-inventory.md` — 自规划允许 + 禁止工具清单
- `references/sediment-prompt-template.md` — 4-option AskUserQuestion 沉淀模板
- spec: `docs/superpowers/specs/2026-07-08-peaks-solo-dispatcher-design.md` §3.1, §3.3, §3.4, §3.5
- plan: `docs/superpowers/plans/2026-07-08-peaks-solo-dispatcher/s1-peaks-solo-skill.md`
- decision memo: `.peaks/memory/user-decision-2026-07-08-revive-peaks-solo-as-dispatcher.md`