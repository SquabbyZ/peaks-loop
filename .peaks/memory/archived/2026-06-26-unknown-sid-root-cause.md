---
archived: 2026-06-29
reason: v2.16.0-alpha change-id axis scope reduction
status: archived
name: 2026-06-26-unknown-sid-root-cause
description: Root-cause diagnosis of `.peaks/_sub_agents/unknown-sid/` and `.peaks/_runtime/{sid-3,sid-h,sid-r,unknown-sid}/` orphan session dirs that drove the long-standing 5 `doctor.test.ts` carry-forward failures. Records the production-side bug, the test-side bug, and the 3-layer fix that eliminated both.
metadata:
  type: lesson
  sourceArtifact: src/cli/commands/dispatch-commands.ts
  sourceArtifactSecondary: src/services/skills/skill-presence-service.ts
  sourceArtifactTertiary: tests/unit/sub-agent-commands.test.ts
  createdAt: 2026-06-26
---

Root cause + remediation log for the `.peaks/_sub_agents/unknown-sid/` and `.peaks/_runtime/{sid-3,sid-h,sid-r,unknown-sid}/` orphan session dirs. 3-layer fix shipped in 4 commits (df1a246, 41d4fd2, 12ecd98 + a 4th as `_sub_agents`/`_runtime` archive run during the same session). Verifies the 5 `doctor.test.ts` long-carry-forward failures that survived every QA verdict from 2026-06-22 onward.

## Symptom (what was observed)

- `.peaks/_sub_agents/` had a `unknown-sid` directory with 6,576 files: 1.18MB `active-dispatches.json` + 3,287 `dispatch-unknown-rid-*.json` + 3,288 `batch-*.counter.json`.
- `.peaks/_runtime/` had 4 orphan session dirs: `sid-3`, `sid-h`, `sid-r`, `unknown-sid` (each containing only a `metrics/slices.jsonl`).
- `peaks doctor` reported `L3:l3-orphan-sessions: 4 orphan session(s) under .peaks/_runtime/ fail isValidSessionId: sid-3, sid-h, sid-r, unknown-sid`.
- 5 `tests/unit/doctor.test.ts` "passes when ..." happy-path tests failed with `expected false to be true` because `report.summary.ok` flipped false on the orphan check.
- 1 `tests/unit/doctor/35-checks-aggregate.test.ts` failed for the same reason.

The 5/6 failures were marked "pre-existing carry-forward" in every QA verdict for slices `2026-06-22-...`, `2026-06-23-...`, `2026-06-24-...`, and `2026-06-26-audit-artifact-writer-generalization`. The QA reports named `peaks workspace clean --project <repo>` as the fix path. That command only fixed the `_sub_agents/` axis — it did not touch `_runtime/<sid>/` dirs, and it did not address the test pollution that re-created the `_runtime/<sid>/` dirs on every `vitest run`.

## Quantitative profile (uncovered during the diagnosis)

### Production path: `.peaks/_sub_agents/unknown-sid/`

| Day | Dispatches | Notes |
|---|---|---|
| 2026-06-09 → 06-22 | 21+29+108+44+9+16+61 = 288 | Slow ramp, mostly dogfood |
| 2026-06-23 | 427 | First major audit slice storm |
| 2026-06-24 | 1,167 | Peak — `efficiency-4p-bundle` + `baseline-92-triage` running in parallel |
| 2026-06-25 | 1,105 | Continued audit throughput |
| 2026-06-26 | 300+ (still rising) | This session's diagnostic work |

3,287 dispatch files × ~0.3KB avg = ~1MB. `role` distribution: `rd`=3,271 (99%), `peaks-rd`=8, `peaks-qa`=4, `peaks-prd`=3, `peaks-txt`=1. **No overlap** with the `sid-3/sid-h/sid-r` fixture dispatch dirs (3,287 vs 505 each) — this was a real, parallel production dispatch sink, not a fixture.

### Test path: `.peaks/_runtime/{sid-3, sid-h, sid-r, unknown-sid}/`

Each had only `metrics/slices.jsonl` (1.5KB–20KB). `slices.jsonl` first line of `unknown-sid/metrics/slices.jsonl`:
```json
{"schemaVersion":1,"ts":"2026-06-26T11:37:42.982Z","sessionId":"unknown-sid","category":"dispatch","role":"rd","detail":{"requestId":"unknown-rid","ide":"claude-code","promptBytes":724,"headroomCompressed":false}}
```

