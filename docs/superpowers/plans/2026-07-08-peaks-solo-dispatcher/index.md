# Peaks-Solo as Dispatcher — Multi-slice Implementation Plan (Index)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan slice-by-slice. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **For the slice driver:** implement slices in S-order. Each S-slice is independently shippable; do not start S-(N+1) until S-N's exit conditions are green. Note: this is **NOT** a Job-mode run; peaks-solo is a single-rid effort, NOT a multi-slice Job. (Slices here are sub-deliverables within the single release 4.0.0-beta.5.)

**Goal:** Add a `peaks-solo` dispatcher skill (front door) + `peaks skill search` CLI to the 4.x-beta line, enabling users to describe tasks in natural language without knowing which peaks-* leaf skill fits. Solves the "用户面对 N 个 peaks-* slash command 不知道怎么选" pain point. Lands as 4.0.0-beta.5 (standalone minor release). 0 breaking change to 3.x / 4.x users.

**Architecture:** Multi-slice layered delivery. Each S-slice lands one atomic deliverable end-to-end (schema/service + CLI/skill surface + tests + docs). S0 is foundation (`peaks skill search` CLI primitive). S1 is the dispatcher skill itself. S2 is the integration glue (marketplace + CHANGELOG + README). S3 is dogfood on the peaks-loop project itself. Total: 4 slices, ~2.5 working days, single dev, full-auto (or strict mode per user choice — dispatcher is user-facing enough that strict mode may be more appropriate; see S2 setup).

**Tech Stack:** TypeScript (existing), Commander (existing), Zod (existing), Vitest (existing), existing `peaks` CLI. **No new dependencies.**

**Inherits from:** `docs/superpowers/specs/2026-07-08-peaks-solo-dispatcher-design.md` (the spec this plan implements). All ACs in spec §4 are tracked in the per-slice plan files. All hard constraints in spec §0 (HC-1 through HC-11) are inherited and re-listed in each slice's "Scope checklist".

**External references (advisory, never vendored, never authoritative):**
- None for this plan. dispatcher is a peaks-loop-internal concept; no upstream skill to reference. (Contrast: loop-engineering plan references `darwin-skill` + `andrej-karpathy-skills` upstream.)

---

## Hard Constraints (inherited from spec §0)

> **Every slice's scope checklist MUST include this section verbatim** (or a link back to this file with a "see index §Hard Constraints" pointer).

- **HC-1 一次到位:** 不分批、不灰度。`peaks-solo` skill + `peaks skill search` CLI 必须在同一 release 同步上;不先发 skill 后发 CLI。
- **HC-2 不计成本:** 不为减少工作量妥协任何决策(例:不退化 search 到 list|grep;不让 solo 复用 code 的 Step 0 anchor 状态;不省掉 description 里的 NOT clause)。
- **HC-3 不计时间:** 可以拆多个 sub-task 派多个 sub-agent 并行;每个 sub-agent 完成前不进入下一个 sub-task。S0 / S1 可并行(见 §"Parallelism")。
- **HC-4 禁止假绿:** 任何 sub-agent 自报"完成"必须附证据(实跑命令输出、vitest 实际 pass 数、rg 实际输出)。
- **HC-5 禁止偷懒:** 不允许跳过任何位置,除非 spec §2.2 明示不动。
- **HC-6 全量回归:** 本次改动后必须跑 `pnpm vitest run`(全量)+ `peaks skill list`(确认 peaks-solo 出现)+ 1 次 dogfood。**任何**失败阻塞 release。
- **HC-7 7 天 rename 红线:** 7 天内不得 rename peaks-* 任何 skill 名。真要再改必须先开 decider session + 列出 ≥ 3 条新证据 + 同步对所有 peaks-* 引用做 grep 影响面扫描。
- **HC-8 peaks-code 0 改动:** 不允许修改 `skills/peaks-code/`、`bin/peaks.js` 里 peaks-code 相关 surface、peaks-code 任何 step 内部行为。可选:peaks-code SKILL.md 第 1 段 description 末尾加 1 句 "如不想自己选 / 用 /peaks-solo"(≤ 20 字,等 S2 决定;不写也 OK)。
- **HC-9 Human-NL-Choice-Only / Two-Forms-Only 兼容:** peaks-solo 内部所有用户决策点走 `AskUserQuestion`,**不引入新的自由文本输入**。
- **HC-10 老入口保留:** 3.x / 4.x 用户继续 `/peaks-code` / `/peaks-content` / `/peaks-doctor` 等,**不破坏**。peaks-solo 是新加的第三条入口。
- **HC-11 dispatcher 比 orchestrator 薄:** peaks-solo 是 **dispatcher(分诊员)**,不写代码、不写 PRD、不跑 vitest、不改 Loop Engineering 资产。能做的:看用户语言、查 skill 池、转交 leaf、跑通用工具(deep-search / WebSearch / Bash / Edit markdown)、提议沉淀。

