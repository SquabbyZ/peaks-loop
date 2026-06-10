# Completion handoff

> Body of `## Peaks-Cli Completion handoff` + `### Workflow completion (no auto-exit)`.

After final validation, refresh project-local standards via `peaks standards init/update` (never hand-write). Merge scan-backed changes incrementally; preserve hand-maintained content unless user confirms deletion.

Use Peaks-Cli TXT for the compact handoff capsule: mode, validated decisions, artifact paths, standards deltas (`CLAUDE.md` and `.claude/rules/**` statuses), open questions, next action. Do not restate the full workflow log.

## Workflow completion (no auto-exit)

peaks-solo does NOT itself call `peaks skill presence:clear --project <repo>` at workflow end. Presence management is delegated to the last downstream skill in the workflow (peaks-rd, peaks-qa, peaks-txt); each of those skills owns its own presence:clear step per its SKILL.md. peaks-solo only sets presence: it does not unset it.

The user can continue with follow-up requirements naturally — no need to re-invoke `/peaks-solo` to do so. The header continues to display whatever skill is active; the user can `/peaks-solo` again to re-anchor.

Before ending, extract durable memories from this session:
```bash
peaks project memories:extract --session-id <session-id> --project <repo> --json
```