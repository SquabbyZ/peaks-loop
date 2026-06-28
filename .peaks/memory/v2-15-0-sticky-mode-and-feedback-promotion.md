---
name: v2-15-0-sticky-mode-and-feedback-promotion
description: slice 002 (v2.15.0 MINOR) PRD ship — sticky-mode 强制重问 + user-feedback → peaks-cli capability 治理回路（system-level fix，不能停在 memory）。下个 session RD fork agent 跑 AC-1~AC-5。
metadata:
  type: project
---

# Slice 002 / v2.15.0 — sticky-mode + feedback promotion (PRD 已 ship，等 RD)

**触发**: 2026-06-28 session 88b27d 用户两条 feedback：
1. 新 session 没有询问 mode（sticky presence 锁死 full-auto）
2. feedback 没进入 peaks-cli 能力（user-given rule 只写 memory，LLM 下次不强制遵守）

**关键决策（user-given）**：
- 走深层 fix（加 hook / gate / SOP），不是 memory 修补
- 走 slice 流程（PRD → RD → QA → commit），不是 inline 改
- full-auto boundary = commit only 升格为 peaks-cli gate（hard-floor category）

## PRD 位置

`.peaks/_runtime/2026-06-28-session-88b27d/prd/requests/002-sticky-mode-and-feedback-promotion.md`

## Scope（5 个 AC）

| AC | 内容 | 文件 |
|---|---|---|
| AC-1 | presence staleness 检测 + rotation auto-clear | new CLI `presence:check-stale` |
| AC-2 | peaks-solo SKILL.md Step 1 强制重问 mode | SKILL.md + new reference + new test |
| AC-3 | feedback-promotion SOP + CLI `feedback promote` + `feedback check-unpromoted` | new SOP + new CLI + verify-pipeline Gate H |
| AC-4 | mode-gate.ts 加 commit-boundary hard-floor | mode-gate.ts + new test |
| AC-5 | test + docs + version 2.14.2 → 2.15.0 (MINOR) | CHANGELOG + version.ts + ≥ 3 test files |

## 下次 session 起点

按 user-given rule "开 slice 进 RD/QA"：

```
1. peaks workspace init（确认 sid）
2. peaks skill presence:set peaks-solo --mode full-auto --gate startup
3. 读本 memory + PRD-002
4. peaks-rd fork agent 跑 AC-1 → AC-2 → AC-3 → AC-4 → AC-5
5. peaks-qa fork agent 跑 full suite + 新 test
6. commit (slice commit + PRD commit, version 2.14.2 → 2.15.0)
7. STOP (full-auto boundary = commit only，user-only: push/tag/publish/global install)
```

## 不要做

- ❌ inline 改 SKILL.md / mode-gate.ts（必须走 RD/QA）
- ❌ 把 88b27d session 残留的 stale presence 主动 clear（user-only）
- ❌ 跑 peaks hooks install（这是 user-only 边界，slice 只是 ship 代码）
- ❌ npm publish（user-only）

## Related

- [[2026-06-28-full-auto-boundary]] — full-auto boundary = commit only
- [[2026-06-28-session-75d5f0-compaction-1]] — P3/P4 已 ship，本 slice 是 v2.15.0 起点
- PRD: `.peaks/_runtime/2026-06-28-session-88b27d/prd/requests/002-sticky-mode-and-feedback-promotion.md`