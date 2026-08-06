---
name: 4016-lint-strict-prd-todo
description: PRD-002b — ESLint 严格化 + LLM 红线 baseline (incremental + project-aware);并入 4.0.16 一起发;待 4.0.16 ship 闭环后开 1 个新 slice
metadata:
  type: project-todo
  scope: project-level
  effective: 2026-08-06
  parent-rule: incremental-first-no-touch-stockcode-rule
---

# PRD-002b — ESLint 严格化 + LLM 红线 baseline (合并进 4.0.16)

## 状态

⏸ **WAITING** — 等当前 4.0.16 ship 闭环（已 7 commits on main, verify-pipeline PASS, request handed-off）后开 1 个新 slice。**预算充足**，可立即开。

## Slice 范围 (1 slice = RD + QA + SC + TXT)

### RD 改造 (5 文件)

1. **`config/eslint/.peaks-rules.cjs`** —— 升级 3 条 rule：
   - `max-lines: ['error', { max: 400, skipBlankLines: true, skipComments: true }]` (单文件 400 行，**error**)
   - `max-lines-per-function: ['error', { max: 50, skipComments: true, skipBlankLines: true }]` (单函数 50 行，**error**)
   - `complexity: ['warn', { max: 10 }]` (圈复杂度 10，**保持 warn**)

2. **`src/services/lint/eslint-runner.ts`** —— 加 3 个新选项：
   - `diffOnly: boolean` (default `true`)：lint 只跑 `git diff HEAD` 的新增 hunks；不动存量
   - `baselineFile: string` (default `.peaks/lint/baseline.json`)：命中 baseline 的违规自动豁免
   - `redLineMode: 'none' | 'baseline-aware'` (default `baseline-aware`)：runtime warning 打印"全仓同类违规 N 个"
   - **改 stdout narrowing（cycle-1 已 fix，regression test 必须保留）**

3. **`src/cli/commands/lint-commands.ts`** —— 加 3 个子命令：
   - `peaks lint baseline`：扫 cwd 整个项目，输出 `.peaks/lint/baseline.json`（项目级，gitignored 默认）
   - `peaks lint check` (default)：diffOnly + baseline 豁免
   - `peaks lint --red-line`：生成 `.peaks/memory/lint-redline-summary.md`（gitignored）

4. **`skills/bee/peaks-rd/SKILL.md`** —— Gate B5 段扩展：
   - 新增 "Baseline 流程"：第一次跑 lint 必先 `peaks lint baseline` 生成项目 baseline
   - 新增 "Red-line 流程"：每次 Gate B5 前 read `.peaks/memory/lint-redline-summary.md`

5. **`skills/bee/peaks-rd/references/jsts-eslint-gate.md`** —— 扩到 ≥ 120 行（含 Section 7 "Project-aware baseline" + Section 8 "Red-line"）。

### 依赖 + 项目状态

- peak-loop 自身的 `.peaks/lint/baseline.json`：**入库 git**（TS CLI 项目，reference 价值高；作为下游类似项目的 fixture）
- 下游项目 baseline：按 S1 规则各自重生成，**不入 peaks-loop 库**

### QA 验证门

1. `peaks lint baseline` 在 peak-loop 仓库跑通；输出 `.peaks/lint/baseline.json` 内容合理
2. `peaks lint check`（默认 diffOnly=true）在 4.0.16 仓库 7 commits 上：存量违规自动豁免，新增违规报错
3. `peaks lint --red-line` 生成 `lint-redline-summary.md`；LLM 读该文件可看到"同类违规 N 个 + top 5 file:line"
4. 4 条新增 BDD test（`when baselineFile provided, should skip matching violations` / `when diffOnly true, should not scan files outside diff` / 等）

### SC / TXT

- 标准 SC 流程：commit boundaries + change impact + rollback plan
- TXT 流程：handoff capsule + 关 request

## 决策链 (1-of-1 / 2026-08-06)

| 决定 | 用户原话 | 影响 |
|---|---|---|
| D1 | "当前讨论的内容并入 4.0.16 一起发" | 不开 4.0.16.1 hotfix；等当前 4.0.16 ship 后立刻开本 slice |
| D2 | "成本不用考虑预算充足" | 1 slice 不分拆 |
| D3 | "全 lint rule 是给 LLM 用的" | rule 设计目标 = 让 LLM 下次写出更好的代码 |
| D4 | "优先处理增量内容，不主动碰存量" | diffOnly: true 默认；治理存量前必先告知风险 |
| D5 | "全仓扫描 OK，但 baseline 按项目动态生成" | `.peaks/lint/baseline.json` 是项目级，不跨项目盲目复用 |
| D6 | "全仓 baseline 作为 LLM 开发红线" | redLineMode: 'baseline-aware' + memory doc 双轨 |
| D7 | "下游项目随 peaks-loop update 自动生效" | 不起 downstream-migration slice |

## 关联

- **Parent rule**: [[incremental-first-no-touch-stockcode-rule]] (3 主线 + 3 补充决定全记录)
- **Predecessor slice**: PRD-002 (ESLint + OCR 1.8.x ship closure) — 7 commits, 26 files, +1509/-960 LOC, verify-pipeline PASS
- **Related memory**: [[peaks-loop-publishing-critical-hard-rules]] (SquabbyZ sole-author + 9-step publish recipe)

## 启动本 slice 的最小验证

next session 起 peaks-code 时，先：
1. `git status` — 工作树干净
2. `git log --oneline -8` — 4.0.16 ship 闭环的最后 commit = `2080a74a` (F4 docs fix)
3. `peaks -v` — 4.0.16 已 ship
4. 然后开本 slice：RD dispatch + 4 文件 + baseline 生成 + BDD test + verify-pipeline
