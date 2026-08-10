---
name: 2026-08-10-rid-statusline-24h-overlay-sediment
description: rid-statusline-24h-overlay complete sediment — statusline 显示 24h 子状态 + RD v2 教训
metadata:
  type: project
  kind: sediment
  rid: rid-statusline-24h-overlay
  session: 2026-08-10-session-05b9be
  shipped: 2026-08-10
---

# rid-statusline-24h-overlay — full sediment

## 摘要

修复 bug：用户告诉 LLM "切换成 24h" 后，LLM 跑了 `peaks session 24h-mode transition` 命令成功，但 statusline 还显示旧 base mode。修复：在 active 状态下，statusline 同时显示 base mode + 24h 子状态，二维正交（如 `Peaks ✓ peaks-code · full-auto [24h-24h_active]`）。

## Live before/after

```
before: Peaks ✓ peaks-code · full-auto
        (24h 子状态变化完全不反映)

after:  Peaks ✓ peaks-code · full-auto [24h-24h_active]
        (24h-state.json 存在时附加 [24h-<lowercase-state>] token)
```

## 文件改动（5 files = 2 source + 2 test + 1 doc）

### Source (2 modified)
- `src/services/skills/skill-statusline-service.ts` — 新增 `TwentyFourHourOverlay` type（`{state: string}`）+ `read24hOverlay` function（path: `.peaks/_runtime/<sid>/24h-state.json`）+ `StatusLineModel.twentyFourHourState` field；所有 5 个 `buildStatusLineModel` return path 都加新字段
- `src/services/skills/skill-statusline-renderer.ts` — 新增 `format24hSuffix` helper；扩展 `renderActive` signature 为 7-arg；3 个 active return path 追加 24h suffix；call site 更新

### Test (1 modified + 1 modified)
- `tests/unit/skills/skill-statusline-sid-only-marker.test.ts` — 追加 12 个新 test case in `describe('rid-statusline-24h-overlay')` block
- `tests/unit/services/skills/skill-statusline-renderer.test.ts` — 5 个 typed factory 更新加 `twentyFourHourState: null`

### Doc (1 modified)
- `CHANGELOG.md` — 4.0.18 entry added

## 关键工程教训（cycle-1 RD v1 暴露的真错误）

### 1. `attempts: number` 是错的 schema

**RD v1 假设 `TwentyFourHourOverlay` 是 `{ state: string; attempts: number }`。**
**实际 production schema 是 `Record<DecisionKey, number>`**（decision-key map），但 renderer 只关心 `state` 字段。

**Why**: 没去 `Read` `src/services/24h-mode/state.ts:55-66,64`，凭直觉推断 schema。

**How to apply**: 任何"读 sidecar file"的设计，必须先 Read/grep 实际写入端代码，确认 schema 后再定义 type。

### 2. 漏改 5 个 return path

**RD v1 只描述了 1 个 return path 加新字段，实际 `buildStatusLineModel` 有 5 个**（lines 287, 294, 297, 307, 325）。

**Why**: 没 Read 完整 `buildStatusLineModel` 函数。

**How to apply**: 改 `StatusLineModel` type 或 model 字段时，必须 Read 整个函数 grep 所有 `return {` / `return { state:` 行。

### 3. 漏改 3 个 renderActive return path

**RD v1 只描述了 1 个 renderActive return path 加 24h suffix，实际有 4 个**（lines 368, 373, 387, 389），其中 3 个需要改。

**Why**: 同上，没 Read 完整函数。

**How to apply**: 改 renderer 任何函数前，必须 Read 完整函数列出所有 return 行。

### 4. malformed shape 覆盖不足

**RD v1 只覆盖 2 个 malformed case（corrupt JSON + missing state），实际需要 4 个**：
- `{state: ""}` (empty string)
- `{state: 123}` (wrong type)
- `{}` (missing state)
- `[]` (array root)

**Why**: 没考虑 root 不是 object 的情况。

**How to apply**: readFile + JSON.parse 的 helper，malformed coverage 至少 4 case：corrupt JSON / empty state / wrong-type state / array-or-null root。

### 5. wrong field type 不一致返回 null

**RD v1 用 truthy check `obj.state` 而不是显式 `typeof obj.state === 'string' && obj.state.length > 0`** — 对 `{state: 0}` / `{state: null}` 等边界 case 行为不一致。

**How to apply**: strict-mode helper 用显式 type check，不依赖 truthy。

### 6. test count + scope drift

**RD v1 自称 7 test cases，实际 plan 写 8 个；Tasks 1-3 描述的 case 数 + RD claim + §"Karpathy self-check" 不一致**。
**Plan Task 4 改 CHANGELOG.md 但 RD "in-scope" 列表只列 3 个文件，scope drift**。

**How to apply**: RD 的 §"unit-test requirements" 数与 plan task 的 it() 数必须一致；CHANGELOG 必须显式列在 in-scope file list。

## 流程教训（cycle-1 lesson from rid-statusline-stale-ux）

- **cycle-1 RD 又一次没有 §0 verification log** — 即便前一个 slice 的 sediment 已经写了这个教训
- **必须在 RD dispatch prompt 里硬性要求 "MUST NOT invent API signatures; MUST cite file:line + actual parameter list"**，否则 sub-agent 会跳过这一步
- **cycle cap = 3 是合理上限**，但本 slice 只到 cycle 1 就暴露了 5 P0 + 3 P1 = 8 个 finding（vs rid-statusline-stale-ux cycle 1 = 4C + 10H + 6M），说明 cycle-1 lesson 没有完全 internalize
- 这次 RD v2 修完后 cycle 2 5/5 approve（karpathy / code / qa-test-cases），证明 §0 verification log 是关键

## v2.15.0 + 24h state machine 安全语义保留

- `skill-presence-service.ts` 不动（0 diffs confirmed by QA acceptance）
- `setSkillPresence` API 不动
- `peaks session 24h-mode transition` 命令行为不变
- `SkillPresenceMode` enum 不变（仍是 4 mode）
- 新增的 `read24hOverlay` 是纯 read-only + graceful null，不引入新攻击面

## 不在本次范围（forward-looking）

- 24h 子状态的 i18n（当前 hard-coded lowercase state token）
- 24h sub-state 变化时的 push event（当前是 poll-based via Claude Code ~1s render interval）
- 把 24h overlay 应用到 idle / stale 状态（当前仅 active overlay）
- cache 24h-state.json 读路径（当前每次 render 都 file I/O，但只在 active 时发生）

## 链接

- PRD: `.peaks/_runtime/2026-08-10-session-05b9be/prd/requests/002-rid-statusline-24h-overlay.md`
- RD v2: `.peaks/_runtime/2026-08-10-session-05b9be/rd/requests/002-rid-statusline-24h-overlay.md` (371 lines, §0 verified)
- Cycle-1 reviews: `rd/karpathy-review.md`, `rd/code-review.md`, `qa/test-cases/002-rid-statusline-24h-overlay.md`
- Design doc: `docs/superpowers/specs/2026-08-10-statusline-24h-overlay-design.md`
- Implementation plan: `docs/superpowers/plans/2026-08-10-statusline-24h-overlay.md`
- QA acceptance: `.peaks/_runtime/2026-08-10-session-05b9be/qa/acceptance/002-rid-statusline-24h-overlay.md`
- Related prior slice: `.peaks/memory/2026-08-10-rid-statusline-stale-ux-sediment.md` (cycle-1 lesson that should have prevented cycle-1 finding 1-5 here)
