# Completion handoff

> Body of `## Peaks-Loop Completion handoff` + `### Workflow completion (no auto-exit)`.

After final validation, refresh project-local standards via `peaks standards init/update` (never hand-write). Merge scan-backed changes incrementally; preserve hand-maintained content unless user confirms deletion.

Use Peaks-Loop TXT for the compact handoff capsule: mode, validated decisions, artifact paths, standards deltas (`CLAUDE.md` and `.claude/rules/**` statuses), open questions, next action. Do not restate the full workflow log.

## Workflow completion (no auto-exit)

peaks-code does NOT itself call `peaks skill presence:clear --project <repo>` at workflow end. Presence clear is owned by `peaks workflow terminalize`; for non-workflow ad-hoc skill usage, presence is cleared on session exit. Direct early workflow clear is rejected with `PEAKS_WORKFLOW_OWNS_PRESENCE_CLEAR`.

The user can continue with follow-up requirements naturally — no need to re-invoke `/peaks-code` to do so. The header continues to display whatever skill is active; the user can `/peaks-code` again to re-anchor.

Before ending, extract durable memories from this session.

> **Owned by runbook Step 10 (TXT handoff) + Step 11 (Memory sediment in SKILL.md).** Do not duplicate the CLI invocation here — the canonical command is:
>
> ```bash
> peaks memory extract --project <repo> --artifact .peaks/_runtime/<sessionId>/txt/handoff.md --apply --json
> ```
>
> `peaks project memories:extract` is a different (batch-scoped, no-artifact) CLI used in non-handoff flows. Step 11 in SKILL.md enforces the artifact-scoped path; follow that.