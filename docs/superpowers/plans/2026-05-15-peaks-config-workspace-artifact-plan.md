# Peaks Config & Workspace/Artifact Repo Configuration — Implementation Plan

## Context

Previous phase established the **capability recommendation foundation** (`peaks recommend`, `peaks capability status`).
This phase establishes the **config and artifact workspace layer** — the infrastructure that powers all downstream Peaks workflows.

## Design Decisions (already agreed with user)

| Decision | Rationale |
|----------|-----------|
| Config layers: `~/.peaks/config.json` (user-global) + `.peaks/config.json` (project) | User settings vs project settings, precedence: project > user |
| Token policy: `env:`, `keychain:`, `gh-cli:` references, never raw secrets | Security-first; tokens come from existing auth channels |
| Multi-workspace via `workspaceId` in config | Users manage multiple projects/repos |
| Artifact workspace behind Git backend | WorkBuddy, OpenClaw, Hermes consumers use same artifact flow |
| CLI-first JSON API surface (no `peaks serve` yet) | Phase 1 scope: local tool, no HTTP wrapper |
| `--json` flag on all commands | Machine-readable output for scripting |
| `.peaks/` not gitignored — part of project artifact contract | Enables Git-backed artifact handoff |
| `.peaks-artifacts/` gitignored — working copies | Local workspace cache |

## What's NOT in this phase

- `peaks serve` HTTP wrapper (Phase 4)
- External capability deep-indexing (Phase 8)
- Full non-solo swarm profiles

---

## Task List

### Task 1 — Config Layer: Types & Service

**Files:**
- `src/services/config/config-types.ts` — config schema types
- `src/services/config/config-service.ts` — read/write config with layer merge
- `src/cli/program.ts` — add `peaks config get` and `peaks config set` commands

**Scope:**
- `PeaksConfig` type with: `version`, `currentWorkspace`, `workspaces[]`, `language`, `model`, `tokens`
- `WorkspaceConfig` type with: `workspaceId`, `name`, `rootPath`, `artifactRepo`, `installedCapabilityIds[]`
- Token reference types: `TokenRef = { env: string } | { keychain: string } | { ghCli: true }`
- Config file paths: `~/.peaks/config.json` and `.peaks/config.json`
- `readConfig()` — merges user + project configs (project overrides user)
- `writeConfig()` — writes to user global config only by default; `--local` flag writes project config
- `getWorkspaceConfig(workspaceId)` — returns workspace or null
- `setCurrentWorkspace(workspaceId)` — updates `currentWorkspace` in user config

**Commands:**
- `peaks config get --json` → prints current merged config
- `peaks config get --key <path>` → prints specific key (e.g. `workspaces[0].artifactRepo`)
- `peaks config set --key <path> --value <json> [--local]` → sets value, writes user or project config
- `peaks config workspace list --json` → lists all workspaces
- `peaks config workspace add --id <id> --name <name> --path <path> --json` → adds workspace
- `peaks config workspace remove --id <id> --json` → removes workspace
- `peaks config workspace switch --id <id> --json` → sets currentWorkspace

### Task 2 — Artifact Workspace: Schema & Service

**Files:**
- `schemas/artifact-workspace.schema.json` — validates artifact workspace config
- `src/services/artifacts/workspace-service.ts` — artifact workspace operations

**Scope:**
- `ArtifactWorkspace` type: `workspaceId`, `artifactRepo { provider, owner, name }`, `localPath`, `lastSync`, `syncStatus`
- `syncArtifactWorkspace(workspaceId)` — syncs local working copy with remote (dry-run prints plan)
- `getArtifactWorkspaceStatus(workspaceId)` — returns sync status, pending changes, last sync time
- Schema validation: must validate against `artifact-workspace.schema.json` in doctor

### Task 3 — Doctor Integration

**Files:**
- `src/services/doctor/doctor-service.ts` — already exists, extend checks
- `tests/unit/doctor.test.ts` — extend tests

**Scope:**
- Add doctor check: config file exists at `~/.peaks/config.json` (warn if missing)
- Add doctor check: current workspace config valid (warn if workspaceId points to missing dir)
- Add doctor check: artifact workspace local path exists and is readable
- Add doctor check: schema `artifact-workspace.schema.json` present

### Task 4 — Unit Tests

**Files:**
- `tests/unit/config-service.test.ts` — config layer tests
- `tests/unit/workspace-service.test.ts` — artifact workspace tests

**Coverage targets:**
- Config merge: project overrides user
- Config get/set with nested key paths
- Workspace add/remove/switch
- Artifact workspace status (configured vs unconfigured vs out-of-sync)

### Task 5 — CLI Integration & Smoke Tests

**Scope:**
- All new commands wire into `program.ts`
- `--json` consistency on all commands
- Run `peaks config --help` and `peaks config workspace --help` to verify

---

## Acceptance Criteria

- [ ] `peaks config get --json` returns merged config with both layers
- [ ] `peaks config workspace list` shows empty list initially
- [ ] `peaks config workspace add --id test --name "Test Workspace" --path . --json` works
- [ ] `peaks config workspace switch --id test --json` updates currentWorkspace
- [ ] `peaks artifacts status --json` reads from workspace config (not hardcoded)
- [ ] Doctor checks pass for new schema and config files
- [ ] All new UT pass
- [ ] TypeScript clean (`pnpm typecheck`)
- [ ] 80%+ coverage on new code