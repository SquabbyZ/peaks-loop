# Existing System Extraction: peaks-cli
**Date:** 2026-06-04
**Session:** 2026-06-04-session-b60252
**Archetype:** legacy-frontend (CLI, not web)

## Visual tokens
- colors: [] (no web UI; CLI color via chalk)
- spacing: [] (no web UI; terminal output uses text layout)
- typography: [] (no web UI)
- radii: [] (no web UI)
- sources: [] (no design token file found)

> The peaks-cli is a Node CLI, not a web frontend. The legacy-frontend archetype is the closest match the scan can give; the absence of design tokens is correct, not a bug.

## Conventions

### Service layer
- Directory: `src/services/`
- Naming: kebab-case directories + PascalCase classes / camelCase factory exports
- Sample service files:
  - `src/services/progress/progress-service.ts` (chalk + ora progress display)
  - `src/services/session/session-manager.ts` (session ID lifecycle)
  - `src/services/config/config-types.ts` (typed config shapes)
  - `src/services/skills/skill-presence-service.ts` (active-skill marker writes)
  - `src/services/perf/perf-baseline-service.ts` (perf regression baseline)

### CLI command layer
- Directory: `src/cli/commands/`
- Naming: `<domain>-commands.ts` per command group (e.g. `core-artifact-commands.ts`, `project-commands.ts`, `sop-commands.ts`)
- Pattern: commander.js `.command(name).description().option().action()` chain
- Output envelope: stable `{ok, command, data, warnings, nextActions}` JSON shape (required for machine-readable interop)

### Schema layer
- Directory: `schemas/`
- Purpose: external-facing JSON schemas (package manifest, SOP manifest, request artifact, etc.)
- Source of truth for inter-version contracts

### Skill layer
- Directory: `skills/<skill-name>/SKILL.md`
- Install path: `scripts/install-skills.mjs` runs on `postinstall` to symlink skills into the active Claude Code install
- Skill surface: SKILL.md (routing + body) + optional `references/*.md` (deep dives) + `test-prompts.json` (excluded from npm package)
- Output style: `output-styles/peaks-skill-swarm.md` (style, not skill)

### Test layer
- Test runner: vitest
- Coverage: v8 provider
- Coverage gate: 100% on testable files (per project memory [[coverage-red-line]] — no padding)
- Exclusions: `coverage.exclude` in `vitest.config.ts` (mcp-stdio-transport, *-types pattern)

### File / module size
- Standard: many small files; 200-400 typical, 800 max (per `.claude/rules/common/coding-style.md`)

## Inconsistencies
- None detected by the scan.

## Hard constraints for new code

### Active constraints (still to enforce on every change)
1. CLI commands must return `--json` envelope `{ok, command, data, warnings, nextActions}` (see [[custom-sop-and-gate-metering]] for the design constraint).
6. Settings mutations: explicit user opt-in only; never write `.claude/settings.json` from skill bodies (per [[gate-enforcement-hook]]).
7. Stay within project directory; do not touch `~/.claude`, `~/.peaks` without explicit user auth (per [[peaks-current-directory-scope]]).
8. Coverage: 100% on testable files; do not add tests for the sake of the gate (per [[coverage-red-line]]).

### Landed patterns (established via BLOCKER / MEDIUM / minor closures 2026-06-02 / 2026-06-03 — do NOT regress)
- **Memory write idempotency** — `peaks project memories:extract` skip-if-name-exists branch (read-before-write + dedup by `name`). Anchor: `extractSessionMemories` → `writeNewFile` (src/services/memory/project-memory-service.ts L283, L784 comment, L797 call). `O_EXCL` writes anywhere in memory land must follow the same pattern.
- **Session-id / path containment** — `assertSafeSessionDir(projectRoot, sessionId)` realpath + `isInsidePath` (L401, called at L590). Any new code that takes a user-supplied path or session id must do the same realpath + isInsidePath dance before reading.
- **`--dry-run` / `--apply` parity** — never hardcode `apply: true`; mirror the existing mutual-exclusion pattern at `src/cli/commands/core-artifact-commands.ts:325` (also used by `standards.init` line 270).
- **Memory index provenance** — entries carry `sourceArtifact` (typed as `string | null`) + `sourcePath` (informational, repo-relative preferred over absolute) + `updatedAt` derived from file `mtime`, NOT `new Date()`. Type at L60/L102, generation at L481.
- **mtime guard on read-side regen** — `shouldRegenerateIndex(indexPath, memoryFiles)` strict `>` (L531, called at L567) so the index rebuilds only when a memory file is newer than the index itself. Avoid the `>=` footgun (would force regen on every read when mtimes tie).
- **Magic numbers → named constants** — `MIN_BODY_SENTENCE_LENGTH=20` / `MAX_DESCRIPTION_LENGTH=120` / `ELLIPSIS_RESERVE=3` (L159-161, used L384-394). New code: extract constants at the top of the file, not inline literals.
- **Walker dedup** — `listMarkdownFiles(dir, {maxDepth, skipDotfiles})` is the canonical markdown walker. Do NOT add a second near-duplicate; the prior `listFilesRecursive` was removed in `e611daf` for exactly this reason.
- **Containment for non-session paths too** — `realPathOrThrow(path, 'Project memory source must stay inside the project memory directory')` + `isInsidePath(sourcePath, stableRealPath(safeMemoryDir))` (L854-855) is the pattern for the project-memory backup copy path; mirror it whenever copying user-supplied or computed paths.

### Known minor issues (non-blocking, surface for future cleanup)
- `index.json` `sourcePath` field contains Windows dev-machine absolute paths (`C:\Users\smallMark\Desktop\peaks-cli\...`). Harmless (informational, never used to open files), but visually noisy on Mac/Linux. A future cleanup could switch the field to repo-relative.
