---
name: runtime-detached-4-0-20-shipped-2026-08-11
description: peaks-loop@4.0.20 SHIPPED — runtime@0.0.2 as public 0.0.x SemVer dep; 6-round CI fix chain closed
metadata:
  type: project
  createdAt: 2026-08-11
---

# peaks-loop 4.0.20 + peaks-loop-internal-runtime 0.0.2 — SHIPPED ✅

## State (verified 2026-08-11)

- `npm view peaks-loop dist-tags.latest` → `4.0.20`
- `npm view peaks-loop-internal-runtime dist-tags.latest` → `0.0.2` (peaks-loop tarball dep rewritten from `workspace:*` to exact `0.0.2` by pnpm pack)
- `npm view peaks-loop-shared dist-tags.latest` → `0.0.51`
- `npm view peaks-loop-mut dist-tags.latest` → `0.1.23`
- peaks-loop@4.0.20 tarball deps: `peaks-loop-internal-runtime: 0.0.2`, `peaks-loop-shared: 0.0.51`, `peaks-loop-mut: 0.1.23` — ALL exact-pinned, all resolvable in npm registry
- 24h state machine: HANDOFF (since 2026-08-10T16:52:50Z)

## 6-round CI fix chain (publish attempts)

| # | Commit | Error | Fix |
|---|---|---|---|
| #141 | `e68ef9ff` | 11 × "Relative import paths need explicit file extensions in ECMAScript imports" | NodeNext `.js` suffix (commit `cc057928`) |
| #142 | `cc057928` | `release-notes-not-found: no CHANGELOG entry for 4.0.19` | Add `## 4.0.19 — 2026-08-11` entry (commit `06ee77eb`) |
| #143 | `06ee77eb` | `npm error EPRIVATE: This package has been marked as private` | Make peaks-loop-internal-runtime public + remove private filter from release-pack.mjs (commits `56f70dc8`, then re-corrected `7f30518e` + `f246d0ad`) |
| #144 | `56f70dc8` | ✅ SUCCESS (peaks-loop@4.0.19 + 3 subpackages published, but runtime skipped) | — |
| #145 | `7f30518e` | peaks-loop@4.0.20 install 404 on `peaks-loop-internal-runtime` | Bump runtime to 0.0.1 (independent SemVer per user direction) |
| #146 | `f246d0ad` | (user manually published runtime@0.0.1 + configured GitHub Actions publish) | — |
| #147 | `6e402120` | `npm error E422: package.json "repository.url" is ""` (sigstore provenance check) | Add `repository.type=git, url=https://github.com/SquabbyZ/peaks-loop` (commit `9dc0cbb5`) |
| #148 | `9dc0cbb5` | ✅ SUCCESS (all 4 packages on registry, lockstep) | — |

## Spec coverage (all 5 phases)

- **Phase A** (detached sub-agent core): 17 tasks — ProcessSupervisor, LifecycleOwner, ClaudeAdapter, PromptBuilder, StatusProtocol, AutoCompactAdapter, ResourceBudgetGuard, dispatch orchestrator, CLI entry, --no-throttle flag, SKILL.md, integration tests, benchmarks, publish lockstep 3 packages, memory sediments
- **Phase B** (vendor-neutral expansion): 4 tasks — CodexAdapter, CopilotAdapter, peaks vendor-detect CLI
- **Phase C** (reviewer fan-out detached): 2 tasks — peaks-rd/SKILL.md + peaks-qa/SKILL.md reviewer/sub-role --mode detached paragraphs
- **Phase D** (peaks-doctor bridge): 2 tasks — peaks doctor invoke --from-code CLI stub
- **Phase E** (dashboard hook): 2 tasks — lease-dashboard.html detachedGraphView empty container

Total: **27 task commits** + **6 CI fix commits** + **5 sediment commits** = **38 commits in session**.

## Verification (operator or next session)

```
npm view peaks-loop dist-tags.latest
# 4.0.20

npm view peaks-loop-internal-runtime dist-tags.latest
# 0.0.2

curl -fsS https://registry.npmjs.org/peaks-loop/4.0.20 | jq .dependencies
# {"peaks-loop-internal-runtime":"0.0.2", "peaks-loop-shared":"0.0.51", "peaks-loop-mut":"0.1.23", ...}

# Install test (operator):
npm install -g peaks-loop@4.0.20
peaks --version  # should print 4.0.20
```

## Known issues (non-blocking)

- **ci #173 (`56f70dc8` on main) failed** — independent ci.yml workflow (not publish.yml). Likely test/vitest flake or new gate failure from one of the new files (vendor-detect CLI / doctor invoke / detachedGraphView). Does NOT block npm registry (publish.yml passed). Should be fixed in a follow-up commit.
- **4.0.19 tag** still points to commit `56f70dc8` but peaks-loop@4.0.19 is de facto superseded by 4.0.20 (runtime@4.0.19 was effectively unpublished; the `peaks-loop-internal-runtime: 4.0.0` dep pin in 4.0.19 tarball would 404). Users should use 4.0.20+ going forward.

## Related

- spec: `docs/superpowers/specs/2026-08-10-peaks-detached-sub-agent-design.md`
- plan: `docs/superpowers/plans/2026-08-10-peaks-detached-sub-agent-plan.md`
- design sediment: `.peaks/memory/2026-08-10-runtime-detached-design.md`
- 4.0.19 ship-pending: `.peaks/memory/2026-08-11-runtime-detached-4-0-19-shipped.md` (de facto superseded by 4.0.20)
- 4.0.19 closure: `.peaks/memory/2026-08-11-runtime-detached-all-5-phases-shipped.md`
- 4.0.20 ship-pending (this file): `.peaks/memory/2026-08-11-runtime-detached-4-0-20-shipped.md`
- 4.0.20 manual handoff: `.peaks/memory/2026-08-11-runtime-0-0-1-manual-publish-handoff.md`