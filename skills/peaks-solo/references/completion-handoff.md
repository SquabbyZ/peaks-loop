# Completion handoff

> Body of `## Peaks-Cli Completion handoff` + `### Workflow completion (no auto-exit)`.

After final validation, refresh project-local standards via `peaks standards init/update` (never hand-write). Merge scan-backed changes incrementally; preserve hand-maintained content unless user confirms deletion.

Use Peaks-Cli TXT for the compact handoff capsule: mode, validated decisions, artifact paths, standards deltas (`CLAUDE.md` and `.claude/rules/**` statuses), open questions, next action. Do not restate the full workflow log.

## Workflow completion (no auto-exit)

Do NOT call `peaks skill presence:clear --project <repo>` at workflow end. The presence file and header remain active so the user stays inside the workflow context. The user can continue with follow-up requirements naturally — no need to re-invoke `/peaks-solo`. The header continues to display the active skill and current gate.

Before ending, extract durable memories from this session:
```bash
peaks project memories:extract --session-id <session-id> --project <repo> --json
```