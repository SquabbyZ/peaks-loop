---
name: v2-14-0-anti-fake-green-hardening
description: peaks-cli v2.14.0 ship state on 2026-06-28 — anti-fake-green hardening with 5 mechanical gates (G1 fixture-replay, G2 silent-warning lint, G3 prose-only ≤5%, G4 third-party reviewer, G5 race-detector). QA verdict pass 10/10 gates 25/25 ACs.
metadata:
  type: project
---

**v2.14.0 ship state (Windows session, 2026-06-28):**
- RID: 2026-06-28-anti-fake-green-hardening (session: 2026-06-28-session-75d5f0)
- Branch: main (peaks-cli ships on main, established v3.0 pattern)
- Tag: `v2.14.0` (full release — not beta)
- Range: 4 commits ahead of origin/main from v2.13.x ship baseline
- Working tree: 102 modified entries (79 staging + fixture/test scaffolding per diff)
- Tests: 4502 unit tests pass + 3 pre-existing failures NOT introduced (per QA report)
- QA verdict: pass (10/10 gates, 25/25 ACs)
- Final review: Opus 4.8, ship-with-notes

**v2.14.0 footprint (5 gates shipped):**
- **G1 fixture-replay**: 32 real-shipment fixtures + `peaks fixture capture` CLI + `pnpm test:replay`
- **G2 silent-warning**: TS-AST lint detector + 142 baseline grace markers + `pnpm lint:silent-warning`
- **G3 prose-only ≤5%**: 89 → 6 promote enforcers (prose ratio 60.1% → 0%) + `pnpm audit:prose-ratio`
- **G4 third-party reviewer**: `skills/peaks-reviewer/` + `~/.peaks/config.json.reviewer` schema + `THIRD_PARTY_REVIEW` prereq (soft-warn v2.14.0, hard-fail v2.15.0)
- **G5 race-detector**: 4 fuzz-hardened modules + fixed `share-commands` LWW flake + `pnpm test:race` (`--repeat=20`)

**5 RD sub-agent contracts landed:**
- Slice A.1 (G1 fixture-replay)
- Slice A.2 (G2 silent-warning)
- Slice A.3 (G5 race-detector)
- Slice B   (G4 third-party reviewer)
- Slice C   (G3 prose-only ≤5%)

**1 RD micro-cycle (meta-level proof of gate effectiveness):**
- G2 lint caught silent catch in `reviewer-service.ts:153` — the gate itself caught the regression while in-flight, before merge. This is meta-level evidence that the mechanical gates actually fire.

**Known limitations carried forward (NOT guarantees per PRD NG5):**
1. Self-dogfood blind spots — testing ourselves cannot catch all of our own blind spots
2. 5-line mechanical defense reduces probability of undetected regressions but does NOT eliminate them
3. Cross-platform `prepublish-build.mjs` still partial (Windows `cmd.exe` spawnSync issue observed — `spawnSync C:\Windows\system32\cmd.exe ENOENT`); mitigated by running `pnpm run build` directly
4. (Carried from PRD NG1) `peaks` solo mode still relies on LLM verdict synthesis; gates can only verify mechanical invariants

**Why this ship matters:**
- v2.13.x added reasoning layer (multi-signal convergence) but still trusted itself
- v2.14.0 inverts the trust assumption: every green-light must pass through a mechanical gate
- 5 gates form a 5-line defense-in-depth against fake-green: replay fidelity (G1) + silent failure (G2) + prose rationalization (G3) + external scrutiny (G4) + race correctness (G5)
- Each gate fires on a different failure mode, so the union is strictly stronger than any single gate

**How to apply (carry-forward to v2.15.0):**
1. **G4 escalation**: `THIRD_PARTY_REVIEW` is soft-warn in v2.14.0; must be hard-fail in v2.15.0
2. **Cross-platform prepublish**: fix `scripts/prepublish-build.mjs` to use `shell: true` or cross-platform spawner (Windows-specific cmd.exe path issue)
3. **G3 baseline hardening**: prose ratio currently 0%; add new files must maintain ≤5% via the enforcer
4. **G1 fixture refresh cadence**: real-shipment fixtures captured from prod telemetry — refresh quarterly to catch new regression shapes
5. **Karpathy §4 Goal-Driven Execution**: every release territory commit must run all 5 gates; the gate suite itself is the contract

**Pre-commit gate results (this release):**
- `pnpm tsc -p tsconfig.json --noEmit` — exit 0
- `pnpm test:replay` (G1) — 23/23 pass
- `pnpm lint:silent-warning` (G2) — clean (390 files scanned, 0 anti-patterns)
- `pnpm test:race` (G5) — 57/57 pass across 4 fuzzed modules
- `pnpm run build` — exit 0 (dist/ produced)

**Files in release territory:**
- `CHANGELOG.md`, `package.json`, `src/shared/version.ts` (release bump)
- `src/services/fixture/`, `src/services/reviewer/` (NEW)
- `src/services/audit/enforcers/`, `src/services/audit/prose-ratio-calculator.ts`, `src/services/audit/static-audit-service.ts` (NEW)
- `scripts/lint/`, `scripts/fixture-capture.mjs` (NEW)
- `schemas/` (NEW replay-fixture + reviewer-envelope schemas)
- `skills/peaks-reviewer/` (NEW skill)
- `src/cli/commands/reviewer-commands.ts`, `src/cli/commands/audit-commands.ts`, `src/cli/program.ts`, `src/services/artifacts/artifact-prerequisites.ts`, `vitest.config.ts` (MODIFIED)
- `tests/unit/replay/`, `tests/unit/lint/`, `tests/unit/reviewer/`, `tests/unit/audit/` (NEW test suites)