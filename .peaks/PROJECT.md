# Peaks Project Context

> Auto-generated project memory. Peaks reads this at the start of each session to understand
> the project's history, tech stack, conventions, and past decisions.
> Last updated: 2026-09-12T03:32:17.888Z

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

## Timeline (32 sessions, showing last 15)

| Date | Directory | Title | What |
|------|-----------|-------|------|
| 2026-09-12 | `2026-09-12-session-ded54d` | Untitled | - |
| 2026-09-12 | `2026-09-12-session-2a1800` | Untitled | - |
| 2026-09-12 | `2026-09-12-session-30287d` | Untitled | - |
| 2026-09-12 | `2026-09-12-session-87d906` | Untitled | - |
| 2026-09-12 | `2026-09-12-session-fe2f86` | Untitled | - |
| 2026-09-11 | `2026-09-12-session-86f23b` | Untitled | Session: 2026-09-12-session-86f23b. Verdict: **NOT SHIPPABLE — 3 BLOCK |
| 2026-09-11 | `2026-09-12-session-aaae4f` | Untitled | - |
| 2026-09-11 | `2026-09-11-session-6cd43c` | Untitled | - |
| 2026-09-11 | `2026-09-11-session-e40557` | Untitled | - |
| 2026-09-11 | `2026-09-11-session-107b80` | Untitled | - |
| 2026-09-11 | `2026-09-11-session-209390` | Untitled | - |
| 2026-09-11 | `2026-09-11-session-d43a67` | Untitled | - |
| 2026-09-10 | `2026-09-10-session-7aa6ec` | Untitled | - |
| 2026-09-10 | `2026-09-10-session-195a7b` | Untitled | - |
| 2026-09-10 | `2026-09-10-session-8ee8c6` | Untitled | - |

<!-- peaks-managed:session-history-end -->
