---
archived: 2026-06-29
reason: v2.16.0-alpha change-id axis scope reduction
status: archived
name: 2026-06-22-top-level-change-id-cleanup
description: .peaks/_runtime/<YYYY-MM-DD-*>/ top-level dirs forbidden in 2.8.0+; 2.8.0-era orphan cleaned up + 4-layer defense (gitignore + vitest 8 cases + source-code redirect + CLI help-text guard).
metadata:
  type: feedback
  sourceArtifact: tests/unit/workspace/top-level-change-id-guard.test.ts
  sourceArtifactSecondary: tests/unit/workspace/workspace-init-change-id-redirect.test.ts
  sliceFollowup: 2026-06-23-audit-followup
---

# Top-level `.peaks/_runtime/<YYYY-MM-DD-*>/` cleanup — slice 2026-06-22-top-level-change-id-cleanup + 2026-06-23-audit-followup

**Commits delivered:** 7373f81 (chore: drop orphan + pin defense rule),
d557ed8 (release: 2.8.3 — gitignore + docs + tests), f18a518 (wip:
redirect --change-id), bc0423d (release: 2.8.3 — source fix), and the
audit followup commit on top of bc0423d.
**Audit window:** 2026-06-22 22:50–23:00 UTC+8 (initial cleanup);
2026-06-23 (audit + remediation followup)
**Session id:** 2026-06-22-session-14216e

## Background

peaks-loop 2.8.0+ enforces a **two-axis workspace convention**:
- **session-id axis** (gitignored, ephemeral): `.peaks/_runtime/<sessionId>/<role>/...`
- **change-id axis** (logical identifier, not a directory): the change-id is a *string*
  carried by RD/QA artifacts (`peaks request init --change-id <id>` writes them under
  `.peaks/_runtime/<sessionId>/<role>/requests/<rid>-<changeId>.md`), not a filesystem
  directory. Reviewable artifacts still land under `.peaks/_runtime/<changeId>/<role>/` (created
  lazily by the writer), but the **binding** lives at
  `.peaks/_runtime/current-change` as a plain text file (slice 2.8.3 redirect) — NOT
  as a top-level sibling dir next to `.peaks/_runtime/`.

A pre-2.8.0 install (legacy `peaks workspace init --change-id ...` flow) had written a stale
sibling at `.peaks/2026-06-22-cc-connect-orphan-cleanup/` (4 files, 28 KB, untracked).
The slice content had already been promoted to the canonical axis
(`.peaks/_runtime/2026-06-22-session-14216e/rd/requests/002-2026-06-22-cc-connect-orphan-cleanup.md`),
so the top-level dir was a redundant duplicate.

## Audit findings (full repo scan, 2026-06-22)

| Location | Finding | Disposition |
|---|---|---|
| `.peaks/2026-06-22-cc-connect-orphan-cleanup/` (top-level) | 4 files, all untracked, no external code references | **deleted** (commit 7373f81) |
| `.peaks/_runtime/<sid>/**` | date-prefixed segments under `_runtime/` — these are CORRECT (gitignored via `.peaks/_runtime/` rule) | kept |
| `src/` `skills/` `tests/` `schemas/` `scripts/` | 0 references to the orphan dir as a live path | clean |
| `.peaks/_runtime/...session-14216e/rd/requests/002-...md` | `linked-prd:` etc. textual references to the orphan path | kept — these are historical deliverable metadata, not active path reads; same id content already lives under runtime axis |
| `.peaks/_sub_agents/unknown-sid/dispatch-...json` | dispatch prompt contains the change-id | **tolerated** — gitignored ephemeral snapshot; safe to leave until next `_sub_agents/` retention sweep (no action needed in this slice) |

## Action taken — 4-layer defense

1. `rm -rf .peaks/2026-06-22-cc-connect-orphan-cleanup/` (4 files gone, commit 7373f81).
2. **`.gitignore` defense rule** (commit 7373f81):
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
3. **Vitest guard** at `tests/unit/workspace/top-level-change-id-guard.test.ts`:
   **8 cases** (commit d557ed8 added AC4b + AC6; commit bc0423d added AC7; audit-followup
   commit added 4-verb pin to AC7):
   - AC1: root `.gitignore` contains the YYYY-MM-DD-prefix defensive rule
   - AC2: the rule's fnmatch pattern ignores a synthetic candidate path
   - AC3: the rule's fnmatch pattern does NOT match `.peaks/_runtime/<date>/...`
   - AC4: working tree contains no orphan top-level date-prefixed `.peaks/` dirs
   - AC4b: `git ls-files` also returns no top-level date-prefixed tracked entries
   - AC5: `CLAUDE.md` declares the top-level change-id ban as a hard rule
   - AC6: `.peaks/PROJECT.md` documents the ban in its Conventions section
   - AC7: `src/cli/commands/workspace/init-command.ts` teaches the correct path
     (`.peaks/_runtime/current-change` + `LegacyChangeIdSiblingError` +
     `LegacyChangeIdBindingError` + 4 migration verbs: inspect/move/delete/unlink/re-run)
   All 8 pass.
