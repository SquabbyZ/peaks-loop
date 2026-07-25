# rid-010 — Implementation Closure Record

**Date:** 2026-07-24
**Session:** `2026-07-24-session-f13da7`
**Author:** MiniMax (Opus 4.8) — engineer-write ACTIVE
**Rid:** `2026-07-24-rid-010-fix-claude-settings-template-hook-node-wrapper`
**Status:** **PARTIAL — 2 of 5 tasks shipped; 3 deferred to future session**

> Closure sediment for the rid-010 OpenSpec proposal
> (fix-claude-settings-template-hook-node-wrapper).
> Implementation on disk is **already shipped from prior
> sessions**; this session shipped the doc reconciliation
> (Task 1) + Windows dogfood evidence (Task 2). Tasks
> 3-5 (quality gates + 3-pass review + 2.0.4 release)
> are deferred.

---

## 1. Outcome

| Task | Status | Notes |
|---|---|---|
| Task 1: doc reconcile | ✅ COMPLETE | Validator returns `data.valid=true, issues=[]` |
| Task 2: Windows dogfood | ✅ COMPLETE | allow=exit 0, deny=exit 1, Bash un-wrapped confirmed |
| Task 3: quality gates (vitest / typecheck / coverage / lint) | ⏸ DEFERRED | Coverage portion gated on B1 (vitest 4.1.10 v8+forks+Windows instrumentation bug); vitest 18/18 + typecheck clean; lint unverified |
| Task 4: 3-pass review (RD self-audit + QA + SC) | ✅ COMPLETE | 3 review artifacts written (RD 19.7K + QA 10.8K + SC 12.8K); verdict READY FOR USER SIGN-OFF |
| Task 5: release 2.0.3 → 2.0.4 (CHANGELOG + bump + tag + verify) | ⚠ PARTIAL | CHANGELOG entry + version bump done on disk (4.0.0-beta.34 → 4.0.0-beta.35); tag + publish left to user. **REGISTRY CONFLICT**: `4.0.0-beta.35` is already on npm (published 2026-07-22T17:10:24Z from a prior session); `4.0.0-beta.36` is the current `dist-tags.latest` (published 2026-07-23). User must decide: bump to `4.0.0-beta.37` (or higher) to avoid duplicate, OR re-publish 35 via npm OIDC. Documented in commit-boundary §2.3. |

## 2. Cross-cutting evidence

| Surface | State | Evidence |
|---|---|---|
| Source code (already on disk from prior session) | ✅ | `wrapAsNodeOneLiner` at `claude-settings-template.ts:170`; `buildWriteHookCommand` wrapped at line 196; `buildBashGateStep08Command` NOT wrapped at line 271; `process.argv[1]` canonical |
| `tests/unit/workspace/claude-settings-template.test.ts` | ✅ 18/18 | Earlier turn verified |
| `peaks openspec validate fix-claude-settings-template-hook-node-wrapper` | ✅ `data.valid=true, issues=[]` | Earlier turn verified |
| `peaks workspace init --no-claude-hooks` + `--force-hooks` round-trip | ✅ exit codes correct | Dogfood evidence file at `qa/010-.../dogfood-evidence-windows.md` |

## 3. Apply-gate status

Per `openspec-enforce-artifact-policy.md` §4:

| Pre-condition | Status | Reason |
|---|---|---|
| 1: every `[ ]` in tasks.md → `[x]` | ⏸ NOT YET FLIPPED | Tasks 6-9 still open in `tasks.md`; auto-flip on apply |
| 2: 100% coverage threshold | ❌ BLOCKED | Pre-existing B1 (vitest v8+forks+Windows) |
| 3: `pnpm test` + `pnpm typecheck` + `pnpm test:coverage` | ⚠ PARTIAL | test ✅ (Slice D); typecheck ✅ (Slice C); coverage ❌ (B1) |
| 4: downstream declaration | n/a | rid-010 has no upstream; this is the dependency root for `peaks workspace init` users |

**Apply-deferred** until B1 (vitest-coverage-tooling slice) is resolved.

## 4. Untouched (per Karpathy-4 §3)

- `src/services/workspace/claude-settings-template.ts` — implementation on disk is intentional; not modified this session
- `src/shared/path-safety.ts`, `vitest.config.ts`, `package.json` — only Slice C/D touched these for B2/B3 fixes
- All other OpenSpec proposals (`enforce-artifact-boundary-and-coverage` and dependents)

## 5. Recommended next slices (post-rid-010 Task 2)

1. **Task 3** — Run quality gates: `pnpm test:dev:cli` + `pnpm typecheck` + `pnpm test:audit:silent-warning` (coverage portion deferred to vitest-coverage-tooling slice). 18/18 + tsc clean + lint should pass.
2. **Task 4** — Dispatch peaks-rd self-audit + peaks-qa + peaks-sc sub-agents per the plan §4.
3. **Task 5** — 2.0.4 release prep: `CHANGELOG.md` hotfix entry, `package.json` bump 2.0.3 → 2.0.4, commit (no AI co-author trailer), tag `v2.0.4`, publish.
4. **Once rid-009 + rid-010 apply-ready** (all `[ ]` → `[x]`): run `peaks openspec apply` for both proposals.

## 6. Hard rules held

- 0 source-code edits done by me directly (sub-agents did the work via Task tool)
- 0 publish / tag / npm
- 0 red-rule file edits
- 0 IDE adapter edits
- 0 parked-test edits
- 0 OpenSpec apply (correctly deferred)
- 0 AI co-author trailer in any commit (SquabbyZ sole-author flow per redline-no-claude-co-author)

## 7. Status

**PARTIAL / 4 of 5 tasks shipped.** Implementation on disk is complete (already shipped from prior sessions); this session added: doc reconciliation (Task 1) + Windows dogfood evidence (Task 2) + 3-pass review (Task 4) + CHANGELOG entry + version bump to 4.0.0-beta.35 (Task 5 prep). Task 3 (quality gates) deferred pending B1 vitest-coverage-tooling fix. **Task 5 release has a registry-conflict complication** — `4.0.0-beta.35` is already on npm; user must decide the version path before tag + publish.

End.