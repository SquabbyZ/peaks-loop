# peaks-mcp Design

## Goal

Add a `peaks-mcp` skill and Peaks CLI MCP management surface that installs a curated set of MCP servers selected by the project. The install path is intentionally one-click and idempotent: if a Claude MCP server is already installed, Peaks skips it.

## Product Positioning

Peaks is an orchestration layer for useful skills, MCP servers, and swarm-style agent workflows. `peaks-mcp` makes MCP setup part of that orchestration instead of leaving users to manually discover and configure each server.

## Curated MCP Set

The initial curated list comes from `docs/mcpServer.md` and includes:

- ruflo
- context7
- playwright-mcp
- chrome-devtools
- context-mode
- modelcontextprotocol/servers
- searchcode
- mysql_mcp_server
- figma-context-mcp
- GitNexus

Each entry should have a stable internal id, display name, source URL, install strategy, and skip-detection key.

## CLI Surface

Add an MCP command group to Peaks CLI:

- `peaks mcp install [--dry-run] [--yes] [--json]`
- `peaks mcp list [--json]`
- `peaks mcp gitnexus`

`peaks mcp install` installs the curated set into Claude Code MCP configuration. It checks existing Claude MCP servers first and skips entries with matching names. `--dry-run` reports planned additions and skipped entries. `--yes` allows non-interactive execution.

`peaks mcp list` prints the curated registry and installation state for UI and skill callers.

`peaks mcp gitnexus` is the MCP server entrypoint Claude Code should call for GitNexus. Claude configuration should point at Peaks, not at a user-global GitNexus install.

## GitNexus Proxy Design

GitNexus should be proxied through Peaks CLI rather than installed globally. The MCP configuration should be shaped like:

```bash
claude mcp add gitnexus -- peaks mcp gitnexus
```

The proxy is a shared capability boundary. It is callable by users and by skills, so outputs and command behavior must be stable and machine-readable where appropriate.

Future lifecycle commands can be added under a dedicated group:

- `peaks gitnexus setup`
- `peaks gitnexus analyze [path]`
- `peaks gitnexus status [path]`
- `peaks gitnexus clean [path]`

These are not required for the first install milestone unless needed to make `peaks mcp gitnexus` work.

## Data Flow

1. User or skill invokes `peaks mcp install`.
2. Peaks loads the curated MCP registry.
3. Peaks reads installed Claude MCP servers.
4. Peaks computes a plan: add missing, skip existing, report unsupported/manual entries.
5. In dry-run mode, Peaks returns the plan only.
6. In execution mode, Peaks invokes Claude MCP add commands for missing entries.
7. For GitNexus, Peaks adds a Claude MCP server that points to `peaks mcp gitnexus`.

## Error Handling

- Missing `claude` executable: return a stable error and next action to install or expose Claude Code CLI.
- Existing server: skip, not fail.
- Failed MCP add: report the specific server id and keep processing only if the failure is isolated and safe.
- Unknown install strategy: mark as manual/unsupported instead of guessing.
- GitNexus proxy startup failure: surface the underlying command failure without swallowing stderr.

## Testing

Add unit tests for:

- curated registry shape
- install-plan calculation with existing servers
- GitNexus entry generating a Peaks proxy command
- JSON result envelope shape
- error handling for missing Claude CLI and add failures

Add CLI tests for:

- `peaks mcp list --json`
- `peaks mcp install --dry-run --json`

## First Milestone Scope

Implement the skill and CLI planning surface first. If direct `claude mcp add` execution needs platform-specific quoting or broader environment testing, keep execution behind `--yes` and make dry-run the default until verified.

## Out of Scope

- Desktop enable/disable UI
- Remote MCP marketplace discovery
- Automatic token or secret setup
- User-global GitNexus installation
- Full GitNexus indexing lifecycle beyond the MCP proxy entrypoint
