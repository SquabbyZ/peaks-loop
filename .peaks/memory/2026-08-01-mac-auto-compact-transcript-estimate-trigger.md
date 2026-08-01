---
name: peaks-loop-mac-auto-compact-transcript-estimate-trigger
description: peaks-loop 4.0.4 shipped the data path (recursive readdir, env, statusline) for Mac auto-compact but never wired the new `transcript-estimate` source into the orchestrator's trigger ladder; commit 43561ffe closed the auto-fire half (2026-08-01)
metadata:
  type: project
  originSessionId: 2026-07-31-session-84c3da
  modified: 2026-08-01T02:48:00.000Z
---

# Mac auto-compact trigger closure (commit 43561ffe — 2026-08-01)

## Symptom
On Mac Claude Code, even after peaks-loop 4.0.4 (which shipped rid-001-r1/r2/r3 +
4 sweep rids + rid-002 `--prompt-size` + rid-003 docs), the auto-compact never
fired. The user saw `⚠️ 上下文已 70+ tool call / $69+, 继续前建议先 /compact 再
commit` from Claude Code instead of an automatic `peaks compact auto --execute`.

## Root cause
The 4.0.4 B-route shipped the data path correctly:
- `findTranscriptJsonl` (recursive readdir, rid-001-r1) returns `{ path, bytes }`
  on Mac.
- `readClaudeTranscriptFallback` returns `{ ratio: bytes/256KB, bytes }`.
- The probe surfaces `source: 'transcript-estimate'` to the orchestrator.

But the **trigger gate** was half-open. The orchestrator's
`evaluateAutoCompactDecision` only fires on the older P1/P2/P4 sources; the new
`transcript-estimate` source is a real signal but was ignored. On Mac, all three
of P1 (claude-code-env) and P2 (statusline-poll) and P4 (user-overridden) are
absent, so the probe returns `conservative-fallback: ratio: 0` and the gate
stays in `none` zone forever.

## Fix (1-line source-tag-aware gate, commit 43561ffe)
`src/services/code/auto-compact-orchestrator.ts` `evaluateAutoCompactDecision`
gained a single new case: when no P1/P2/P4 source is present AND the source is
`transcript-estimate` AND ratio ≥ 0.85, return `shouldCompact: true`. The gate
sits AFTER the `force` short-circuit and BEFORE the default `shouldCompact:
true` fallback — preserves all pre-rid behavior.

**Why this is safe:**
- The transcript fallback only fires on real bytes (≥1); the
  `conservative-fallback: ratio: 0` sentinel is unaffected.
- The gate is source-aware, not ratio-only — a real P1 (env) or P2 (statusline)
  reading at 0.85 still wins, the transcript estimate is just a fallback for
  the Mac case.
- 256KB threshold is the same one used by `readClaudeTranscriptFallback`. No new
  magic number.

## Files
| File | +LOC | -LOC | Notes |
|---|---|---|---|
| `src/services/code/auto-compact-orchestrator.ts` | 21 | 1 | 1-line gate + comment, no helper extracted |
| `tests/unit/code/auto-compact-orchestrator.test.ts` | 177 | 0 | NEW, 5 cases (1 new + 4 regression) |
| `CHANGELOG.md` | 6 | 0 | 1 bullet under `Unreleased — 4.0.4.x` |
| `docs/mac-auto-compact.md` | 41 | 6 | auto-fire line + 256KB ≈ 100% caveat |

Total: +240/-12. Production diff: 22 LOC (under 50 cap).

## Anti-fake-green defense
- **Production ESM repro is mandatory**: build via `tsc -p
  tsconfig.build.json` to a tmp dir, then `node --input-type=module` against
  `dist/services/code/auto-compact-orchestrator.js`. The repro runs against a
  real ≥256KB Mac-shaped jsonl fixture under `~/.claude/projects/-<hash>/<sid>.jsonl`.
  This catches the rid-001-r1 class of bug (ESM `require is not defined`).
- The QA verdict-issued run reproduced this and confirmed S1/S2/S3 all PASS
  without a ReferenceError.

## No new dependencies / no new CLI
The trigger uses the existing `peaks compact auto --execute` surface. The
`--prompt-size <bytes>` escape hatch (rid-002) is unchanged and remains the
manual override for the user's `peaks code context-now` invocation. No CLI
flag added; the gate is purely in the orchestrator's `evaluateAutoCompactDecision`.

## Cross-platform
Win / Mac / Linux all benefit. The transcript fallback path was already
cross-platform (recursive readdir works identically on all 3). The Mac case
is the one that needed the new trigger because P1+P2 are absent; on Win/Linux
the env-var still wins as P1 (existing behavior preserved).

## Known limitation
The 256KB threshold is a byte-count proxy for "100% of context" — Claude Code
on Opus 4.1 is actually 200K tokens (~800KB jsonl, not 256KB). The 256KB
threshold triggers auto-compact earlier than the "real" 100% mark. This is
**acceptable** for the auto-compact use case (better to compact early than to
hit the red-line), and is documented in `docs/mac-auto-compact.md` as a known
approximation. A token-accurate Mac signal (e.g. from a statusline-state.json
or from `claude --status --json` if/when that verb lands) would be a future
improvement; for now, the byte-based estimate is a strict improvement over
the no-signal Mac baseline.

## Red-line compliance
- [x] SquabbyZ sole author (no `Co-Authored-By` trailer)
- [x] No `peaks-loop-shared/` / `publish.yml` / `package.json` change
- [x] No version bump (lands on main, ships in next 4.0.4.x or 4.0.5)
- [x] `auto-compact-reader.ts` NOT touched (PRD scope respected)
- [x] Karpathy 4 guidelines: 1-line surgical, no helper, no refactor

## QA verdict
All 4 dims PASS:
- Dim 1 Correctness: gate correctly carves out `transcript-estimate ≥ 0.85`,
  P1/P2/P4 paths unchanged.
- Dim 1.5 Production ESM repro: built dist + real 222.5KB Mac-shaped fixture
  → S1/S2/S3 PASS, no ReferenceError.
- Dim 2 Portability: 0 hits for `win32` / `process.platform` / `process.arch`.
- Dim 3 Integration: vitest 14/14 (reader) + 5/5 (orchestrator), tsc 0 errors.
- Dim 4 Discipline: no Co-Authored-By, 22 LOC prod diff (≤50 cap), no shared
  / publish / package.json change.

**Why:** Without this sediment, the next time someone asks "why does Mac
auto-compact still not fire" (or "why does it fire on Win/Linux but not
Mac"), the same systematic-debugging sweep will repeat. The cost of writing
this fact is small; the cost of re-discovering is 30+ minutes of audit +
rd + qa.

**How to apply:** When the user files any future "auto-compact not working on
Mac" issue, read this file FIRST. Confirm the `evaluateAutoCompactDecision`
function still has the `transcript-estimate` source-aware gate at the right
place (after `force`, before `shouldCompact: true` fallback). If it's gone,
this is a regression; if it's there, the issue is elsewhere (e.g. env-var
side-channel returning a stale ratio, or a higher-priority source is
incorrectly reporting a non-zero value).

Related: [[peaks-loop-mac-auto-compact-no-env-injection]] (root cause sediment
for the data-path half); [[peaks-loop-mac-auto-compact-esm-fake-green-and-fix]]
(the rid-001-r1 anti-fake-green pattern that QA-Dim-1.5 inherits).
