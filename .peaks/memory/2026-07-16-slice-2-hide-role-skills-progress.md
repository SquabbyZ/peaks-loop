---
name: 2026-07-16-slice-2-hide-role-skills-progress
description: Slice 2 hide-role-skills DONE (PASS verdict 8/8 AC) — cross-session bridge to Slice 3 on-demand-ecc for rotating job 2026-07-16-cli-surface-cleanup-impl
metadata:
  type: project
  date: 2026-07-16
  sessionId: 2026-07-16-session-651c20
  jobId: 2026-07-16-cli-surface-cleanup-impl
  sliceDone: 2
  sliceTotal: 3
  currentSlice: slice-3-on-demand-ecc
  acTested: 8
  acPassed: 8
  acSemanticPass: 0
  acDeferred: 0
  acFailed: 0
  verdict: PASS
---

# Slice 2 DONE — bridge to Slice 3 + publish

**Date:** 2026-07-16
**Session:** 2026-07-16-session-651c20 (rotated cycle-1 of rotating job)
**Job:** 2026-07-16-cli-surface-cleanup-impl (2/3 slices done)
**Next main-session responsibility:** Slice 3 on-demand-ecc

## One-paragraph status

peaks-loop 4.0.0-beta.10 2/3 slices landed. Slice 2 hide-role-skills: 22 files
modified (+120/-24 net lines), 8/8 AC flip from pre-impl 4/8 to post-impl
PASS-classified (8 PASS + 0 PASS-SEMANTIC + 0 PASS-DEFERRED + 0 FAIL). Slice 2
commit a38a769 carries full disclosure of the Commander 12 `.hidden()` API
drift (D-007) — fixed in this slice via `{ hidden: true }` constructor flag,
NOT the chain method. Build green, 36/36 tests pass.

## Git chain (HEAD = a38a769)

```
a38a769 chore(slice-2): hide-role-skills — 10 CLI .hidden() + 5 SKILL.md visibility:internal + tests
45f6f36 chore(sediment): Slice 1 progress bridge — cross-session handoff for Slice 2/3
c263204 chore(sediment): ice-cola real-test + D-004/005/006 CLI drift memories
aab96c1 chore(version): sync CLI_VERSION 4.0.0-beta.9 → 4.0.0-beta.10
cf2fd16 chore(slice-1): del-minimax-worker — 1690 lines removed across 33 files
```

(commit chain in working tree now = a38a769 + uncommitted sediment edits —
the next session must commit sediment before Slice 3 dispatch, OR
amend the Slice 2 commit if user prefers single-commit per slice.)

## Slice 2 verdict matrix (8/8 PASS)

| AC | Pre-impl | Post-impl | Evidence |
|---|---|---|---|
| AC2.1 | FAIL | PASS | `peaks --help \| grep -E "^\s+(prd\|qa\|sc\|audit\|code-review\|perf-audit\|security-audit\|upgrade\|agent\|code)\s"` → empty |
| AC2.2 | PASS | PASS | `peaks prd --help` exits 0 with full help (structural non-removal) |
| AC2.3 | PASS | PASS | `peaks sub-agent dispatch --role prd --help` exits 0 (separate code path, confirmed) |
| AC2.4 | FAIL | PASS | `peaks skill list \| grep peaks-doctor` → empty |
| AC2.5 | FAIL | PASS | `peaks skill list --include-internal \| grep peaks-doctor` → non-empty |
| AC2.6 | FAIL | PASS | `peaks skill search --query doctor` JSON → no `peaks-doctor` entry |
| AC2.7 | PASS (legacy) | PASS (rewritten) | `tests/integration/skill-search-cli.test.ts` 8/8 pass (I-5/I-6/I-7/I-8 new) |
| AC2.8 | PASS | PASS | `peaks skill presence:set peaks-code` exits 0 |

## Slice 2 deviations from RD tech-doc

### 1. Commander 12 `.hidden()` API drift (D-007)

RD tech-doc assumed `program.command('xxx').hidden()` chain method.
**Commander 12.1.0 does NOT expose `.hidden()` at runtime** —
verified by `node -e "console.log(typeof new Command().hidden)"` →
`undefined`. The implementer used `program.command('xxx', { hidden: true })`
constructor flag instead, which is the only available API in Commander 12.
This is functionally equivalent. Documented in:
`.peaks/memory/2026-07-16-slice-2-commander-12-hidden-api-drift.md`.

**How to apply:** Any future slice that wants to hide a subcommand
(e.g. Slice 3 `peaks ecc install` for non-LLM consumers, or any LLM-internal
subcommand) MUST use `program.command(name, { hidden: true })` NOT the
chain method.

### 2. `exactOptionalPropertyTypes: true` conditional spread

