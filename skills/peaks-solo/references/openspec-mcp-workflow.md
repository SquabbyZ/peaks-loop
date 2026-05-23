# OpenSpec and MCP Lifecycle for Peaks Solo

Peaks Solo orchestrates RD, QA, and SC. When the target repository uses OpenSpec or external MCP servers, Solo must drive the full lifecycle through the Peaks CLI so each role works against the same stable surface.

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

## MCP capability lifecycle

```text
peaks mcp list / scan   →  Solo inventories what is configured today
peaks mcp plan          →  Solo previews the install diff before any write
peaks mcp apply --yes   →  Solo authorizes the install (real side effect)
peaks mcp call          →  RD or QA invokes a tool on the installed server
peaks mcp rollback      →  Solo restores from a peaks-managed backup
```

Rules Solo applies:

- `apply` is the first real side effect in the MCP track. It requires `--yes`, backs up `~/.claude/settings.json` first, and refuses to overwrite non-peaks-managed entries unless `--claim` is passed. Solo decides whether `--claim` is appropriate.
- Required env vars must be set in the runtime environment before `apply` or `call`. Peaks refuses to spawn a server with missing env, surfacing each missing key in `envCheck.missing`.
- `call` writes evidence into the RD or QA artifact. Solo never pastes secrets, full request/response bodies, or session tokens into the handoff capsule.
- `rollback` is the recovery action when an install or update made things worse. The backup path is the one Peaks reported during `apply`.

## Refactor workflow wiring

For `peaks-solo refactor` runs against a repository with `openspec/`:

1. RD entry gate — `peaks openspec validate <id>` must pass and `peaks openspec to-rd <id>` must return `acceptance.length > 0`.
2. Each slice must reference one OpenSpec tasks section as its commit boundary (per `references/openspec-commit-boundaries.md` in peaks-sc).
3. QA exit gate — re-run `peaks openspec validate <id>` after implementation; record the result in the QA validation report.
4. Archive — `peaks openspec archive <id> --apply` only after QA passes the exit gate and SC closes the final commit.

If MCP servers are needed for docs lookup or research, Solo coordinates the one-time install before RD starts so RD does not block on capability resolution mid-slice.

## Boundary

Solo must not write `openspec/changes/**` or `~/.claude/settings.json` directly. Every mutation goes through the CLI commands above. The CLI returns stable envelopes; Solo captures them as artifact links rather than re-explaining their content in the handoff.
