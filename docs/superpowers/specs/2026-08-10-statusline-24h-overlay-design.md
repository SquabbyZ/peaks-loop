---
name: 2026-08-10-statusline-24h-overlay-design
description: statusline 显示 24h mode 子状态（[24h-active] / [24h-idle] / etc）— Approach A renderer-only 增强
kind: design
created: 2026-08-10
rid: rid-statusline-24h-overlay (proposed)
session: 2026-08-10-session-05b9be
status: draft (awaiting user review)
---

# Statusline 24h overlay — design

## 摘要

修复 bug：用户告诉 LLM "切换成 24h" 后，`peaks session 24h-mode transition` 命令成功，但 statusline 还显示旧的 base mode。根因：`SkillPresenceMode` enum（`skill-presence-service.ts:24`）写死 4 mode，**`24h` 不在内**，且 24h 子状态存在独立 state machine（`.peaks/_runtime/<sid>/24h-state.json`），renderer 没读它。

修复目标：statusline 在 active 状态下同时显示 **base mode + 24h 子状态**，二维正交（`full-auto + 24h-active` / `assisted + 24h-paused` / etc）。

## 范围

### In scope
- `skill-statusline-service.ts`：`buildStatusLineModel` 多读 1 个 24h-state.json
- `skill-statusline-renderer.ts`：`renderActive` 拼接 24h suffix token
- 测试：2-3 个新 vitest case

### Out of scope
- 不改 `SkillPresenceMode` enum（保持 `'full-auto' | 'assisted' | 'swarm' | 'strict'`）
- 不改 `setSkillPresence` API（不引入新参数）
- 不改 `peaks session 24h-mode transition` 命令（它已经写自己的 24h-state.json）
- 不改 v2.15.0 安全语义（`presence:check-stale` outer-mismatch 行为保留）
- 不动 forbidden files（`skill-presence-service.ts`、`presence-lease-service.ts`、`workspace-service.ts`、`session/**`、`audit/**`）

## 架构

### Data flow

```
[peaks session 24h-mode transition] --writes--> .peaks/_runtime/<sid>/24h-state.json
                                                       |
[peaks statusline] --reads--> buildStatusLineModel  <--+
                            (existing lease reader — UNCHANGED)
                            (NEW: read24hState())
                            ↓
                            StatusLineModel { state, presence, twentyFourHourState, ... }
                            ↓
                            renderActive(model, palette)
                              - existing: [mode] token (from presence.mode)
                              - NEW: 24h suffix (from model.twentyFourHourState)
                            ↓
                            output string
```

### Components

#### `skill-statusline-service.ts`

Add function `read24hState(projectRoot, sessionId): TwentyFourHourOverlay | null`:

```ts
type TwentyFourHourOverlay = {
  state: 'USER_CONFIRM' | '24H_ACTIVE' | 'PAUSED' | 'CANCELLED' | string;
  attempts: number;
};

function read24hState(projectRoot: string, sessionId: string): TwentyFourHourOverlay | null {
  // Read .peaks/_runtime/<sessionId>/24h-state.json
  // On ENOENT / corrupt JSON / unreadable → return null
  // NEVER throw — caller treats null as "no 24h overlay"
}
```

Modify `buildStatusLineModel` to call `read24hState` AFTER existing presence read; only attach overlay when state === 'active'.

#### `skill-statusline-renderer.ts`

Add helper `format24hSuffix(overlay: TwentyFourHourOverlay | null, noColor, capability): string`:

```ts
function format24hSuffix(overlay, noColor, capability) {
  if (!overlay) return '';
  const label = `[24h-${overlay.state.toLowerCase()}]`;
  return `${palette.inlineSeparator}${brandRun(label, noColor, capability)}`;
}
```

Modify `renderActive` to append 24h suffix after the existing `[${presence.mode}]` token.

#### Tests

