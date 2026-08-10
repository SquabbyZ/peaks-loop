---
name: 2026-08-10-rid-statusline-stale-ux-sediment
description: rid-statusline-stale-ux 完整 sediment — statusline ⚠ UX 修复 + SessionStart primer hook + RD sub-agent 虚构 API signature 教训
metadata:
  type: project
  kind: sediment
  rid: rid-statusline-stale-ux
  session: 2026-08-10-session-05b9be
  shipped: 2026-08-10
---

# rid-statusline-stale-ux — full sediment

## 摘要

修复 statusline 在新会话看到 `Peaks ⚠ peaks-code · stale 92h` 的 UX 误读。根因：`.claude/settings.json` 没有 SessionStart hook，peaks workspace init rotation 没在 statusline 第一次渲染前触发，旧 lease 残留被 renderer 读出。修复：(a) renderer 文案中性化 + 新 `palette.idleStale` + `formatHumanAge` Map cache；(b) 新 `peaks session primer` subcommand（仅 rotation rebinding，跳过 bootstrap/materialize/hooks-install）+ SessionStart hook 接入；(c) `resolveCanonicalProjectRootStrict` strict helper；(d) 文件 rename `outer-cache-hook-constants.ts → session-start-hook-constants.ts`。

## Live before/after

```
before: Peaks ⚠ peaks-code · stale 92h → peaks-loop [cacde8]
after:  Peaks ○ empty → peaks-loop [05b9be]
```

## 文件改动（21 个 = 6 source + 4 test + 1 settings + 1 unit modified + 5 new + 1 rename + 3 review artifacts）

### Source (6 modified + 1 created + 1 renamed)
- `src/services/skills/skill-statusline-renderer.ts` — palette.idleStale 字段、formatHumanAge + Map cache、renderStale 中性文案
- `src/services/skills/hooks-settings-service.ts` — resolveHookEntries 追加 HOOK_WORKSPACE_INIT entry；resolveLegacySentinels 追加
- `src/services/skills/outer-cache-hook-constants.ts` → **`session-start-hook-constants.ts`** — 新增 HOOK_WORKSPACE_INIT_SENTINEL/_COMMAND/_EVENT
- `src/services/config/config-safety.ts` — 新增 resolveCanonicalProjectRootStrict + InvalidProjectRootError
- `src/cli/commands/primer-command.ts` — NEW; runPrimerAction + registerPrimerCommand
- `src/cli/program.ts` — mount primer under session group

### Test (1 modified + 3 new)
- `tests/unit/skills/skill-statusline-sid-only-marker.test.ts` — 删 `stale <Nh>` legacy 断言、保留 `peaks-code` 断言
- `tests/integration/statusline-session-start-init.test.ts` — NEW; 4 cases
- `tests/integration/workspace-session-start-primer.test.ts` — NEW; 4 cases
- `tests/integration/hooks-install-preserves-workspace-init.test.ts` — NEW; 4 cases（含 mkdtempSync tmp root + case 4 sha256 before/after guard）

### Settings
- `.claude/settings.json` — SessionStart entry: `peaks session primer --project "${CLAUDE_PROJECT_DIR}"`

## 关键工程教训

### 1. RD sub-agent 会虚构 API signature

**Cycle-2 RD sketch 写了 `clearStalePresenceOnRotation(root, rotation)` 2-arg 形式，但真实 API 是单 options object**（`skill-presence-service.ts:584-588`）。这导致 cycle-2 的实现计划如果直接落地会 silent-fail。

**Why**: RD sub-agent 在没有 Read/Grep 实际代码时，根据函数名脑补参数。

**How to apply**:
- 任何 RD tech-doc 在写 diff sketch **之前** 必须 §0 验证 log（Grep/Read 真实签名 + 参数列表 + 行为）
- 在 dispatch prompt 里硬性要求 "MUST NOT invent API signatures; MUST cite file:line + actual parameter list"
- v3 的 §0 7/7 verified-live 是这次修法的核心
- cycle-3 起 review 优先检查 §0 是否完整

### 2. Cleanup-path 设计错误：renderer 读的是 sid-scoped lease，不是 single-slot

**Cycle-2 RD 假设 `clearStalePresenceOnRotation` + `gcStalePresenceLeases` 能清掉 ⚠，但这俩只清理 single-slot legacy 文件（4.0.11-A 之前）。** 自 4.0.11-A 写入已迁到 sid-scoped lease + presence-index。`gcStalePresenceLeases` 迭代 `input.leases ?? []` 在外部调用时是空数组，silent no-op。

**Why**: 不读 skill-statusline-renderer.ts 的实际 read path，凭直觉推断。

**How to apply**:
- 任何"清理"修复必须先 grep renderer/reader 的 read path，再推断 cleanup 目标
- v3 明确记录"rotation rebinding（不是 cleanup calls）才是真机制"于 §0.4 + §4.2.1
- 后续 slice 如涉及 presence/lease 状态机改动，必须先 `Read skill-statusline-service.ts:264-326` + `presence-lease-service.ts:424-437`

### 3. `resolveCanonicalProjectRoot` 是 fail-open 不是 strict

**Cycle-2 RD sketch 假设它会在 bad path 上 throw，实际它 `return start` 永不 throw**（`config-safety.ts:138`）。

**Why**: helper 名字含 `Canonical` 让人以为 strict，实际只是 path-resolution helper，validation 在别处。

**How to apply**:
- 任何 path-traversal 防御必须先 Read 实际 helper 行为，不能假设名字暗示
- v3 引入新的 `resolveCanonicalProjectRootStrict` + `InvalidProjectRootError`（Option A），因为 strict helper 在 scope 内
- 不要 cycle-2 RD 那种"helper 看起来 strict 就 strict"的推断

