# peaks-loop 2026-08-01 sub-agent merge-and-e2e archive sediment

sessionId: 2026-08-01-session-410315
rid: 2026-08-01-subagent-merge-and-e2e
gate: archive-bundle
ships-with: 2026-08-01-statusline-auto-compact-progress (RID1)
source-service-version: peaks-loop@4.0.4
final-verdict: verdict-issued / allPass=true

## Three business risks from the bundle hand-off — RESOLVED

### Risk 1 — `runE2EVerify` was a deterministic stub

**Symptom (RID2 verdict, business risk 1)**: `runE2EVerify` returned
`{ outcome: 'pass', passCount: fixtures.length }` for any non-empty
plan. The CLI existed end-to-end but did not exercise a real browser.

**Resolution (2026-08-01-bundle archive, Task 3)**: replaced the stub
with a layered runner:

- `resolvePlaywrightEnv()` reads
  `PEAKS_PLAYWRIGHT_USER_DATA_DIR` +
  `PEAKS_PLAYWRIGHT_PROFILE_NAME` (env stamped by
  `peaks sub-agent dispatch`). Returns `null` when either is unset or
  when the user-data-dir path does not exist on disk.
- `probeChromiumBinary()` probes for `chromium` / `chrome.exe` etc via
  `process.platform` (Windows → `where`, POSIX → `which`), then
  `--version` to confirm the binary actually runs. No hard-coded path.
- `runOneFixtureWithPlaywright()` spawns Chromium with
  `--user-data-dir=$PEAKS_PLAYWRIGHT_USER_DATA_DIR
  --profile-directory=$PEAKS_PLAYWRIGHT_PROFILE_NAME`, navigates to
  `fixture.url`, matches CSS selectors (`#id` / `.class` / `css:<sel>`)
  or substrings against the rendered DOM. Returns
  `{ pass: true }` or `{ pass: false, reason }` per fixture.
- The deterministic stub path is retained as the fallback for CI
  runners without Chromium; the integration test
  `tests/integration/dispatch-merge-and-e2e.e2e.test.ts` now has a
  second case that asserts `runner: 'stub'` when both env vars are
  deleted.

**Tests added**:

- 86/86 green across `tests/unit/services/dispatch`,
  `tests/unit/services/worktree`, and
  `tests/integration/dispatch-merge-and-e2e.e2e.test.ts`.
- `pnpm build` → `build-integrity: OK`.

### Risk 2 — RD security-review.md and perf-baseline.md absent

**Symptom (RID2 verdict, business risk 2)**: the final-review JSON
recorded that the two review docs were deferred to a separate audit
slice. They were not on disk when the bundle was archived.

**Resolution (2026-08-01-bundle archive, Tasks 4 + 5)**: both docs
are written at
`.peaks/_runtime/2026-08-01-session-410315/rd/security-review.md` and
`.peaks/_runtime/2026-08-01-session-410315/rd/perf-baseline.md`.

- Security review covered: dispatch provenance + canonical-lease gate,
  `.peaks/_runtime/<sid>/service-registrations.json` (file-bound),
  `.peaks/_runtime/<sid>/pw-profiles/<dispatchId>/` (per-dispatch
  Chromium user-data-dir), the absence of new secrets / network / auth
  changes, and the file-bound I/O surface across the merged slice.
  Verdict: APPROVED.
- Perf baseline covered: O(1) cost of `planMergeBack`, the single
  `path.join` per dispatch of `playwrightProfilePaths`,
  no-new-I/O claim of `killRegisteredServices`, the bounded
  best-effort shutdown latency (5000 ms cap × N), and the e2e stub
  deterministic count. Verdict: APPROVED.

### Risk 3 — schema v3.1 → v3.2 reverse compat

**Symptom (RID2 verdict, business risk 3)**: a v3.1 build reading a
v3.2 record would throw `version mismatch`. The schema bump was
additive but the upgrade path was not explicitly tested.