- `tests/unit/skills/skill-statusline-sid-only-marker.test.ts`: 3 new cases in a new `describe('rid-statusline-24h-overlay AC block')`:
  - TC-A: active + 24h-state.json = `{ state: '24H_ACTIVE', attempts: 0 }` → renders `[24h-24h_active]`
  - TC-B: active + 24h-state.json absent → no 24h suffix (back-compat)
  - TC-C: active + 24h-state.json corrupt → no 24h suffix, no exception
  - TC-D: stale state → no 24h suffix (24h only overlays active)

## 错误处理

| Condition | Behavior |
|---|---|
| 24h-state.json 不存在 | renderer 跳过 24h suffix（back-compat） |
| 24h-state.json 损坏（JSON.parse fail） | renderer 跳过 24h suffix，不抛异常 |
| 24h-state.json 存在但 state 字段缺 | 视为 `null` |
| presence 处于 stale / idle / invalid-presence | renderer 跳过 24h suffix（24h 仅 overlay active） |
| read24hState 抛意外异常 | catch → null，log warning 但不阻塞 statusline |

## Acceptance criteria

- AC-1：active + 24h-active → output 含 `[24h-24h_active]` token
- AC-2：active + 24h-state.json 缺失 → output 与现状一致（无 24h suffix）
- AC-3：active + corrupt 24h-state.json → output 不含 24h suffix，不抛异常
- AC-4：stale 状态 → 不显示 24h suffix
- AC-5：`peaks skill presence:check-stale --project . --json` outer-mismatch 仍返回 `stale: true`（v2.15.0 保留）

## Risk + alternatives

### R1: 24h-state.json 读路径慢
**风险**：每次 statusline render 都 file I/O。Claude Code 每 ~1s 渲染一次。
**缓解**：用 fast-path cache（ageMs < 1000ms 复用上次结果）+ 用 `fs.readFileSync` 不做 lock（read-only）。

### R2: 24h 状态命名映射
**风险**：24h-state.json 内部 state 是 `24H_ACTIVE` / `USER_CONFIRM` / `PAUSED` / `CANCELLED`，statusline 怎么呈现？
**缓解**：v1 用 `[24h-<lowercase>]` 简单映射；以后做 i18n。

### R3: 与 rid-statusline-stale-ux 联动
**风险**：本次 slice 的 4.0.18 candidate 已经包含 stale-ux；新 slice 共享 renderer 文件需协调。
**缓解**：新 case 写在 sid-only-marker.test.ts 的新 describe block，与 stale-ux case 物理隔离。

## Karpathy self-check

1. **§1 Think Before Coding**：✅ 根因分析已写入本 spec 摘要；事实可溯源（grep skill-presence-service.ts:24、line 266、line 326、renderer line 377-378）
2. **§2 Simplicity First**：✅ Approach A 是 3 个候选里最简单的（1 文件 + 1 service 改动）；拒绝 Approach B（改 setSkillPresence API + 命令回调链）和 Approach C（重构 enum）
3. **§3 Surgical Changes**：✅ 改动限定 renderer + service，禁止触碰 forbidden files
4. **§4 Goal-Driven Execution**：✅ 5 个 AC 直接对应 PRD/RD 的 verification matrix

## 验证手段

```bash
# 1. 手动跑 24h-mode transition 后看 statusline
peaks session 24h-mode transition --state 24H_ACTIVE --confirm
peaks statusline --json  # expect: 含 [24h-24h_active]

# 2. 单测
./node_modules/.bin/vitest run tests/unit/skills/skill-statusline-sid-only-marker.test.ts

# 3. v2.15.0 安全语义保留
peaks skill presence:check-stale --project . --json  # outer-mismatch 时仍 stale: true
```

## Out of scope（forward-looking）

- i18n（24h 子状态当前 hard-coded en-US）
- 24h 子状态本身的设计优化（属于 peaks-code 24h mode slice，不在本 scope）
- 把 24h-state.json 也接到 statusline idle / stale 状态的 suffix（本 spec 仅 overlay active）

## 链接

- Related: `.peaks/memory/2026-08-10-rid-statusline-stale-ux-sediment.md`（已 ship 的 stale-ux slice）
- Forbidden files reference: `.peaks/memory/peaks-loop-publishing-critical-hard-rules.md`
