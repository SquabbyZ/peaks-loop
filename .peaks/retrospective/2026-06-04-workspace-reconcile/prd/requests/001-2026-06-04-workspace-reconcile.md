# PRD Request 2026-06-04-workspace-reconcile

- session: 2026-06-04-session-89f7cb
- type: feature
- source: W3 + W4 sub-slice plan in the parent PRD `.peaks/2026-06-04-session-ec7f95/prd/requests/001-2026-06-04-workflow-resilience.md` (slice 2 of 2)
- raw input (sanitized): "继续后面的W2/W3/W4" — slice 2 of the workflow-resilience work. W2 is already shipped (commit 5f30353, see `.peaks/2026-06-04-session-ec7f95/rd/requests/001-2026-06-04-workflow-resilience.md` for that sub-slice's evidence). This slice covers W3 (add `peaks workspace reconcile` CLI) and W4 (fix SC commands to resolve artifacts across sessions).

## Goals

- **W3**: add a new CLI command `peaks workspace reconcile` that scans `.peaks/2026-MM-DD-session-*/` directories under the project root, identifies the canonical session (via 4-tier heuristic: active-skill binding → most-recent mtime → most-recent artifact mtime → dir-name sort), and re-points `.peaks/.session.json` to the canonical session. Dry-run by default; `--apply` is destructive and enables deletion of empty / abandoned dirs older than 7 days. The command emits a JSON envelope per the existing CLI convention.
- **W4**: modify the existing SC commands (`peaks sc validate`, `peaks sc boundary`) so the artifact-path lookup checks `.peaks/.active-skill.json` first, then `.peaks/.session.json`, then a `find .peaks/ -name '<artifact>'` fallback. The resolved session id is reported in a new `resolvedSessionId` field on the JSON envelope (additive). Both commands stay non-destructive.

## Non-goals

- No merge of PRD/RD/QA artifacts across sessions — only re-pointing bindings.
- No migration of the deprecated `b60252` session (Mac-path ancient) — out of scope; just leave it alone.
- No change to existing SC commands' *non-resolution* behavior; only the resolution precedence changes.
- No new top-level dependencies.
- No change to the existing destructive-`--apply` gate posture outside W3's new `--apply`.
- No CLI command renaming or removal.

## Preserved behavior

- `peaks workspace init` still creates a session dir; the dir is still `.peaks/YYYY-MM-DD-session-<6hex>/`. (W3 does not change the schema, only the cleanup story.)
- `peaks skill presence:set` still writes `.peaks/.active-skill.json`.
- All existing SC commands' output envelopes stay compatible: new `resolvedSessionId` is additive; existing fields are unchanged.
- `peaks sc impact` and `peaks sc retention` (the SC commands that worked in the prior session) are unchanged.
- `pnpm build` (which calls `sync-version.mjs` first, and now also gets `predev`/`pretest`/`prepublish` hooks from slice 1) still works without change.
- The 4 destructive-`--apply` lines in `peaks-solo` runbook grow to 5 (one new `--apply` for W3's `peaks workspace reconcile`).

## Acceptance criteria

### W3

- `peaks workspace reconcile --json` (default mode, no `--apply`):
  - Returns a JSON envelope listing every `.peaks/2026-MM-DD-session-*/` directory it found, with each entry's `path`, `lastActivity` (mtime of `session.json` inside), and `artifactCount` (count of files under that session dir, excluding `session.json` itself).
  - Identifies one entry as `canonicalSessionId` per the 4-tier heuristic in the Goals.
  - Re-points `.peaks/.session.json` to the canonical session (writes a fresh `.session.json`).
  - Reports the `repointedFrom` and `repointedTo` in the JSON envelope.
  - Lists any session dir matching `ageThreshold` (default 7 days, mtime-based) as `deletionCandidates` but does not delete them.
  - Exit code 0.
- `peaks workspace reconcile --apply`:
  - Same as default mode, PLUS deletes the entries listed in `deletionCandidates`.
  - The JSON envelope adds a `deleted` array showing the actual deletions performed.
  - Exit code 0 on success; non-zero if any deletion fails (with the failure listed in the envelope).
- `peaks workspace reconcile --help`:
  - Documents both modes and the 7-day age threshold.
  - Lists the canonical-session heuristic in the order described.
  - Warns explicitly that `--apply` is destructive and removes the listed dirs.
- `peaks workspace reconcile --older-than 30d` overrides the age threshold (stretch goal, default 7d if not implemented).
- Unit tests cover: discovery (multiple dirs, no dirs); canonical selection (each heuristic tier wins when prior tier is absent); re-pointing (no-op when already canonical); age threshold (boundary at 7d); `--apply` delete path; `--no-apply` dry-run path; error mode (no session dirs at all).
- No regression: `peaks workspace init`, `peaks skill presence:set` outputs unchanged.

### W4

- `peaks sc validate --slice-id <rid>` and `peaks sc boundary --slice-id <rid>`:
  - On a project where the artifact path resolves to a non-`.session.json`-bound session (e.g. `.peaks/<sid-A>/qa/test-reports/<rid>.md` exists but `.session.json` points to `<sid-B>`), the SC commands resolve `<sid-A>` via the new 3-tier resolution (active-skill → session.json → find fallback).
  - New `data.resolvedSessionId` field on the JSON envelope (additive).
  - `peaks sc validate` returns `data.valid: true` when the artifact is found via any of the three sources (current behavior: `valid: false` because it only checks the bound session).
- Dogfood gate (the actual acceptance for W4 in this session):
  - Before W4: `peaks sc validate --slice-id 2026-06-04-monorepo-and-release --json` returns `data.valid: false` (artifacts in `cda1cd`, binding points to `89f7cb`).
  - After W4: same command returns `data.valid: true`, with `data.resolvedSessionId === "2026-06-04-session-cda1cd"`.
- No regression: `peaks sc impact` / `peaks sc retention` outputs unchanged.

### Combined runbook back-stop

- After Slice 2 lands, `peaks skill runbook peaks-solo --json` reports `peaksCommandCount: 32` (one new line: `peaks workspace reconcile`).
- The 4 destructive-`--apply` lines grow to 5 (the new `peaks workspace reconcile --apply` is added to the `destructiveApplyLines` array).
- `peaks skill doctor` still passes all checks.

## Frontend delta (only when target is in scope)

- Not applicable. peaks-cli is a CLI tool.

## Risks and open questions

- **Risk**: W3's "canonical session" heuristic. Tier-1 (active-skill) is the orchestrator's truth; the others are fallbacks. Document the precedence in `--help` and the schema docs.
- **Risk**: W3's `--apply` deletes dirs. The CLI must check that the dir is *empty* before deleting (a session dir with real artifacts should never be auto-deleted). Document the "empty or 7d-abandoned" check.
- **Risk**: W4's `find .peaks/ -name '<artifact>'` fallback can match the wrong artifact if the user has multiple slices with the same rid (very rare but possible). The active-skill and session.json lookups are deterministic; the find fallback is the last-resort.
- **Open question**: should the canonical-session heuristic be configurable (e.g. `--prefer latest` vs `--prefer active-skill`)? Default to the documented order; add a flag as a stretch.
- **Open question**: W3's `--apply` is destructive. The runbook line count check is the back-stop. The new `--apply` line must be in `destructiveApplyLines`.

## Handoff

- to peaks-rd: .peaks/2026-06-04-session-89f7cb/rd/requests/001-2026-06-04-workspace-reconcile.md
- to peaks-qa: .peaks/2026-06-04-session-89f7cb/qa/requests/001-2026-06-04-workspace-reconcile.md
- to peaks-ui: (skip — no UI)

## Status

- created: 2026-06-04T15:16:50.000Z
- last update: 2026-06-04T15:20:29.861Z
- state: handed-off