**Why this list is long:** dispatcher is a **new architectural concept** in peaks-loop; the 11 hard constraints lock the role's identity. Future specs that reference peaks-solo may inherit just HC-9 / HC-10 / HC-11; the earlier HC-1..HC-6 are 2026-07-05 universal constraints and should be inherited by every peaks-loop long-task spec anyway.

---

## Slice Map (S0..S3)

| S | Slice | Landed asset / surface | Spec sections covered | Spec ACs | Exit condition |
|---|---|---|---|---|---|
| S0 | `peaks skill search` CLI primitive | `src/cli/commands/skill-search-commands.ts` + `src/services/skill/skill-search-service.ts` + `tests/unit/skill-search.test.ts` | §3.2, §2.1 (CLI 部分) | AC-2, AC-3, AC-9 | `peaks skill search --query "code"` returns peaks-code; `--query "xxxxx"` returns `[]`; vitest unit green |
| S1 | `peaks-solo` dispatcher skill | `skills/peaks-solo/SKILL.md` + 2-3 `references/*.md` + `tests/unit/peaks-solo.test.ts`(SKILL.md frontmatter 解析 + NOT clause 解析) | §3.1, §3.3, §3.4, §3.5 | AC-1, AC-5 | peaks-solo 出现在 `peaks skill list`;frontmatter 含 "Dispatcher";NOT clause 至少 NOT 4 个 leaf skill(peaks-code / peaks-content / peaks-doctor / peaks-issue-fix-orchestrator);vitest unit green |
| S2 | Integration + surface | `.claude-plugin/marketplace.json`(新条目)+ `CHANGELOG.md`(1 条)+ `README.md` / `README-en.md`(各 1 段) | §2.1, §1.1 长痛段 | AC-7, AC-8, AC-10 | marketplace.json 验证(项目 install 命令能拉到 peaks-solo);CHANGELOG 1 条;全量 vitest 仍绿(无老 skill regression);`peaks skill list` 输出含 peaks-solo;**user freeze CHANGELOG 措辞** |
| S3 | Dogfood — 用户原话"获取 GitHub top 10" | `tests/integration/dispatcher-flow.test.ts` + 1 次手工 dogfood 记录到 `.peaks/memory/2026-07-08-peaks-solo-dogfood.md` | §1.1 短痛段(完整闭环) | AC-4 | test 自动跑通("获取 GitHub top 10" → search 返回空 → 兜底走 deep-search → 跑完问沉淀);手工 dogfood 1 次记录到 .peaks/memory;4-section evidence brief 形成(what_happened / why_it_matters / what_learned / what_action) |