`ts` is real wall-clock; the dispatch was from the dogfood session that was running at that time, but the project-root that the test fixture left polluted was `.peaks/` (peaks-loop itself). The 4 `sid-3/sid-h/sid-r/unknown-sid` dirs in `_runtime/` are the same **dispatch** path writing to `_runtime/<sid>/metrics/` via `emitObservabilityEvent` (slice C of v2.11.1) — the `requestId=unknown-rid` in the `slices.jsonl` confirms it's the same production fallback sid.

## Root cause (3 contributing layers, all needed the fix)

### Layer 1 — Production: 5 CLI entry points had a help-text lie

The `--session-id` flag's help text in `peaks sub-agent dispatch` read:
> `--session-id <sid>: override active session id (default: peaks session info --active)`

But the actual implementation in 5 CLI files collapsed to:
```ts
const sid = options.sessionId ?? 'unknown-sid';
```

The "default resolve from active session" was never wired up. When an LLM driver (peaks-solo orchestrator or downstream agent) saw the help text, trusted the auto-resolve, and omitted `--session-id`, the dispatch landed under `.peaks/_sub_agents/unknown-sid/`.

Affected sites (all 6 inline sites across 5 files):
- `src/cli/commands/dispatch-commands.ts:148` (warm-path single dispatch)
- `src/cli/commands/dispatch-from-dag.ts:58` (`--from-dag` path)
- `src/cli/commands/share-commands.ts:73,189,264` (3 subcommands: `share`, `shared-read`, `await`)
- `src/cli/commands/contract-commands.ts:95` (`peaks contract write`)

### Layer 2 — Test isolation: `sub-agent-commands.test.ts` left orphan fixture sids in real cwd

