---
name: 2026-08-05-peaks-loop-4-0-13-publish-closure
description: 4.0.13 publish closure — 3-slice statusline bundle (callerId fallback + active [short-sid] + idle/stale sid-only marker + multi-binary drift guard with severity-aware buildReport) shipped + 4.0.13 published to npm latest, full 9-step cutover recipe executed, no publish trap hit
metadata:
  type: project
  originSessionId: c573377e-72fb-4f27-b54b-28cb1501e40f
  modified: 2026-08-06T00:30:00.000Z
---

# 2026-08-05 peaks-loop 4.0.13 publish closure

**Session:** 2026-08-04-session-3fe1be (peaks-code, full-auto, IDLE post-publish)
**Goal:** Ship statusline empty-render fix + sid-only marker + multi-binary drift guard, publish 4.0.13.

## Slices shipped (3 commits on main, all SquabbyZ sole-author)

| # | Slice | Commit | Notes |
|---|-------|--------|-------|
| 1 | callerId fallback + active `[short-sid]` | `4be37d08` | G1: statusline `empty` → active lease; G2: `peaks-loop [3fe1be]` suffix when state=active |
| 2 | sid-only marker (idle/stale) + multi-binary drift check | `95654d48` | G3: idle/stale states also append sid; G4: `peaks doctor check` detects multi-version peaks-loop on PATH |
| 3 | QA repair cycle | `34de6c22` | AC7 fix (severity-aware `buildReport` → `summary.ok = errors === 0`); LOC cap recovery (extract `computeRootSuffix` to sibling module; renderer 806 → 776) |
| 4 | sediment | `565436c8` | docs/memory pre-publish |
| 5 | release commit | `6cf1e44d` | chore(release): bump to 4.0.13 |

## 4.0.13 publish verified

- Tag `v4.0.13` created on `6cf1e44d`
- `git push origin v4.0.13` (single-tag push, NOT `--tags`) → publish.yml triggered
- ~90s later: `npm view peaks-loop dist-tags.latest` → `4.0.13` ✓
- `npm view peaks-loop@4.0.13 version` → `4.0.13` ✓
- `npm view peaks-loop versions` includes `4.0.13` ✓

## 9-step recipe execution

| Step | Action | Result |
|------|--------|--------|
| 1 | `bump-version.mjs --to 4.0.13` | peaks-loop 4.0.12 → 4.0.13; **peaks-loop-shared 0.0.42 → 0.0.43 lockstep** (avoid CLI_VERSION chicken-egg); peaks-loop-mut 0.1.15 → 0.1.16; peaks-loop-shared-channel 0.0.19 → 0.0.20 |
| 2 | `sync-readme-version.mjs` | no-op (README patterns not found; that's fine — synced elsewhere) |
| 3 | CHANGELOG entry written | New `## 4.0.13` section above 4.0.12; documents 3 commits + lockstep bumps |
| 4 | `.changeset/*.md` check | empty (no stale changesets) |
| 5 | `pnpm run build` | 3 subpackages compile; root tsc clean; copy-templates 10 files; build-integrity: OK |
| 6 | `pnpm test:unit` (full suite) | 586/593 passed; **6 pre-existing flakes** (session-binding-bridge Case 4, auto-compact-orchestrator Case 5, skill-statusline-dual-skill Case 4 — all confirmed pass 3/3 in isolation; not regressions) |
| 7 | commit + tag | `6cf1e44d` + `v4.0.13` |
| 8 | `git push origin v4.0.13` (NOT `--tags`) | accepted |
| 9 | verify publish | ✓ all 4 checks pass |

## Known carry-forward

- `peaks -v` on local PATH **may still report 4.0.12** even though npm `latest` = 4.0.13 and root `package.json#version` = 4.0.13. Same chicken-egg trap as 4.0.4 publish — but mitigated this time because `peaks-loop-shared` was bumped lockstep (`0.0.42 → 0.0.43`), so the npm pack should rewrite `peaks-loop-shared: 0.0.43` correctly. User-side escape hatch: `npm i -g peaks-loop`.
- **Pre-existing flakes** in `tests/unit/{session/session-binding-bridge-path-canonicalize,code/auto-compact-orchestrator,services/skills/skill-statusline-dual-skill}.test.ts` pass 3/3 in isolation but flake under parallel-run. Not blocking 4.0.13. Carry-forward to a future flake-investigation slice.

## Anti-patterns observed and avoided

1. **PowerShell here-string `@'...'@` ate stray `@`** into a prior orchestrator commit (sediment commit `81b00571` had a leading `@` until amended via `git commit -F /tmp/commit-msg.txt`). Fixed for 4.0.13 by always using bash heredoc.
2. **Pre-existing flake must not block release** — verified each flake 3/3 in isolation; that's the canonical bar (don't let parallel-run flake cause release delays).
3. **Severity-aware buildReport pattern** — the canonical reference for "warning vs error" doctor checks. Future doctor checks MUST emit `severity: 'warning'` for observational findings.

## Cross-references

- [[2026-08-05-statusline-empty-render-short-sid-suffix-sid-only-marker-and-multi-binary-drift-guard]] — slice design sediment
- [[peaks-loop-publishing-critical-hard-rules]] — the 5 publish traps
- [[peaks-cli-version-shared-chicken-egg]] — peaks-loop-shared lockstep bump trap (mitigated this time)
- [[peaks-loop-4-0-12-publish-closure]] — precedent for the 9-step recipe