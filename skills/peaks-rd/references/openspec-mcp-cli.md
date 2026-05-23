# OpenSpec and MCP CLI for Peaks RD

Peaks RD reads OpenSpec change packs and external MCP servers through the Peaks CLI rather than re-parsing markdown or spawning subprocesses by hand. The CLI returns the same stable envelope shape (`{ ok, command, data, warnings, nextActions }`) so RD can capture it as artifact JSON.

## Loading an existing OpenSpec change as RD input

When the target repository already has `openspec/changes/<id>/`, project the change pack into the RD input shape before slicing:

```bash
peaks openspec show <change-id> --project <repo> --json
peaks openspec to-rd <change-id> --project <repo> --json
```

- `show` returns the parsed proposal sections, tasks progress, and detected `specs/<capability>/` capabilities.
- `to-rd` returns `{ changeId, acceptance, whatChanges, dependencies, risks, outOfScope, commitBoundaries[] }`. RD slice acceptance must be derived from `acceptance`; out-of-scope items from `outOfScope` must remain out of scope in the slice spec.

If the change does not exist, `to-rd` returns `OPENSPEC_CHANGE_NOT_FOUND`. Treat that as a blocker, not an excuse to free-form a slice spec.

## Rendering a new OpenSpec change pack from RD work

When RD plans a non-trivial change in a repository that already uses `openspec/`, generate the change pack first (default dry-run), inspect the rendered markdown, and only then write it:

```bash
peaks openspec render --request <jsonPath> --project <repo> --json
peaks openspec render --request <jsonPath> --project <repo> --apply --json
```

The request JSON shape is:

```json
{
  "changeId": "<kebab-case>",
  "why": "...",
  "whatChanges": ["..."],
  "outOfScope": ["..."],
  "dependencies": ["..."],
  "risks": ["..."],
  "acceptanceCriteria": ["..."],
  "tasks": [{ "heading": "1. <section>", "todos": ["..."], "doneItems": ["..."] }],
  "design": "<raw markdown>"
}
```

`render --apply` refuses to overwrite an existing change directory unless `--overwrite` is passed. Treat that refusal as intentional.

## Calling MCP tools for research evidence

When RD needs external library or API docs, prefer a registered MCP server through Peaks instead of free-form web fetches:

```bash
peaks mcp list --json
peaks mcp plan --capability context7.docs-lookup --json
peaks mcp apply --capability context7.docs-lookup --yes --json   # one-time install
peaks mcp call --capability context7.docs-lookup --tool <toolName> --args-json '{...}' --json
```

Rules:

- `plan` must be inspected before `apply`. `apply` is a real side effect; it backs up `~/.claude/settings.json` first.
- Required env vars must be present before `apply` and `call`; Peaks refuses to spawn a server with missing env.
- `call` results should be written into the RD artifact (e.g. `.peaks/<session-id>/rd/mcp-call-<ts>.json`) as the evidence link. Do not paste secrets or full network bodies into the RD handoff.

## Boundary

Peaks RD must not hand-edit `openspec/changes/**` or `~/.claude/settings.json` directly. All writes go through the CLI commands above with dry-run preview, explicit confirmation, and Peaks-managed source labels.
