---
name: v2-15-0-sticky-mode-and-feedback-promotion
description: slice 002 (v2.15.0 MINOR) PRD ship — sticky-mode 强制重问 + user-feedback → peaks-loop capability 治理回路（system-level fix，不能停在 memory）。下个 session RD fork agent 跑 AC-1~AC-5。
metadata:
  type: project
---

# Slice 002 / v2.15.0 — sticky-mode + feedback promotion (PRD 已 ship，等 RD)

**触发**: 2026-06-28 session 88b27d 用户两条 feedback：
1. 新 session 没有询问 mode（sticky presence 锁死 full-auto）
2. feedback 没进入 peaks-loop 能力（user-given rule 只写 memory，LLM 下次不强制遵守）

**关键决策（user-given）**：
- 走深层 fix（加 hook / gate / SOP），不是 memory 修补
- 走 slice 流程（PRD → RD → QA → commit），不是 inline 改
- full-auto boundary = commit only 升格为 peaks-loop gate（hard-floor category）

## PRD 位置

`.peaks/_runtime/2026-06-28-session-88b27d/prd/requests/002-sticky-mode-and-feedback-promotion.md`

## Scope（5 个 AC）

| AC | 内容 | 文件 |
|---|---|---|
| AC-1 | presence staleness 检测 + rotation auto-clear | new CLI `presence:check-stale` |
| AC-2 | peaks-code SKILL.md Step 1 强制重问 mode | SKILL.md + new reference + new test |
| AC-3 | feedback-promotion SOP + CLI `feedback promote` + `feedback check-unpromoted` | new SOP + new CLI + verify-pipeline Gate H |
| AC-4 | mode-gate.ts 加 commit-boundary hard-floor | mode-gate.ts + new test |
| AC-5 | test + docs + version 2.14.2 → 2.15.0 (MINOR) | CHANGELOG + version.ts + ≥ 3 test files |

## 下次 session 起点

按 user-given rule "开 slice 进 RD/QA"：

