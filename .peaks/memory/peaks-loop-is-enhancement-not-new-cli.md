---
name: peaks-loop-is-enhancement-not-new-cli
description: peaks-loop 的真实产品形态 = 现有 AI CLI 之上的增强层,不抢 shell 入口、不发明新 prompt 流、不替代任何运行时;vendor 中立是定义性条款
metadata:
  type: project
  createdAt: 2026-07-04
  source: brainstorm session for `docs/superpowers/specs/2026-07-04-peaks-maker-dynamic-skill-sediment-design.md` (user note)
---

# peaks-loop = 现有 AI CLI 之上的增强层,不造新 AI CLI

> **Why:** 用户 2026-07-04 明确给出定位:"peaks-loop 的定位不是要开发一款新的 AI CLI,而是增强"。这条直接影响 4.x sediment-pool spec 的设计姿态——任何 4.x / 后续 slice 越界发明 shell 入口、新 prompt 流、新 session 协议都是违反本条。
>
> **How to apply:** 当 LLM 在解释 peaks-cli/peaks-maker/sediment-pool 时,必须保持"增强层姿态";当发现 specs 里出现"替代 AI CLI""发明新的 shell wrapper""让 user 切换到 peaks 的 prompt"这种隐含动作,立即收回并标注违反本条。

## 1. 增强层姿态的具体含义

| 维度 | 造新 AI CLI (×) | 增强 (✓) |
|---|---|---|
| Shell 入口 | 自己造 `peaks>` REPL | 不抢;用户在 Claude Code / Codex / Copilot 原生 shell 里运行 |
| Skill 触发 | `peaks do X` | 由 adapter 翻译成 Claude `Skill` tool / Codex skill activate / 等 |
| 状态 | peaks 自管 session | 由用户当前 runtime 的 session 主导;peaks 只在 pool / scratch 维持自己的薄薄一层 |
| Prompt 流 | 自己写 `.peaks/system-prompt.md` 注入 | 不注入;peak-maker 以 skill 形态出现,被 runtime 自然装载 |
| 鉴权 | peaks 的 `~/.peaks/auth` | 复用 runtime 的鉴权 (Claude 订阅 / Codex 订阅) |
| 文档界面 | peaks 自有 docs site | docs 是 reference;操作仍以 skills 形式被 runtime 引导 |

## 2. 为什么这条之前没人写明

- 24h 定位 (`peaks-loop-24h-ai-programmer-positioning`) 答了"peaks-loop 给谁用、用多久",没答"peaks-loop 是另一个产品还是另一个 layer"。
- user-role (`peaks-loop-user-role-and-tech-decision`) 答了"user 不参与技术决策",也没答"peaks-loop 是不是另一个 CLI"。
- 4.x sediment-pool spec 的 §3.2 adapter 层原则其实**已经**意识到 vendor-neutral,但没有把"现有 AI CLI 之上的增强"这句定位写死。
- 现在用户明确说出"增强",**定性**。本文件初代版本曾用"机械臂"作比喻,经用户 2026-07-04 指示移除该比喻——比喻不准确且与项目其他术语无呼应。保留原则本身,不再使用任何隐喻。

## 3. 反例(spec / 设计文档 / 行为不允许的措辞)

- × "用户打开 peaks CLI 输入 ..."
- × "peaks-loop 提供另一种 shell 体验"
- × "peaks-loop 替代 Claude Code / Codex"
- × "peaks-cli 自有 REPL"
- × "peaks-loop 自管 session 状态,无法被 Claude Code 看到"
- × "在 peaks-cli 内维护 prompt 模板,需用户手动注入"

→ 出现任一条,立即收回并标注违反本条。

## 4. 与现有定位的关系

- 24h 定位: **不变**。这条只补"形态"层,不影响"who / when / why"。
- user-role + 反伪选择: **互相强化**。反伪选择说的是"不让 user 选技术",这条说"不让 peaks 抢 AI CLI 的位置"。都是"做减法"。
- vendor-neutral adapter (设计原则): **从"重要约束"升格到"产品哲学"**。今天之前 adapter 是工程必要;今天之后 adapter 是定义性条款——丢了这条 peaks-loop 就成了另一个 AI CLI,失败。
- Human-NL-Choice-Only: **本条低于它**。具体优先级见 `.peaks/memory/MEMORY.md`。

## 5. 4.x sediment-pool spec 必须自检的 7 处措辞

| Section | 当前措辞 | 是否越界? |
|---|----------------|---|
| §3 架构图顶端 | "LLM Runtime (Claude Code / Cursor / Codex / Copilot / ...)" | ✓ 姿态正确,保持 |
| §3 顶层注 | "The orchestrator has no domain knowledge" | ✓ 保持 |
| §4.1 `peaks run` (已 retired) | 明文"不替换 runtime 原生入口" | ✓ 保持 |
| §3.2 adapter 列表 | "default adapter for claude" | ✓ 保持 |
| §1.1 Symptom | "no concept of a sediment pool — a place where skills accumulate" | ✓ 保持 |
| §3.3 6 步生命周期 | "runtime invokes the bee" | ✓ 保持 |
| §4.4 老系统 skill 迁移 | "system-bundled skills" 标签 | ✓ 保持 |

## 6. 关联

- [[peaks-loop-24h-ai-programmer-positioning]] — 谁 / 多久 / 为什么
- [[peaks-loop-user-role-and-tech-decision]] — user 边界
- [[human-nl-choice-only-tenet]] — user-facing 元规则 (本条低于它)
- `docs/superpowers/specs/2026-07-04-peaks-maker-dynamic-skill-sediment-design.md` — 4.x 设计 doc
- `docs/superpowers/specs/2026-07-03-peaks-loop-job-design.md` — 24h 长任务设计 (与本条同族)
- `CLAUDE.md` — 已上升为 project-level rule
