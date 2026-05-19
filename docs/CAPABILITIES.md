# Capability Model

Peaks prefers external skills and MCP over reimplementing specialist capabilities.

## Resolution pipeline

```text
Peaks skill identifies capability need
  -> check installed capability registry
  -> ask for consent before token-heavy discovery unless profile allows auto
  -> use find-skills to discover candidates when needed
  -> current Peaks skill selects a candidate
  -> Peaks CLI installs/enables/doctors the capability
  -> Claude Code runtime invokes external skill or MCP
  -> fallback to Peaks built-in flow if unavailable
```

## Consent policy

Default policy:

- `capabilityDiscovery = ask`
- `installExternalSkills = ask`
- `enableMcp = ask`

Automatic discovery is allowed only when a profile explicitly grants it and stays within budget.

## CLI-managed resources

The CLI manages desired state and sync for:

- skills
- MCP servers
- hooks
- agents
- swarm profiles
- automation profiles
- proxy settings
- artifact repositories

## UI integration

Visual clients should call commands with `--json` and `--dry-run`, then ask users to confirm side effects.
