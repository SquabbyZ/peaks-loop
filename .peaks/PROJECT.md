# Peaks Project Context

> Auto-generated project memory. Peaks reads this at the start of each session to understand
> the project's history, tech stack, conventions, and past decisions.
> Last updated: 2026-08-12T01:47:49.567Z

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
| 2026-08-12 | `2026-08-12-session-4aaf2b` | rid-skill-persistence-001 完整修复 (3 文件 + 2 | **Path:** `peaks-code / rid-skill-persistence-001` |
| 2026-08-11 | `2026-08-11-session-5c3563` | Untitled | peaks-code |
| 2026-08-11 | `2026-08-11-session-1f4285` | Untitled | - |
| 2026-08-11 | `2026-08-11-session-fadc3c` | Untitled | - |
| 2026-08-11 | `2026-08-11-session-383128` | Untitled | - |
| 2026-08-11 | `2026-08-11-session-5a7298` | Untitled | - |
| 2026-08-11 | `2026-08-11-session-6367bd` | Untitled | - |
| 2026-08-11 | `2026-08-11-session-476090` | Untitled | $ pnpm exec tsc -p tsconfig.build.json |
| 2026-08-11 | `2026-08-11-session-7f7f78` | 技能路径解析与codegraph项目优化 | 1. **CLI wire — `peaks vendor-detect`** must reach the real handler so |
| 2026-08-10 | `2026-08-10-session-53a9ad` | Untitled | peaks-code |
| 2026-08-10 | `2026-08-10-session-05b9be` | Untitled | | ID | Status (v1 → v2) | Evidence | |
| 2026-08-06 | `2026-08-06-session-cacde8` | Untitled | title: ESLint JS/TS Gate (S1) + OCR 1.8.x Multi-language Reviewer Rebu |
| 2026-08-04 | `2026-08-04-session-70ff1e` | Untitled | peaks-code |
| 2026-08-04 | `2026-08-04-session-139b31` | Untitled | statusline 当前实现（4.0.9）有 2 个独立的 user-reported 问题： |
| 2026-08-03 | `2026-08-03-session-1b6cf3` | Untitled | 对 RD 产出的两份 deliverable 做 **4 维验收**: |

<!-- peaks-managed:session-history-end -->
