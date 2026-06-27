---
name: v2-13-2-verdict-aggregator-fixes
description: peaks-cli v2.13.2 ship state on 2026-06-27. Verdict aggregator BLOCKER bug fix + CLI surface (peaks verdict aggregate) + envelope unification + prd/handoff.md auto-regen + MUT_REPORT soft-block window. 149/149 PRD-targeted tests pass, 7 AC all green. Carry-forward to v2.14.0 for hard-fail conversion.
metadata:
  type: project
---

**v2.13.2 ship state (Windows session, 2026-06-27):**
- RID: 2026-06-27-verdict-aggregator-fixes
- Branch: main
- Working tree: clean (after git commit)
- Tests: **149/149 PRD-targeted pass** (2.13.1 baseline 90 + 2.13.2 new 33 + 26 from indirect updates) = 149. Full unit suite: **4355/4356 pass + 17 skipped** (1 pre-existing `tokenizer.test.ts` flake confirmed on clean HEAD `571f92b` after stashing v2.13.2 changes; not introduced by v2.13.2)
- tsc --noEmit: 0 errors
- Final review: peaks-qa sub-agent verdict=pass, 7 AC all green, 1 pre-existing regressionFinding (tokenizer flake, not in scope)

**v2.13.2 footprint (8 files modified + 3 new src files + 4 new test files = 15 files, 8 already-staged + 7 unstaged at ship):**
- Modified: `src/services/verdict/verdict-aggregator.ts` (+79/-21) — `pushFix` key fix + `VerdictReason.sources` field
- Modified: `src/services/artifacts/artifact-prerequisites.ts` (+39/-5) — `MUT_REPORT.backCompat = true` + `warnings[]` field
- Modified: `src/cli/commands/request-commands.ts` (+28) — `prd:handed-off` auto-regen hook (1 branch)
- Modified: `src/cli/program.ts` (+3) — `registerVerdictAggregateCommands()` registration
- Modified: `tests/unit/services/verdict/verdict-aggregator.test.ts` (+78) — 3 new cross-source dedup cases
- Modified: `tests/unit/artifact-prerequisites.test.ts` (+5) + `tests/unit/artifact-prerequisites-typed.test.ts` (+10) + `tests/unit/artifact-prerequisites/mut-report-prereq.test.ts` (+8) — soft-block behavior
- NEW: `src/services/verdict/envelopes.ts` (200 lines) — discriminated union + 5 parsers + adapter
- NEW: `src/services/prd/handoff-auto-regen.ts` (~80 lines) — `autoRegenPrdHandoff()` helper
- NEW: `src/cli/commands/verdict-aggregate-command.ts` (168 lines) — `peaks verdict aggregate` subcommand
- NEW: `tests/unit/services/verdict/envelopes.test.ts` (7 cases)
- NEW: `tests/unit/cli/commands/verdict-aggregate-command.test.ts` (4 cases)
- NEW: `tests/unit/services/prd/handoff-auto-regen.test.ts` (4 cases)
- NEW: `tests/unit/artifact-prerequisites-v2-13-2-soft-block.test.ts` (2 cases)
- Release territory: CHANGELOG.md (+112 lines) + src/shared/version.ts (1 line) + package.json (1 line) + this memory file

**Key architectural decisions (locked):**

1. **BLOCKER bug fix** — `pushFix` key changed from `${source}|${file}|${line}|${hint}` to `${file}|${line}|${hint}` per audit-output-schema.md:73. The v2.13.1 implementation was wrong: it used `source` as a dedup dimension, which means `security-audit: a.ts:1: same` and `perf-audit: a.ts:1: same` were treated as different keys and never merged. The fix uses a per-key `Map<string, VerdictReason>` that appends sources to the existing entry on hit. v2.13.1 unit test had 13 cases that didn't exercise cross-source; the dogfood script immediately caught it.

2. **CLI surface pattern** — `peaks verdict aggregate --from-rid <rid> --sid <sid> --project <path> --json` is the v2.13.1 carry-forward goal #1 (was deferred to v2.14 in the v2.13.1 release notes). Now shipped. Returns `{ verdict, reasons, sources: { security|perf|karpathy|mut|qa: 'present'|'missing' } }` so callers can see which envelopes fed the aggregator.

