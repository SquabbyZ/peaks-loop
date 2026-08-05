---
name: 2026-08-05-four-optimizations-prd-sediment
description: 2026-08-05 4 个用户优化点的 PRD 沉淀 — publish.yml tag 收紧 + hook --json flag + session-overload signal index + statusline sid-scoped lease
metadata:
  type: project
---

# 2026-08-05 four optimizations — PRD sediment

**PRD file**: `.peaks/_runtime/2026-08-04-session-3fe1be/prd/requests/2026-08-05-four-optimizations.md`
**Decided**: 2026-08-05 by AskUserQuestion (all 4 options selected as "Recommended")
**Status**: PRD-locked; 0 implementation work started in the originating session.

## Why this exists

User asked for 4 orthogonal optimizations in one /peaks-code turn. Each slice
is independently meaningful; they were not pre-existing in the project
backlog. The PRD was written so a follow-up session (or 4 parallel sub-agents)
can pick the file up and execute without re-deriving intent.

## What the 4 slices are

1. **slice 1 — publish.yml tag 收紧**: add a strict `^v[0-9]+\.[0-9]+\.[0-9]+$`
   regex gate inside publish.yml so `v4.0.11` is the only accepted shape.
2. **slice 2 — hook --json flag**: re-apply the 2026-07-27 fix (which
   regressed) — add `--json` to `.claude/settings.json:14` AND to the hook
   template in `claude-settings-template.ts`, plus a drift guard test.
3. **slice 3 — session-overload signal index**: new
   `skills/peaks-code/references/session-overload-signal-index.md` listing
   the 7 overload signals with thresholds + files + LLM actions. Document
   the red-line that LLM MUST NOT re-ask user about cost/length/context.
4. **slice 4 — active-skill.json removal**: 3 sub-slices (A: write-path,
   B: statusline resolver, C: doctor/sc/migration) replacing the
   single-slot global presence file with the 4.0.8 canonical lease
   projection at `.peaks/_runtime/<sid>/leases/`.

## How to apply (next session reading this file)

1. Open the PRD file directly. Do NOT re-derive the AskUserQuestion answers.
2. Run `peaks code detect-job` and confirm the existing job-shape decision
   is still `isJob: true` for `rid-2026-08-05-bdd-test-style`. If yes, append
   these 4 slices to the existing slice list; otherwise create a new job.
3. Sub-agent fan-out: slices 1 / 2 / 3 are independent and can run in
   parallel via `peaks sub-agent dispatch --from-dag`. Slice 4 must run
   sequentially (A → B → C) because B reads the file surface A cleans.
4. Doctor check after slice 4-C: `peaks doctor check` must report no
   active-skill.json related warnings; the workspace-layout check should
   list `.active-skill.json` as a known legacy dotfile to delete on next
   `peaks workspace reconcile`.

## Why this is a project memory (not a session sediment)

The PRD carries **user-confirmed choices** (`Recommended` selections across
4 AskUserQuestion questions). Future sessions need to know that the user
already approved this direction and that re-asking would violate the
two-forms-only / human-NL-choice-only tenet.

## Cross-references

- [[bash-pretooluse-hook-json-error-fix]] — slice 2's prior fix history.
- [[peaks-cli-version-shared-chicken-egg]] — slice 1 must not regress this.
- [[2026-08-04-statusline-session-id-fix]] — slice 4-B supersedes this.
- [[peaks-code-runbook-4-0-0-beta-6-skill-md-d-001-d-002-d-003-d-010]] —
  CLI drift index (slice 4 should not introduce new D-NNN drifts).