4. **Source-code redirect** (commits f18a518 + bc0423d + audit followup):
   - `src/shared/change-id.ts#setCurrentChangeId` defaults to `{ form: 'file' }` —
     writes only `.peaks/_runtime/current-change` (mode 0o600), never creates
     `.peaks/_runtime/<changeId>/` at top level.
   - `src/services/workspace/workspace-service.ts#initWorkspace` pre-flights
     `validateChangeIdOrThrow` + `lstatSync` legacy sibling dir. Throws
     `LegacyChangeIdSiblingError` if found.
   - **Audit followup fix**: `setCurrentChangeId` now uses `lstatSync` to detect
     legacy 2.8.0-era symlinks at the binding path and throws
     `LegacyChangeIdBindingError` (3-step recipe: inspect / unlink / re-run) instead
     of silently unlinking + writeFileSync'ing over them. This closes the
     data-loss-shaped bug the audit surfaced.
5. **CLI help-text guard** (commit bc0423d + audit followup):
   - `peaks workspace init` command description rewritten to teach
     `.peaks/_runtime/current-change` (not `.peaks/_runtime/<change-id>/`).
   - `--change-id` option description rewritten with the same redirect + a
     mention of both `LegacyChangeIdSiblingError` and `LegacyChangeIdBindingError`.
   - Catch blocks for both errors emit JSON envelope `data` + `nextActions`
     (sibling: inspect/move/delete/re-run; binding: inspect/unlink/re-run).

## Followups — applied in 2.8.3 audit followup

All 13 audit findings from the multi-dimensional audit (Karpathy + security +
silent-failure + migration) were resolved in a single followup commit. Highlights:
- `LegacyChangeIdBindingError` new error class — closes the silent symlink-replace
  data-loss path.
- `validateChangeIdOrThrow` called BEFORE any path join / existsSync probe in
  `initWorkspace` (closes the unvalidated-path info-leak window).
- `lstatSync`-based guard in `initWorkspace` distinguishes path types (file vs dir
  vs symlink vs broken symlink) instead of conflating them into one error.
- `writeFileSync` on the binding file uses mode `0o600` (defense-in-depth on
  multi-user hosts).
- `workspace-init-change-id-redirect.test.ts` extended from 6 to 8 cases (AC7
  symlink-at-binding-path + AC8 / AC8b `'..'` / `'.'` validation); dead `track`
  helper removed; AC6 upgraded to also pin the 4-step migration recipe ordering.
- Memory file, `index.json`, `CLAUDE.md`, `.peaks/PROJECT.md`, `CHANGELOG.md` all
  updated to reflect the final 4-layer defense + 8-case test count + the
  binding-vs-artifact path distinction.

## Why this is the right shape

- The rule is **path-anchored** (no regex engine), so it's cheap and stable.
- The pattern matches **date-prefixed** siblings only — does not over-block legitimate
  source-of-truth dirs (`memory/`, `standards/`, `sops/`, `project-scan/`, `retrospective/`,
  `sc/`, `perf-baseline/`, `_archive/`).
- The vitest guard fails fast if (a) someone removes the `.gitignore` rule by hand, or
  (b) someone hand-creates an orphan dir and tries to commit it. Both are real failure
  modes observed in the wild.
- The 4-layer defense (gitignore + vitest 8 cases + source-code redirect + CLI help-text
  guard) means a regression requires a coordinated bypass of FOUR independent defenses,
  not just one. This is the user's "thorough root-out" expectation.

## Lessons

1. **Trust no pattern outside `_runtime/`.** Any date-prefixed sibling at `.peaks/`
   top level is a 2.8.0-era artifact. The defense rule + test pins this so it cannot
   silently regress.
2. **Untracked ≠ harmless.** Even an untracked `.peaks/_runtime/<id>/` confuses `git status`,
   pollutes search results, and can be force-added by mistake. Root out at audit time.
3. **gitignore + test = defense in depth.** The rule alone is bypassable by `--force-add`
   (rare but possible); the test alone is bypassable by deleting the test. Together they
   make a regression require *two* coordinated edits. With the 2.8.3 4-layer defense,
   the bar is now FOUR coordinated edits.
4. **Audit, then audit the audit.** The 2026-06-23 multi-dimensional audit found a
   silent data-loss bug (symlink at binding path) that the initial 2.8.3 release
   would have shipped. **Lesson**: every release that ships a "fix" deserves its own
   followup audit before publish — the fix itself can introduce new failure modes.
5. **CLI help text is the LLM's teacher.** A future LLM reading `peaks workspace
   init --help` will learn the path from the description, not from reading source.
   Keeping the help text aligned with the actual code behavior is critical.

## Followups (not blocking — open as of audit followup)

- Consider adding the same `.peaks/[0-9][0-9][0-9][0-9]-...` rule to the
  `.peaks/.gitignore` snippet as a defensive mirror. Not strictly required (root
  `.gitignore` already covers it), but it would survive a future root-gitignore refactor.
- The `.peaks/_sub_agents/unknown-sid/` directory contains a dispatch snapshot whose
  `requestId` is `2026-06-22-cc-connect-orphan-cleanup`. **Status: tolerated** —
  gitignored ephemeral state; safe to leave but could be reaped by the next
  `_sub_agents/` retention sweep. No action needed in this slice.

## Why: Why this slice exists

**Why:** A 2.8.0-era install left a stale `.peaks/_runtime/<change-id>/` sibling that violated
the 2.8.0+ convention. The user wanted a thorough root-out (delete + defense + memory),
not a one-shot `rm`.

**How to apply:** Whenever you see an untracked `.peaks/_runtime/<YYYY-MM-DD-*>/` at top level,
treat it as a regression. The vitest guard catches new occurrences automatically; do
not bypass it.