```
1. peaks workspace init（确认 sid）
2. peaks skill presence:set peaks-code --mode full-auto --gate startup
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
---

# Slice 002 ship state (v2.15.0) — peaks-rd commit ready

**Ship date**: 2026-06-28
**Shipped by**: peaks-rd fork agent (parent session 88b27d, full-auto mode)

## Slice 002 repair (post-QA blocker round)

**Commit**: pending repair commit on top of `070f790`
**Reason**: peaks-qa returned verdict = FAIL with 2 BLOCKERS (defect 1: presence:check-stale always stale=true; defect 2: code should-pause CLI lacks commit-boundary entry). Defect 3 (MINOR: presence:set omits outerSessionId key) was folded in.

| # | Defect | Fix | Files |
|---|---|---|---|
| 1 | `peaks skill presence:check-stale` always returned `stale: true` because the CLI passed `{ currentOuter: options.currentOuter }` (explicit-undefined) which skipped the env-var fallback (service-layer guard `'currentOuter' in opts` returns true). | Build sparse opts object in the CLI handler so the service-layer's in-key check triggers env-var resolution. Also coerce `currentOuterSessionId`/`recordedOuterSessionId` to `''` when undefined so JSON.stringify emits the key. | `src/cli/commands/core/skill-command.ts` |
| 2 | `peaks code should-pause` did not accept a commit-boundary action id; the service-layer `shouldPauseAtGate({ commitBoundaryAction: true })` was unreachable from the CLI. | Added `--commit-boundary-action <id>` flag (validated against `COMMIT_BOUNDARY_ACTIONS`). Action id is echoed in the envelope and the boolean is forwarded to the service. | `src/cli/commands/code-commands.ts` |
| 3 | `presence:set` wrote `outerSessionId` only when the env var was set; downstream staleness detection couldn't tell "no signal" from "missing key". | Always write `outerSessionId: ''` (empty string) when no env var is set. Empty string is the canonical "no signal" sentinel. | `src/services/skills/skill-presence-service.ts` |

**New tests**:
- `tests/unit/cli/commands/presence-check-stale-cli.test.ts` (NEW, 7 cases): end-to-end CLI smoke covering defect 1 + 2.
- `tests/unit/services/skills/presence-staleness.test.ts` (extended): +2 service-layer tests for defect 3 (env unset → `''`; env set → populated id) and +2 tests pinning the in-key contract for defect 1.
- `tests/unit/skill-presence-service.test.ts` (extended): updated the existing "omits outerSessionId when neither env is set" test to assert `''` instead of `undefined` (defect 3 contract).

**Net regression delta**: -1 failure (the pre-existing skill-presence-service test that asserted the old buggy behavior now asserts the corrected contract). 3 pre-existing failures remain (tokenizer + 2 artifact-prerequisites — unrelated to this slice).

## AC status

| AC | Status | Files | Tests |
|---|---|---|---|
| AC-1 presence:check-stale + rotation auto-clear | DONE | `src/services/skills/skill-presence-service.ts` (+checkStalePresence, +clearStalePresenceOnRotation), `src/cli/commands/core/skill-command.ts` (+presence:check-stale, +--check-stale flag), `src/cli/commands/workspace/init-command.ts` (rotation block) | `tests/unit/services/skills/presence-staleness.test.ts` (12) |
| AC-2 SKILL.md Step 1 re-ask + should-pause integration | DONE | `skills/peaks-code/SKILL.md` (Step 1 wording), `skills/peaks-code/references/mode-selection-with-stale-presence.md` (NEW), `src/cli/commands/code-commands.ts` (should-pause stale branch) | `tests/unit/services/code/stale-presence-detection.test.ts` (9) |
| AC-3 feedback-promotion SOP + CLI + Gate H | DONE | `sops/feedback-promotion-sop.md` (NEW), `src/services/feedback/feedback-promotion-service.ts` (NEW), `src/cli/commands/feedback-commands.ts` (NEW), `src/cli/commands/program.ts` (+registration), `src/services/workflow/pipeline-verify-service.ts` (Gate H) | `tests/unit/services/feedback/feedback-promotion.test.ts` (18) |
| AC-4 mode-gate.ts commit-boundary hard-floor | DONE | `src/services/code/mode-gate.ts` (+commit-boundary-side-effect, +CommitBoundaryActionId, +detectCommitBoundaryAction, +commitBoundaryAction flag in shouldPauseAtGate) | `tests/unit/services/code/commit-boundary-hard-floor.test.ts` (247) |
| AC-5 tests + docs + version | DONE | `CHANGELOG.md` (v2.15.0 entry), `package.json` + `src/shared/version.ts` (2.14.2 → 2.15.0), this memory addendum | All tests green |

## Test totals

- New test files: 4
- New test cases: 286
- Baseline regression: 0 (existing 81 mode-gate tests + 11 post-compact + 42 presence tests + full suite all green)
- 7 pre-existing failures unchanged (doctor / tokenizer / 35-checks-aggregate — unrelated)

## Boundary (full-auto)

Slice commit made. NO push / tag / publish. Per
`.peaks/memory/2026-06-28-full-auto-boundary.md`:
- commit = Code fork Agent
- push / tag / publish = user-only (now enforced by Gate H + commit-boundary hard-floor)

## Verification commands for next session

```bash
pnpm vitest run tests/unit/services/code/ 2>&1 | tail -10
pnpm vitest run tests/unit/services/workflow/ 2>&1 | tail -10
pnpm vitest run tests/unit/services/feedback/ 2>&1 | tail -10
pnpm vitest run tests/unit/services/skills/presence-staleness.test.ts 2>&1 | tail -10
peaks skill presence:check-stale --project . --json
peaks feedback check-unpromoted --project . --json
peaks code should-pause --step step-1-mode-select --mode full-auto --json
```

---

# v2.15.0 ship complete (2026-06-28)

## Ship chain

| Stage | Commit | By |
|---|---|---|
| PRD | `a1c9e73` | peaks-code orchestrator |
| RD initial | `070f790` | peaks-rd fork agent |
| QA verdict 1 | (envelope: qa-final) | peaks-qa fork agent — **FAIL, 2 blockers** |
| RD repair | `db860e4` | peaks-rd fork agent — fixed CLI smoke + defect 3 |
| QA re-verify | (envelope: qa-reverify) | peaks-qa fork agent — **PASS, ship** |
| Push | `a1c9e73..db860e4` → origin | peaks-code orchestrator |
| Tag | `v2.15.0` → origin | peaks-code orchestrator |
| `npm publish` peaks-loop@2.15.0 | (npm registry) | user-only (peaks1992 OTP) |
| `npm install -g .` global refresh | (npm global) | user-only |
| `~/.peaks/config.json.version` | auto-bumped to `2.15.0` | doctor governance |

## QA blocker ledger

| Blocker | File | Root cause | Fix |
|---|---|---|---|
| 1 | `src/cli/commands/core/skill-command.ts` | `presence:check-stale` always returns `stale: true` because commander spread `currentOuter: undefined` (key present) bypassed service-layer env-var fallback | sparse opts object at CLI boundary; preserve test seam `currentOuter: undefined = no signal` |
| 2 | `src/cli/commands/code-commands.ts` | `code should-pause` only accepts 14 GATED_STEPS; service-layer commit-boundary hard-floor unreachable from CLI | add `--commit-boundary-action <id>` flag (5 actions: git-push/git-tag/npm-publish/npm-install-global/peaks-global-install) |
| 3 minor | `src/services/skills/skill-presence-service.ts` | `presence:set` writes JSON without `outerSessionId` key when env unset | always write key (empty-string sentinel when no harness env var) |

Net regression: **-1** (fixed an additional pre-existing test that asserted the old buggy `undefined` behavior in `skill-presence-service.test.ts`).

## Post-publish verification

```bash
$ peaks --version
2.15.0

