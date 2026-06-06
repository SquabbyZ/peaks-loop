# QA Request 003-2026-06-06-session-layout-canonicalize

- session: 2026-06-06-session-c4c553
- change-id: 003-2026-06-06-session-layout-canonicalize
- linked-rd:  .peaks/003-2026-06-06-session-layout-canonicalize/rd/requests/001-003-2026-06-06-session-layout-canonicalize.md
- linked-prd: none (refactor; user-confirmed design)
- type: refactor

## Red-line boundary check

- in-scope changes seen in the diff (match PRD + RD scope)
- out-of-scope changes flagged (any extra file, route, mock, fixture, behavior)
- verdict: clean | boundary-violation

## OpenSpec exit gate (when openspec/ exists)

- not applicable — this is a refactor, not a feature delivery

## Acceptance checks

- A. Data migration: 4 sessions moved to `_runtime/`, top-level has 1 (current binding) — pass
- B. Symlink layer / EPERM manifest: manifest has 3 active + 17 retrospective entries — pass
- C. Workspace init invariant (on fresh tmp dir): session dir at `_runtime/<sid>/` only — pass
- D. Presence reuse invariant: 3 calls → 0 new session dirs — pass
- E. Reconcile regeneration: `data.changeLinks.manifestWritten: true` — pass
- F. Test results: 1913 pass + 28 pre-existing Windows failures in allow-list — pass
- G. CLI command preservation: all commands preserve JSON shape — pass
- H. Type check: `pnpm typecheck` exit code 0 — pass

## Mandatory validation gates

- unit tests: `pnpm vitest run` — 1913 pass / 28 fail (all pre-existing Windows allow-list) / 9 skip / 1950 total
- API validation (when applicable): N/A (CLI-only)
- browser E2E (when frontend): N/A
- browser-error feedback loop: N/A
- security check: `qa/security-findings.md` — 0 findings (re-verified RD's `rd/security-review.md` against live repo)
- performance check: `qa/performance-findings.md` — no regression > 10% (re-verified RD's `rd/perf-baseline.md` against live repo; wall-clock dominated by tsx boot, not by slice code)
- validation report path: `qa/test-reports/003-2026-06-06-session-layout-canonicalize.md`

## Regression matrix

- peaks workspace init — pass (canonical-only invariant verified on fresh tmp dir)
- peaks workspace migrate --to-runtime — pass (idempotent, skipped-already-canonical)
- peaks workspace reconcile — pass (manifest written, EPERM fallback engaged)
- peaks skill presence:set — pass (3 calls reused bound session)
- peaks skill doctor — pass (38 checks, all OK)
- peaks session list — pass (4 sessions, JSON shape preserved)
- peaks session info — pass (JSON shape preserved)
- peaks sc status — pass (JSON shape preserved)
- peaks sc validate (against historical rid) — pass (canonical-vs-legacy path resolver working)
- peaks workflow verify-pipeline — pass (returns structured rdPhase/qaPhase gates)
- peaks doctor — pass (`skill-presence:workspace` now reads from `_runtime/` per F1 spec)
- peaks scan libraries — pass (12 packages, byScope preserved)
- peaks scan archetype — pass (frontendOnly, srcFileCount: 138)
- pnpm typecheck — pass (exit code 0)

## Browser evidence

N/A — refactor with no frontend surface changes.

## Verdict

- overall: pass

## Status

- created: 2026-06-06T02:51:00.000Z
- last update: 2026-06-06T02:58:00.000Z
- state: qa-handoff
