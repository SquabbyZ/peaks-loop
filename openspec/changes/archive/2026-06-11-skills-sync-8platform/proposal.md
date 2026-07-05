# peaks skills sync 8-platform distribution

## Why

Per spec §9 line 1105 (Slice #12 final piece): "`peaks skills sync`
8 平台分发". The peaks-loop skill family (peaks-code / peaks-rd /
peaks-qa / peaks-prd / peaks-sop / peaks-sc / peaks-ui / peaks-txt /
peaks-ide / peaks-doctor) lives in the repo at `skills/<name>/SKILL.md`.
The IDE-adapter layer (Slice 0.7) already enumerates 8 supported
target platforms in the `IdeId` enum:

- `claude-code` (Slice 0.7, verified)
- `trae` (Slice 0.7, verified)
- `codex` (registered, not yet dogfooded)
- `cursor` (registered, not yet dogfooded)
- `qoder` (registered, not yet dogfooded)
- `tongyi-lingma` (registered, not yet dogfooded)
- `hermes` (registered, not yet dogfooded)
- `openclaw` (registered, not yet dogfooded)

The 8 platforms are wired into the `IdeSkillInstall` profile, and
`scripts/install-skills.mjs` already exports `installBundledSkills({
ideId, projectRoot })` — the symlink installer is platform-aware.
What is missing is the CLI surface that fans out to all 8 platforms
in one command.

## What Changes

### New CLI: `peaks skill sync`

```
peaks skill sync [--platform <id> | --all] [--dry-run] [--project <path>] [--json]
```

Default behavior (`--all`): iterate the 8 IdeId values, call
`installBundledSkills({ ideId, projectRoot, ... })` for each,
report a per-platform result. Idempotent: re-running is a no-op
when the symlinks are already correct (the existing
`installBundledSkills` early-returns on `linkTarget === sourcePath`).

Per-platform result:
- `installed`: skills newly symlinked (or `[]` on no-op)
- `skipped`: skills whose target is not a managed symlink (third-party
  owned)
- `error`: optional string when the IDE's `skillInstall` profile
  is missing or the symlink failed
- `durationMs`: wall-clock for the platform's sync

Aggregate result:
- `totalRedLines` (no, this is the audit command; here it's)
- `syncedCount`: number of platforms that returned a successful
  result
- `failedCount`: number of platforms that returned an error
- `totalInstalled`: sum of `installed.length` across all platforms

Flags:
- `--platform <id>`: sync only one platform (e.g. `--platform claude-code`).
  Default is `--all` (iterate all 8).
- `--dry-run`: do not write; emit the same shape with `installed: []`
  and `applied: false`.
- `--project <path>`: project root (used to detect the per-IDE
  install target). Default: process.cwd().
- `--json`: emit the JSON envelope.

### Service: `src/services/skills/sync-service.ts`

Pure wrapper over `scripts/install-skills.mjs`'s
`installBundledSkills`. Lists the 8 IdeIds statically, calls
`installBundledSkills` for each, returns the aggregated result.

## Acceptance Criteria

- A1 — `peaks skill sync --all --project .` exits 0; the
  `syncedCount` is 8 and `failedCount` is 0 on a clean tree.
- A2 — `peaks skill sync --platform claude-code --project .`
  exits 0; the result is a 1-platform array with `syncedCount: 1`.
- A3 — `peaks skill sync --dry-run` does NOT create any new
  symlinks; the existing tree is unchanged after the run.
- A4 — Re-running is a no-op: `installed: []` for every platform
  (idempotent contract from `install-skills.mjs`).
- A5 — TDD: at least one unit test per behavior; full vitest green.
- A6 — `peaks skill sync --platform bogus` rejects with a
  non-zero exit; the IdeId is validated against the registry.

## Spec reference (canonical)

- `docs/superpowers/specs/2026-06-11-peaks-loop-l1-l2-l3-redesign.md`
  §9 line 1105 (Slice #12 final piece)
- `src/services/ide/ide-types.ts:16-24` (the 8-platform IdeId union)
- `scripts/install-skills.mjs:496-580` (the existing per-IDE
  symlink installer)

## Out of scope

- Per-platform install validation (the existing
  `install-skills.mjs` already validates the install root is
  not a symlink / hardlink / etc.)
- Auto-detection of which 8 platforms the user has installed
  (the slice ships `--all` + `--platform <id>`; an `--only-installed`
  mode is left for a future slice)
