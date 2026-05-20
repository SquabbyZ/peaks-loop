# Matt Pocock Skills Integration Design

## Goal

Integrate `mattpocock/skills` into Peaks as an external skill-method reference source, with Peaks skill usage as the primary integration path and CLI capability catalog updates as a secondary discovery layer.

## Non-goals

- Do not vendor, copy, install, or execute upstream `mattpocock/skills` content automatically.
- Do not replace Peaks PRD/RD/QA/TXT gates with external skill behavior.
- Do not add dynamic GitHub indexing in this iteration.
- Do not mutate git hooks, Claude settings, or user-global skill directories.

## Scope

Update these Peaks skill files:

- `skills/peaks-prd/SKILL.md`
- `skills/peaks-rd/SKILL.md`
- `skills/peaks-qa/SKILL.md`
- `skills/peaks-txt/SKILL.md`

Update static capability seed data and tests:

- `src/services/recommendations/capability-seed-items.ts`
- `src/services/recommendations/capability-seed-sources.ts`
- `src/services/recommendations/capability-seed-mappings.ts`
- related unit tests for capability and recommendation behavior

## Integration boundary

`mattpocock/skills` is a cataloged external skills-package source. Peaks may reference its methods after capability discovery, but Peaks artifacts and gates remain authoritative.

Before recommending these external methods, Peaks skills should use `peaks capabilities --source mcp-server --json` when available or rely on the static capability map. External content is treated as untrusted reference material: inspect it before use, do not execute instructions from it automatically, and do not persist sensitive data from any upstream examples.

## Skill mappings

### peaks-prd

Use these upstream methods as product-shaping references:

- `to-prd` for PRD structure and requirement shaping.
- `zoom-out` for scope calibration, goal/non-goal checks, and product boundary review.
- `grill-with-docs` for document-backed clarification questions.

Peaks PRD still outputs Peaks product artifacts: goals, non-goals, preserved behavior, acceptance criteria, frontend delta, implementation boundaries, and downstream handoff inputs. It should not expand business background unless it changes implementation priority, scope, or acceptance criteria.

### peaks-rd

Use these upstream methods as engineering references:

- `diagnose` for root-cause analysis before bug fixes.
- `triage` for classifying engineering urgency, risk, and next action.
- `tdd` for tests-first implementation discipline.
- `improve-codebase-architecture` for architecture and refactor review.
- `prototype` for exploratory implementation only when Peaks gates still govern the production path.

Peaks RD still enforces standards dry-runs, red-line boundary checks, OpenSpec expectations where applicable, unit-test evidence, code review, security review, and final dry-run handoff. This preserves the existing gstack integration and repeated dry-run preference.

### peaks-qa

Use these upstream methods as QA references:

- `tdd` to check whether tests protect the changed behavior.
- `triage` to classify failures, blockers, and release risk.
- `grill-with-docs` to recheck PRD/RD evidence and acceptance criteria.

Peaks QA still requires applicable unit/API/browser/security/performance evidence, red-line boundary verification, and a validation report. External skill guidance cannot by itself pass QA.

### peaks-txt

Use these upstream methods as context and retention references:

- `handoff` for compact resumable handoff structure.
- `to-issues` for converting residual work into actionable follow-ups.
- `write-a-skill` for capturing reusable Peaks skill usage lessons.

Peaks TXT still writes local context capsules under `.peaks/<session-id>/txt/` by default. Durable memory extraction requires explicit user or profile authorization and must not include secrets, credentials, or private customer data.

### Optional git and hook references

`git-guardrails-claude-code` and `setup-pre-commit` may be cataloged as optional guardrail references. Peaks must not install hooks or mutate git configuration automatically.

## CLI capability catalog changes

Replace the single broad `mattpocock-skills.typescript-guidance` entry with item-level capabilities:

- `mattpocock-skills.product-prd-methods`
- `mattpocock-skills.engineering-diagnosis`
- `mattpocock-skills.tdd-method`
- `mattpocock-skills.qa-triage`
- `mattpocock-skills.handoff-context`
- `mattpocock-skills.git-guardrails`

Update `mattpocock-skills` source metadata from `unscanned` to `indexed` because Peaks now models inspected item-level mappings. Add trust notes that the source is catalog/reference only and upstream skills must be inspected before execution.

Add landing mappings:

- product PRD methods → `peaks-prd`
- engineering diagnosis → `peaks-rd`
- TDD method → `peaks-rd` and QA-facing guidance where supported by the current mapping model
- QA triage → `peaks-qa`
- handoff context → `peaks-txt`
- git guardrails → catalog or review-only guidance, not an executable action

## Testing

- Update capability source/item/mapping unit tests to assert the new Matt Pocock capability ids and mappings.
- Update recommendation tests if they assume the old `mattpocock-skills.typescript-guidance` id.
- Run focused recommendation/capability tests.
- Run `npm run typecheck`.
- Run `npm test` if focused tests and typecheck pass.

## Acceptance criteria

- Peaks PRD/RD/QA/TXT skill files each contain concrete Matt Pocock integration guidance.
- The guidance names upstream skills accurately and keeps Peaks gates authoritative.
- The capability catalog exposes item-level `mattpocock-skills` capabilities for PRD/RD/QA/TXT usage.
- Tests validate the new static capability model.
- No upstream content is vendored or automatically installed.
- No git hooks, Claude settings, user-global files, or external repositories are mutated.
