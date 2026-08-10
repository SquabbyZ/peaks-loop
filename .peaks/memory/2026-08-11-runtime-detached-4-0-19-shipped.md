---
name: runtime-detached-4-0-19-ship-pending-2026-08-11
description: Single-ship v4.0.19 PENDING CI verification — all 5 Phases A-E merged into one release (user direction 2026-08-11)
metadata:
  type: project
  createdAt: 2026-08-11
---

# Single-ship v4.0.19 — PENDING CI verification

## State

- **Plan originally**: 5 Phases × 5 versions (4.0.19 / 4.0.20 / 4.0.21 / 4.0.22 / 4.0.23)
- **User direction (2026-08-11)**: 取消 4.0.20-23 五个版本，**全部开发完统一走 4.0.19 的发布流程**
- **Current local state**: package.json + shared 0.0.49 + shared-channel 0.0.25 + mut 0.1.21 + runtime RUNTIME_VERSION 4.0.19 — ALL FIVE PHASES' code committed (Phase A 17 tasks + Phase B 4 tasks + Phase C 2 tasks + Phase D 2 tasks + Phase E 2 tasks = 27 total tasks)
- **Tags deleted**: v4.0.20 / v4.0.21 / v4.0.22 / v4.0.23 (local + remote)
- **v4.0.19 tag**: re-created (was pushed earlier; CI may have already triggered — see verify runbook below)

## Why single-ship

User 决策：避免 5 个连续 minor 版本各自 publish 带来的 npm registry churn + GitHub Actions 资源浪费 + 维护负担。一次性把全部 5 Phase 代码 ship 到 4.0.19。

## What next session should do

1. `git pull` (fast-forward only — local now has force-pushed changes)
2. **Verify v4.0.19 tag in origin**: `git ls-remote origin v4.0.19`
3. **If CI already triggered on v4.0.19 push before tag delete**: the publish.yml may already have published 4.0.19 to npm. Check:
   ```
   npm view peaks-loop dist-tags.latest
   curl -fsS https://registry.npmjs.org/peaks-loop/4.0.19 | jq .version
   ```
4. **If 4.0.19 NOT yet published**: re-push tag v4.0.19 (force) to retrigger CI; OR run `peaks release plan 4.0.19` locally if peaks has a CLI-driven publish path.
5. **If 4.0.19 ALREADY published**: verify dist-tags.latest = 4.0.19 + curl registry check; this is the success state.
6. **Rename this sediment to `…shipped.md`** once registry confirms.

## All 5 phases (single-ship content)

- **Phase A** (commits `4ccfb2c7` → `505983c8`): 17 tasks — monorepo skeleton + ProcessSupervisor + LifecycleOwner + ClaudeAdapter + PromptBuilder + StatusProtocol + AutoCompactAdapter + DispatchRecord fields (Task 8 sub-agent) + ResourceBudgetGuard + dispatch orchestrator + CLI entry + --no-throttle (Task 11+11.5 sub-agent) + SKILL.md + integration tests + benchmarks + publish lockstep 3 packages + memory sediments.
- **Phase B** (commits `8e04c41f` / `3dc11397` / `dd19d77c`): 4 tasks — CodexAdapter + CopilotAdapter + peaks vendor-detect CLI (Task 20 sub-agent).
- **Phase C** (commit `dce31a14`): 2 tasks — reviewer / sub-role --mode detached in peaks-rd + peaks-qa SKILL.md.
- **Phase D** (commit `abc35add`): 2 tasks — peaks doctor invoke --from-code CLI (Task 24 sub-agent).
- **Phase E** (commit `f6a02534` reverted + `dd69d7e9` rewritten): 2 tasks — lease-dashboard.html detachedGraphView empty container.

## Total

- **27 tasks** across **5 phases**
- **5 commits** with sub-agent dispatch (Task 8, 11+11.5, 20, 24 — last 4 delegated)
- **3 spec drift corrections** (npm name; root workspace dep; runtime not in publish list)
- **11 vitest test files added**: process-supervisor / lifecycle / vendor/{claude,codex,copilot}-adapter / prompt-builder / status-protocol / auto-compact-adapter / resource-budget / dispatch + sub-agent-detached + vendor-detect + doctor-invoke-from-code + lockstep-three-packages
- **No Co-Authored-By trailer** on any commit (SquabbyZ sole author per .claude/rules/TypeScript/coding-style.md red rule)

## Related

- [[runtime-detached-design-2026-08-10]] — spec mirror
- [[runtime-detached-24h-user-confirm-2026-08-10]] — user authorization
- [[phase-A-baseline-stub-2026-08-10]] — efficiency baseline ledger (stub; real E2E measurement still pending)