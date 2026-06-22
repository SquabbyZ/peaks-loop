---
name: 2026-06-22-top-level-change-id-cleanup
description: .peaks/<YYYY-MM-DD-*>/ top-level dirs forbidden in 2.8.0+; 2.8.0-era orphan cleaned up + defense rule pinned by a vitest guard.
metadata:
  type: feedback
  sourceArtifact: tests/unit/workspace/top-level-change-id-guard.test.ts
---

# Top-level `.peaks/<YYYY-MM-DD-*>/` cleanup — slice 2026-06-22-top-level-change-id-cleanup

**Commit (pending):** main branch, single atomic chore commit
**Audit window:** 2026-06-22 22:50–23:00 UTC+8
**Session id:** 2026-06-22-session-14216e

## Background

peaks-cli 2.8.0+ enforces a **two-axis workspace convention**:
- **session-id axis** (gitignored, ephemeral): `.peaks/_runtime/<sessionId>/<role>/...`
- **change-id axis** (gitignored, ephemeral): `.peaks/_runtime/<sessionId>/...` — there is
  no separate `.peaks/<changeId>/` sibling at top level. Change-id is an *identifier string*
  carried by RD/QA artifacts (`peaks request init --change-id <id>` writes them under
  `.peaks/_runtime/<sessionId>/<role>/requests/<rid>-<changeId>.md`), not a directory.

A pre-2.8.0 install (legacy `peaks workspace init --change-id ...` flow) had written a stale
sibling at `.peaks/2026-06-22-cc-connect-orphan-cleanup/` (4 files, 28 KB, untracked).
The slice content had already been promoted to the canonical axis
(`.peaks/_runtime/2026-06-22-session-14216e/rd/requests/002-2026-06-22-cc-connect-orphan-cleanup.md`),
so the top-level dir was a redundant duplicate.

## Audit findings (full repo scan)

| Location | Finding | Disposition |
|---|---|---|
| `.peaks/2026-06-22-cc-connect-orphan-cleanup/` (top-level) | 4 files, all untracked, no external code references | **deleted** |
| `.peaks/_runtime/<sid>/**` | date-prefixed segments under `_runtime/` — these are CORRECT (gitignored via `.peaks/_runtime/` rule) | kept |
| `src/` `skills/` `tests/` `schemas/` `scripts/` | 0 references to the orphan dir as a live path | clean |
| `.peaks/_runtime/...session-14216e/rd/requests/002-...md` | `linked-prd:` etc. textual references to the orphan path | kept — these are historical deliverable metadata, not active path reads; same id content already lives under runtime axis |
| `.peaks/_sub_agents/unknown-sid/dispatch-...json` | dispatch prompt contains the change-id | kept — `.peaks/_sub_agents/` is gitignored ephemeral; the dispatch is a one-shot snapshot |

## Action taken (commit pending)

1. `rm -rf .peaks/2026-06-22-cc-connect-orphan-cleanup/` (4 files gone).
2. **Defense rule** added to root `.gitignore`:
   ```
   # Defense (slice 2026-06-22-top-level-change-id-cleanup): no YYYY-MM-DD-prefixed
   # directories are allowed at `.peaks/` top level. change-id / session-id style
   # dirs must live under `.peaks/_runtime/<sid>/` (gitignored) — never as siblings.
   .peaks/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-*/
   ```
   - Matches: `.peaks/2026-06-22-cc-connect-orphan-cleanup/`, `.peaks/2026-06-21-anything/`, etc.
   - Does NOT match: `.peaks/_runtime/2026-06-22-session-14216e/` (underscore prefix; that
     segment is `_runtime`, not a date). The `_runtime/` sub-tree is already covered by
     the existing `.peaks/_runtime/` rule (line 9 of `.gitignore`).
3. **Defense test** added at `tests/unit/workspace/top-level-change-id-guard.test.ts`:
   5 vitest cases pinning the rule + scanning the working tree + scanning `git ls-files`.
   All 5 pass.

## Why this is the right shape

- The rule is **path-anchored** (no regex engine), so it's cheap and stable.
- The pattern matches **date-prefixed** siblings only — does not over-block legitimate
  source-of-truth dirs (`memory/`, `standards/`, `sops/`, `project-scan/`, `retrospective/`,
  `sc/`, `perf-baseline/`, `_archive/`).
- The vitest guard fails fast if (a) someone removes the `.gitignore` rule by hand, or
  (b) someone hand-creates an orphan dir and tries to commit it. Both are real failure
  modes observed in the wild.

## Lessons

1. **Trust no pattern outside `_runtime/`.** Any date-prefixed sibling at `.peaks/`
   top level is a 2.8.0-era artifact. The defense rule + test pins this so it cannot
   silently regress.
2. **Untracked ≠ harmless.** Even an untracked `.peaks/<id>/` confuses `git status`,
   pollutes search results, and can be force-added by mistake. Root out at audit time.
3. **gitignore + test = defense in depth.** The rule alone is bypassable by `--force-add`
   (rare but possible); the test alone is bypassable by deleting the test. Together they
   make a regression require *two* coordinated edits.

## Followups

- Consider adding the same rule to the `.peaks/.gitignore` snippet as a defensive
  mirror. Not strictly required (root `.gitignore` already covers it), but it would
  survive a future root-gitignore refactor.
- The `.peaks/_sub_agents/unknown-sid/` directory contains a dispatch snapshot whose
  `requestId` is `2026-06-22-cc-connect-orphan-cleanup`. This is gitignored ephemeral
  state; safe to leave but could be reaped by the next `_sub_agents/` retention sweep.

## Why: Why this slice exists

**Why:** A 2.8.0-era install left a stale `.peaks/<change-id>/` sibling that violated
the 2.8.0+ convention. The user wanted a thorough root-out (delete + defense + memory),
not a one-shot `rm`.

**How to apply:** Whenever you see an untracked `.peaks/<YYYY-MM-DD-*>/` at top level,
treat it as a regression. The vitest guard catches new occurrences automatically; do
not bypass it.