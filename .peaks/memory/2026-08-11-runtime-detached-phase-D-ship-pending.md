---
name: runtime-detached-phase-D-ship-pending-2026-08-11
description: Phase D ship PENDING CI verification — peaks doctor invoke --from-code shipped; tag v4.0.22 pushed
metadata:
  type: project
  createdAt: 2026-08-11
---

# Phase D ship — PENDING CI verification

## State

- **Local commit `abc35add`**: feat(cli) peaks doctor invoke --from-code
- **Local commit `3d0c5eef`**: chore(release) bump 4.0.21 → 4.0.22
- **Local commit `dce31a14`**: docs(peaks-rd|peaks-qa) reviewer / sub-role --mode detached (Phase C correction)
- **Git tag `v4.0.22`**: pushed to origin/main
- **GitHub Actions publish.yml**: running (OIDC Trusted Publishing)
- **Phase D code**: 2/2 tasks complete

## Phase D summary

- peaks doctor invoke --from-code CLI handler (stub: writes
  proposal.md; real LLM analysis delegated to peaks-doctor sibling)
- Phase C correction: skills/bee/peaks-{rd,qa}/SKILL.md reviewer /
  sub-role --mode detached paragraphs committed to repo

## What next session should do

Same as A/B/C:
1. `git pull`
2. Check GitHub Actions: https://github.com/SquabbyZ/peaks-loop/actions/runs/{latest}
3. Verify: `npm view peaks-loop dist-tags.latest` + curl registry checks
4. On success: rename this file to `…shipped.md`
5. On failure: do NOT proceed to Phase E until Phase D ship is confirmed

## Related

- [[runtime-detached-design-2026-08-10]]
- [[runtime-detached-phase-A-ship-pending-2026-08-10]]
- [[runtime-detached-phase-B-ship-pending-2026-08-10]]
- [[runtime-detached-phase-C-ship-pending-2026-08-11]]
- [[runtime-detached-24h-user-confirm-2026-08-10]]