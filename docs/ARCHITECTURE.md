# Peaks Architecture

## Layers

```text
Peaks skills          Capability definitions, workflow rules, artifact contracts
Peaks CLI services    Install/config/doctor/sync/rollback side effects
Runtime adapters      Claude Code hooks, skills, MCP, agents, swarm profiles
Artifact repository   GitHub-backed intermediate artifacts and validation evidence
External UI clients    Claude Code Router visual client and other callers
```

## Skill and CLI boundary

Skills describe what should happen. The CLI performs side effects.

Skills can:

- Define role responsibilities.
- Define refactor gates and acceptance rules.
- Reference external capabilities such as skills or MCP.
- Produce or consume artifact contracts.
- Recommend profiles.

Skills must not silently:

- Modify `.claude/settings.json`.
- Install hooks.
- Create `.claude/agents`.
- Enable MCP servers.
- Store tokens.
- Create remote repositories.

The CLI owns those actions through explicit commands, dry runs, reports, and rollback.

## External-callable CLI surface

Every important command should support:

- `--json` for machine-readable output.
- `--dry-run` for previewing side effects.
- `--yes` only where explicit non-interactive confirmation is safe.
- stable envelopes: `{ ok, command, data, warnings, nextActions }`.
- stable error codes for UI integration.

The Claude Code Router UI can call CLI commands or reuse services later without parsing human text.

## Coexistence with cc-switch

Peaks must not read or write cc-switch's database. It should:

- Scan Claude live state.
- Mark unknown items as unmanaged.
- Manage only Peaks-managed items or items explicitly imported/claimed by the user.
- Preserve user-managed and cc-switch-managed entries.
- Use dry-run diff, backup, and rollback before sync.

## Artifact repository

MVP uses a remote artifact repository as the primary store. GitHub and GitLab are both valid providers; GitLab is important for private intranet code hosts. The project still keeps a local `.peaks-artifacts/` working copy tied to that remote.

The CLI creates or links the artifact repository only after confirmation or an enabled automation profile. Tokens must never be written to skills, artifacts, reports, or committed config.
