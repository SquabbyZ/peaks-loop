# PRD Request 2026-06-04-monorepo-and-release

- session: 2026-06-04-session-cda1cd
- type: feature
- source: dogfood report from 2026-06-04 round 2 (peaks-cli ↔ ice-cola)
- raw input (sanitized): "A B C都修" — user accepted three options surfaced in the dogfood report: (A) full RD slice to fix `peaks scan libraries` monorepo-blind; (B) chore slice to bump version to 1.2.9 and add `pnpm install` onboarding note to README; (C) write an issue/PR description for the monorepo-blind defect as a deferred backlog item.

## Goals

- Address three findings from the 2026-06-04 ice-cola dogfood pass in a single coordinated release.
- Slice C: capture the monorepo-blind defect as a reproducible issue document (no code change). Located at `.peaks/2026-06-04-session-cda1cd/sc/issue-001-monorepo-blind.md` for tracking; the canonical ticket content lives in this PRD and the issue file.
- Slice A: extend `peaks scan libraries` to discover and enumerate dependencies across pnpm / npm / yarn workspaces. The scan must not regress on single-package projects and must clearly mark per-workspace provenance on the report.
- Slice B: bump `package.json` version to `1.2.9` and append a one-paragraph "clone → pnpm install → tsx" note to `README.md` so a fresh checkout of peaks-cli is not blocked by missing `chalk/ora/terminal-kit` in `node_modules`.

## Non-goals

- No new breaking changes to the `scanLibraries` JSON envelope shape — only additive fields (per-workspace group, monorepo-detection flag).
- No release of a new global npm tag in this slice — the version bump is recorded in source; publishing happens separately.
- No new CLI commands (per the dev-preference rule: skill-first / CLI-auxiliary). Slice A touches an existing command's behavior only.
- No code changes for Slice C — it is a documentation deliverable.

## Preserved behavior

- Single-package projects (no `pnpm-workspace.yaml`, no `workspaces` field in `package.json`, no `lerna.json`): output shape and counts identical to today.
- `peaks scan libraries --project <path>` without monorepo detection on a single-package project: returns the same `libraries[]`, `byScope`, `warnings` fields.
- `peaks skill doctor`, `peaks skill runbook peaks-solo`, `peaks scan archetype` outputs unchanged.
- The destructive-`--apply` gate posture (4 --apply lines in peaks-solo runbook) is preserved.

## Acceptance criteria

- Slice C: `.peaks/2026-06-04-session-cda1cd/sc/issue-001-monorepo-blind.md` exists with sections: Summary, Reproduction (verbatim CLI output from round 2 dogfood), Impact, Proposed Fix Sketch, Test Plan, References. No code diff.
- Slice A (verified on ice-cola after fix):
  - `pnpm exec tsx src/cli/index.ts scan libraries --project ice-cola --json` returns ≥ 200 total library entries (ice-cola has ~220 deps across 7 package.json files).
  - Report includes a new `workspaces` field listing each discovered `package.json` path and its library count.
  - On a single-package fixture (e.g. a temp dir with one `package.json`), the report shape is byte-identical to today's output (no `workspaces` field, or `workspaces: []`).
  - Unit tests cover: pnpm-workspace.yaml glob, npm workspaces field, yarn workspaces field, monorepo with nested workspace globs (e.g. `packages/hermes-agent/*`).
- Slice B:
  - `package.json` version field reads `1.2.9`.
  - `README.md` (or `README.md` equivalent) contains a "First-time setup" or equivalent section explicitly stating: `git clone … && pnpm install && pnpm dev` (or the equivalent that surfaces the missing-deps error before the user hits it).
  - `peaks --version` reflects the new version after `pnpm build`.

## Frontend delta (only when target is in scope)

- Not applicable. peaks-cli is a CLI tool; no UI changes.

## Risks and open questions

- Risk: `peaks scan libraries` is part of the peaks-solo runbook (command #6). A behavior change must be back-compatible or the runbook line count check (peaksCommandCount === 31) will move. Confirm post-fix the runbook still surfaces 31 commands; if the runbook body was updated in `4a7b0ad` to add this line, the addition is stable.
- Risk: monorepo detection adds a glob resolution step. `fast-glob` is not currently a dependency; using `node:fs.readdir` + manual glob match avoids a new dep but may struggle with deep `**` patterns. Decision: hand-rolled matcher for the supported shapes; document the limitation.
- Open question: should the per-workspace `libraries` array also include the workspace's own name/version? Today the report does not carry a "self" entry. Decide during RD implementation; default to including `name + version` of the workspace as the first entry per workspace group, behind a `--include-self` flag (default off).
- Open question: how to handle overlapping matches (e.g. pnpm-workspace.yaml AND npm `workspaces` field both present). Decision: prefer pnpm-workspace.yaml if it exists; fall back to npm `workspaces`; document precedence.

## Handoff

- to peaks-rd: .peaks/2026-06-04-session-cda1cd/rd/requests/2026-06-04-monorepo-and-release.md
- to peaks-qa: .peaks/2026-06-04-session-cda1cd/qa/requests/2026-06-04-monorepo-and-release.md
- to peaks-ui: (skip — no UI)

## Sub-slice plan (sequential, not parallel — avoid commit conflicts)

1. **Slice C** (`type: docs`) — write issue file. No code diff, no QA gate. Commit: `docs(issue): capture peaks scan libraries monorepo-blind defect`.
2. **Slice A** (`type: feature`) — RD work for monorepo detection. Full gates: tech-doc, code-review, security-review, test-cases, test-report, security-findings, performance-findings. Commit: `feat(scan): discover monorepo packages in peaks scan libraries`.
3. **Slice B** (`type: chore`) — version bump + README note. Light gates. Commit: `chore(release): bump to 1.2.9 + README pnpm install note`.

## Status

- created: 2026-06-04T12:57:42.335Z
- last update: 2026-06-04T12:59:59.933Z
- state: handed-off
