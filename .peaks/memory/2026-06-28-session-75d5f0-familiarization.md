---
name: 2026-06-28-session-75d5f0-familiarization
description: 2026-06-28 new session (75d5f0) 启动时熟悉 peaks-loop 项目时沉淀的结构要点 — 版本/栈/目录骨架/skills/CLI 表面积/standards 指针/memory 体量。便于后续 session 直接复用。
metadata:
  type: project
---

# 2026-06-28 75d5f0 session 启动熟悉要点

**触发**: 用户开场白"你先熟悉下当前这个项目，我有些问题"。
**session id**: `2026-06-28-session-75d5f0`（由 outer-session-mismatch 自动 rotate 自上一会话 `2026-06-28-session-100b52`）。
**workspace**: `C:\Users\smallMark\Desktop\peaks-loop`，分支 main。

## 1. 版本与栈

- **版本**：`package.json` `version = "2.13.4-beta.1"`，`src/shared/version.ts` 同步。**CHANGELOG 顶部已记录 2.13.4 ship state**（slice `2026-06-28-code-mode-bypass-fix`，4 production defects）。
- **语言**：TypeScript（strict、`"type": "module"`、Node ≥20、`@types/node ^22.10.2`、TS `^5.7.2`）。
- **包管理**：`pnpm@10.11.0`（`packageManager` 字段锁定）。`pnpm.onlyBuiltDependencies = []`（无 postinstall 构建脚本）。
- **运行时依赖**（6 个）：
  - `@colbymchenry/codegraph 0.7.10`（可选项目分析）
  - `commander ^12.1.0`（CLI 框架）
  - `fzf ^0.5.2`（模糊匹配）
  - `headroom-ai 0.22.4`（上下文压缩）
  - `yaml ^2.9.0`
  - `zod ^3.25.76`（schema 校验）
  - peer（optional）：`@alibaba-group/open-code-review 1.3.1`
- **devDependencies**：vitest 2.1.8、tsx 4.19.2、stryker-mutator 8.7.1（mut 测试）、zod-to-json-schema 3.25.2。

## 2. 仓库骨架

```
peaks-loop/
├── bin/peaks.js           # shim → dist/src/cli/index.js
├── src/
│   ├── cli/               # program.ts + commands/ (61 个命令文件)
│   ├── services/          # 36 个子模块
│   ├── shared/version.ts
│   ├── hooks/ lib/ skills/
├── skills/                # 19 个 peak-* skill 家族
│   └── peaks-code/        # 当前活跃 skill
├── tests/unit/            # 366 个 *.test.ts
├── schemas/               # JSON schema 定义
├── scripts/               # 同步/构建/发布/install-skills/watch
├── agents/                # karpathy-reviewer.md（其他通过 Skill tool）
├── output-styles/         # Peaks-Skill-Swarm
├── .peaks/                # runtime + memory + standards
│   ├── memory/            # 107 个 markdown
│   ├── standards/         # canonical 规则（common + typescript）
│   ├── _runtime/          # 当前活跃 sid 75d5f0 + 9 个历史 sid
│   ├── change/            # change-id axis artifacts
│   └── session.json + active-skill.json
├── openspec/              # 启用了 OpenSpec 变更工作流
├── docs/                  # 设计 spec（含 superpowers/）
├── dist/ coverage/ rd/    # build/test 产物
```

## 3. skills 家族（19 个）

- **编排**：`peaks-code`（当前活跃，gate=startup, mode=full-auto）
- **角色**：`peaks-prd / peaks-rd / peaks-qa / peaks-ui / peaks-sc / peaks-txt / peaks-sop`
- **审计与门禁**：`peaks-audit / peaks-security-audit / peaks-perf-audit / peaks-final-review / peaks-doctor / peaks-slice-decompose`
- **辅助**：`peaks-companion / peaks-ide / peaks-code-resume / peaks-code-status / peaks-code-test`
- 所有 SKILL.md 通过 `peaks skill presence --json` 解析当前活跃 skill（canonical-path 走 CLI，禁止直接 Read active-skill.json，详见 `active-skill-cli-routing` memory）。

## 4. src/services/ 关键子模块（36 个）

