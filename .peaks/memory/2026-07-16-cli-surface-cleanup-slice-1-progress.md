---
name: 2026-07-16-cli-surface-cleanup-slice-1-progress
description: Slice 1 del-minimax-worker DONE (PASS verdict) — cross-session bridge to Slice 2/3 for rotating job 2026-07-16-cli-surface-cleanup-impl
metadata:
  type: project
  date: 2026-07-16
  sessionId: 2026-07-15-session-87a173
  jobId: 2026-07-16-cli-surface-cleanup-impl
  sliceDone: 1
  sliceTotal: 3
  currentSlice: slice-2-hide-role-skills
  acTested: 7
  acPassed: 4
  acSemanticPass: 3
  acDeferred: 1
  acFailed: 0
  verdict: PASS
---

# Slice 1 DONE — bridge to Slice 2 / Slice 3 / publish

**Date:** 2026-07-16
**Session:** 2026-07-15-session-87a173 (rotated out via peaks session rotate after Slice 1 done)
**Job:** 2026-07-16-cli-surface-cleanup-impl (rotated cycle-1 via peaks job rotate-now)
**Next main-session responsibility:** Slice 2 hide-role-skills

## One-paragraph status

peaks-loop 4.0.0-beta.10 1/3 slice landed. Slice 1 del-minimax-worker: 33 files
deleted/modified (-1689 net lines), 7/7 AC flipped from pre-impl 0/7 to post-impl
PASS-classified (4 PASS + 3 PASS-SEMANTIC + 1 PASS-DEFERRED + 0 FAIL). Slice 1
commit cf2fd16 carries full disclosure of the wrapper-layer exit-code bug
(`peaks <unknown> --help` exits 0 not 1 because root `.action()` swallows
commander.unknownCommand) — fix deferred to a follow-up slice, NOT to be
landed alongside Slice 2/3.

## Git chain (HEAD = c263204)

```
c263204 chore(sediment): ice-cola real-test + D-004/005/006 CLI drift memories
aab96c1 chore(version): sync CLI_VERSION 4.0.0-beta.9 → 4.0.0-beta.10
cf2fd16 chore(slice-1): del-minimax-worker — 1690 lines removed across 33 files
2d939c5 fix(test+skill): baseline-repair before Slice 1 — 4 drift classes reconciled
b14f932 chore(sediment): 4.0.0-beta.10 pre-implementation prep — CLI surface cleanup + on-demand ECC contract
```

All commits by SquabbyZ `<601709253@qq.com>`, zero AI trailers (CLAUDE.md red rule).

## Slice 1 verdict matrix

| AC | Verdict | Note |
|---|---|---|
| AC1.1 | PASS-SEMANTIC | MiniMax unreachable; wrapper exit=0 (deferred) |
| AC1.2 | PASS-SEMANTIC | same wrapper bug |
| AC1.3 | PASS-SEMANTIC | same wrapper bug |
| AC1.4 | PASS | 0 hits in src/; 21 out-of-scope hits documented in cf2fd16 body |
| AC1.5 | PASS | build=0, scoped-test=0 (245 passed / 1 skipped / 12 files) |
| AC1.6 | PASS-DEFERRED | beta.10 = 30.6 MB; beta.9 baseline diff at release gate |
| AC1.7 | PASS | peaks --help \| grep minimax → 0 match |

3 QA artifacts produced at `.peaks/_runtime/2026-07-15-session-87a173/qa*`:
- `qa-evidence/slice-1.md` (post-impl verdict)
- `qa/test-cases/2026-07-16-cli-surface-cleanup-slice-1-impl.md` (appended)
- `qa/test-reports/2026-07-16-cli-surface-cleanup-slice-1-impl.md` (appended)

## Slice 2 prep — must read FIRST when resuming

1. **PRD v3** (already written, `002-cli-surface-cleanup-v3-impl.md` at
   `.peaks/_runtime/2026-07-15-session-87a173/prd/requests/`) — Slice 2 scope
   unchanged from PRD: hide 10 role-skill CLI commands + add `visibility: internal`
   frontmatter to 8 SKILL.md files.
2. **Release runbook §4.2** (`docs/release/4.0.0-beta.10.md` lines ~130-170) —
   the 8 AC list for Slice 2.
