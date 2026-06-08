# OpenSpec Lifecycle for Peaks Solo

Peaks Solo orchestrates RD, QA, and SC. When the target repository uses OpenSpec, Solo must drive the full lifecycle through the Peaks CLI so each role works against the same stable surface.

> **Slice #016 (2026-06-09)**: this document used to live at `openspec-mcp-workflow.md` and contained a section on the `peaks mcp *` lifecycle. The MCP subsystem was retired in slice #016; that section is gone. The OpenSpec lifecycle described below is unchanged.

## OpenSpec change lifecycle

```text
peaks openspec render   →  RD authors a change pack (dry-run, then --apply)
peaks openspec validate →  Solo gates RD output before slicing starts
peaks openspec show     →  any role reads parsed proposal/tasks state
peaks openspec to-rd    →  RD projects the pack into refactor slice input
                          SC projects it into commit boundary candidates
peaks openspec validate →  QA gates the final state before sign-off
peaks openspec archive  →  Solo moves the change under changes/archive/<id>/
```

Rules Solo applies:

- `render --apply` is the only Peaks-managed way to write a change pack. Other roles must not hand-edit `openspec/changes/**`.
- `validate` is run twice per change in a refactor flow: once before slicing (RD entry gate) and once before archive (QA exit gate). Both must end with `data.valid === true`.
- `archive --apply` is the lifecycle terminator; Solo only invokes it after QA acceptance and SC commit.

## Refactor workflow wiring

For `peaks-solo refactor` runs against a repository with `openspec/`:

1. RD entry gate — `peaks openspec validate <id>` must pass and `peaks openspec to-rd <id>` must return `acceptance.length > 0`.
2. Each slice must reference one OpenSpec tasks section as its commit boundary (per `references/openspec-commit-boundaries.md` in peaks-sc).
3. QA exit gate — re-run `peaks openspec validate <id>` after implementation; record the result in the QA validation report.
4. Archive — `peaks openspec archive <id> --apply` only after QA passes the exit gate and SC closes the final commit.

If the consuming LLM needs an MCP server for docs lookup or research (e.g. Context7), it checks its own tool list for `mcp__<server>__*` and tells the user the install command if absent. peaks-cli is no longer in the install path; the LLM is the executor, the IDE is the dispatcher.

## Boundary

Solo must not write `openspec/changes/**` or `~/.claude/settings.json` directly. Every mutation goes through the CLI commands above. The CLI returns stable envelopes; Solo captures them as artifact links rather than re-explaining their content in the handoff.
