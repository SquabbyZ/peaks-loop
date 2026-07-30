---
"peaks-loop": major
"peaks-loop-shared": minor
---

# 4.0.0 (2026-07-30) — first stable GA cutover

This is the **first** 4.0.0 published to npm. The previous
`latest` was 4.0.0-beta.36 (a pre-release line); this commit
replaces it. Verified against `https://registry.npmjs.org/peaks-loop`
on 2026-07-30.

## What's in the GA

- 5 super-command CLI surface: `peaks code / audit / doctor / openspec / release / release-pack`
- `peaks job karpathy-cost-check` (new in this commit) — auto-downgrade a `'block'` karpathy-reviewer gateAction to `'warn'` when `costRatio > 10`. 24h-mode is the override.
- `peaks compact history` / `peaks statusline compact` (new in this commit) — human- and LLM-readable visibility into the auto-compact pipeline.
- `auto-compact-orchestrator` now appends every dispatch to `.peaks/_runtime/<sessionId>/compact-history.jsonl` for audit + dashboard.
- Test suite: 219 cases across 4 packages (`peaks-loop` / `peaks-loop-mut` / `peaks-loop-shared-channel` / `peaks-loop-shared`), full suite `pnpm test:full` runs in ~67s on Windows. The legacy 559-file unit suite was deleted in commit `f17aa377` and rebuilt from the production contract (see `.peaks/memory/2026-07-30-test-rebuild-epic-sediment.md`).
- Stale workflows `unpublish-4-0-0-and-4-0-2.yml` and `dist-tag-move.yml` removed (no longer applicable — npm registry confirms neither 4.0.0 nor 4.0.2 were ever live).

## Breaking change from 4.0.0-beta.N

- The `bump` step in `publish.yml` is now a no-op when no `.changeset/*.md` is staged; the maintainer manually pins the manifest versions for the GA cutover. Future patch releases use the changesets flow as before.

## Migration notes

- `peaks-loop-shared` jumps from `0.0.26` to `0.1.0` to match the GA cutover. Internal consumers that pinned the exact `0.0.x` should update to `^0.1.0` or `^4.0.0`.
- The 73 pre-4.0.0 leaf commands are still absent (per the 2026-07-28 GA release notes); users on 3.x should read `docs/cli-migration-4-0-0.md`.

## Verification

- `pnpm -s build` → exit 0
- `pnpm test:full` → 4 packages / 219 cases / all green
- `npm view peaks-loop@4.0.0` → returns this release after publish
- `git tag v4.0.0` → triggers `publish.yml` via OIDC trusted publishing
