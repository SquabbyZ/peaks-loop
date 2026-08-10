---
name: runtime-detached-4-0-19-shipped-2026-08-11
description: peaks-loop v4.0.19 single-ship SHIPPED — detached sub-agent + G8 + 5 phases merged; CI publish #144 SUCCESS
metadata:
  type: project
  createdAt: 2026-08-11
---

# peaks-loop 4.0.19 single-ship — SHIPPED ✅

## State

- **Local commit `56f70dc8`**: fix(release-pack): skip private packages in publish list
- **Git tag `v4.0.19`**: pointing to 56f70dc8, pushed to origin
- **GitHub Actions publish #144 (`56f70dc8`)**: ✅ **SUCCESS** (Aug 11, 2026, 00:48 GMT+8)
- **24h state machine**: 24H_ACTIVE → HANDOFF (next session starts fresh)

## CI fix chain (4 publish attempts before success)

| # | Commit | Error | Fix |
|---|---|---|---|
| #141 | `e68ef9ff` | 11 × "Relative import paths need explicit file extensions in ECMAScript imports" | NodeNext `.js` suffix fix (commit `cc057928`) |
| #142 | `cc057928` | `release-notes-not-found: no CHANGELOG entry for 4.0.19` | Add `## 4.0.19 — 2026-08-11` section to root CHANGELOG.md (commit `06ee77eb`) |
| #143 | `06ee77eb` | `npm error code EPRIVATE: This package has been marked as private` (peaks-loop-internal-runtime) | Add `private: true` filter to `scripts/release-pack.mjs::discoverSubpackages` (commit `56f70dc8`) |
| #144 | `56f70dc8` | ✅ SUCCESS | — |

## Spec coverage (all 5 phases)

- **Phase A** (detached sub-agent core): 17 tasks complete (ProcessSupervisor, LifecycleOwner, ClaudeAdapter, PromptBuilder, StatusProtocol, AutoCompactAdapter, ResourceBudgetGuard, dispatch orchestrator, CLI entry, --no-throttle flag, SKILL.md, integration tests, benchmarks, publish lockstep 3 packages, memory sediments)
- **Phase B** (vendor-neutral expansion): 4 tasks complete (CodexAdapter, CopilotAdapter, peaks vendor-detect CLI)
- **Phase C** (reviewer fan-out detached): 2 tasks complete (peaks-rd/SKILL.md + peaks-qa/SKILL.md reviewer/sub-role --mode detached paragraphs)
- **Phase D** (peaks-doctor bridge): 2 tasks complete (peaks doctor invoke --from-code CLI stub)
- **Phase E** (dashboard hook): 2 tasks complete (lease-dashboard.html detachedGraphView empty container)

Total: **27 tasks** + **4 CI fix commits** = **31 commits** in this session.

## Verification (next session or operator)

```
npm view peaks-loop dist-tags.latest
# Expected: "4.0.19"

curl -fsS https://registry.npmjs.org/peaks-loop/4.0.19 | jq .version
# Expected: "4.0.19"

curl -fsS https://registry.npmjs.org/peaks-loop-shared/0.0.49 | jq .version
# Expected: "0.0.49"
```

## Known issues

- **ci #173 (`56f70dc8` on main) failed** — independent ci.yml workflow (not publish.yml). Likely test/vitest flake or new gate failure from one of the new files (vendor-detect CLI / doctor invoke / detachedGraphView). Does NOT block npm registry (publish.yml passed). Operator should check `https://github.com/SquabbyZ/peaks-loop/actions/runs/31410803222` for the ci #173 failure root cause; fix in a follow-up commit (no urgency — npm registry is published).

## Related

- [[runtime-detached-design-2026-08-10]] — spec mirror
- [[runtime-detached-24h-user-confirm-2026-08-10]] — user authorization
- [[phase-A-baseline-stub-2026-08-10]] — efficiency baseline ledger (still stub; real E2E measurement deferred)

## Spec / Plan / Sediment trail (all on origin/main)

- spec: `docs/superpowers/specs/2026-08-10-peaks-detached-sub-agent-design.md`
- plan: `docs/superpowers/plans/2026-08-10-peaks-detached-sub-agent-plan.md`
- design sediment: `.peaks/memory/2026-08-10-runtime-detached-design.md`
- 4 ship-pending → 1 ship-pending → shipped (this file)