**S0 与 S1 并行**:S0 是 CLI 基础(skill 池查询能力),S1 是 dispatcher skill(消费 S0 的能力);S0 不依赖 S1 任何东西,S1 只在 §"triage 决策流"段需要 S0 的 CLI。但 S1 的 SKILL.md frontmatter 描述可以**不依赖** S0 的实现细节(只描述 S0 提供的能力,具体调用方式等 S1 实施时再钉)。所以 S0 / S1 可以 fan-out 并行。

---

## File Structure (pre-task map)

| File / dir | Action | Owned by S-slice |
|---|---|---|
| `src/services/skill/skill-search-service.ts` | create | S0 |
| `src/cli/commands/skill-search-commands.ts` | create | S0 |
| `tests/unit/skill-search.test.ts` | create | S0 |
| `skills/peaks-solo/SKILL.md` | create | S1 |
| `skills/peaks-solo/references/triage-decision-table.md` | create | S1 |
| `skills/peaks-solo/references/fallback-tool-inventory.md` | create | S1 |
| `skills/peaks-solo/references/sediment-prompt-template.md` | create | S1 |
| `tests/unit/peaks-solo.test.ts` | create | S1 |
| `.claude-plugin/marketplace.json` | modify (新条目) | S2 |
| `CHANGELOG.md` | modify (1 条) | S2 |
| `README.md` | modify (1 段"dispatcher 前门"说明, ≤ 100 字) | S2 |
| `README-en.md` | modify (1 段, en 版) | S2 |
| `tests/integration/dispatcher-flow.test.ts` | create | S3 |
| `.peaks/memory/2026-07-08-peaks-solo-dogfood.md` | create (artifact) | S3 |
| `package.json` | **NOT modified** (无新依赖) | — |
| `skills/peaks-code/SKILL.md` | **NOT modified** (HC-8) | — |
| `bin/peaks.js` | **NOT modified** (HC-8) | — |

---

## Parallelism

按 HC-3,本 plan 在 S-slice 内部允许 fan-out,但 S-slice 之间有强依赖(S1 依赖 S0 的能力,S2 依赖 S0 + S1 都 ship,S3 依赖 S2)。

**S0 内部 sub-agent fan-out(≥ 2 切片时启用 `peaks sub-agent dispatch --from-dag`):**
- S0-A: 实现 `skill-search-service.ts`(纯函数 + Zod schema)
- S0-B: 实现 `skill-search-commands.ts`(CLI 表面,Commander 接入)
- S0-C: 写 `tests/unit/skill-search.test.ts`(3 种匹配 + 1 个 no-match 边界)
- S0-D: 跑全量 vitest,确认无 regression

**S1 内部 sub-agent fan-out:**
- S1-A: 写 `skills/peaks-solo/SKILL.md` frontmatter + 角色定义段(§0-1)
- S1-B: 写 `skills/peaks-solo/references/triage-decision-table.md`(关键词 → leaf skill 表)
- S1-C: 写 `skills/peaks-solo/references/fallback-tool-inventory.md`(自规划兜底工具表)
- S1-D: 写 `skills/peaks-solo/references/sediment-prompt-template.md`(沉淀提议 AskUserQuestion 模板)
- S1-E: 写 `tests/unit/peaks-solo.test.ts`(frontmatter 解析 + NOT clause 解析)

S1-A 跟 S1-B/C/D 串行(S1-B/C/D 引用 S1-A 的 frontmatter 字段),S1-E 依赖 S1-A。

**S2 内部 sub-agent fan-out:**
- S2-A: 改 marketplace.json
- S2-B: 改 CHANGELOG.md(user freeze 措辞在 S2-B 实施前)
- S2-C: 改 README.md + README-en.md(各 1 段)
- S2-D: 全量 vitest + `peaks skill list` 验证

S2-A / S2-B / S2-C 串行(S2-D 依赖 S0 + S1 + S2-A/B/C)。

