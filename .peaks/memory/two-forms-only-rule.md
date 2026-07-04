---
name: two-forms-only-rule
description: peaks-loop 全局用户交互规则 — 无客户端时 user 一切操作 = (1) AskUserQuestion pick / (2) 自然语言描述;桌面客户端出后,它是 UI 加速,主路径不变
metadata:
  type: project
  createdAt: 2026-07-04
  source: brainstorm session for `docs/superpowers/specs/2026-07-04-peaks-maker-dynamic-skill-sediment-design.md` (user note)
---

# Two-Forms-Only — 全局用户交互规则

> **Why:** 用户 2026-07-04 重申"目前没有客户,用户的一切操作只有选择 AskUserQuestion 的选项和自然语言,包括下载存储的 skill 或者微调等全部都是用户通过自然语言让 LLM 去操作"。这条把 sediment-pool spec 的 §4.1.0 "Zero-CLI-cost" 提升为**全局**规则,覆盖所有 4.x 及后续 spec 的 user 行为约束。后续有桌面应用了,**用户可以快捷操作** —— 但这是 UI 加速,不是新的 verb 表面。
>
> **How to apply:** 任何 4.x/后续 slice 写 user-facing 流程(下载、导入、微调、复制、保留、销毁、晋升、退役、搜索、list 等)时,只允许两类 user 动作。出现"user types `peaks <verb>`"、"user runs `peaks …`"、表格里让 user 敲 flag,立即按本条重写。

## 1. 两种合法的 user 形式

| 形式 | 例子 | 实施者 |
|---|---|---|
| AskUserQuestion pick | "你想要 A 还是 B?", "晋升这只 bee 吗?", "destroy 还是 retain?" | LLM 提选项;user 在自然语言对话中选 |
| 自然语言描述 | "下载最新版的 bee-arxiv", "把 import 路径换成 ~ 那个", "下次直接复用" | user 主动发起,LLM 解析意图(intent-based,非 keyword-match)后驱动 CLI |

## 2. 全部 user 操作收口

下面这些**全部**走 "user 自然语言 → LLM → `peaks skill sediment <verb>`" 的形式,**user 不直接接触 CLI**:

- `add-segment` / `add-bee` / `refine-bee` / `clone-bee` — 沉淀/微调/复制
- `promote` / `retire` — 晋升/退役
- `dispose --decision destroy|retain` — 销毁/保留
- `export` / `import` — 下载/上传
- `releases` / `release-show` — 浏览/查看版本
- `list` / `search` / `recent` — 列表/搜索
- `rebuild-index` — 修复 index

—— 任何一项如让 user 直接敲 CLI,即违反本条。

## 3. 桌面客户端是 UI 加速,不是新 verb

- 未来桌面客户端出后,user 可以"快捷操作"(按钮、拖拽、文件选择器、列表视图、搜索框)
- 这些快捷操作**底层仍走** `peaks skill sediment …` 表面,经过 LLM 协调
- 桌面**不**发明新的 verb 表面 / 不绕过 LLM 协调模型
- 桌面的快捷操作是"加速",不是"替代"

> 反例:桌面出后让 user 拖拽就 `peaks skill sediment import <path> --force`,这是绕过 LLM 协调,违反本条。正确做法:桌面把拖拽翻译成 NL,LLM 接住,LLM 决定怎么 import。

## 4. 与其他 meta 规则的关系

| 规则 | 关系 |
|---|---|
| [[human-nl-choice-only-tenet]] | 本条是它的"完整覆盖性表达",更严;当两者同时适用时,本条是当前 spec 的引用对象 |
| [[peaks-loop-is-enhancement-not-new-cli]] | 本条是 user 维度的"增强层"语义:user 仍在他的 AI CLI 里,peaks 是增强;不另起入口 |
| [[peaks-loop-local-skillhub]] | local SkillHub 的"分享给队友"路径,user 走 NL → LLM → `export` → 把 tar.gz 给队友;**不是**"user 在 peaks 里分享给别人" |

四张牌栈: 本条 > human-nl-choice-only > enhancement-not-new-cli > 24h 定位 > 反伪选择

## 5. 越界清单(任何命中都重写)

- × "user 拖入 import 文件后自动执行"
- × "user 在桌面点击按钮后直接调用 `peaks …`"
- × "user 在 prompt 里粘贴 JSON 修补 manifest"
- × "user 键入 `peaks skill sediment export …`"
- × error message / AskUserQuestion 里暗示"键入 y 确认"
- × 任何让 user 直接接触 CLI / JSON / 文件路径手填的 UX

## 6. 关联

- `CLAUDE.md` — 已上升为第二条 project-level rule
- `docs/superpowers/specs/2026-07-04-peaks-maker-dynamic-skill-sediment-design.md` — §0.0 / §9 Red Line #10 / §11 Decision log
- [[human-nl-choice-only-tenet]] / [[peaks-loop-is-enhancement-not-new-cli]] / [[peaks-loop-local-skillhub]] — 同族 meta 规则
