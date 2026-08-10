---
name: runtime-detached-phase-B-ship-pending-2026-08-10
description: Phase B ship PENDING CI verification — CodexAdapter + CopilotAdapter + vendor-detect shipped; tag v4.0.20 pushed
metadata:
  type: project
  createdAt: 2026-08-10
---

# Phase B ship — PENDING CI verification

## State

- **Local commit `bc11e300`**: chore(release) bump 4.0.19 → 4.0.20
- **Local commit `dd19d77c`**: feat(cli) peaks vendor-detect (Task 20)
- **Git tag `v4.0.20`**: pushed to origin/main
- **GitHub Actions publish.yml**: running (OIDC Trusted Publishing)
- **Phase B code**: 4/4 tasks complete

## Phase B summary

- CodexAdapter (5KB max prompt)
- CopilotAdapter (6KB max prompt)
- peaks vendor-detect CLI
- defaultRegistry() now registers all 3 vendors end-to-end

## What next session should do

Same as Phase A:
1. `git pull` to sync origin/main
2. Check GitHub Actions: https://github.com/SquabbyZ/peaks-loop/actions/runs/{latest}
3. Verify: `npm view peaks-loop dist-tags.latest` + curl registry checks
4. On success: rename this file to `2026-08-10-runtime-detached-phase-B-shipped.md`
5. On failure: do NOT proceed to Phase C until Phase B ship is confirmed

## Related

- [[runtime-detached-design-2026-08-10]]
- [[runtime-detached-phase-A-ship-pending-2026-08-10]]
- [[runtime-detached-24h-user-confirm-2026-08-10]]