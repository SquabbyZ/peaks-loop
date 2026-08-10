---
name: runtime-detached-phase-E-ship-pending-2026-08-11
description: Phase E ship PENDING CI verification — dashboard detachedGraphView hook shipped; tag v4.0.23 pushed
metadata:
  type: project
  createdAt: 2026-08-11
---

# Phase E ship — PENDING CI verification

## State

- **Local commit `f6a02534`**: chore(release) bump 4.0.22 → 4.0.23
- **Git tag `v4.0.23`**: pushed to origin/main
- **GitHub Actions publish.yml**: running (OIDC Trusted Publishing)
- **Phase E code**: 2/2 tasks complete
- **All 5 Phases A-E shipped pending CI** (4.0.19 / 4.0.20 / 4.0.21 / 4.0.22 / 4.0.23)

## Phase E summary

- peaks-code lease-dashboard.html: `detachedGraphView` empty container
  (data-peaks-hook="detached-graph-view"); render deferred to
  subsequent slice

## All 5 phases summary

- **Phase A 4.0.19** (commit `844a3268`): detached sub-agent core +
  ClaudeAdapter + G8 auto-compact + LifecycleOwner closure +
  ProcessSupervisor + StatusProtocol + PromptBuilder + AutoCompactAdapter
  + ResourceBudgetGuard + dispatch orchestrator + CLI handler +
  publish lockstep 3 packages + integration tests + memory sediments.
- **Phase B 4.0.20** (commit `bc11e300` + `dd19d77c`): CodexAdapter +
  CopilotAdapter + peaks vendor-detect CLI.
- **Phase C 4.0.21** (commit `57372565` + `dce31a14`): reviewer /
  sub-role --mode detached in peaks-rd + peaks-qa SKILL.md.
- **Phase D 4.0.22** (commit `3d0c5eef` + `abc35add`): peaks doctor
  invoke --from-code CLI bridge.
- **Phase E 4.0.23** (commit `f6a02534`): lease-dashboard.html
  detachedGraphView empty container.

## What next session should do

Same as A/B/C/D:
1. `git pull`
2. Check GitHub Actions: https://github.com/SquabbyZ/peaks-loop/actions/runs/{latest}
3. Verify all 5 phases' registry writes:
   ```
   npm view peaks-loop dist-tags.latest
   curl -fsS https://registry.npmjs.org/peaks-loop/4.0.23 | jq .version
   curl -fsS https://registry.npmjs.org/peaks-loop-shared/0.0.53 | jq .version
   ```
4. On success: rename each phase's ship-pending to shipped; write
   final closure sediment at `.peaks/memory/2026-08-11-runtime-detached-all-5-phases-shipped.md`.
5. On failure: do NOT proceed; open investigation per peaks-lockstep
   sediment.

## Related

- [[runtime-detached-design-2026-08-10]]
- [[runtime-detached-phase-A-ship-pending-2026-08-10]]
- [[runtime-detached-phase-B-ship-pending-2026-08-10]]
- [[runtime-detached-phase-C-ship-pending-2026-08-11]]
- [[runtime-detached-phase-D-ship-pending-2026-08-11]]
- [[runtime-detached-24h-user-confirm-2026-08-10]]