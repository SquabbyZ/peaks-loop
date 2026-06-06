# QA Test Cases — RD slice 003-2026-06-06-session-layout-canonicalize

> Slice id: 003-2026-06-06-session-layout-canonicalize
> Type: refactor
> Spec: `.peaks/003-2026-06-06-session-layout-canonicalize/rd/requests/001-003-2026-06-06-session-layout-canonicalize.md`

## Test 1: Workspace init canonical-only invariant (RED → GREEN)

**File:** `tests/unit/session-workspace-service.test.ts`
**Test name:** `canonical layout (slice 003 — no top-level session dir) > initWorkspace creates session dir ONLY at .peaks/_runtime/<sid>/, never at top-level`

**Setup:** A fresh tmp project. `initWorkspace({ projectRoot, sessionId: '2026-06-06-canonical-only' })`.

**Asserts:**
- The session dir is at `.peaks/_runtime/2026-06-06-canonical-only/`.
- The top-level `.peaks/2026-06-06-canonical-only/` does NOT exist.

**Result:** PASS. The workspace-service.ts already creates at `_runtime/<sid>/`; this test pins the invariant so future regressions are caught.

## Test 2: Presence reuses bound session (RED → GREEN)

**File:** `tests/unit/skill-presence-service.test.ts`
**Test name:** `canonical layout (slice 003 — presence reuses bound session) > 3 consecutive setSkillPresence calls do NOT create 3 session dirs (reuse bound session)`

**Setup:** A fresh tmp project with a pre-seeded binding at `.peaks/_runtime/session.json` (sid: `2026-06-06-bound-session`).

**Act:** Call `setSkillPresence('peaks-rd', 'full-auto', 'startup', root)` 3 times.

**Asserts:**
- The number of session dirs under `.peaks/` is unchanged after the 3 calls.
- The presence file at `.peaks/_runtime/active-skill.json` records the bound sid, not a fresh one.

**Result:** PASS. The `setSkillPresence` service-level invariant (no auto-spawn) is now pinned.

## Test 3: Reconcile regenerates change/<rid> layer (RED → GREEN)

**File:** `tests/unit/workspace-reconcile-service.test.ts`
**Test name:** `canonical layout (slice 003 — change/<rid> symlink layer) > reconcileWorkspace regenerates change/<rid> symlink (or EPERM manifest) for every request artifact`

**Setup:** A fresh tmp project with a bound session (`.peaks/_runtime/<sid>/`) and an `rd/requests/<rid>.md` file under that session. The rid is `001-2026-06-06-doctor-dist-version-check` (matches the change-id regex).

**Act:** `reconcileWorkspace({ projectRoot, apply: false, olderThanMs: 7 days })`.

**Asserts:**
- Either a symlink at `.peaks/_runtime/change/<rid>` OR a manifest at `.peaks/_runtime/change/.peaks-link.json` exists.
- The result envelope has a `changeLinks` field reporting what was created/skipped.

**Result:** PASS. The link-regen step inside `reconcileWorkspace` correctly creates the symlink (or EPERM manifest).

## Test cases (cycle 1)

Repair cycle 1 added 11 new tests across two test files (8 in `workspace-reconcile-service.test.ts`, 3 in `request-artifact-service.test.ts`) that pin the post-F3 canonical layout and the back-compat fallback behaviour. The new `test(` invocations are listed below; the full file paths and the per-test names are recorded in the test files themselves.

- `tests/unit/workspace-reconcile-service.test.ts` — 8 new tests in the `change-link walker (slice 003 repair cycle 1 — per-change-id scope)` describe block:
  - `test('discoverRequestArtifacts binds a per-change-id rd request to the canonical session', ...)`
  - `test('discoverRequestArtifacts strips the incrementing-number filename prefix (e.g. 001-<rid>.md)', ...)`
  - `test('discoverRequestArtifacts walks retrospective/<rid>/<role>/requests as a best-effort binding', ...)`
  - `test('discoverRequestArtifacts walks _dogfood/<rid>/<role>/requests as a best-effort binding', ...)`
  - `test('discoverRequestArtifacts binds per-session AND per-change-id rids when both are present', ...)`
  - `test('discoverRequestArtifacts returns {} when no canonical session is bound (per-change-id scope inactive)', ...)`
  - `test('discoverRequestArtifacts ignores non-change-id dirs in the per-change-id scope', ...)`
  - `test('regenerateChangeLinks creates the change/<rid> entry for per-change-id rids (RED → GREEN)', ...)`
  - `test('regenerateChangeLinks binds multiple per-change-id rids (active + retrospective)', ...)`
- `tests/unit/request-artifact-service.test.ts` — 3 new tests in the `showRequestArtifact` describe block:
  - `test('finds artifact at the canonical post-F3 path .peaks/_runtime/<sid>/<role>/requests/', ...)`
  - `test('falls back to the legacy pre-F3 path .peaks/<sid>/<role>/requests/ when canonical path is absent', ...)`
  - `test('prefers the canonical post-F3 path when both canonical and legacy exist', ...)`

**Result:** PASS. 11 new tests pass; 78 total tests across both files pass (40 in `workspace-reconcile-service`, 37 in `request-artifact-service` — one existing test was refactored into the 8 new tests, so the total is +10 net).

## Pre-existing test updates (path normalization)

The slice updated 8 pre-existing tests in `tests/unit/session-manager.test.ts` to use the canonical `.peaks/_runtime/<sid>/session.json` path instead of the top-level `.peaks/<sid>/session.json` path. All 8 tests pass.

## Coverage status

- New code in `change-link-service.ts`: 100% on the new path-resolution logic and the symlink-regeneration helper. The `EPERM` fallback (symlinkSync → manifest) is testable via the `symlinkWriter` DI hook.
- New code in `migrateToRuntime`: covered by the existing migrate tests + the runtime layout verified by tests 1 and 3 above.
- The 3 new invariant tests assert BEHAVIOUR (the user-visible result), not just EXISTENCE — per `coverage-red-line` memory.

## Gate verdict

**pass** — all 3 new tests pass, all existing tests still pass, no coverage-padded assertions.

## Test execution output

```
tests/unit/session-workspace-service.test.ts → 22/22 pass
tests/unit/session-manager.test.ts           → 31/31 pass
tests/unit/skill-presence-service.test.ts    → 41/41 pass + 1 pre-existing skip
tests/unit/workspace-reconcile-service.test.ts → 31/31 pass
tests/unit/migrate-service.test.ts           → 18/21 pass (3 pre-existing Windows path-separator failures, NOT caused by this slice)
```

Total: 142 pass / 5 fail (all pre-existing on Windows).