`loadEnrichedSkills` in `src/services/skill/skill-search-service.ts`
needed `...(s.visibility !== undefined ? { visibility: s.visibility } : {})`
because the project's strict TS config forbids assigning `string | undefined`
to an optional property. Same pattern already used in registry's two
`skills.push` sites. Documented in sediment file above.

### 3. Test I-5 row-level tightening

Naive `expect(list.stdout).not.toContain('peaks-doctor')` assertion
fails because `peaks-solo` SKILL.md description mentions
`peaks-doctor` as a dispatch leaf. Replaced with regex
`expect(list.stdout).not.toMatch(/^ {2}peaks-doctor\s/m)` — row-prefix
anchor. Behavior unchanged.

## Slice 3 prep — read FIRST when resuming

1. **PRD v3** (already written, `.peaks/_runtime/2026-07-15-session-87a173/prd/requests/002-cli-surface-cleanup-v3-impl.md`)
   §Slice 3 + 4 NEW design details (§3.A cache perms, §3.B context flags,
   §3.C frontmatter fallback, §3.D sub-agent dispatch).
2. **Release runbook** (`docs/release/4.0.0-beta.10.md` §4.3 + §5.3) —
   the 12 AC list for Slice 3.
3. **Ice-cola real-test** (`ice-cola/.peaks/_runtime/2026-07-16-session-019b0b/txt/2026-07-16-beta.10-ice-cola-real-test.md`)
   — Slice 3 row in §3 table at lines 80-110.
4. **Design sediment** (`.peaks/memory/cli-cleanup-on-demand-ecc-design-2026-07-16.md`)
   — Slice 3 design rationale: 3 DEL (agent-commands.ts + ecc-agent-service.ts + 1 test),
   4 NEW (ecc-commands.ts + ecc-cache-service.ts + 2 tests), 4 MOD
   (program.ts + static-service.ts + retention.ts + bootstrapLogger wire).
5. **Commander 12 hidden API sediment** (`.peaks/memory/2026-07-16-slice-2-commander-12-hidden-api-drift.md`)
   — if Slice 3 needs to hide `peaks ecc ls --json` or similar, use
   `{ hidden: true }` not `.hidden()`.

## Slice 3 ready-state (verified by this session)

- HEAD = a38a769 (Slice 2 commit).
- Working tree clean except uncommitted sediment (next session should
  commit sediment first).
- `peaks job progress` reports `done: 2/3, currentSlice: slice-3-on-demand-ecc`.
- `peaks --help` empirically excludes 10 hidden names (verified by AC2.1).
- `peaks ecc install` does NOT yet exist (Slice 3 will add it).

## Next session immediate action sequence (Slice 3 start)

1. Commit any uncommitted sediment (currently: slice-2 progress bridge +
   commander-12 drift memory + MEMORY.md pointer).
2. Step 0: `peaks workspace init` → fresh sid (peaks session rotate
   releases parent binding — this session's binding was already
   created at `2026-07-16-session-651c20`).
3. Step 0.7: post-compact-detect → may auto-resume (shouldAutoResume: false
   if no checkpoint today).
4. Step 2.3: `peaks project memories --project <repo> --json` → load
   this file + D-007 sediment + design sediment + D-004/005/006.
5. Step 3: dispatch peaks-rd for Slice 3 tech-doc (Slice 1+2 tech-docs
   are slice-specific; Slice 3 needs its own).
6. Step 4: dispatch peaks-rd for Slice 3 touchlist + test plan.
7. Step 5: dispatch peaks-qa for Slice 3 pre-impl baseline (expected 0/12
   because Slice 3 hasn't landed yet).
8. Step 6: dispatch implementer sub-agent for Slice 3 touchlist
   (with explicit reminder about D-007 + Commander 12 API).
9. Step 7: git commit + `peaks job checkpoint --state done --commit-sha <sha>`.
10. ice-cola baseline gate (PRD §4): re-run 27-AC set in ice-cola,
    confirm 27/27 PASS, then `npm publish --tag beta` (D-005 note:
    needs 2FA OTP from user).

## Hard rules carried forward

- Author = SquabbyZ only; zero AI trailers (CLAUDE.md red rule).
- D-005: peaks job checkpoint lacks `--evidence`; pass evidence via `--reason`.
- D-002: peaks session title positional `<sessionId> "<title>"`.
- D-007: Commander 12 — use `{ hidden: true }` flag, NOT `.hidden()`.
- Merge order invariant 1 → 2 → 3 still binding (Slice 3 = last).

Why this matters: 3-slice job 67% done. Slice 3 + ice-cola gate + publish
are the user's final acceptance gates. Slice 2's PASS verdict proves the
peaks-code pipeline works end-to-end across session rotations.
How to apply: any new session MUST read this file in Step 2.3 project-memory
load.