---
name: 4-0-0-beta-6-published
description: 4.0.0-beta.6 已 npm publish + global peaks-loop 更新;session 2026-07-08-session-17918f 完整闭环。
metadata:
  type: project
---

# 4.0.0-beta.6 — 已 publish + global 更新

**发布日期:** 2026-07-09
**Commit:** ddc85f8 feat: 发布4.0.0-beta.6(35 files / +2517/-132)
**NPM:** `peaks-loop@4.0.0-beta.6` public,global install 已更新(2026-07-09 user confirmed)

## 内容物

(1) **OpenSpec 解耦**(PRD-1 / RD-1 / QA-1):删 Step 0.5 OpenSpec opt-in + 7 references trim + 1 reverse-assertion test
(2) **vendor adapter + runtime-detection + polyrepo**(PRD-2 / RD-2 / QA-2):14 new src + 5 new test,3 verb group `peaks runtime / adapter / polyrepo *`,vendor-neutrality 守住(`src/services/code/` 0 vendor verb)

## 已知遗留(后续 S3-cleanup)

- 4 legacy 文件仍硬编码 `claude --compact`:session-auto-compact-hook-command / auto-compact-dispatcher / auto-compact-hook-install / ide/adapters/claude-code-adapter
- AC-4 baseline 1 failure(SKILL.md byte cap)
- AC-5 PARTIAL(child .peaks/ lazy 创建,R-1)
- Final-review allPass=false(user-approved 2 INCONCLUSIVE)

## Why / How to apply

**Why:** 4.0.0-beta.6 是 peaks-loop 第一次双轨发布(dispatcher 上线 + 自身改造并行)。这次发布的两个关键设计选择对未来 slices 有指导意义:
- **vendor-neutrality 通过 adapter 抽象守住** — 新代码零 vendor 动词,新 vendor 接入 = 新 adapter 文件 + register,不动核心
- **polyrepo root + child peaks 双层** — lazy 子集(Karpathy #2),parent 无 .git 时让 LLM 跨仓视角

**How to apply:**
- 后续 beta.7+ 改动:先看本文件的"已知遗留"段,优先解决 S3-cleanup
- 评估 peaks-loop 健康度:global peaks-loop 已 4.0.0-beta.6,`peaks --version` / `peaks skill list` 应当看到新 verb group
- 跨版对比(beta.5 vs beta.6):同时召回 [[2026-07-08-4-0-0-beta-5-overview]] + 本文件
- beta.6 的 3 个 sediment lessons(OpenSpec / vendor-neutrality / polyrepo)对未来 vendor 接入 / polyrepo 设计是基线

## 关联

- [[2026-07-08-4-0-0-beta-5-overview]] — 上一版整体改动概览
- [[openspec-peaks-code-peaks-runtime-source-of-truth]] — sediment lesson 1
- [[vendor-neutrality-adapter-vendor]] — sediment lesson 2
- [[polyrepo-root-child-peaks-lazy]] — sediment lesson 3
- session `2026-07-08-session-17918f` 在 peaks-loop / .peaks/_runtime/ 有完整 PRD/RD/QA/sec/perf/final-review/handoff 产物,可 audit replay