| 子系统 | 路径 | 职责 |
|---|---|---|
| 编排 | `code/` | mode-gate、dag-orchestrator、auto-compact-orchestrator、batch-heartbeat、post-compact-detector、status-line-renderer |
| 会话 | `session/` | session-manager、checkpoint、resume、caller-binding、resolve-caller-id、getSessionDir、platform-fallbacks |
| 技能 | `skill/` | resume-detector、skill-scheduler |
| 门禁与判定 | `verdict/` | verdict-aggregator、envelopes（v2.13.2+） |
| 角色 | `rd/ qa/ sc/ prd/ ui/ txt/ sop/` | RD 的 strategy/tactical/impl/ast-gate、QA 的 browser-*、SC、PRD 等 |
| 上下文与记忆 | `context/ memory/ openspec/ cap/ observability/` | context-builder、project-memory、openspec |
| 审计独立 | `audit-independent/ security/ perf/` | security-audit + perf-audit 解耦 5 路信号 |
| 任务切片 | `slice-commands/` | slice check / slice decompose |
| 工作流 | `workflow/ artifacts/ handover/` | pipeline-verify、artifact-paths、request-artifact-service |
| 配置 | `preferences/ profiles/ config/ migration/` | user prefs、profile、migrate-1-4-1 / v2-10-to-v2-11 |

## 5. CLI 表面（61 个命令文件）

`src/cli/commands/` 下按动词分组：`agent / audit / capability / classify / code-review / codegraph / config / context / contract / core / core-artifact / dispatch / final-review / gate / heartbeat / hooks / log / loop / memory / migrate-* / mut / observability / openspec / perf / playwright / prd / preferences / project / qa / request / retrospective / sc / scan / security-audit / session-checkpoint / session-resume / share / skill-conformance / slice / code / sop / statusline / sub-agent / sub-agent-shared / sub-agent-dispatch-guard / test / understand / upgrade / verdict-aggregate / worker / workflow / workflow-plan / workspace`。

`src/cli/program.ts` (281 行) 注册所有命令；`src/cli/index.ts` (32 行) 是 entry。

## 6. standards 指针

- 仓库内 `.claude/rules/**.md` 全部是 **2 行 pointer**，指向 canonical `.peaks/standards/`：
  - `.claude/rules/common/{coding-style,code-review,security,dev-preference}.md` → `.peaks/standards/common/`
  - `.claude/rules/typescript/{coding-style,testing}.md` → `.peaks/standards/typescript/`
- canonical 内容（要点）：
  - **common/coding-style.md**: 简洁优先、不变量校验、preserve existing conventions。
  - **common/security.md**: 禁硬编码 secret、路径穿越/symlink 防御、不可逆动作要 confirm。
  - **typescript/coding-style.md**: 禁止新加 `any`、优先用 `unknown` + narrowing、用项目现有 tool。
  - **typescript/testing.md**: 4-dim 单元测试 split（render / behavior / integration / a11y），单 `describe` = 单维度。

## 7. 当前活跃 slice

- 上一 session `100b52` 2026-06-28 已 ship 2.13.4-beta.1（commit `d40c1e8`）。CHANGELOG 写"4 production defects"：
  1. `mode-gate.ts` Step 1 不再自动默认 full-auto（HARD_PAUSE_STEPS + GateKind discriminator）
  2. `pipeline-verify-service.ts` + `artifact-paths.ts` 走 canonical `.peaks/_runtime/change/<changeId>/...`，旧路径给 1-minor-release 弃用 warning
  3. `auto-compact-dispatcher.ts` + `auto-compact-orchestrator.ts` 加 `target: 'main'|'sub-agent'` 修"100% context 没救活 session"问题
  4. `migrate-change-scope` CLI 迁移工具
- 测试体量：4394/4418 pass + 141 skipped（pre-existing `doctor.test.ts` × 5 + `tokenizer.test.ts` × 1 + `35-checks-aggregate.test.ts` × 1，与 2.13.4 无关）
- 已知 v2.14.0 backlog（见 `.peaks/memory/2026-06-27-v2-13-3-verdict-aggregator-v2-12-debt.md`）：
  - `prepublish-build.mjs` Windows EINVAL → 换 cross-spawn
  - MUT_REPORT soft-block → hard-fail
  - 5 envelope schema unification
  - v2.13.0 auto-compact 在 ad-hoc Claude Code 100% context 没生效（用户 2026-06-28 反馈，2.13.4 已部分修）

## Why

新 session 启动时无需再扫一遍仓库。先看这个 memory 就能定位：版本/栈/目录/CLI 表面积/standards 指针/slice 上下文。

## How to apply

下次再开 session 跑 `peaks workspace init` 后：
1. 直接读这个 memory + `2026-06-27-v2-13-3-verdict-aggregator-v2-12-debt.md` + `2026-06-27-v2-13-2-verdict-aggregator-fixes.md`
2. 用户问"项目结构" → 引用 §1-5
3. 用户问"代码改在哪" → 引用 §4 + `git log --oneline -10`
4. 用户问"下次该干什么" → 引用 §7 的 v2.14.0 backlog
