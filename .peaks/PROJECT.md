# Peaks Project Context

> Auto-generated project memory. Peaks reads this at the start of each session to understand
> the project's history, tech stack, conventions, and past decisions.
> Last updated: 2026-07-03T02:37:14.483Z

## Project: peaks-loop

## Conventions

- **`.peaks/` workspace underscore-prefix convention (since 2.8.0)** — any
  top-level segment under `.peaks/` whose name starts with `_` is **ephemeral**
  (gitignored by the single `.peaks/_*/` rule). Non-underscored segments are
  git-tracked source-of-truth. Two explicit exceptions are documented in
  `.gitignore`: `.peaks/runtime/` (typo guard) and `.peaks/preferences.json`
  (per-project user state). Full rule at
  `.peaks/memory/workspace-underscore-convention.md`.
- **Top-level `.peaks/_runtime/<YYYY-MM-DD-*>/` is forbidden (effective 2.8.3)** —
  session-id artifacts MUST live under `.peaks/_runtime/<sid>/`
  (gitignored). Never as siblings of `.peaks/_runtime/`. **Path
  distinction** (post-`2026-06-29-change-id-root-removal`): the
  change-id is metadata-only — reviewable artifacts (RD/QA/PRD) live at
  `.peaks/_runtime/<sid>/<role>/requests/<rid>-<change-id>.md` and the
  change-id appears only as a filename slug. There is no longer a
  binding file at `.peaks/_runtime/current-change`. **Four layers of
  enforcement**: (1) root `.gitignore` rule
  `.peaks/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-*/` blocks untracked
  writes; (2) vitest guard at
  `tests/unit/workspace/top-level-change-id-guard.test.ts` (8 cases
  including CLI help-text + sibling-dir-shape assertions) fails CI on
  regression; (3) source-code redirect in
  `src/services/workspace/workspace-service.ts` — `initWorkspace` uses
  `lstatSync` to refuse legacy sibling dirs
  (`LegacyChangeIdSiblingError`); (4) `CLAUDE.md` "Hard ban" section
  tells future AI sessions never to create the pattern. Originating
  incident: a 2.8.0-era `peaks workspace init --change-id ...` flow left
  a 4-file orphan at
  `.peaks/2026-06-22-cc-connect-orphan-cleanup/`, root-caused + fixed in
  slice `2026-06-22-top-level-change-id-cleanup` (commits `7373f81`,
  `d557ed8`, `f18a518`, `bc0423d`, plus audit followup). The change-id
  axis was fully removed in slice `2026-06-29-change-id-root-removal`.
  See `.peaks/memory/2026-06-22-top-level-change-id-cleanup.md` for the
  full audit trail + the 13 audit findings remediation.

<!-- peaks-managed:session-history-start -->

## Timeline (10 sessions)

| Date | Directory | Title | What |
|------|-----------|-------|------|
| 2026-07-03 | `2026-07-03-session-ee2aba` | Untitled | None. Single-file doc fix, fully reversible with `git checkout skills/ |
| 2026-07-02 | `2026-07-03-session-447ab0` | Untitled | name: 001-code-memory-write-broken |
| 2026-07-02 | `2026-07-02-session-0cc78e` | Untitled | name: auto-compact-zero-pause-qa |
| 2026-07-02 | `2026-07-02-session-21b44b` | Untitled | - |
| 2026-07-01 | `2026-07-01-session-b42ac6` | Codegraph+UA 联合补强与降级 | schemaVersion: 2 |
| 2026-06-30 | `2026-06-30-session-f90141` | Untitled | name: loop-eng-similar-75-gaps-25 |
| 2026-06-29 | `2026-06-29-session-60737e` | Untitled | title: Change-Id Root Removal |
| ? | `2026-07-01-session-f90141` | Untitled | RENAME-DONE: 2026-07-01T00:00:00Z |
| ? | `2026-06-11-session-edbe91` | Untitled | - |
| ? | `2026-06-06-session-5b1095` | Untitled | - |

<!-- peaks-managed:session-history-end -->