### 4. applyHookInstall 没有 tmp-root guard

**`atomicWriteJson` 直接写真实路径**（`hooks-settings-service.ts:584-625`），不拒绝 symlink 或项目根。测试如果不显式 mkdtempSync 就会 clobber git-tracked `.claude/settings.json`。

**Why**: install 路径优先考虑用户场景（直接 install 到真实 path），没考虑 test 隔离。

**How to apply**:
- 任何写 `.claude/settings.json` 的测试**必须**用 `mkdtempSync` + afterEach teardown
- v3 case 4 用 sha256 before/after guard 显式断言未 clobber 真实 settings.json
- `peaks session primer` 路径里也跳过 `applyHookInstall`（避免 SessionStart 触发 settings.json 重写）

### 5. Claude Code hooks 并行执行，SessionStart → statusLine 无顺序保证

**AC-2 验收假设 SessionStart 在第一帧 statusLine 之前完成，但官方文档明确 hooks 并行执行**。

**Why**: Claude Code harness 在某些版本下并行触发 SessionStart 与第一帧 statusLine。

**How to apply**:
- v3 §6 显式加 degradation clause："If harness parallel-runs hooks, AC-1 (renderer) is fallback guarantee; AC-2 is best-effort"
- 文案中性化（AC-1）必须独立 ship，**不能依赖** hook 触发顺序
- 任何依赖 SessionStart 单线程执行的 slice 必须显式声明 degradation

### 6. Test fixture 与 assertion 必须一致

**Cycle-2 RD 新增测试断言 `4 天前` 但 fixture age = 48h = `2 天前`，直接 FAIL**。

**Why**: RD 没注意 fixture 是 cycle-1 已经写好的，cycle-2 直接写新 assertion。

**How to apply**:
- 写新 assertion 之前必须 Read 既有 fixture
- 改 fixture 时同步改 assertion
- v3 在 §0 验证中专门列了 fixture-vs-assertion 一致性

## 流程教训

### RD 5-way fanout cycle cap = 3 是合理的（这次走到 cap 触发 approve）

- Cycle 1: 5/5 request-changes（卡在 v1 的根本性错误）
- Cycle 2: 3/4 approve（karpathy/code/perf），security 暴露 RD 虚构 signature + cleanup-path 设计错误
- Cycle 3: 5/5 approve（cycle cap 达到但通过）

**Why cap 有效**: cycle-2 security review 揭露 cycle-1 merge 没看到的根本性问题（虚构 signature + cleanup-path 错误），强制 v3 走 §0 验证路径。

**How to apply**:
- cap = 3 是**最高警戒线**，不是目标；目标是 cycle 1 就 approve
- 任何 cycle request-changes 都必须 read reviewer 找出的"systemic pattern"（如 RD 虚构 signature），下个 cycle 必须从根上修
- merge document 一定要 dedupe + rank，否则 v2 会把 cycle-1 修过的问题又重新犯

### peaks-code 的"角色 skill" 不等于 "code impl agent"

- PRD / RD / QA 都是 peaks-* skill，但**实际代码改动**是通过 `Agent` 工具派 general-purpose sub-agent 做（CLI dispatch 返回的 toolCall 是 dry-run，orchestrator 真实执行）
- code sub-agent 必须读 RD v3 的 §0 verification log 才不会重蹈 cycle-2 RD 的覆辙

## 不在本次范围（forward-looking）

- `peaks session primer` 不暴露为 top-level command — 仅 SessionStart hook harness 内部调用（RD §3.4 (e)）
- 中文 i18n — renderer 现用 en-US (`(previous session · 4 days ago)`)；zh-CN 留未来 slice
- `ensureSessionWithRotation` 每次 SessionStart 写 `.peaks/_runtime/<sid>/session.json` 是否构成 attack-surface increase — RD §5 R9 deferred
- 用户在 4.0.18 ship 后重跑 `peaks hooks install` 是否拿到新 SessionStart primer entry — 已通过 dual-commit (resolveHookEntries push + legacy sentinel set append) 保证

## 链接

- PRD: `.peaks/_runtime/2026-08-10-session-05b9be/prd/requests/001-rid-statusline-stale-ux.md`
- RD v3: `.peaks/_runtime/2026-08-10-session-05b9be/rd/requests/001-rid-statusline-stale-ux.md`
- Cycle-1 review merge: `.peaks/_runtime/2026-08-10-session-05b9be/rd/reviews-merge-rid-statusline-stale-ux.md`
- Cycle-3 fix spec: `.peaks/_runtime/2026-08-10-session-05b9be/rd/cycle3-fix-spec.md`
- Cycle-3 security review (final approve): `.peaks/_runtime/2026-08-10-session-05b9be/audit/security.md`
- Cycle-3 karpathy review (final approve): `.peaks/_runtime/2026-08-10-session-05b9be/rd/karpathy-review.md`
- Cycle-3 code review (final approve): `.peaks/_runtime/2026-08-10-session-05b9be/rd/code-review.md`
- Cycle-2 perf review (approve): `.peaks/_runtime/2026-08-10-session-05b9be/audit/perf.md`
- Test plan: `.peaks/_runtime/2026-08-10-session-05b9be/qa/test-cases/rid-statusline-stale-ux.md`
- QA acceptance (final): `.peaks/_runtime/2026-08-10-session-05b9be/qa/acceptance/rid-statusline-stale-ux.md`
- Related memory: `2026-08-10-statusline-empty-render-short-sid-suffix-sid-only-marker-and-multi-binary-drift-guard.md` (4.0.13 ship 的 G1-G4 baseline)