**Resolution (2026-08-01-bundle archive, Task 7)**: the
`upgradeRecord` helper already backfilled `serviceKill: []` and
`mergeBackAttempts: 0` for records missing those fields (lines
949-958 of `src/services/dispatch/dispatch-record-writer.ts`). The
ship-with-RID2 behavior was correct; what was missing was a
regression guard. Added two unit tests in
`tests/unit/services/dispatch/dispatch-record-writer.test.ts`:

- `upgrade path is silent: readRecord of a v3.1 JSON backfills
  serviceKill=[] and mergeBackAttempts=0 (no throw)`
- `upgrade path is silent for unknown-version legacy (numeric 3) and
  backfills defaults`

Both tests call `readRecord()` against a v3.1 / numeric-3 JSON file
on disk and assert the upgrade produces a v3.2 record with the
expected defaults.

### Risk 4 — `vitest.config.integration.ts` opt-in only

**Symptom (RID2 verdict, business risk 4)**: the new
`tests/integration/dispatch-merge-and-e2e.e2e.test.ts` is *not* picked
up by the base config. Operators must run `pnpm test:integration`
explicitly.

**Resolution**: this is by design (per
`docs/standards/integration-test-config.md`). The slice's
`package.json` already exposes `test:integration`. Not changed in
this archive.

## Files shipped in this archive

- `.peaks/_runtime/2026-08-01-session-410315/sc/change-control/2026-08-01-statusline-auto-compact-progress.md`
- `.peaks/_runtime/2026-08-01-session-410315/sc/change-control/2026-08-01-subagent-merge-and-e2e.md`
- `.peaks/_runtime/2026-08-01-session-410315/rd/security-review.md`
- `.peaks/_runtime/2026-08-01-session-410315/rd/perf-baseline.md`
- `src/cli/commands/e2e-verify.ts` (Playwright runner + stub fallback)
- `tests/integration/dispatch-merge-and-e2e.e2e.test.ts` (stub-path test)
- `tests/unit/services/dispatch/dispatch-record-writer.test.ts` (v3.1 silent-upgrade test + numeric-3 silent-upgrade test)

## Carry-forward notes

- The Playwright runner intentionally ships with a tiny subset of the
  full Playwright API (navigate + substring / CSS matcher). Multi-tab
  assertions, screenshot / video recording, and `await expect`
  retry logic belong in a follow-up slice if any peak user actually
  needs them.
- The new `runner` field on `E2EVerifyResult` is a strict superset
  of the prior shape (`'playwright' | 'stub'` is additive). Downstream
  consumers that read the JSON shape MUST tolerate the missing field
  (treat as `'stub'`).
- The `PEAKS_PLAYWRIGHT_USER_DATA_DIR` + `PEAKS_PLAYWRIGHT_PROFILE_NAME`
  env vars are stamped by `peaks sub-agent dispatch` — operators
  that call the playwright MCP server from a non-peaks entry point
  must set them manually to use the real runner.
- 86/86 tests still green; build integrity OK. No version bump
  (peaks-loop remains at 4.0.4); the new code is additive and the
  next user `npm install -g .` after this commit picks it up.

## Lessons

- **Pure functions over I/O when possible.** The biggest risk in
  shipping deterministic stubs is the temptation to inline I/O. The
  layered pattern (resolve-env → probe-binary → spawn real runner →
  fall back to stub) keeps each concern isolated and the failure mode
  observable. The integration test asserts the failure mode
  explicitly.
- **Write the regression guard for the additive schema bump at the
  same time as the bump.** The v3.2 upgrade path was correct on day
  one; the regression guard was the missing piece. Future schema
  bumps should ship the guard in the same commit.
- **Print-mode vs runtime parity.** Cross-platform auto-compact on
  Mac (commit `ede129d2`) had a similar pattern: the runtime needs an
  env-override fallback because the upstream injection was
  environment-specific. The Playwright runner follows the same
  pattern (env vars stamped by CLI, manually-set when invoked
  outside CLI).
