---
name: review-memories-extract-and-memory-index
description: Code review findings on the 2026-06-01 uncommitted changes to project-memory-service.ts, project-commands.ts, and the peaks-* skills (memory hot/warm index + session extract).
metadata:
  type: feedback
---
The new `peaks project memories:extract` and `peaks project memory-index` commands are wired correctly at the schema and CLI surface, but the implementation has three blockers and one MEDIUM finding that should be fixed before this lands.

**Why:** All four are real regressions vs. existing peaks-cli conventions (idempotent memory writes, --dry-run/--apply parity, project-root containment, deterministic sort), and the user has a documented preference for catching these pre-merge.

**How to apply:** When the user asks to "fix the review findings" or comes back to this branch, work the list in order — blockers first, MEDIUM last.

## BLOCKER 1 — `extractSessionMemories` is not idempotent
`writeNewFile` uses `O_EXCL` (the original `executeProjectMemoryExtract` does too), but unlike that path, `extractSessionMemories` has no "exists → skip / merge" branch. Re-running the same `--session-id` after a successful extract throws `EEXIST: file already exists`.

Repro:
1. Create `.peaks/probe/file.md` containing a `<!-- peaks-memory:start -->...<!-- peaks-memory:end -->` block
2. `peaks project memories:extract --session-id probe --project . --json` → ok, 1 written
3. Repeat the same command → `MEMORY_EXTRACT_FAILED` with `EEXIST`

The skill runbooks (peaks-rd / peaks-qa / peaks-sop / peaks-solo) all add the line *after* the last status-changing step, so a re-run is plausible on retry/loop. Fix: skip if the slugified target file already exists in `primaryMemoryDir` and its frontmatter `name` matches the extracted title; or, write to `<slug>-<sessionShortHash>.md` and dedupe by `name` field in the index.

## BLOCKER 2 — `session-id` is unvalidated, `sessionDir` is not contained
`extractSessionMemories` does `join(projectRoot, '.peaks', options.sessionId)`. `options.sessionId` comes straight from the CLI flag, no `..` / absolute / symlink check, and the result is not `realpathSync`+`isInsidePath` guarded before `listFilesRecursive` reads from it. The write target is contained (good — it goes into `primaryMemoryDir`), but the **read** side will happily read files outside the project root and feed them into `extractStableProjectMemories`.

Repro: create a sibling `escape_probe/` containing a memory block, then `peaks project memories:extract --session-id ../escape_probe --project . --json` returns `scannedFiles: 0` only because `existsSync` happens to fail in our test env. With a path that resolves to an existing directory, the scanner walks in and extracts.

Fix: add `slugify`-style sanitization on `sessionId` (only `[a-z0-9_-]`) OR `realpathSync` the sessionDir and `isInsidePath(realSessionDir, realProjectRoot)`, mirroring `assertInsideProject` from line 180.

## BLOCKER 3 — `memories:extract` CLI hardcodes `apply: true` and skips the existing `--dry-run`/`--apply` mutual-exclusion pattern
`core-artifact-commands.ts:322` (`memory.extract`) and `standards.init` (line 270) both expose `.option('--dry-run')` / `.option('--apply')` and reject the combination. The new `peaks project memories:extract` (project-commands.ts:117-142) hardcodes `apply: true` with no flag. That breaks user expectation when they want to preview and makes the runbook `peaks project memories:extract --json` line silently destructive.

Fix: add `.option('--dry-run', 'preview writes without changing files')` / `.option('--apply', 'write extracted memories into .peaks/memory/')`, default to `--dry-run` (the established default in this codebase), and add the `if (options.dryRun && options.apply) { ... INVALID_MEMORY_EXTRACT_FLAGS ... }` guard from `core-artifact-commands.ts:325`.

## MEDIUM — `generateMemoryIndexFile` does not propagate `sourceArtifact` and writes `updatedAt` from `new Date()` not file mtime
`MemoryIndexEntry` currently has no `sourceArtifact` field, but `StoredProjectMemory` does (`parseStoredMemoryFile` line 327 captures it). The index loses the "where did this come from" provenance. Also, `updatedAt: new Date().toISOString().slice(0, 10)` is regenerated on every read, which makes the field useless for diff/audit purposes. Fix: add `sourceArtifact: string | null` to `MemoryIndexEntry`, and use `statSync(memory.filePath).mtime` (clamped to YYYY-MM-DD) for `updatedAt`.

## Minor
- `summarizeMemoryBody` (line 363) is a 20-line deterministic sentence picker with magic numbers (120 / 117 / 20). Document the rules in a header comment or extract constants; right now "why 117 not 119?" is opaque.
- `readMemoryIndex` (line 468) silently regenerates the index on every call when the memory dir has files. This is a side effect on a "read" path. Either rename to `ensureMemoryIndex` / `readOrRebuildMemoryIndex`, or guard the rebuild to a "mtime check" instead of "files exist".
- `listFilesRecursive` (line 387) is its own copy of `listMarkdownFiles` (line 333) with one difference: depth cap and dotfile skip. Either generalize `listMarkdownFiles` with a `{maxDepth, skipDotfiles}` option, or call `listMarkdownFiles` from `listFilesRecursive` to avoid two near-duplicate walkers.

## Cross-references
- `peaks project memories:extract` — `src/cli/commands/project-commands.ts:117`
- `peaks project memory-index` — `src/cli/commands/project-commands.ts:144`
- `extractSessionMemories` — `src/services/memory/project-memory-service.ts:487`
- `readMemoryIndex` — `src/services/memory/project-memory-service.ts:468`
- `generateMemoryIndexFile` — `src/services/memory/project-memory-service.ts:410`
- Existing `memory.extract` dry-run/apply pattern — `src/cli/commands/core-artifact-commands.ts:322`
- Coverage rule (don't add tests just to cover branches) — `.peaks/memory/coverage-red-line.md`