`tests/unit/sub-agent-commands.test.ts` uses bare-form fixture sids (`sid-3`, `sid-h`, `sid-r`) via `--session-id`. Two real-cwd side effects under peaks-loop itself (the test's "cwd project"):

- `.peaks/_sub_agents/<sid>/dispatch-<rid>-*.json`
- `.peaks/_runtime/<sid>/metrics/slices.jsonl`

The existing `afterEach` only cleaned the `mkdtempSync` tmp dir. The fixture sids persisted across tests, and across `vitest run` invocations, the same 4 dirs re-materialized before `doctor.test.ts` ran.

### Layer 3 — `.gitignore` did not cover `_archive/`

Once layers 1 + 2 are fixed, the historical orphan files should be archived (forensic value) but never committed. `.gitignore` had `.peaks/_sub_agents/`, `.peaks/_audit/`, etc. but not `.peaks/_archive/`. The 31.4MB archive of historical `unknown-sid` data would have been a single commit-time mistake away from polluting the repo.

## The 3-layer fix (3 commits + 1 archive run)

### Commit 1 — `df1a246` — production path

Replaced the 6 inline `?? 'unknown-sid'` sites with a 4-tier fallback chain:
```ts
const sid = options.sessionId
  ?? process.env.PEAKS_SESSION_ID
  ?? getCurrentSessionId(projectRoot)   // NEW: read .peaks/_runtime/session.json
  ?? 'unknown-sid';                       // last-resort only
```

Required exporting `getCurrentSessionId` (was private) from `src/services/skills/skill-presence-service.ts`. Help text rewritten at 6 sites to match the real behavior:
> `--session-id <sid>: session id (default: resolve from .peaks/_runtime/session.json; falls back to PEAKS_SESSION_ID env var; final fallback "unknown-sid")`

Tests: `tests/unit/cli/commands/session-id-fallback.test.ts` — 6 cases pinning the 4 tiers (flag > env > binding > legacy back-compat > literal) plus the on-disk dispatch record path. All GREEN.

### Commit 2 — `41d4fd2` — `.gitignore`

Added `.peaks/_archive/` to `.gitignore` with a comment explaining what goes there. Pattern consistent with `.peaks/_sub_agents/` (the source of the same data) and the other ephemeral `.peaks/_<x>/` state trees.

### Commit 3 — `12ecd98` — test isolation

In `tests/unit/sub-agent-commands.test.ts` `afterEach`, after the existing `mkdtempSync` cleanup, scan `.peaks/_sub_agents/` and `.peaks/_runtime/` under the real cwd and `rmSync(..., { recursive: true, force: true })` any directory matching `/^(sid-[a-z0-9]+|unknown-sid)$/` — the same regex as `src/services/workspace/sid-naming-guard.ts`. Each test now leaves the workspace exactly as it found it.

### Archive run — historical 5 + 4 dirs

`executeSubAgentClean(projectRoot, { apply: true })` migrated 5 dirs (3.1MB × 3 + 22MB + 5KB = 31.4MB) from `.peaks/_sub_agents/` to `.peaks/_archive/invalid-sids/`. `mv` (manual, no service helper for this axis) migrated 4 dirs (4-20KB each = 32KB) from `.peaks/_runtime/` to `.peaks/_archive/invalid-sids-runtime/`. Forensics preserved; active workspace clean.

## Verification

| Metric | Before | After |
|---|---|---|
| `.peaks/_sub_agents/unknown-sid/` file count | 6,576 | 0 |
| `.peaks/_runtime/` orphan dir count | 4 | 0 |
| `vitest run` total failures | 6 (5 doctor + 1 aggregate) | 0 |
| `vitest run` total passes | 4,245 | 4,251 |
| `tsc --noEmit` | CLEAN | CLEAN |
| `package.json#version` | 2.11.2 | 2.11.2 (unchanged) |

## What would have been the wrong fix (and why)

Several alternatives look appealing but don't actually fix the root:

- **Adding a guard test** (`tests/unit/workspace/`: HARD-fail on bare sids in `_sub_agents/`): this is a fence, not a fix. The fence fails to trigger for the historical 3,287 files already in place, and adds a test that has to be updated every time someone legitimately uses a `sid-<x>` form. The fence-only approach is what produced the "3 pre-existing doctor test failures" carry-forward across slices 2026-06-22 through 2026-06-26.
- **Just `peaks workspace clean --apply`**: only handles the `_sub_agents/` axis via `executeSubAgentClean`. Does not touch `_runtime/<sid>/` dirs. Does not prevent the test pollution that recreates them on the next `vitest run`. Would have left 4 of the 6 doctor failures standing.
- **Renaming `unknown-sid` to a real sid post-hoc**: treats the symptom (the dir name) without addressing the cause (CLI never read the active session). Would still have allowed new `unknown-sid` writes from any future dispatch that forgot the flag.
- **Adding `--session-id` as a required flag**: breaks every existing caller including the 5 CLI subcommands' own help text. The fix is "make the auto-resolve that the help text already promised actually work", not "force every caller to add a flag".

## Patterns / takeaways for future work

- **Help text is part of the contract.** When a CLI flag's help text says "default: peaks session info --active", the implementation must actually call `peaks session info --active`. If you can't implement the promised default, change the help text. The "Lie-Then-Fix-Later" anti-pattern is the most common root cause of untyped silent fallbacks.
- **Production paths and test fixtures share the same filesystem.** A test that uses `--session-id 'sid-3'` to assert envelope shape is implicitly writing to `.peaks/_runtime/sid-3/metrics/slices.jsonl` under the real cwd (peaks-loop itself). Tests that touch the real filesystem need the same cleanup discipline as production code. `afterEach` must clean ALL side effects, not just the explicit `mkdtempSync` dirs.
- **Two-axis cleanup.** `.peaks/_sub_agents/` (sub-agent dispatch records) and `.peaks/_runtime/<sid>/` (skill-presence + observability metrics) are two separate axes that the same dispatch can write to. A cleanup tool that handles one axis is half a fix. If you ever add a third axis (e.g. `.peaks/_runtime/<sid>/artifacts/`), the cleanup tool needs a third branch.
- **The "pre-existing carry-forward" QA verdict label is a smell.** When a slice QA verdict says "N pre-existing test failures, out of scope, fix path: <some external command>", the verdict is also a promise that the next slice will hit the same failures. If 2+ slices in a row carry the same label, the root cause is no longer "pre-existing" — it's "systemic, and the QA verdict is treating a symptom as a problem statement". This slice demonstrates the reframe: the "3 pre-existing doctor failures" label was masking two distinct bugs (production help-text lie + test isolation leak) that happened to surface through the same check.
- **Archive, don't purge.** When historical orphan files have forensic value (e.g. they let a future reader reconstruct which slices ran when), keep them under `.peaks/_archive/invalid-sids*/` rather than `rm -rf`-ing. The 31.4MB cost is real but bounded; the audit-trail value is unbounded. Pair with a `.gitignore` entry that names the archive dir so the cost doesn't accidentally hit `git push`.

## Related

- `audit-artifact-convention.md` (sibling convention doc) — same date, same governance theme (治根 not 围栏), different file family (`.peaks/memory/` shape contract vs sub-agent dispatch record dir)
- `git log df1a246` — production fallback fix
- `git log 41d4fd2` — `.gitignore` archive entry
- `git log 12ecd98` — test isolation fix
- `src/services/workspace/sid-naming-guard.ts` — canonical bare-sid regex used by both production code and the test cleanup
- `src/services/workspace/workspace-clean-service.ts` — `executeSubAgentClean` (the half-fix the QA verdicts were recommending; necessary but not sufficient)