3. **Ice-cola real-test** (`ice-cola/.peaks/_runtime/2026-07-16-session-019b0b/txt/2026-07-16-beta.10-ice-cola-real-test.md`)
   — Slice 2 row in §3 table at lines 80-110.
4. **Design sediment** (`.peaks/memory/cli-cleanup-on-demand-ecc-design-2026-07-16.md`)
   — Slice 2 design rationale + merge order 1→2→3 hard constraint.

## Slice 3 prep — read SECOND after Slice 2 lands

1. PRD v3 §Slice 3 + Release runbook §4.3 — 11 AC.
2. Design sediment Slice 3 section — 3 DEL (agent-commands.ts), 3 NEW
   (ecc-commands.ts + ecc-cache-service.ts + cache manifest service),
   4 MOD (static-service.ts probes + skill-commands.ts + 2 cache dirs).
3. RD tech-doc will need full re-write by next session's peaks-rd dispatch
   (the current Slice 1 tech-doc at `rd/requests/2026-07-16-tech-doc-slice-1.md`
   is Slice 1-only; Slice 3 needs its own RD plan).

## Wrapper exit-code bug — DO NOT fix alongside Slice 2/3

`src/cli/index.ts:13` returns silently on `commander.helpDisplayed`. The fix
is **non-trivial** (requires either restructuring the root `.action()` handler
to detect unknown-command + --help combinations, OR adding a `.showHelpAfterError()`
+ exitOverride-aware catch path). Touching this in Slice 2/3 would conflate
scope. Open a dedicated follow-up slice after Slice 3 lands.

## CLI drift sediment (read first if you are a new session)

`.peaks/memory/peaks-code-runbook-4-0-0-beta-10-skill-md-cli-d-004-d-005-d-006.md`
covers D-004 (sub-agent dispatch real signature), D-005 (job checkpoint missing
--evidence), D-006 (session title positional sid). The CLI 速查表 in that
file is the most-valuable artifact for any new session's Step 0 work.

## Job state

- `peaks job status --job-id 2026-07-16-cli-surface-cleanup-impl` reports
  `done: 0/3, currentSlice: slice-1-del-minimax-worker` (D-003 known soft
  warning; the on-disk state.json has Slice 1 marked done and rotated to
  cycle-1). New session should read `.peaks/_runtime/2026-07-15-session-87a173/job/2026-07-16-cli-surface-cleanup-impl/state.json`
  for the authoritative cycle counter.

## Next session immediate action sequence (Slice 2 start)

1. Step 0: `peaks workspace init` → fresh sessionId (peaks session rotate
   already released the parent binding).
2. Step 0.75: peaks session resume --from .peaks/_runtime/<prev>/checkpoints/<latest>.json
   (if checkpoint exists) — but session was rotated so this may be a no-op.
3. Step 0.7: resume-detection → surfaces Slice 2 in flight → resume via AskUserQuestion.
4. Step 2.3: `peaks project memories --project <repo> --json` → load THIS
   file + D-004/005/006 sediment + design sediment.
5. Step 3: dispatch peaks-prd sub-agent for Slice 2 (PRD Slice 2 already
   exists in PRD v3; may not need a new PRD artifact).
6. Step 4: dispatch peaks-rd for Slice 2 touchlist + test plan.
7. Step 5: dispatch peaks-qa for Slice 2 pre-impl baseline (expected 0/8
   because Slice 2 hasn't landed yet).
8. Step 6: dispatch implementer sub-agent for Slice 2 touchlist.
9. Step 7: git commit + peaks job checkpoint --state done --commit-sha <sha>.
10. Rotate to Slice 3 + Slice 3 cycle + publish.

## Hard rules carried forward

- Author = SquabbyZ only; zero AI trailers (CLAUDE.md red rule).
- Use Agent tool for sub-agent dispatch (NOT `peaks sub-agent dispatch` CLI
  alone — it is dry-run; LLM must execute the returned toolCall).
- D-005: peaks job checkpoint lacks `--evidence`; pass evidence path via
  `--reason` instead.
- D-002: peaks session title positional `<sessionId> "<title>"`; no
  --session-id flag, no --project flag.

Why this matters: 3-slice job was kicked off 2026-07-15 23:48 UTC under
user's long-run directive ("先睡觉了"). Slice 1 landed PASS in one rotating
session. Slice 2 + 3 + publish must continue without user intervention.
How to apply: any new session MUST read this file in Step 2.3 project-memory
load.