**S3 内部 sub-agent fan-out:**
- S3-A: 写 `tests/integration/dispatcher-flow.test.ts`(自动 dogfood)
- S3-B: 1 次手工 dogfood(用户原话"获取 GitHub top 10"),记录到 `.peaks/memory/2026-07-08-peaks-solo-dogfood.md`
- S3-C: 4-section evidence brief 形成(what_happened / why_it_matters / what_learned / what_action)

S3-A 跟 S3-B 串行(S3-B 是 S3-A 的现实对照);S3-C 依赖 S3-B。

---

## Per-slice plan files

| S | Plan file | Status |
|---|---|---|
| S0 | `s0-skill-search-cli.md` | TO WRITE |
| S1 | `s1-peaks-solo-skill.md` | TO WRITE |
| S2 | `s2-integration-and-surface.md` | TO WRITE |
| S3 | `s3-dogfood.md` | TO WRITE |

> **Per-slice plan files are written when each slice enters implementation.** Each file follows the format of `2026-07-07-loop-engineering/m1-loop-release.md` (scope checklist, deliverables, exit conditions, evidence required, risks). This index is the planning-of-record until S0 begins.

---

## Execution Order

The 4 slices MUST be executed **in order** at the S-slice level. Within each S-slice, sub-agent fan-out is per the §"Parallelism" table above.

```
S0 ──┐
     ├── S2 ── S3
S1 ──┘
```

