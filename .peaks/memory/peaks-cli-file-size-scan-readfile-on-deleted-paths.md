---
name: peaks-cli-file-size-scan-readfile-on-deleted-paths
description: peaks request transition rd → implemented blocks when a slice deletes files; file-size-scan calls readFileSync on git-diff deleted paths (pre-existing peaks-cli bug, slice #015 candidate)
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-06-07-session-84feb7/txt/handoff-014-2026-06-07-remove-legacy-progress-start-surface.md
---

`peaks request transition <rid> --role rd --state implemented` calls into the file-size scan at `src/services/scan/file-size-scan.ts:39-42` to enforce the 800-line cap. The scan iterates over `git diff --name-only HEAD`'s output (changed + new files) and calls `readFileSync` on each. If the diff includes DELETED files (which `git diff` reports as a name, not content), `readFileSync` throws ENOENT and the entire transition aborts with `code: PREREQUISITES_MISSING`. This is a pre-existing peaks-cli bug; slice #014 hit it because the refactor deleted 5 source files + 2 test files, all of which appear in `git diff --name-only HEAD` as deleted entries.

**Why:** The file-size scan was written to enforce the Karpathy guideline "files should be ≤ 800 lines". The intent is good: a single big file is a smell, many small focused files is the desired pattern. But the implementation confuses "file exists with too many lines" (the real check) with "file is in the diff" (the scope of what to scan). Deleted files have no lines to check; the scan should skip them. Currently it crashes, blocking any refactor that deletes files — which is the WORST time to block a refactor (refactors that delete are the ones that need this gate the least, because they're usually cutting dead code that was already bloated).

**How to apply:**
- **For refactor / bugfix slices that delete files**: use `--allow-incomplete --reason "<short justification>"` on the `rd → implemented` transition. The bypass is recorded in the artefact's `bypassedPrerequisites` field so the audit trail is intact. The bypass does NOT skip the file-size scan for the new/modified files; it only skips the deleted-file crash.
- **For new slice planning**: if the slice deletes files, expect the rd → implemented transition to need the bypass. Plan for the `--allow-incomplete` step in the dispatch prompt so the RD sub-agent doesn't get stuck.
- **Slice #015 candidate fix**: in `src/services/scan/file-size-scan.ts` lines 39-42, change the iteration to skip paths where `fs.existsSync(path) === false` (or use `git diff --name-only --diff-filter=d` to get only deleted files and filter them out, then separately iterate the rest). Add a regression test that runs the scan on a diff with 5 deleted files and confirms it returns 0 violations (not a crash).
- **Why this is a pre-existing bug**: it would have bitten any refactor slice that deletes files (none of slices #001–#013 deleted files at this scale; slice #014 is the first). The same code path is used by the slice-check tool's "typecheck" + "unit-tests" + "review-fanout" stages, so any of those could also crash on a refactor with deletions.

**Related:** `peaks-cli-request-init-filename-truncation-57-char-limit` (slice #014 surfaced two pre-existing peaks-cli self-bugs in one go; the dogfood was the only way to find them).
