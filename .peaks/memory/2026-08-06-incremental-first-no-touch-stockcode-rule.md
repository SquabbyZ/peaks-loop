---
name: incremental-first-no-touch-stockcode-rule
description: peaks-loop lint rules are for LLM consumption on incremental code; never touches stockcode without explicit user go-ahead AND prior risk acknowledgement
metadata:
  type: project-rule
  scope: project-level
  effective: 2026-08-06
  redline: true
---

# Incremental-first / no-touch-stockcode rule (effective 2026-08-06)

## TL;DR

peaks-loop 所有 lint rule / code-review gate 的目标对象是 **LLM 正在写 / 刚刚写的代码 (incremental content)**。**不主动碰存量代码 (stockcode)**。即使用户明确要治理 stockcode，治理过程中也必须**优先告知风险，让用户决定**——LLM 不擅自对存量代码动手。

## 3 binding statements (verbatim from user, 2026-08-06)

1. **当前讨论的内容并入 4.0.16 一起发**（不另开 hotfix）。
2. **全部 lint rule 都是给 LLM 用的**——不是给人类开发者 review 用的；rule 的设计目标 = 让 LLM 下一次写出来的代码更好。
3. **优先处理增量内容**——新写的代码 / LLM 刚生成的代码；**不主动碰存量代码**；即使用户明确要治理存量代码，治理过程中也要**优先告知风险让用户决定**。

## Why this rule exists

peaks-code / peaks-loop 自身的存量代码规模很大（4.0.15 baseline：~600 files, ~80K LOC）。lint rule 提为 `error` 之后，存量代码可能大面积触发违规。如果不区分"增量" vs "存量"：

- **CI 立即全红**——`pnpm test:unit` 跑全量 lint 就会失败，开发者无法 commit 任何东西
- **假阳性 false-positive 雪崩**——存量代码里可能有历史原因造成的合理违规（API 兼容性、第三方约束、deprecated 模式），LLM 不该擅自"修"它们
- **scope creep 风险**——LLM 拿到 lint 输出后会"顺手重构"周边代码，触发 peaks-code "surgical changes" 红线
- **违反用户对 LLM 的角色定位**——peaks-code 的定位是"24h AI 程序员编排器"，不是"无限范围重构助手"

## How to apply

### Scenario A — Default (most common)

LLM 写新代码 → peak-rd Gate B5 跑 `peaks lint` → **lint output 只对 LLM 刚写的 diff 起作用**（"增量"）→ 不报错存量代码。

实现方式：lint 范围限定为 `git diff --name-only HEAD` 的文件 + `git diff` 的 hunks；不是全仓库扫。

### Scenario B — User 明确要求治理存量

LLM 必须先：
1. 跑 `peaks lint --scope .` (全仓库扫) → 报告违规数 / 涉及文件数 / 是否 blocking
2. **优先告知风险**给用户：
   - "全仓库有 N 个违规，涉及 M 个文件"
   - "按 4.0.10 baseline 当时有意为之（warn-only），这些违规可能是有意保留的设计"
   - "如果你确认要治理，建议先用 ESLint `--fix` 跑 dry-run 看看 effect"
3. **不擅自修**——等用户明确指令（"go ahead" / "只修这几类" / "先列名单"）
4. 治理过程中严格 scope 控制：只动用户列出的违规类型；不"顺手"重构

### Scenario C — CI / pre-commit hook

CI 跑全量 lint 是**只对 PR 引入的新增代码报错**——不报错"PR 触碰到的存量代码的存量违规"。实现：lint 跑 `git diff main...HEAD` 的 hunk-level violation。

## Red line violations (会触发 peaks-code audit)

- ❌ LLM 跑 `peaks lint --scope .` 后**未告知用户风险**就自动修复存量违规
- ❌ LLM 把存量违规"顺手"重构进 PR
- ❌ LLM 把 `max-lines` / `max-lines-per-function` 提为 `error` 后**未加增量过滤**直接跑全量 lint
- ❌ LLM 把 4.0.10 baseline 故意保留的 warn-only 行为直接升 error，**没做基线免责表**

## Anti-patterns (DON'T)