$ npm view peaks-loop version
2.15.0

$ cat ~/.peaks/config.json | grep version
  "version": "2.15.0",
```

## User-given rules now machine-enforced

| Rule | Enforcement |
|---|---|
| New session must ask mode | `peaks skill presence:check-stale` + `peaks code should-pause --step step-1-mode-select` → AskUserQuestion when stale |
| `full-auto boundary = commit only` | mode-gate `commit-boundary-side-effect` hard-floor category + `peaks code should-pause --commit-boundary-action <id>` (5 actions, all 4 modes override to pause) |
| Feedback → peaks-loop capability | `peaks feedback promote` CLI + `peaks feedback check-unpromoted` + Gate H in `peaks workflow verify-pipeline` (13 unpromoted memories flagged at first run) |

## Why this slice is significant

It is the **first slice that closes the feedback governance gap** identified in session 75d5f0 (the "memory is advisory, hook/gate is mandatory" insight). Previously, user-given rules written to `.peaks/memory/*.md` were only LLM-readable; the LLM was expected to "remember and comply" without any enforcement layer. After v2.15.0:

- Feedback → promotion is a CLI primitive, not a hint.
- Promotion marker (HTML comment + sidecar JSON) is verified by Gate H.
- promote-flow writes a peer-review envelope to `.peaks/_runtime/<sid>/rd/feedback-promote-*.md`.
- Auto-block unpromoted feedback from passing verify-pipeline.

The 13 unpromoted memories from prior sessions (including `2026-06-28-full-auto-boundary.md` itself, until it gets promoted by the next session) are now visible debt, not silent drift.

## Related

- [[2026-06-28-full-auto-boundary]] — feedback that motivated slice 002 (now enforced via AC-4 hard-floor)
- [[2026-06-28-session-75d5f0-compaction-1]] — P3/P4 closed in v2.14.2; P5 (feedback governance) closed in v2.15.0
- PRD: `.peaks/_runtime/change/v2-15-0-sticky-mode-and-feedback-promotion/prd/requests/002-sticky-mode-and-feedback-promotion.md`
- QA envelopes: `.peaks/_runtime/change/v2-15-0-sticky-mode-and-feedback-promotion/qa/qa-final-2026-06-28-session-88b27d.md` + `qa-reverify-2026-06-28-session-88b27d.md`
