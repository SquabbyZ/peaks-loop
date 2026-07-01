---
name: v2-13-1-verdict-aggregator
description: peaks-loop v2.13.1 ship state on 2026-06-27. Verdict reasoning layer: MUT_REPORT prereq + aggregateVerdict() service + micro-cycle reasoning section. 90/90 tests pass, tsc 0 errors, 5 AC all green. Carry-forward for v2.14 envelope unification.
metadata:
  type: project
---

**v2.13.1 ship state (Windows session, 2026-06-27):**
- RID: 2026-06-27-verdict-aggregator
- Branch: main
- Working tree: clean (after git commit)
- Tests: **90/90 PASS** across 8 test files (5 new + 1 updated + 2 updated), duration 1.27s
- tsc --noEmit: 0 errors
- Final review: peaks-qa sub-agent verdict=pass, 5 AC all green, 0 regression findings

**v2.13.1 footprint (5 files modified + 4 files added):**
- `src/services/verdict/verdict-aggregator.ts` (NEW, 223 lines) — pure aggregateVerdict() + locally-defined KarpathyEnvelope / MutEnvelope / QaEnvelope types
- `src/services/artifacts/artifact-prerequisites.ts` (+32 lines) — MUT_REPORT constant + FEATURE/BUGFIX wiring
- `skills/peaks-solo/references/micro-cycle.md` (+91 lines) — ## Verdict reasoning (v2.13.1) section
- `tests/unit/artifact-prerequisites.test.ts` (+25 lines) — seeded mut-report.json in 3 pass-path tests
- `tests/unit/artifact-prerequisites-typed.test.ts` (+20 lines) — same
- `tests/unit/artifact-prerequisites/mut-report-prereq.test.ts` (NEW, 4 cases)
- `tests/unit/services/verdict/verdict-aggregator.test.ts` (NEW, 13 cases)
- `tests/unit/skills/solo/micro-cycle-verdict-reasoning.test.ts` (NEW, 4 cases)
- `CHANGELOG.md` (+75 lines) — full v2.13.1 release notes
- `src/shared/version.ts` (1 line: 2.13.0 → 2.13.1)
- `package.json` (1 line: 2.13.0 → 2.13.1)

**Key architectural decisions (locked):**
1. **Pure aggregator** — no I/O, no clock, no fs. v2.13.1 wires the result into micro-cycle.md as the "re-run reason" payload; v2.14 will wire it into a CLI subcommand.
2. **Hard precedence, no scoring** — `block > return-to-rd > warn > pass` via single `VERDICT_PRECEDENCE` array + `bucketOf()` helper. Karpathy §1 Simplicity First.
3. **All-empty → 'pass' 退化** — when no signals are present (e.g. pre-existing happy path that doesn't run audits), the aggregator returns 'pass' instead of 'block'. This preserves backward compatibility for slices that never had audit gating.
4. **Envelope heterogeneity preserved** — 5 envelopes still have 3 distinct shapes; v2.13.1 ships precedence aggregation. v2.14 should add `services/verdict/envelopes.ts` shared module with discriminated-union type and parser funcs.
5. **MUT_REPORT prereq is one-way** — it blocks `rd → qa-handoff` but does NOT touch `peaks-qa`'s internal `loadMutReport() === null → gate=skipped` path. Backward compatibility for qa-side consumers preserved.
6. **REFACTOR inherits via reference** — `REFACTOR_TABLE = FEATURE_TABLE` (line 312 of artifact-prerequisites.ts), so adding MUT_REPORT to FEATURE_TABLE automatically applies to REFACTOR. No duplicate wiring.
7. **6-step micro-cycle body byte-stable** — `git diff HEAD -- skills/peaks-solo/references/micro-cycle.md` shows only the new section is added; lines 1-222 unchanged. Karpathy §3 Surgical Changes honored.

**Carry-forward to v2.14:**
- **CLI surface for `aggregateVerdict()`** — add `peaks verdict aggregate --from-rid <rid>` that reads all 5 envelope artifacts and prints aggregated verdict + reasons
- **Envelope schema unification** — add `services/verdict/envelopes.ts` shared module with discriminated-union type and parser funcs; the 3 distinct envelope shapes collapse to 1
- **`prd/handoff.md` auto-regeneration** — make peaks-prd write the handoff on every `prd:handed-off` transition so AUDIT_REQUIRES_HANDOFF prereq doesn't require pre-existing handoff
- **MUT_REPORT prereq back-compat window** — current v2.13.1 hard-blocks feat/bugfix/refactor at `rd:qa-handoff`; consider a 1-minor-release soft-block window like the v2.12.0 audit back-compat (allow missing with warning → fail on 2.14.0)

**Why:** Why I should remember this: v2.13.1 is the third of three coordinated slices (v2.12.0 = audit independence, v2.13.0 = auto-compact, v2.13.1 = verdict reasoning) that together form peaks-solo's "decide + act + converge" loop. The user explicitly noted the gap: "现在有了审计独立的agent...但是没有结论或者依据应该怎么决策" — v2.13.1 fills that gap with a pure aggregator + 3-line micro-cycle reasoning surface. v2.14 is the natural follow-up for envelope unification + CLI surface.

**How to apply:** When resuming v2.14, read this memory FIRST, then `.peaks/memory/2026-06-22-plan-2-ship-state.md` (peaks-mut context) + `.peaks/memory/2026-06-27-v2-12-fanout-3way.md` (v2.12.0 audit context) + `.peaks/project-scan/audit-output-schema.md` (the 4 aggregation rules that the v2.13.1 aggregator already implements). The 5 envelope shapes in `src/services/verdict/verdict-aggregator.ts:38-66` are the unification target list.