3. **Envelope unification is type-level only** — `src/services/verdict/envelopes.ts` provides `AnyEnvelope` discriminated union + 5 parser funcs, but the on-disk envelope file contents are **unchanged** (each file remains in-file self-describing per the v2.12.0 schema policy). `aggregateVerdict()` signature is **unchanged** for backward compatibility; the parsers are additive. v2.14 can move envelope shapes to a shared schema if a unification pass lands.

4. **Handoff auto-regen is surgical** — only fires on `prd:handed-off` (1 of 12 transition paths). 11 other transitions are byte-stable. Karpathy §3 discipline: do NOT modify unrelated surfaces. Helper lives in `src/services/prd/handoff-auto-regen.ts` and reuses `sha256OfBody` from existing handoff-service.

5. **MUT_REPORT soft-block mirrors v2.12.0 audit pattern** — `backCompat: true` flag on the prereq constant, soft-block branch in `checkPrerequisites()`, warning code `mut-report-missing-deprecated-in-v2.14.0`. `passed: false` still throws (2.14.0 is the hard-fail target). This is the same 1-minor-release deprecation window pattern used in v2.12.0 for the v2.11.x→v2.12.0 audit transition.

6. **Dogfood was the only thing that caught the BLOCKER** — v2.13.1 shipped with 49/49 unit tests passing and tsc clean, yet had a real cross-source dedup bug. The 13-case aggregator test suite covered all 8 AC-2 behaviors (A-H) but did not exercise the cross-source scenario. The dogfood script that I wrote on 2026-06-27 immediately surfaced this on the first run (`expected 1 reason, got 2 reasons`). Lesson: unit tests pin the contract, but they only pin what they cover. Post-release dogfood with adversarial inputs is the only way to catch scenarios the spec didn't enumerate. This memory file is the canonical reference for "why post-release dogfood matters" in this codebase.

**Carry-forward to v2.14.0:**

1. **MUT_REPORT hard-fail** — convert soft-block to hard-fail. Remove the `backCompat: true` branch in `checkPrerequisites()`. Update the soft-block tests to expect throw-not-warn.
2. **Envelope schema unification (optional)** — if a unification pass is desired, move the 5 envelope shapes to a shared schema module. The discriminated union in `src/services/verdict/envelopes.ts` is the foundation; v2.14 can replace the parsers with a single schema-driven loader.
3. **`bin/peaks.js` dist refresh** — `pnpm run build` before `npm publish` so the published `bin/peaks.js` reflects the new `peaks verdict aggregate` subcommand. v2.13.2 smoke test used `./node_modules/.bin/tsx ./bin/peaks.js` because the dist is stale (Jun 13 timestamp).
4. **Pre-2.14.0 dogfood with adversarial cross-source scenarios** — write a 5+ case dogfood that deliberately feeds conflicting `(file,line,hint)` tuples from multiple sources to confirm the merge behavior under stress.

**Why:** Why I should remember this: v2.13.2 is the canonical example of "post-release dogfood catches what unit tests miss." The user's question "现在有了审计独立的agent...但是没有结论或者依据应该怎么决策" motivated v2.13.1; the v2.13.1 dogfood (in response to user's "先使用当前项目dogfood" instruction) caught a real bug; the user's "2.13.1 我发完了" + "把 2.14 要做的部分做到 2.13.1 版本里" combined into v2.13.2 which fixed the bug AND shipped the v2.14 carry-forward. The full loop is: question → implement → dogfood → fix bug → ship patch. The next slice should follow the same pattern.

**How to apply:** When resuming v2.14 work, read this memory FIRST, then `.peaks/memory/2026-06-27-v2-13-1-verdict-aggregator.md` (the bug context), then `.peaks/project-scan/audit-output-schema.md` (the dedup rule that the fix implements), then `src/services/verdict/verdict-aggregator.ts:131-180` (the fixed `pushFix` + `indexByKey` Map). The 3 v2.13.2 dedup test cases (I/J/K) at `tests/unit/services/verdict/verdict-aggregator.test.ts` are the canonical "this is the contract" reference for any future envelope schema work.
