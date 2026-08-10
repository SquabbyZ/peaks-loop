---
name: runtime-detached-phase-A-ship-pending-2026-08-10
description: Phase A ship PENDING — git tag v4.0.19 pushed; GitHub Actions publish.yml running; CI verification deferred to next session
metadata:
  type: project
  createdAt: 2026-08-10
---

# Phase A ship — PENDING CI verification

## State

- **Local commit `844a3268`**: chore(release) bump 4.0.18 → 4.0.19
- **Git tag `v4.0.19`**: pushed to origin/main
- **GitHub Actions publish.yml**: running (OIDC Trusted Publishing)
- **Local verification**: NOT YET — `npm view peaks-loop dist-tags.latest` + curl registry checks deferred to next session
- **Phase A code**: 17/17 tasks complete + Task 8 sub-agent + Task 11+11.5 sub-agent all shipped
- **Memory sediments**: design + phase-A-baseline-stub + user-confirm + this ship-pending sediment

## What next session should do

1. `git pull` to sync origin/main
2. Check GitHub Actions: https://github.com/SquabbyZ/peaks-loop/actions/runs/{latest}
3. Verify registry writes:
   ```
   npm view peaks-loop dist-tags.latest
   curl -fsS https://registry.npmjs.org/peaks-loop/4.0.19 | jq .version
   curl -fsS https://registry.npmjs.org/peaks-loop-shared/0.0.49 | jq .version
   ```
4. On success: rename this file to `2026-08-10-runtime-detached-phase-A-shipped.md`; add 5 phase ship closure sediment.
5. On failure: open Phase B/C/D/E investigation; do NOT proceed to Phase B until Phase A ship is confirmed.

## Phase A summary

- **27 commits** since session start (~6h wall-clock incl. brainstorm)
- **5 sub-agent dispatches** completed (Task 8 + Task 11+11.5)
- **3 spec drift corrections**:
  1. npm name `@peaks-loop/runtime` → `peaks-loop-internal-runtime` (matches peaks-loop-shared sibling convention)
  2. plan Task 1 step 1-5 internal `package.json#name` literal drift
  3. plan Task 15 `add runtime to publish list` — runtime is private; correct fix is gate-cli-version on-disk RUNTIME_VERSION literal check (not publish list)
- **2 fixtures acceptance**: 4/4 dispatch-record-writer tests + 62/62 cli tests + 4/4 integration tests + 2/2 lockstep tests
- **G8 infinite-context** shipped (Phase A critical path)
- **LifecycleOwner closure invariant** unit + integration tested
- **ResourceBudgetGuard** rails in place (≤ 200MB / ≤ 5% CPU / ≤ 8 fan-out)

## Related

- [[runtime-detached-design-2026-08-10]] — spec mirror
- [[runtime-detached-24h-user-confirm-2026-08-10]] — user authorization
- [[phase-A-baseline-stub-2026-08-10]] — efficiency baseline ledger (still stub; real E2E measurement pending)