S0 and S1 run in parallel (S0 is CLI primitive, S1 is skill that consumes S0's capability). S2 waits for both. S3 waits for S2.

**No "mode" concept for peaks-solo.** peaks-solo 是 dispatcher(分诊员),**不**沿用 peaks-code 的 4-mode 选择(assisted / strict / full-auto / swarm)—— 那是 peaks-code 的"用户介入度"概念,2026-07-05 改名时 peaks-code 残留的。dispatcher 的运行方式 = **长任务 → 自动跑完(无 mode 切换) / 非长任务 → LLM 内置思考(无 mode 切换)**;用户介入点 = 沉淀提议 AskUserQuestion + 分诊候选 AskUserQuestion,**不**通过 mode 切换控制。

**Job mode?** **NO.** This is a single-rid release (4.0.0-beta.5), not a multi-rid Job. peaks-solo 出现 ≠ 启用 peaks job *。Slices here are sub-deliverables, not Job slices.

---

## Acceptance

All 10 ACs from spec §4 must pass before S3 sign-off. Per-slice exit conditions are listed in the §"Slice Map" table above. Full acceptance gate at S3 sign-off:

- [ ] AC-1: `peaks-solo` skill 在 `peaks skill list` 出现,description 包含 "Dispatcher" 字样
- [ ] AC-2: `peaks skill search --query "code"` 返回 peaks-code(matchScore > 0)
- [ ] AC-3: `peaks skill search --query "xxxxx"` 无 match 时返回 `[]`,不报错
- [ ] AC-4: 用户原话"获取 GitHub top 10" → peaks-solo 跑 → search 返回空 → 兜底走 deep-search → 跑完问沉淀(dogfood evidence 必须含这 4 步的实跑输出)
- [ ] AC-5: peaks-solo 不能写 src/** 业务代码
- [ ] AC-6: peaks-code 0 改动(git diff 验证:本 PR 不触碰 `skills/peaks-code/SKILL.md` 之外的内容)
- [ ] AC-7: 3.x / 4.x 老用户 `/peaks-code` / `/peaks-content` / `/peaks-doctor` 继续可用(vitest 全量绿)
- [ ] AC-8: 7 天内不再 rename peaks-* 任何 skill 名(HC-7 自我约束)
- [ ] AC-9: 全量 vitest 绿(`pnpm vitest run`)
- [ ] AC-10: CHANGELOG 1 条,措辞 user freeze

---

## Risks (inherited from spec §6)

| # | Risk | Severity | Mitigation | Owned by |
|---|---|---|---|---|
| R1 | `peaks skill search` 性能(20 skill < 50ms,200 skill < 200ms?) | Medium | limit 默认 10,加分页;v1 不做 FTS5,只做 substring | S0 |
| R2 | dispatcher 分诊错(L1 匹配 peaks-code 但实际 content) | High | AskUserQuestion 多选加 (e) "都不对,我自己跑";S3 dogfood 1 次真实 run 验证 | S1 + S3 |
| R3 | 自规划兜底无 boundary(LLM 跑危险命令) | High | SKILL.md §5 Out of scope 显式列危险操作清单;LLM 自身的安全护栏 + peaks-solo HC-11 约束 | S1 |
| R4 | 与 peaks-content / peaks-doctor 等 leaf 描述重叠 | Medium | peaks-solo description NOT clause 显式 NOT 每个 leaf;leaf 自己的 description 加 1 句"用户如想自动分诊,可用 /peaks-solo" | S1 + S2 |
| R5 | dispatcher 变第二个 orchestrator(L1 越权) | High | RL-10(待 user 拍板命名)+ HC-11 锁死"不能写代码" | S1 + S3 |
| R6 | CHANGELOG 措辞 user freeze 卡住 S2 | Low | S2 实施期间切到 `assisted` 模式;预先给 placeholder 草稿 | S2 |
| R7 | peaks-loop 自己 dogfood 时找不到 deep-search skill | Low | S3 实施时先查 `peaks skill list` 看 deep-search 是否在;不在则用 `WebSearch` 兜底 | S3 |

---

## Tech Notes

- **No new dependencies.** `peaks skill search` 用 Commander 现有 surface + Zod + 现有 skill frontmatter 解析(peaks-solo 自己会被 search 列入候选,所以 peaks-solo 必须自描述,不能"自己搜不到自己")。
- **peaks-solo 不写自己的 `.peaks/_runtime/<sid>/` 状态文件。** 每次触发都从 0 查 skill 池(HC-11 隐含约束 + §"Out of scope"显式约束)。
- **peaks-solo 不读自己之前的 dispatch 决策**(无 caching)。理由:dispatcher 是分诊员,不是 cache;避免 context-overflow + 避免 stale decision。
- **RL-10 命名待 user 拍板。** S0 / S1 期间**不**实现 RL-10 编号系统(那是 `.peaks/standards/loop-engineering-guidelines.md` 的扩展,跟 dispatcher 解耦);但 SKILL.md 自身的 HC-11 约束**已经**锁死"不能写代码",等效于临时版 RL-10。S3 sign-off 时 user 决定是否把 HC-11 升格为正式 RL-10。
- **OpenSpec change-id:** 本 plan 跟随 2026-07-05 那次同 pattern(连续 work,不是新 PRD),不创建 `openspec/changes/<id>/`。S0 实施时 user 二次确认。

---

## Related

- `docs/superpowers/specs/2026-07-08-peaks-solo-dispatcher-design.md` — the spec this plan implements
- `docs/superpowers/plans/2026-07-07-loop-engineering/index.md` — format reference (M0..M9 multi-slice pattern)
- `docs/superpowers/plans/2026-07-03-peaks-job/README.md` — format reference (M1..M7 milestone pattern)
- `.peaks/memory/user-decision-2026-07-08-revive-peaks-solo-as-dispatcher.md` — 商讨结论(spec 的 §0 / §10 锚)
- `.peaks/memory/peaks-solo-to-peaks-code-rename-session-directive.md` — 2026-07-05 6 条硬约束(HC-1..HC-6 来源)
- `.peaks/memory/peaks-solo-is-an-orchestrator-not-an-implementer-even-for-pure-doc-changes.md` — 旧"orchestrator"语义(HC-11 故意区分)
- `.peaks/memory/human-nl-choice-only-tenet.md` — HC-9 来源
- `.peaks/memory/two-forms-only-rule.md` — HC-10 来源
- `.peaks/memory/peaks-loop-positioning-loop-engineering.md` — 兼容的全局定位
