# Peaks Project Context

> Auto-generated project memory. Peaks reads this at the start of each session to understand
> the project's history, tech stack, conventions, and past decisions.
> Last updated: 2026-06-28T14:36:15.925Z

## Project: peaks-cli

## Conventions

- **`.peaks/` workspace underscore-prefix convention (since 2.8.0)** — any
  top-level segment under `.peaks/` whose name starts with `_` is **ephemeral**
  (gitignored by the single `.peaks/_*/` rule). Non-underscored segments are
  git-tracked source-of-truth. Two explicit exceptions are documented in
  `.gitignore`: `.peaks/runtime/` (typo guard) and `.peaks/preferences.json`
  (per-project user state). Full rule at
  `.peaks/memory/workspace-underscore-convention.md`.
- **Top-level `.peaks/_runtime/<YYYY-MM-DD-*>/` is forbidden (effective 2.8.3)** —
  change-id / session-id artifacts MUST live under `.peaks/_runtime/<sid>/`
  (gitignored). Never as siblings of `.peaks/_runtime/`. **Path
  distinction**: the change-id **binding** (the active change-id for the
  project) is a plain text file at `.peaks/_runtime/current-change`,
  written by `peaks workspace init --change-id <id>`. Reviewable
  artifacts (RD/QA/PRD) embed the change-id as a filename slug under
  `.peaks/_runtime/<sid>/<role>/requests/<rid>-<change-id>.md` and
  may lazily create a tracked reviewable-artifact root at
  `.peaks/_runtime/change/<changeId>/<role>/` — but that dir lives UNDER `.peaks/_runtime/`,
  not at the `.peaks/` top level. **Four layers of enforcement**:
  (1) root `.gitignore` rule
  `.peaks/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-*/` blocks untracked
  writes; (2) vitest guard at
  `tests/unit/workspace/top-level-change-id-guard.test.ts` (8 cases
  including CLI help-text + 4 migration verbs) fails CI on regression;
  (3) source-code redirect in `src/shared/change-id.ts` +
  `src/services/workspace/workspace-service.ts` — `setCurrentChangeId`
  uses `lstatSync` to refuse silent symlink-replace (`LegacyChangeIdBindingError`)
  and `initWorkspace` uses `lstatSync` + `validateChangeIdOrThrow` to
  refuse legacy sibling dirs (`LegacyChangeIdSiblingError`); (4) `CLAUDE.md`
  "Hard ban" section tells future AI sessions never to create the
  pattern. Originating incident: a 2.8.0-era
  `peaks workspace init --change-id ...` flow left a 4-file orphan at
  `.peaks/2026-06-22-cc-connect-orphan-cleanup/`, root-caused + fixed in
  slice `2026-06-22-top-level-change-id-cleanup` (commits `7373f81`,
  `d557ed8`, `f18a518`, `bc0423d`, plus audit followup).
  See `.peaks/memory/2026-06-22-top-level-change-id-cleanup.md` for the
  full audit trail + the 13 audit findings remediation.

<!-- peaks-managed:session-history-start -->

## Timeline (11 sessions)

| Date | Directory | Title | What |
|------|-----------|-------|------|
| 2026-06-28 | `2026-06-28-session-b84af6` | Untitled | **Mode**: full-auto |
| 2026-06-28 | `2026-06-28-session-2ecbba` | Untitled | N/A — 本切片是 Node.js 内部 CLI 库,不涉及前端 |
| 2026-06-28 | `2026-06-28-session-88b27d` | Untitled | rid: 001-v2-14-2-tilde-peaks-p3p4 |
| 2026-06-28 | `2026-06-28-session-75d5f0` | Untitled | schemaVersion: 1 |
| 2026-06-27 | `2026-06-28-session-100b52` | Untitled | Fix four runtime defects reported in `peaks-solo` session 2026-06-28: |
| 2026-06-27 | `2026-06-27-session-83acf5` | Untitled | schemaVersion: 1 |
| 2026-06-27 | `2026-06-27-session-5913d2` | Untitled | peaks-solo |
| 2026-06-27 | `2026-06-27-session-b483e6` | v2.12-independent-security-perf-audit | requestId: v2-12-independent-security-perf-audit |
| 2026-06-27 | `2026-06-27-session-1512ac` | Untitled | N/A — this is a CLI-only feature. |
| ? | `2026-06-11-session-edbe91` | Untitled | - |
| ? | `2026-06-06-session-5b1095` | Untitled | - |

<!-- peaks-managed:session-history-end -->
