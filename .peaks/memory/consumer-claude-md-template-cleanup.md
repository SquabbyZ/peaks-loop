# Consumer CLAUDE.md template cleanup (slice 028)

> Source: peaks-loop project memory, captured 2026-06-10 from slice 028.
> Scope: applies to the consumer-facing CLAUDE.md template emitted by
> `peaks standards init` / `peaks standards update`, to the new
> `peaks standards migrate` rewriter, and to the new
> `peaks skill detect-marker-loss` detection primitive.

## What changed

`src/services/standards/project-standards-service.ts:232-254` no longer emits a
multi-step heartbeat-check block into consumer projects' `CLAUDE.md`. The
old 28-line block contained three things that should never have leaked to
consumers:

1. `peaks skill heartbeat:touch` and `peaks skill presence:clear` per-turn
   LLM instructions (CLI primitives, not LLM instructions).
2. A direct reference to the legacy `.peaks/.active-skill.json` path
   (the post-slice-2026-06-05 canonical home is
   `.peaks/_runtime/active-skill.json`).
3. An `External reference: https://github.com/affaan-m/everything-claude-code`
   line that was peaks-loop-internal, not consumer-facing.

The new head section is a single 1-line sentence that routes the LLM
through `peaks skill presence --json` and tells it to render a compact
status header when a valid skill is active. It matches the post-slice-025
peaks-loop repo's own `CLAUDE.md`.

## The 3 locked decisions (user confirmed 2026-06-10)

1. **Q1 = A**: the slice INCLUDES a new `peaks skill detect-marker-loss`
   primitive that reads `.peaks/_runtime/active-skill.json` (with legacy
   fallback) and compares it against the latest assistant message. If a
   presence marker is active but the message lacks the
   `Peaks-Loop Skill:` / `Peaks-Loop Gate:` marker, the primitive returns
   `markerFound: false` and a `warning` string for the caller to surface.
   The implementation lives in
   `src/services/hooks/presence-marker-detector.ts` and is wired into
   `peaks skill detect-marker-loss --project <repo> [--message <text>]`
   in `core-artifact-commands.ts`.

2. **Q2 = A**: the slice INCLUDES a new `peaks standards migrate` command
   that rewrites a consumer project's `CLAUDE.md` in place. The command
   is dry-run by default and requires explicit `--apply` to write. The
   implementation lives in
   `src/services/standards/migrate-service.ts` and is wired into
   `standards.migrate` in `core-artifact-commands.ts`.

3. **Q3 = A**: the new head-section text is the 1-line sentence drafted
   in PRD-028 §D1 (post-slice-025 peaks-loop repo style). It does NOT
   include any of: `heartbeat:touch`, `presence:clear`, `Default runbook`,
   `Startup sequence`, `Swarm parallel phase`, `Do NOT skip step`,
   `<!-- Peaks-Loop 心跳检测`, `everything-claude-code` (URL).

## Consumers that already have the old text in their CLAUDE.md

Run:

```bash
peaks standards migrate --project <consumer-repo> --apply
```

to rewrite the legacy heartbeat block in place. The migration is
idempotent: re-running on an already-migrated `CLAUDE.md` returns
`foundOldBlock: false, applied: false` with the next-action
`CLAUDE.md is already up to date`.

The migrator is conservative: it only touches content between the
`<!--` opener line and the `External reference: ...` closer line. If the
opener was stripped by an editor, the migrator falls back to detecting
any of the 5 forbidden legacy strings and cuts from the start of the
line where the first one appears.

## Dogfood results (slice 028)

1. `pnpm build` → clean.
2. `pnpm tsc --noEmit --pretty false` → 0 errors.
3. `pnpm vitest run tests/unit/project-standards-service.test.ts`
   → 19 passed, 1 skipped (Windows symlink test, pre-existing).
4. `pnpm vitest run tests/unit/services/standards/migrate-service.test.ts`
   → 6 passed.
5. `pnpm vitest run tests/unit/services/hooks/presence-marker-detector.test.ts`
   → 6 passed.
6. `peaks standards migrate --project .` (peaks-loop repo's own CLAUDE.md)
   → `foundOldBlock: false, wouldChange: false, applied: false` with
   `CLAUDE.md is already up to date`. Confirms the peaks-loop repo was
   already on the post-slice-025 template.
7. `peaks standards migrate --project <temp-fixture> --apply` on a
   fixture containing the full legacy block → `applied: true`, 27 lines
   before → 8 lines after, surrounding `# Project Notes` and
   `# Tail content` preserved. All 5 forbidden strings absent from
   the rewritten file; new `peaks skill presence --json` and
   `Peaks-Loop Skill: <skill>` markers present.
8. `peaks skill detect-marker-loss --project .` → returns
   `active: true, skill: peaks-solo, markerFound: false, warning: ...`
   (no `--message` was passed; this is the correct contract: presence
   is active but the latest assistant message is empty / unmarked).
9. `peaks skill detect-marker-loss --project . --message "Peaks-Loop Skill: peaks-solo | Peaks-Loop Gate: rd | Next: work"`
   → `active: true, skill: peaks-solo, markerFound: true, warning: undefined`.

## Why this slice exists (rule references)

- `peaks-current-directory-scope` — the new commands follow the
  `--project <path>` convention rather than `process.cwd()` heuristics.
- `peaks-skill-output-style` — the new template mentions
  `Peaks-Loop Skill: <skill> | Peaks-Loop Gate: <gate> | Next: <one short action>`
  in the same shape as the existing output-style header, so consumers
  do not need a new mental model.
- `skill-first-cli-auxiliary-sub-agent-dispatch` — the new commands
  are justified under sub-rule (2) of the dev-preference
  (skill-first/CLI-auxiliary): they return structured JSON envelopes
  the skill reads back. `peaks standards migrate` is also a
  destructive side effect (sub-rule 3) and is therefore mandatory
  `--apply`-gated. The detection primitive is wired into
  `peaks skill *` (existing verb) rather than a new top-level command.
- `feedback_skill_red_lines_need_cli_backing.md` — slice 028 is the
  converse case: when the SKILL.md says "the LLM should display
  the status header", the `detect-marker-loss` primitive is the
  machine check that flags drift between the LLM's behavior and
  the contract.

## What this slice does NOT do

- Does not delete `peaks skill heartbeat:touch` or
  `peaks skill presence:clear` — those are still CLI commands and
  are used by `peaks-loop`'s own internal role hand-off flow
  (peaks-rd, peaks-qa, peaks-solo). The slice just stops emitting
  LLM instruction text about them.
- Does not change the `sourceId: 'everything-claude-code'` in
  `project-standards-service.ts` (that's a source-of-standards
  identifier, not the URL reference the user flagged).
- Does not touch the peaks-solo / peaks-rd / peaks-qa / peaks-txt
  / peaks-prd / peaks-sc SKILL.md bodies. The post-slice-026 line
  caps (217/217, 209/217, 245/245) are unchanged.
