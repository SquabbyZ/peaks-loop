# Peaks Project Context

> Auto-generated project memory. Peaks reads this at the start of each session to understand
> the project's history, tech stack, conventions, and past decisions.
> Last updated: 2026-06-25T17:17:58.364Z

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

## Timeline (22 sessions, showing last 15)

| Date | Directory | Title | What |
|------|-----------|-------|------|
| 2026-06-25 | `2026-06-25-session-139b84` | Untitled | > **Released**: 2026-06-26 |
| 2026-06-25 | `2026-06-25-session-fe94e7` | Untitled | **Author:** peaks-solo (orchestrator) | **Session:** `2026-06-25-sessi |
| 2026-06-24 | `2026-06-24-session-514c27` | Untitled | 四项变更合并为一个 refactor slice。共同目标：在 **wall-time 持平**、**token 总量持平**（允许 -5% |
| 2026-06-23 | `2026-06-23-session-dc4cbc` | Untitled | peaks-solo |
| 2026-06-23 | `2026-06-23-session-8d14dd` | Untitled | peaks-solo |
| 2026-06-23 | `2026-06-23-session-fbee82` | Untitled | peaks-solo |
| 2026-06-22 | `2026-06-22-session-14216e` | Untitled | peaks-solo |
| 2026-06-22 | `2026-06-22-session-1f8ba1` | Untitled | peaks-solo |
| 2026-06-21 | `2026-06-21-session-6fefac` | Untitled | 把下面整块(从 ```markdown 起，到 ``` 止)整段贴到 Mac 上 peaks-cli 目录新开的 Claude Code |
| 2026-06-18 | `2026-06-18-session-b78501` | Untitled | peaks-solo |
| 2026-06-13 | `2026-06-14-session-edc6bb` | Untitled | peaks-solo |
| 2026-06-13 | `2026-06-14-session-b51782` | Untitled | - |
| 2026-06-13 | `2026-06-13-session-2ecd34` | RD: 修 2.0.3 hook node -e 包装 bugfix | > RD-side draft of QA acceptance cases. The peaks-qa skill will run |
| 2026-06-12 | `2026-06-12-session-dbc275` | Untitled | **in-scope files (RD may modify):** |
| 2026-06-11 | `2026-06-11-session-35ee92` | Untitled | > peaks-qa performance review (Gate A4). |

<!-- peaks-managed:session-history-end -->
