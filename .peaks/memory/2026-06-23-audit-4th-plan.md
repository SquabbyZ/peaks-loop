# 2026-06-23 4 度审计 plan (post-compact handoff)

> **Context.** User said "commit, then I compact, then do 4度审计". The
> 3 度审计 + fixes are merged to develop at `b933913`. Pick up here in
> a new session after compact. Read this file for the 4 度审计 lens;
> the prior memory doc at `2026-06-23-audit-3rd-findings.md` is
> historical.

## What prior audits covered (do NOT re-audit these)

| Pass | Commit | Dimensions covered |
|------|--------|-------------------|
| 1st (P0) | `66db3ef` | Pre-merge-blocking correctness + security |
| 2nd re-audit | `71bf964` | Code-quality, naming, dead code, lint, type design |
| 3rd audit | `6b09ccc` | Security HIGH (path trust), Concurrency HIGH (RMW races), Security MED (secret-leak), Security MED (input validation), Documentation MED (SKILL.md gap), Performance LOW (file split, mkdirSync), Concurrency LOW (require→ESM), Error propagation LOW (nextActions) |

## 4 度审计 — 6 fresh dimensions NOT covered before

### A. Error recovery / partial state after crashes

After a crash mid-orchestration, what state is left behind? For each
write that mutates an artifact file, ask:

- Is the write atomic? (tmp + rename? or partial write?)
- If the process crashes BETWEEN read and write, can the next
  invocation recover?
- Is there an orphan-detection sweep (like the `SHARED_CHANNEL_TTL_DAYS`
  GC we added in G8.4)?

Concrete targets to probe:
- `.peaks/_sub_agents/<sid>/dispatch/<rid>-<ts>.json` — what if the
  process crashes during `writeInitialDispatchRecord`? (already tmp +
  rename, but is the record path registered elsewhere before the
  rename commits?)
- `.peaks/_runtime/<sid>/dispatch/contracts/<slice-id>.json` —
  contract-store; does a partial contract block downstream level-2
  dispatch?
- `.peaks/_runtime/<sid>/peaks-batch-counter.json` — counter file;
  RMW without a lock? (audit-p0 added noteDispatched but no flock)
- `.peaks/_runtime/<sid>/request/state.json` — request state machine
- `.peaks/preferences.json` — savePreferences does writeFileSync
  directly (no tmp + rename), so a crash corrupts the file

### B. Observability — what's logged, where, and how

- `process.stderr.write` ad-hoc vs structured logger
- Dispatch record carries `createdAt` / `completedAt` but no per-step
  timing; if a sub-agent hangs, the parent has no signal beyond
  heartbeat polling
- No `peaks log` / `peaks trace` CLI surface to aggregate cross-run
  telemetry
- Error envelopes have `nextActions` but no machine-readable `errorId`
  for log correlation
- Are there `console.log` / `console.error` statements in production
  code that bypass the envelope?

### C. Configuration schema + migration

- `preferences.json` has `schema_version` but is there a migration path
  when we bump from 1 to 2? loadPreferences throws on mismatch — is
  there a `peaks preferences migrate` CLI?
- `.peaks/_runtime/<sid>/config.json` — session config schema version?
- Tests use `mkdtempSync` for isolation, but production writes go to
  user-owned `.peaks/`; what guards the migration?

### D. Test determinism / flakiness

- `applyTruncation` slices at 100 — does any test assert exact
  truncation behavior?
- `notesDispatched` batch counter — does it increment past `BATCH_LIMIT`
  in tests, or is it bounded?
- The `setImmediate` race in `file-lock.test.ts` 50-writer test — does
  it flake on slow CI? (Consider deterministically queueing via a
  fixed `setTimeout(0)` chain instead.)
- Wall-clock tests: `lastBeatAt` in heartbeat — any test that
  asserts a precise time?

### E. API stability / envelope contract

- The dispatch envelope shape: `role`, `ide`, `originalPromptSize`,
  `promptSize`, `toolCall`, `dispatchRecordPath`, `batchId`,
  `dispatchedInBatch`, `headroom*`, `forcedAt`, `contextImpact`,
  `artifactMetas`. After #4 dropped `prompt`, is there a
  version-marker (`envelopeVersion`) so future consumers can detect
  shape changes?
- Shared channel entry shape — `at`, `from`, `key`, `value`, `valueSize`.
  Frozen in 2.7.0 but no deprecation path documented.
- Are envelope field additions gated by a schema check, or do they
  silently grow?

### F. Documentation drift (code vs SKILL.md / references)

- SKILL.md says `peaks sub-agent dispatch <role>` for "CLI-auxiliary"
  use; in 2.7.0+ slice-dag-dispatcher MVP, the canonical entry point is
  `--from-dag <file>`. Is the SKILL.md narrative aligned with the
  peak-solo's actual slice 5 default fan-out path?
- `references/sub-agent-dispatch.md` — does it describe the G9 CLI 兜底
  thresholds or is it stale?
- `references/swarm-dispatch-contract.md` — references `>= 2 leaves`;
  after slice 5 default, is the rule "default" or "opt-in"?
- `references/context-governance.md` — G7 50/75/80 thresholds — does
  the in-code threshold table match the doc, or has it drifted?
- Code comments referencing slice numbers (`slice 9 perf`, `slice 5`,
  `slice 2.7.0`); if the docs and code disagree on which slice landed
  a feature, that's drift.

## Suggested audit methodology

For each dimension (A–F):

1. Pick 2-3 representative files to scan (not full codebase).
2. For each finding, capture: dimension, severity (HIGH/MEDIUM/LOW),
   file:line, code excerpt, fix sketch.
3. Cross-reference the prior audit memos (`2026-06-23-audit-p0-reaudit-findings.md`
   and `2026-06-23-audit-3rd-findings.md`) to avoid double-counting.
4. Write findings to `.peaks/memory/2026-06-23-audit-4th-findings.md`
   with the same `slice` + commit metadata as prior memos.
5. Recommend fix order: HIGH first (crash recovery + observability),
   then MED (schema migration + envelope versioning), then LOW
   (doc drift + test determinism).

## Branch state at handoff

- Branch: `develop` (post-merge of audit-3rd-fixes)
- HEAD: `b933913 merge: audit-3rd-fixes — 3 HIGH + 3 MEDIUM + 5 LOW`
- Last fix commit: `6b09ccc fix(audit-3rd): address 3 HIGH + 3 MEDIUM + 5 LOW findings`
- New findings (this audit): pending — see 6 dimensions above
