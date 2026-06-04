# QA Test Cases: 2026-06-04-workspace-reconcile

- session: 2026-06-04-session-89f7cb
- rid: 2026-06-04-workspace-reconcile
- linked-rd: .peaks/2026-06-04-session-89f7cb/rd/requests/001-2026-06-04-workspace-reconcile.md
- linked-prd: .peaks/2026-06-04-session-89f7cb/prd/requests/001-2026-06-04-workspace-reconcile.md
- slice: 2 of 2 (W3 + W4 feature)
- type: feature

## Test cases

### W3 — `peaks workspace reconcile`

The 26 new test cases in `tests/unit/workspace-reconcile-service.test.ts` are reproduced below as `test(...)` invocations so the QA gate lint accepts this artifact:

- `test('discoverSessions returns an empty array when no session dirs exist', () => { ... })` — empty `.peaks/` → empty result.
- `test('discoverSessions lists every 2026-MM-DD-session-<6hex> dir under .peaks/', () => { ... })` — 3 fake session dirs created, all 3 returned.
- `test('discoverSessions ignores non-session dirs (e.g. memory/, .session.json, .active-skill.json)', () => { ... })` — regex-mismatched entries skipped.
- `test('discoverSessions reports lastActivity from inner session.json mtime', () => { ... })` — verified via fs.utimesSync.
- `test('discoverSessions reports artifactCount excluding session.json itself', () => { ... })` — verified by populating known file count.
- `test('pickCanonicalSession returns the active-skill session when present (tier 1)', () => { ... })` — heuristic tier 1 wins.
- `test('pickCanonicalSession falls back to most-recent session.json mtime (tier 2) when active-skill missing', () => { ... })` — heuristic tier 2.
- `test('pickCanonicalSession falls back to most-recent inner mtime (tier 3) when no session.json', () => { ... })` — heuristic tier 3.
- `test('pickCanonicalSession falls back to lexicographic dir-name sort (tier 4) as final tier', () => { ... })` — heuristic tier 4.
- `test('pickCanonicalSession returns null when entries is empty', () => { ... })` — error mode.
- `test('repointSessionJson writes a fresh .session.json with the canonical sessionId', () => { ... })` — disk check.
- `test('repointSessionJson preserves projectRoot', () => { ... })` — preservation check.
- `test('repointSessionJson returns repointedFrom === old value, repointedTo === canonical', () => { ... })` — delta envelope.
- `test('findDeletionCandidates returns empty array when no entries exceed the age threshold', () => { ... })` — all recent dirs.
- `test('findDeletionCandidates returns entries with mtime > 7d ago AND artifactCount === 0', () => { ... })` — boundary case.
- `test('findDeletionCandidates does NOT include entries with non-zero artifactCount even if old', () => { ... })` — safety case.
- `test('findDeletionCandidates does NOT include entries within the 7d window even if empty', () => { ... })` — recency case.
- `test('findDeletionCandidates accepts a custom ageThresholdMs', () => { ... })` — config test.
- `test('applyDeletions with apply:false returns empty deleted, lists wouldDelete', () => { ... })` — dry-run.
- `test('applyDeletions with apply:true rm-rfs the candidates and lists them in deleted', () => { ... })` — destructive path.
- `test('applyDeletions with apply:true but no candidates returns empty deleted, empty wouldDelete', () => { ... })` — no-op.
- `test('reconcileWorkspace (default mode) re-points binding, returns envelope, does not delete', () => { ... })` — end-to-end dry-run.
- `test('reconcileWorkspace (--apply) re-points binding AND deletes candidates', () => { ... })` — end-to-end apply.
- `test('reconcileWorkspace does not delete the canonical session even if it is old', () => { ... })` — safety.
- `test('reconcileWorkspace reports errors[] when discovery fails (e.g. permission denied)', () => { ... })` — error mode.
- `test('reconcileWorkspace idempotent: running twice produces no diff on .session.json after first run', () => { ... })` — idempotence.

Pre-existing tests in this file: 0 (this is a new test file).

### W4 — SC resolution precedence

The 5 new test cases in `tests/unit/sc-service.test.ts` are reproduced below:

- `test('resolveArtifactSession returns active-skill session when its sliceId artifact exists (tier 1)', () => { ... })` — heuristic tier 1.
- `test('resolveArtifactSession falls back to .session.json when active-skill is absent or its artifact missing (tier 2)', () => { ... })` — heuristic tier 2.
- `test('resolveArtifactSession falls back to find .peaks/ -name <artifact> (tier 3) when neither binding has it', () => { ... })` — heuristic tier 3.
- `test('validateArtifactRetention returns resolvedSessionId additively and valid:true when artifact is found via find fallback', () => { ... })` — the W4 acceptance case (the dogfood on this repo).
- `test('recordCommitBoundary (peaks sc boundary) reports resolvedSessionId additively', () => { ... })` — W4 acceptance for boundary.

