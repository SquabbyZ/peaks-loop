---
name: runtime-detached-phase-C-ship-pending-2026-08-11
description: Phase C ship PENDING CI verification — reviewer fan-out --mode detached documented; tag v4.0.21 pushed
metadata:
  type: project
  createdAt: 2026-08-11
---

# Phase C ship — PENDING CI verification

## State

- **Local commit**: chore(release) bump 4.0.20 → 4.0.21
- **Git tag `v4.0.21`**: pushed to origin/main
- **GitHub Actions publish.yml**: running (OIDC Trusted Publishing)
- **Phase C code**: 2/2 tasks complete

## Phase C summary

- peaks-rd/SKILL.md: Reviewer fan-out detached mode paragraph (Phase C)
- peaks-qa/SKILL.md: Sub-role detached mode paragraph (Phase C)
- Both files: user-machine-only (NOT git-tracked; peaks-rd/qa are
  sibling skills, not in peaks-loop monorepo)
- peaks audit red-lines: no new fail from this prose

## What next session should do

Same as Phase A/B:
1. `git pull` to sync origin/main
2. Check GitHub Actions: https://github.com/SquabbyZ/peaks-loop/actions/runs/{latest}
3. Verify: `npm view peaks-loop dist-tags.latest` + curl registry checks
4. On success: rename this file to `2026-08-11-runtime-detached-phase-C-shipped.md`
5. On failure: do NOT proceed to Phase D until Phase C ship is confirmed

## Related

- [[runtime-detached-design-2026-08-10]]
- [[runtime-detached-phase-A-ship-pending-2026-08-10]]
- [[runtime-detached-phase-B-ship-pending-2026-08-10]]
- [[runtime-detached-24h-user-confirm-2026-08-10]]