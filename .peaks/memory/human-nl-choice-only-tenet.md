---
name: human-nl-choice-only-tenet
description: peaks-loop 项目宗旨 — 人参与决策归约为 2 种:选择 / 自然语言描述;凡 user-typed CLI / 手写 JSON / 手填表单皆越界
metadata:
  type: project
  createdAt: 2026-07-04
  source: brainstorm session for `docs/superpowers/specs/2026-07-04-peaks-maker-dynamic-skill-sediment-design.md` (user note)
---

# 项目宗旨: Human-NL-Choice-Only

> **Why:** 用户 2026-07-04 明确指出"人参与决策只有两种:选择 / 自然语言描述",并强调"当前包括后续的设计修复与改造的时候"都按这条。这条优先级最高,先于任何 design / refactor / fix 决策。
>
> **How to apply:** 当 LLM 解释任何 user-facing 行为、写 AskUserQuestion、设计 promotion_gate、写 error message、design 新 CLI verb 时,先 grep 本条;若 user 被期待"打字/敲命令/手写 JSON",收回并按 NL 路径重写。

## 1. 两种合法的用户参与原型

| 原型 | 例子 | 引导主体 |
|---|---|---|
| 选择 (pick) | "你想要 A 还是 B?", "晋升这只 bee 吗?", "完成还是继续?" | LLM 用 `AskUserQuestion` 提选项,用户用自然语言回答 |
| 自然语言描述 (describe) | "把这次抓 arxiv 的流程沉淀下来", "我下次想直接复用这只 bee" | 用户主动发起,LLM 解析后驱动 CLI |

## 2. 越界清单(任何命中都重写)

- × 让用户敲 CLI flag / 子命令 / pipeline
- × 让用户手写 `peaks.json` / `sop.json` / `SKILL.md` / `manifest.json`
- × 让用户手填表单字段(input / value / dropdown 选择题外的"提供 XX"题)
- × 让用户在终端键入长路径或多 token 答案
- × 让用户回答"对/错"以外的字符级 yes (yes / Y / 回车裸 yes) → ×,改为自然语言 yes

## 3. 与其他 memory 的关系

- [[peaks-loop-24h-ai-programmer-positioning]] — 用户角色 + 24h 节奏
- [[peaks-loop-user-role-and-tech-decision]] — user 不参与技术决策
- [[peaks-loop-is-enhancement-not-new-cli]] — 增强层,不是新 AI CLI
- 本条: 项目宗旨 / user-facing 元规则

四张牌按这一顺序堆叠:**user-facing 元规则 (本条) → 形态层 (enhancement-not-new-cli) → 角色层 (24h) → 决策层 (反伪选择)**。任何 spec / code 违反任一条都先收回。

## 4. spec 内部如何引用本条

参考 `docs/superpowers/specs/2026-07-04-peaks-maker-dynamic-skill-sediment-design.md` 顶部 §0 Project Tenet + §9 Red Lines 中新增的 "user-facing 元规则不可违反"条目。该处的钉法:

- §0 是源头声明
- §2 (Goals) 引用 §0
- §4 各组件 引用 §4.1.0
- §6 错误表 用 NL 表述(本条已要求)
- §9 Red Lines 加一条最严的:user-facing 措辞必须经过本条检查

## 5. related

- `docs/superpowers/specs/2026-07-04-peaks-maker-dynamic-skill-sediment-design.md` — 本条在此 spec 落 §0
- 未来 4.x 每个 slice 的 spec 都应在头部 §0 引用本条
