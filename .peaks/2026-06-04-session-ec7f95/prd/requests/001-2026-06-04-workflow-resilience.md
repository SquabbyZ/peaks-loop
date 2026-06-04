# PRD Request 2026-06-04-workflow-resilience

- session: 2026-06-04-session-ec7f95
- type: feature
- source: open questions Q1/Q2/Q3 from the 2026-06-04-monorepo-and-release TXT handoff (slice 2026-06-04-monorepo-and-release, session cda1cd, txt/handoff.md)
- raw input (sanitized): "继续后面的W2/W3/W4" — user accepted the three workflow-resilience follow-up items deferred from the prior slice: (W2) promote `sync-version.mjs` to a `predev`/`prepack` hook so version bumps can't silently desync; (W3) introduce `peaks workspace reconcile` to consolidate the multi-session-dir bloat into a single canonical session; (W4) fix `peaks sc validate` / `peaks sc boundary` so they resolve artifacts across the active session, not the first-bound session in `.session.json`.

## Goals

- **W2**: ensure `peaks --version` (and any code that imports `CLI_VERSION` from `src/shared/version.ts`) is always in sync with `package.json`. The version sync must run on `predev`, `prepack`, `prepublish`, and `pretest` so that `pnpm dev` / `pnpm build` / `pnpm pack` / `pnpm test` can never observe a stale `1.2.8` after a `package.json` bump to `1.2.9`. The fix must also update the existing `build` script (which already runs sync-version as its first step) to be defensible: no-op when already in sync, error when the file write would be a no-op but the cache is dirty.
- **W3**: add a `peaks workspace reconcile` command that scans `.peaks/2026-MM-DD-session-*/` directories under the project root, identifies the canonical session (most recent `lastActivity`, or the one referenced by `.peaks/.active-skill.json`, or the one most recently written-to), and re-points `.peaks/.session.json` to the canonical session. Optionally deletes empty / abandoned session dirs older than 7 days. Defensive default: never auto-delete; only re-point + report. A `--apply` flag is required to actually delete empty dirs.
- **W4**: fix `peaks sc validate` and `peaks sc boundary` so the SC commands look up the artifact path in `.peaks/.active-skill.json` (the orchestrator's current session) first, then fall back to `.peaks/.session.json` (the workspace binding), and finally to a `find .peaks/ -name '<artifact>'` fallback. The first two are deterministic; the third is the survival path. Document precedence in the SC command's `--help` text.

## Non-goals

- No new top-level dependencies (hand-rolled session discovery; no `find-up` / `pkg-dir` / etc.).
- No change to the user-facing `peaks --version` JSON envelope or the JSON envelope of any SC command. Additive behavior only.
- No change to the existing `pnpm build` script (W2 adds hooks but does not refactor build).
- W3 does not merge PRD/RD/QA artifacts across sessions — it only re-points bindings. (A future "merge" command would be a separate slice.)
- W4 does not migrate the deprecated `b60252` session dir to the new binding. The ancient Mac-path session is out of scope; just leave it alone.
- No new session-dir schema. Existing `.peaks/2026-MM-DD-session-<6hex>/` shape is preserved.

## Preserved behavior

- Single-project, single-session workflows: no observable change after Slice 1 lands. `peaks workspace init` still creates a session dir; `peaks skill presence:set` still writes the active-skill marker. The new hooks (W2) are no-ops when the version file is already in sync.
- `peaks sc impact` and `peaks sc retention` (the SC commands that worked in the prior session): unchanged output and acceptance behavior.
- `peaks --version` returns the same JSON envelope and the same `CLI_VERSION` value; the data is just always in sync with `package.json`.
- Existing `build` script (which already runs `sync-version.mjs` first) keeps that ordering.
- The destructive-`--apply` gate posture: W3's `--apply` is the only new `--apply` in this slice; it's documented in the runbook and the SC boundary.

## Acceptance criteria

### W2 (Slice 1, chore)

- `package.json` `scripts` contains: `predev`: runs `node scripts/sync-version.mjs`; `prepack`: same; `prepublish`: same; `pretest`: same. The pretest hook fires before `vitest` runs, so unit tests can import `CLI_VERSION` and observe the current value.
- `pnpm dev` (which calls `predev` automatically): the new `src/shared/version.ts` is written before `tsx src/cli/index.ts` starts. Verified by adding a unit test that imports `CLI_VERSION` and asserts it matches `package.json` `version`.
- Idempotence: running `node scripts/sync-version.mjs` twice in a row produces no diff on the second run. (Already true today; the predev hook just exercises it.)
- Error mode: if `package.json` is missing or malformed, `sync-version.mjs` exits non-zero. The predev hook propagates the error, so `pnpm dev` fails fast with a clear message.
- No regression: `pnpm build` (which already runs sync-version) still works; `pnpm test` still works; `pnpm typecheck` still works.

### W3 + W4 (Slice 2, feature)

- `peaks workspace reconcile --json` (default mode, no `--apply`):
  - Returns a JSON envelope listing all discovered session dirs under `.peaks/`, their `lastActivity` timestamps, and which one is the "canonical" candidate.
  - Re-points `.peaks/.session.json` to the canonical session (write a new `.session.json`; do not delete the others).
  - Reports the delta: "re-pointed .session.json from `<old>` to `<new>`".
  - Lists empty / abandoned dirs as candidates for deletion but does not delete them.
  - Exit code 0.
- `peaks workspace reconcile --apply` (destructive):
  - Same as above, PLUS deletes the empty / abandoned session dirs older than 7 days.
  - Confirms in the JSON envelope which dirs were deleted.
  - Exit code 0 on success, non-zero if a delete fails.
- `peaks workspace reconcile --help` documents both modes and the 7-day age threshold.
- Unit tests cover: discovery, canonical-selection, re-pointing, age-threshold (7 days), --apply delete path, --no-apply dry-run path, error mode (no session dirs at all).
- `peaks sc validate --slice-id <rid>` and `peaks sc boundary --slice-id <rid>`:
  - On a project with artifacts in a non-bound session (e.g. `.peaks/<sid-A>/qa/test-reports/<rid>.md` is present but `.session.json` points to `<sid-B>`), the SC commands resolve `<sid-A>` from `.peaks/.active-skill.json` first, then `.session.json`, then the global find fallback.
  - The resolved session id is reported in the JSON envelope (new `resolvedSessionId` field, additive).
  - `peaks sc validate` returns `data.valid: true` when the artifact is found in any of the three sources (current behavior is `data.valid: false` because it only checks the bound session).
- Dogfood: in this same repo, after Slice 2 lands, `peaks sc validate --slice-id 2026-06-04-monorepo-and-release --json` should resolve to `cda1cd` (the session that holds the prior slice's artifacts) and return `valid: true` for the QA test-report path. (Today it would fail with "no such file" because the binding points to the wrong session.)
- No regression: `peaks sc impact` / `peaks sc retention` outputs unchanged.

## Frontend delta (only when target is in scope)

- Not applicable. peaks-cli is a CLI tool; no UI changes.

## Risks and open questions

- **Risk**: W3's "canonical session" definition is ambiguous. Candidate heuristics, in order: (1) the session referenced by `.peaks/.active-skill.json` if it exists and points to a real dir; (2) the session with the most recent mtime on its `session.json`; (3) the session with the most recent mtime on any artifact inside it; (4) the most recently created dir by name. Heuristic (1) wins because the active-skill is the orchestrator's truth.
- **Risk**: W4 changes SC command output (adds `resolvedSessionId` field). Existing consumers that strict-parse the JSON envelope may break. Mitigation: the field is additive, not replacing any existing field. Document in the SC command's `--help` and the schema docs.
- **Risk**: W3's `--apply` is destructive. The runbook line count must update from 31 to 32 (one new `peaks workspace reconcile` line, optionally with `--apply` flagged as destructive). `peaks skill doctor` must still pass after the runbook update.
- **Open question**: should the 7-day age threshold for `--apply` deletion be configurable (e.g. `--older-than 30d`)? Default to 7 days per the PRD text; add the flag as a stretch goal.
- **Open question**: W3's reconcile might be run as a `postinstall` hook for clean CI environments. The user has not asked for that; out of scope for this slice.
- **Open question**: the prior slice's handoff noted "session bloat" as a known issue. W3 fixes the *next-time-this-happens* path, not the historical bloat. Historical cleanup is a separate `peaks workspace reconcile --apply` invocation the user can run after Slice 2 lands.

## Handoff

- to peaks-rd: .peaks/2026-06-04-session-ec7f95/rd/requests/2026-06-04-workflow-resilience.md
- to peaks-qa: .peaks/2026-06-04-session-ec7f95/qa/requests/2026-06-04-workflow-resilience.md
- to peaks-ui: (skip — no UI)

## Sub-slice plan (sequential, not parallel — avoid commit conflicts and gate matrix complexity)

1. **Slice 1** (`type: chore`) — W2. Hooks: predev / prepack / prepublish / pretest. Commit: `chore(build): auto-sync CLI version in predev/prepack/pretest hooks`. Light gates: no tech-doc, no test-cases (Slice 1's tests live in the existing vitest suite), no security review (no new external surface), no perf baseline. Just RD + commit + dogfood.
2. **Slice 2** (`type: feature`) — W3 + W4. New CLI command + new SC resolver logic. Full gates: tech-doc, code-review, security-review, test-cases, test-report, security-findings, performance-findings. Runbook line count: 31 → 32. Commit: `feat(workspace): add peaks workspace reconcile + SC artifact resolution`. Dogfood: SC validate against the prior slice's artifacts must return `valid: true`.

## Status

- created: 2026-06-04T14:54:37.026Z
- last update: 2026-06-04T14:57:24.481Z
- state: handed-off