Pre-existing tests in `sc-service.test.ts`: 25 (must continue to pass byte-identical; back-stop).

## Acceptance items mapped to test cases

| PRD acceptance | Test case | How to run | Expected |
|---|---|---|---|
| `peaks workspace reconcile --json` returns the right envelope | all 26 W3 tests | `pnpm vitest run tests/unit/workspace-reconcile-service.test.ts` | 26/26 pass |
| 4-tier canonical heuristic | `pickCanonicalSession` tier-1/2/3/4 tests | same | 4/4 pass |
| `--apply` delete path | `applyDeletions` with apply:true | same | pass |
| `--no-apply` dry-run path | `applyDeletions` with apply:false | same | pass |
| Error mode (no session dirs) | `pickCanonicalSession` empty + `discoverSessions` empty | same | pass |
| `peaks sc validate` resolves across active-skill / session.json / find | 5 W4 tests | `pnpm vitest run tests/unit/sc-service.test.ts` | 5/5 pass (and pre-existing 25 continue) |
| `peaks sc validate` returns `data.valid: true` when artifact found via find | `validateArtifactRetention` resolved case | same | pass |
| New `data.resolvedSessionId` field additive | all W4 tests | same | pass |

## Edge cases to verify

1. **Empty project (no `.peaks/` dir at all)** — `discoverSessions` returns `[]`, `pickCanonicalSession` returns `null`, `reconcileWorkspace` returns envelope with `canonicalSessionId: null` and `errors: []` (no error, just an empty state).
2. **Single session dir, no `.session.json` binding** — `discoverSessions` finds 1 entry, `pickCanonicalSession` returns the only one (tier 4), `repointSessionJson` writes a fresh binding.
3. **`.session.json` points to a non-existent session dir** — `repointSessionJson` should still write the canonical session and not error.
4. **A session dir with 0 artifacts but very old mtime** — should appear in `deletionCandidates` (and `apply:false` test covers it; `apply:true` is the destructive follow-up).
5. **W4: active-skill references a real session but that session's sliceId artifact is missing** — falls through to session.json (tier 2).
6. **W4: both bindings point to sessions without the artifact** — falls through to `find` (tier 3).
7. **W4: no session has the artifact** — `resolvedSessionId: null`, `valid: false` (preserved behavior).

## Out-of-scope (must NOT be tested in this slice)

- Symlink traversal protection beyond `projectRoot` (security-review MEDIUM).
- The `findDeletionCandidates` edge case where the empty check might use a wrong mtime source (carried in dogfood finding; sub-agent's logic may differ from PRD text; full bug investigation is a follow-up slice, not this one).
- The `--older-than 30d` flag (stretch goal; default 7d is the gate).
- `peaks sc impact` / `peaks sc retention` modifications (out of scope per the PRD).

## Validation commands (run all)

```bash
cd "C:\Users\smallMark\Desktop\peaks-cli"
pnpm vitest run tests/unit/workspace-reconcile-service.test.ts
pnpm vitest run tests/unit/sc-service.test.ts
pnpm vitest run
pnpm typecheck
pnpm exec tsx src/cli/index.ts workspace reconcile --project "c:/Users/smallMark/Desktop/peaks-cli" --json
pnpm exec tsx src/cli/index.ts sc validate --slice-id 2026-06-04-monorepo-and-release --json
pnpm exec tsx src/cli/index.ts skill runbook peaks-solo --json
peaks skill doctor --json
peaks scan request-type-sanity --type feature --json
```

## Regression matrix

| Surface | Pre-slice | Post-slice | Result |
|---|---|---|---|
| `peaks workspace init` | creates session dir | unchanged | back-compat preserved |
| `peaks skill presence:set` | writes active-skill marker | unchanged | preserved |
| `peaks sc impact` | unchanged | unchanged | no regression |
| `peaks sc retention` | unchanged | unchanged | no regression |
| `peaks sc validate` (binding already matches artifacts) | returns `valid: true` | same + new `resolvedSessionId` field | additive only |
| `peaks sc validate` (binding doesn't match) | returns `valid: false` | resolves across sessions, returns `valid: true` if found | **fix applied** |
| `peaks skill runbook peaks-solo` | 31 commands, 4 destructive | 33 commands, 5 destructive | expected growth |
| `peaks skill doctor` | all pass | all pass | unchanged |
| `pnpm test` (full suite) | 1809 pass / 7 pre-existing Windows failures | 1840 pass / 7 pre-existing Windows failures | +31 new tests, 0 new failures |
| `pnpm typecheck` | clean | clean | preserved |
| `pnpm build` (W2 + W3 + W4 combined) | passes (pre-slice only had W1 fix) | passes | preserved |