- **DON'T** 写 `pnpm lint:fix --all` 然后 commit 整个仓库
- **DON'T** 在 `peaks lint` 默认行为里扫全仓库 (no `peaks lint --scope .` 默认)
- **DON'T** 把 lint 提为 error 时不区分 diff scope
- **DON'T** 用 lint 输出作为"重构 opportunity list" 主动提议改动

## Anti-patterns (DO)

- **DO** 让 `peaks lint` 默认只跑 diff hunks (`git diff HEAD` for current change, `git diff main...HEAD` for branches)
- **DO** 提供 `--scope <path>` flag 让用户/LLM 显式选择扫描范围
- **DO** 提为 `error` 时同步写一条"基线免责"：存量违规自动豁免
- **DO** 治理存量前必问用户"go ahead?"
- **DO** 治理存量时严格 scope 控制（不超出用户列出的违规类型）

## Supplementary decisions (2026-08-06 user补充)

### S1 — baseline 必须按项目动态生成

`.peaks/lint/baseline.json` **绝不能跨项目盲目复用**。每个项目独立生成：

- **peaks-loop 自身** = TS CLI 项目；baseline 可入库作为 reference + 单元测试 fixture。
- **下游 React TS 项目** = 与 peaks-loop 同语言（TS）但**项目结构 / 工具链 / 编码风格完全不同**；reference 价值低，必须重生成。
- **下游 Python / Go / Java 项目** = 跨语言，零参考价值；按对应工具链生成自己的 baseline（如果未来加 Python lint 同理）。

`peaks lint baseline` 行为：
1. 扫 cwd 整个项目（`--scope .` 默认）
2. 输出 `.peaks/lint/baseline.json`（项目级文件，**不入 peaks-loop 库**；由各项目独立管理）
3. 该文件 gitignored 是默认行为；项目想入库可显式 `git add -f`（但只有类 peak-loop 的 TS CLI 项目才有意义）

### S2 — 红线提醒双轨

LLM 看到"全仓同类违规 N 个"必须有**两个触点**：

1. **CLI runtime warning**：lint 跑出来时打印红线条目（rule + count + 示例 file:line）
2. **LLM memory reference**：`.peaks/memory/lint-redline-summary.md`（gitignored）由 `peaks lint --red-line` 命令自动生成；peaks-rd skill 在 Gate B5 触发前 read 该文件

两个都做，缺一不可。

### S3 — 下游传播 = 零额外工作

4.0.16 publish 后，下游项目随 `npm update peaks-loop` 自动拿到 4 个新能力（`peaks lint` / `peaks code-review detect-ocr-18` / `run-ocr-18` / `ocr-18-delegate-preview`）。**不起 downstream-migration slice**。每个下游项目自己决定何时 update。

如果未来需要"一键升级"，再开新 slice（不是 4.0.16 范畴）。

## Implementation guidance (future slice, optional)

```ts
// src/services/lint/eslint-runner.ts future enhancement:
interface EslintRunOptions {
  cwd: string;
  scope?: string;          // explicit path scope
  diffOnly?: boolean;      // default true; only lint diff hunks
  baselineFile?: string;   // optional path to baseline-violations.json
}

// peaks lint default = diffOnly: true
// peaks lint --all = diffOnly: false (full repo scan; rare)
// peaks lint --fix-baseline = interactive wizard to clear baseline violations
```

## Decision log

- **2026-08-06**: User states 3 binding rules during F4 cleanup discussion. Recorded in this file. See also `.peaks/memory/2026-08-06-eslint-jsts-gate-and-ocr-multilang-rebuild-sediment.md` for the slice context.

## Related rules

- [[peaks-loop-24h-ai-programmer-positioning]] — peaks-loop 定位是 AI 程序员编排器，不是无限范围重构助手
- [[peaks-code-runbook-4-0-0-beta-6-skill-md-cli-d-001-d-002-d-003-d-010]] — D-001..D-010 (CLI drift index)
- [[peaks-loop-publishing-critical-hard-rules]] — SquabbyZ sole-author + 9-step publish recipe
- [[redline-no-claude-co-author]] — co-author trailer ban
