---
name: 2026-07-09-zcode-adapter-overview
description: RID 003-add-zcode-adapter 完成总结 — Slice A (install 默认 model 修复) + Slice B (zcode-adapter 第 9 个 IDE) 全 PASS,verify-pipeline ok=true。4 条 lesson 已沉淀到 .peaks/memory/。
metadata:
  type: project
---

# 2026-07-09-zcode-adapter — 完成总结

**日期:** 2026-07-09
**RID:** 003-add-zcode-adapter
**Session:** 2026-07-08-session-17918f
**Job:** 2026-07-09-zcode-adapter-job (3 slices, single strategy)
**Mode:** full-auto
**Verdict:** ✅ PASS — verify-pipeline ok=true, complete=true, 9/9 gate 绿

## 内容物

(1) **Slice A — install-default-model-fix**:删除 `scripts/install-skills.mjs` 默认 `model: 'sonnet'` + `providers.minimax.model` + 删 `STRONGEST_MODEL_ID` 常量 + 新增 `getStrongestModelId(config)` 函数 + 同步 9 个 test fixture。9 file batch vitest 182 passed / 3 skipped。
(2) **Slice B — zcode-adapter-add** (peaks-loop 第 9 个 IDE):新建 `src/services/ide/adapters/zcode-adapter.ts`(98 行)+ `tests/unit/ide/zcode-adapter.test.ts`(10 case)+ IDE 类型扩展 + registry 注册 + IDE_DETECTION_DIRS/IDE_SKILL_INSTALL_PROFILES 加 zcode 条目 + ESM export 改造 + D-009a fixture 同步。vitest 跨 13 IDE files / 192 tests / 0 failed。
(3) **PRD/RD/SC/QA/verify-pipeline 全链路产物落 `.peaks/_runtime/2026-07-08-session-17918f/{prd,rd,sc,qa,txt}/`**

## 4 条 sediment lesson(已沉淀到 .peaks/memory/)

| File | 主题 |
|---|---|
| `z-code-peaks-loop-9-ide-adapter-vendor-neutrality-adapter.md` | z-code 第 9 个 IDE + vendor-neutrality |
| `peaks-loop-install-model-getstrongestmodelid-fallback.md` | install 不写死 model + getStrongestModelId 三层 fallback |
| `desktop-application-ide-adapter-z-code-cli.md` | desktop-app 类 IDE adapter 字段降级 |
| `peaks-code-runbook-4-0-0-beta-6-skill-md-cli-d-001-d-002-d-003-d-010.md` | SKILL.md 与 CLI 多处偏离(D-001/002/003/010) |

## 已知遗留(后续 slice 处理)

- **Slice C**(可选,RD §2.5):`peaks ide model --current` 运行时探测 model,替换 `getStrongestModelId()` back-compat `'claude-opus-4-7'` fallback。
- **zcode-adapter UNVERIFIED 占位字符串**:D-005 + D-009b,等 z-code 桌面应用 dogfood 后回填 `hookEvent` / `toolMatcher` / `envVar` 真实值。
- **`IdeAdapter` interface 改造**:D-009b 提议把 `hookEvent` / `toolMatcher` / `envVar` 改成 optional,或加 `unverified: boolean` flag。
- **SKILL.md 文档同步**:D-001/002/003/010,需要 SKILL.md 维护者根据实测 CLI 更新文档。
- **SC 模板改造**:D-009a/c,加 "既有白名单 fixture 必须同步" 规则 + "ESM/CJS 前置步骤"。
- **QA gate 改造**:D-009d,vendor-neutrality 字面规则加白名单注释。
- **zai / GLM provider 缺失**:D-008,peaks-loop 自家无 z-code 默认 provider 的对应 entry,后续 slice 处理。

## Why / How to apply

**Why:** RID 003-add-zcode-adapter 是 peaks-loop 4.0.0-beta.6 之后第一个多 CLI 适配 + vendor-neutrality 红线修复的双轨 release,验证了 framework 设计哲学在 desktop-application 类 IDE 的扩展能力 + install 默认值修复的 UX 价值。

**How to apply:**
- 后续 slice / dogfood 时先看本文件 + 4 条 sediment lesson
- 未来接入新 IDE 严格走 PRD → RD → slice → SC → QA → sediment 流程(参照本 RID)
- 任何 vendor 硬编码(strings / commands / paths in src/services/code/)都要走 adapter 抽象
- 任何 install 默认值改动都要在 RD 阶段说明 back-compat fallback 策略

## 关联

- PRD: `.peaks/_runtime/2026-07-08-session-17918f/prd/003-add-zcode-adapter.md`
- RD: `.peaks/_runtime/2026-07-08-session-17918f/rd/003-add-zcode-adapter/rd-report.md`
- SC: `.peaks/_runtime/2026-07-08-session-17918f/sc/003-add-zcode-adapter/sc-report.md`
- QA: `.peaks/_runtime/2026-07-08-session-17918f/qa/003-add-zcode-adapter/qa-report.md`
- handoff: `.peaks/_runtime/2026-07-08-session-17918f/txt/handoff-003-add-zcode-adapter.md`
- discovery-issues: `.peaks/_runtime/2026-07-08-session-17918f/discovery-issues.md`(D-001 ~ D-010 全 12 条)
- prior: [[2026-07-08-4-0-0-beta-6-published]] (上一版 beta.6 整体 sediment)
- prior: [[vendor-neutrality-adapter-vendor]] (vendor-neutrality 设计哲学起源)