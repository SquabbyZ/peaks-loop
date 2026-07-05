# OpenSpec CLI for Peaks RD

Peaks RD reads OpenSpec change packs through the Peaks CLI rather than re-parsing markdown or spawning subprocesses by hand. The CLI returns the same stable envelope shape (`{ ok, command, data, warnings, nextActions }`) so RD can capture it as artifact JSON.

> **Slice #016 (2026-06-09)**: this document used to live at `openspec-mcp-cli.md` and contained a section on the now-retired peaks-loop MCP install / call verbs. The MCP subsystem was retired in slice #016; the LLM's own tool list is now the source of truth for installed MCPs. The OpenSpec CLI recipes below are unchanged.

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

## Library docs lookup via the LLM's own MCP tool list (slice #016)

When RD needs external library or API docs, the consuming LLM checks its own tool list for an MCP entry (typically `mcp__plugin_context7_context7__*` for Context7). If present, the LLM invokes the tool by name directly (`resolve-library-id` then `query-docs` are the canonical Context7 tool names). If absent, the LLM tells the user the install command:

```bash
# Claude Code:
claude mcp add context7 -- npx @upstash/context7-mcp
# Restart the IDE after install; the runtime picks up the new server only after a fresh process.
```

peaks-loop does not install MCPs on the user's behalf as of slice #016; the LLM is the executor and the IDE is the dispatcher. Evidence of the lookup (sanitized query + response summary) goes into the RD artifact, not full network bodies or secrets.

## Boundary

Peaks RD must not hand-edit `openspec/changes/**` or `~/.claude/settings.json` directly. All OpenSpec writes go through the CLI commands above with dry-run preview, explicit confirmation, and Peaks-managed source labels.
