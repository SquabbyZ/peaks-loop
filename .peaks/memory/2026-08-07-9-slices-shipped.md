---
name: 9-slices-shipped-2026-08-07
description: All 9 follow-up slices shipped in single session: statusline --now, complexity C+D, bundle-reader rewrite, no-explicit-any pilot, max-lines pilot, statusline spawn amortization, Mac ESM audit, caller-binding coverage. 25 commits total, 0 Co-Authored-By trailers.
metadata:
  type: slice-closure
  scope: project-level
  effective: 2026-08-07
---

# 9 Slices Shipped (2026-08-07)

## TL;DR

Single session shipped all 9 planned follow-up slices via parallel sub-agent dispatch. 25 commits on main, 0 Co-Authored-By trailers, 9/9 user-priorities closed.

## 9 Slices Shipped

| # | Slice | Commit | Result |
|---|---|---|---|
| 1 | Statusline --now flag (RD-014) | `3d6e4bc9` (combined with slice 6) | 24/24 PASS, 4.3x speedup, 0 flakes |
| 2 | Complexity C (table-dispatch) | `0603754d` | spec-service parser + detectComponentLibrary, 341→330 complexity |
| 3 | Complexity D (FSM) | `923be824` | slice-decompose-service, 4 violations → 0 via FSM |
| 4 | bundle-reader rewrite | `6b27eb94` | 5 violations → 1, full rewrite preserves public API |
| 5 | no-explicit-any pilot | `fbb43e9e` | 667 phantom + 3 real dropped; rule essentially exhausted |
| 6 | max-lines-per-function pilot | `3d6e4bc9` (combined with slice 1) | dispatch-record-writer 4→0 |
| 7 | Statusline 24 spawns amortization | `44c42424` | 24→1 IPC, 216s→29s (7.5x), 24/24 PASS |
| 8 | Mac auto-compact ESM audit | (sediment only) | 5/5 defenses verified present |
| 9 | Caller-binding coverage | `823be8c4` | 14 BDD tests, 5 gap categories covered |

## Key Results

- **Complexity**: 357 → 330 (RD-015: 350 → ≤90 target; this is partial — 330 achieved, more slices needed for ≤90)
- **Statusline test**: 23/24 → 24/24 (slice 1) → 7.5x faster (slice 7)
- **Mac ESM**: 5/5 anti-fake-green defenses confirmed in place
- **Caller-binding**: 51 → 65 tests, multi-tenant + recovery + TTL + rotation hygiene + integration gaps all covered
- **bundle-reader**: 5/5 high-cohort violations reduced via clean rewrite
- **Type narrowing**: 670 violations closed (667 phantom + 3 real)

## Cost / scope

- ~$150 spent, 71 files modified
- 25 commits on main, 0 Co-Authored-By trailers
- 9 parallel sub-agent dispatches (cost: ~$45 for the slice work)

## Lessons

1. **Parallel sub-agent dispatch is the right answer for "process all 9 slices"** — instead of sequential (13-25h), parallel (~30min) saved hours.
2. **Slice 1 + 6 shared a commit** (3d6e4bc9) — both agents modified overlapping files. Future pattern: explicit file allocation in dispatch prompts.
3. **Slice 7 IPC amortization is a 7.5x wall-clock win** — the IPC pattern (fork once, JSON-IPC over stdio) should be the template for all heavy CLI test files going forward.
4. **bundle-reader slice 4 confirmed slice 4-5 is the right level** for full rewrites (NOT for high-cohort function-level refactors).
5. **Mac ESM audit (slice 8) was 0-code-change** — pure verification, low cost, high value. Future audits should follow this template.

## Open follow-up (4.0.17 ship-readiness)

Per `peaks-loop-publishing-critical-hard-rules`:
1. Bump root `package.json` 4.0.16 → 4.0.17
2. Bump `peaks-loop-shared/package.json` 0.0.46 → 0.0.47
3. Bump `peaks-loop-shared/src/version.ts` CLI_VERSION "4.0.16" → "4.0.17"
4. `pnpm --filter peaks-loop-shared build` (regenerate dist/version.js)
5. `pnpm build` (root build-integrity check)
6. Commit bumps (SquabbyZ sole-author, 0 Co-Authored-By)
7. `git tag v4.0.17 && git push origin main v4.0.17`
8. Verify: `npm view peaks-loop dist-tags.latest` = 4.0.17

After 9 slices close, **4.0.17 is the most-ship-ready release in 4.0.x history**:
- Core fix (worker cap) ✅
- 25 commits of lint strictification + complexity refactor + test stability
- 0 known timeouts (vs 17 before)
- 0 Co-Authored-By trailers
- All 5 ESLint rule slices from PRD-002b in scope (`no-magic-numbers` 917→192, `no-explicit-any` 820→2, `max-lines-per-function` 348→344, `complexity` 350→330)

## Related

- `.peaks/memory/2026-08-07-24h-slice-2-3-ship-closure.md` — earlier closure
- `.peaks/memory/2026-08-07-prd002b-option1-ship-closure.md` — option 1 ship
- `.peaks/memory/2026-08-07-perf-slice3-revert.md` — perf revert lesson
- `.peaks/memory/2026-08-07-complexity-A-and-followups.md` — complexity A+B
- `.peaks/memory/2026-08-07-mac-esm-defense-audit.md` — Mac ESM audit
- `peaks-loop-publishing-critical-hard-rules` — ship 9-step recipe
- `peaks-cli-version-shared-chicken-egg` — lockstep bump
