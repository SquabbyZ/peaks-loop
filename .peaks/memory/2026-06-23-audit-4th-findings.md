# 2026-06-23 4 度审计 findings

> **Context.** 4 度审计 per the 6 fresh dimensions in
> `2026-06-23-audit-4th-plan.md`. Prior audits covered correctness,
> security HIGH (path trust), RMW races, secret-leak, input validation,
> SKILL.md gap, file split, mkdirSync overhead, require→ESM, and
> nextActions. The 4 度 pass deliberately does NOT re-audit those.
>
> **Branch state at audit start:** `develop` at `b933913` (audit-3rd
> fixes merged). No uncommitted changes from the prior slice.
>
> **Severity scale:** CRITICAL = data loss / silent failure under normal
> use; HIGH = bug reachable in a realistic flow that breaks a documented
> contract; MED = maintainability / spec drift with no functional loss
> today; LOW = nice-to-have / future-proofing.

## Summary

| Dim | Findings | HIGH | MED | LOW |
|-----|----------|------|-----|-----|
| A. Error recovery / crash state | 4 | 2 | 2 | 0 |
| B. Observability | 3 | 1 | 1 | 1 |
| C. Config schema + migration | 2 | 1 | 1 | 0 |
| D. Test determinism / flakiness | 3 | 0 | 2 | 1 |
| E. API stability / envelope contract | 2 | 1 | 0 | 1 |
| F. Documentation drift | 4 | 1 | 2 | 1 |
| **Total** | **18** | **6** | **8** | **4** |

Recommended fix order: **A → B → E (HIGH) → C (HIGH) → F (HIGH) → B/C/E/F MED → D/F LOW**.

---

## A. Error recovery / partial state after crashes

### A1. `noteDispatched` has a read-modify-write race (RMW without lock) — **HIGH**
**File:** `src/services/dispatch/batch-counter.ts:64-96`
**Problem:** Two concurrent `peaks sub-agent dispatch` invocations for
the same `(projectRoot, sid, batchId)` race on the counter file:

1. P1 calls `readBatchCount` → returns N
2. P2 calls `readBatchCount` → returns N (P1 hasn't written yet)
3. P1 writes `count: N+1`
4. P2 writes `count: N+1` (clobbers P1)

The audit-3rd fixes added `withFileLockSync` to
`shared-channel.ts` and `dispatch-record-writer.ts` but **missed the
batch counter**. The counter is informational (BATCH_OVER_LIMIT is a
warning, not a reject) so a lost increment is silently tolerated —
the BATCH_LIMIT/6 boundary test in `tests/unit/batch-counter.test.ts`
runs serially and would never catch this.

**Repro:** spawn 6+ parallel `peaks sub-agent dispatch --batch-id
<fixed> --prompt "x"` invocations from `xargs -P 6` — final `count`
will be <6, and the BATCH_OVER_LIMIT warning fires for the wrong
threshold.

**Fix sketch:** wrap `noteDispatched`'s read+write in
`withFileLockSync(batchCounterPath(...), () => { ... })` (same
helper as audit-3rd #2/#3). The lock contention is rare
(only when a single batch is dispatched in parallel from the same
LLM) so the spin-wait cost is bounded.

### A2. `savePreferences` uses `writeFileSync` directly (no tmp+rename) — **HIGH**
**File:** `src/services/preferences/preferences-service.ts:64-74`
**Problem:** A crash between `mkdirSync` and `writeFileSync` (or
mid-`writeFileSync` on a power-cut) leaves a zero-byte or
half-written `.peaks/preferences.json`. The next `loadPreferences`
then throws `PREFERENCES_JSON_INVALID` and the LLM is stuck — there
is no recovery path documented.

Compare with `dispatch-record-writer.ts:409-420` which already uses
`tmp + rename` for the same reason.

**Fix sketch:** add `writeAtomic` helper in `preferences-service.ts`
(tmp + rename) and use it in `savePreferences`. The
`preferences-commands.ts:reset` action also writes via raw
`writeFileSync` (line 161) — same fix.

### A3. No orphan-detection sweep for dispatch records or contract files — **MED**
**File:** `src/services/dispatch/dispatch-record-writer.ts` (no TTL
helper) + `src/services/dispatch/contract-store.ts` (no TTL helper)
**Problem:** `shared-channel.ts:42` exposes `SHARED_CHANNEL_TTL_DAYS=30`
and a `isOrphanChannel` predicate — that sweep is in place. But
dispatch records (`dispatch-<rid>-<ts>.json`) and contracts
(`contracts/<slice-id>.json`) have no equivalent. A crashed run leaves
records on disk that the next `peaks sub-agent await` may keep
waiting on. The plan-doc bullet ("`<sid>/request/state.json`" and
"`<sid>/dispatch/contracts/<slice>.json`") flagged this.

**Fix sketch:** add `isOrphanDispatchRecord(opts)` mirroring
`isOrphanChannel`, plus a `peaks sub-agent cleanup` CLI that runs
all three sweeps in one pass (shared channel + dispatch record +
contract). Or extend the existing `peaks workspace consolidate`
umbrella (slice 011) to add dispatch-record/contract TTL.

### A4. `dispatchRecordPath` resolves before the write — path is registered after — **MED**
**File:** `src/services/dispatch/dispatch-record-writer.ts:121-161`
**Problem:** A trace of `writeInitialDispatchRecord` shows the
function is atomic at the file level (tmp+rename, good) but the
record path is only known after the write succeeds. There is no
"bookkeeping" step that registers the path in an index before the
write — the LLM-side runner learns the path from the `dispatch`
envelope, so a crash between `dispatch` returning and the sub-agent
calling `heartbeat` leaves the record orphaned (no parent ever
discovers it).

Compare with the G8.4 shared channel which writes a `batchId` in
the file metadata so the dispatcher can find it again.

**Fix sketch:** add an optional in-memory index (e.g.
`.peaks/_sub_agents/<sid>/active-dispatches.json`) written BEFORE
the record is created; the LLM-side runner reads this index when
restarting. Out of scope for the 4 度 fixes; mention as
"acknowledged limitation" in completion-handoff.

---

## B. Observability — what's logged, where, and how

### B1. Dispatch / heartbeat / share do NOT call `writeLogEntry` — **HIGH**
**File:** `src/cli/commands/dispatch-commands.ts`,
`heartbeat-commands.ts`, `share-commands.ts` (none of them import
`logger.ts`)
**Problem:** `program.ts:78` writes a single `peaks-cli start` line
per process. The dispatch / heartbeat / share CLI actions emit
**nothing** to the JSONL log. So `peaks log tail` shows that the
process ran but not what it did. The `nextActions` and `code` in
the envelope are the only signal, and they live in the LLM's
context window, not on disk.

This is the gap that the plan-doc dim B called out: "if a sub-agent
hangs, the parent has no signal beyond heartbeat polling". The
hang is invisible because there is no record of "dispatch #N
started at T+12s" to cross-reference against the heartbeat.

**Fix sketch:** add `writeLogEntry({ level: 'info', command:
'sub-agent.dispatch', msg: 'dispatched', data: { rid, role, sid,
batchId, dispatchedInBatch, forcedAt, headroomCompressed } })` at
the success path of each action. Same for `heartbeat` and `share`.
The logger is already best-effort and never throws
(`logger.ts:155-159`), so a disk-full or EACCES on `~/.peaks/logs/`
won't break the CLI.

### B2. No `peaks trace` cross-run correlation ID — **MED**
**File:** (new CLI / service)
**Problem:** Each log line carries `command` and `sessionId` but not
a `dispatchId` or `batchId`. When 6 sub-agents run in parallel,
their lines interleave in the JSONL file and there is no way to
group them post-hoc. The user can grep `sessionId=<sid>` but cannot
say "show me everything sub-agent 3 in batch X did".

**Fix sketch:** add an optional `batchId` field to `LogEntry`
(logger.ts:32-42) and pass it through from dispatch/heartbeat/share
actions. Also add a `--batch` flag on `peaks log tail` for filtering.
The envelope already exposes `batchId` (audit-3rd kept it), so the
producer side is ready; the consumer side (log tail) is not.

### B3. Error envelopes have no machine-readable `errorId` — **LOW**
**File:** `src/shared/result.ts` (the `fail()` helper), every
catch-block
**Problem:** A user sees `code: "DISPATCH_ERROR"`, message: "ENOENT
at line 47 of dispatch-record-writer.ts". They have to copy/paste
the message into a search to find related log lines. A short
opaque `errorId` (uuid v4) in every envelope (also written to the
log line) would let the user say "my last error was `errorId:
a1b2c3...` — show me the log lines tagged with that id".

**Fix sketch:** generate `randomUUID()` in `fail()`, return it as
the 5th field; include it in `writeLogEntry` calls from B1.

---

## C. Configuration schema + migration

### C1. `PREFERENCES_SCHEMA_MISMATCH` is a hard fail with no migrate path — **HIGH**
**File:** `src/services/preferences/preferences-service.ts:36-41`
**Problem:** `loadPreferences` throws when `schema_version` does
not equal `PREFERENCES_SCHEMA_VERSION` (currently `2.0.0`). When
this happens, every CLI command that calls `loadPreferences` (via
`dispatch-commands.ts:148`) falls into the `try { ... } catch {
DEFAULT_PREFERENCES.headroom }` branch — so dispatch keeps working
silently with the default. But `peaks preferences get` / `set` /
`reset` (`preferences-commands.ts:54-90`) call `loadPreferences`
directly in their action body; the catch path there is just
`process.exit(1)`, which is hostile. There is no `peaks
preferences migrate` CLI.

**Fix sketch:** add `peaks preferences migrate` that:
1. Reads the on-disk JSON.
2. Compares `schema_version` to `PREFERENCES_SCHEMA_VERSION`.
3. For v1 → v2, applies a documented mapping (e.g. fill in
   `headroom.perTouchpoint` sub-keys that v1 didn't have).
4. Writes the new shape with `schema_version: '2.0.0'`.

Until that ships, document the manual recovery: edit
`.peaks/preferences.json`, change `schema_version` to
`PREFERENCES_SCHEMA_VERSION`, and re-merge. Reference the G2
standard in `references/preferences-migration.md`.

### C2. No schema_version on the dispatch record's `toolCall` — **MED**
**File:** `src/services/dispatch/dispatch-record-writer.ts:67-86`
**Problem:** The record has a top-level `version: 2` field but the
embedded `toolCall` object (the per-IDE `{name, args}` descriptor)
has no version marker. When Claude Code's `Task` tool arg shape
changes (e.g. `subagent_type: "general-purpose"` becomes
`subagent_type: "claude-code-3.5"`), the record's `toolCall` looks
shape-valid but the LLM gets a parameter error. There's no
way to detect "this record is for v2.0 Task, current IDE is v3.0"
without manually inspecting the args.

**Fix sketch:** add `toolCallVersion?: string` to `SubAgentToolCall`
in `sub-agent-dispatcher.ts`, set it at `buildToolCall` time, and
let `dispatch-record-writer.ts` propagate it to the record. The
upgrader (already in `upgradeRecord` at line 313) supplies a
default for legacy records.

---

## D. Test determinism / flakiness

### D1. `file-lock.test.ts` 50-writer test uses `setImmediate` (not deterministic on slow CI) — **MED**
**File:** `tests/unit/services/filesystem/file-lock.test.ts:82-119`
**Problem:** The test schedules all 50 writers via `setImmediate` to
race them in the same event-loop tick. On a busy CI runner
(GitHub Actions hosted runner with cold cache), the spin-wait
inside `withFileLockSync` can starve if Node's microtask queue is
saturated. The 5s worst-case bound (`MAX_LOCK_RETRIES *
LOCK_RETRY_MAX_MS = 100 * 50ms`) is the *theoretical* max; the
real worst case includes any GC pauses. CI flakes on this test
have been reported (see prior `sweeps` log).

**Fix sketch:** replace `setImmediate` with `queueMicrotask` (or
`process.nextTick`) — both run before any I/O so the contention is
deterministic. Alternatively, increase the timeout in vitest config
to 15s. Lower-priority: add a stress variant (`N=200`) to surface
real contention.

### D2. `applyTruncation` boundary case is not asserted — **MED**
**File:** `src/services/dispatch/dispatch-record-writer.ts:223-228`
**Problem:** The function slices to 100 entries and sets
`truncated: true` when the input is >100. The `truncated` flag
flows through `appendHeartbeat`'s return value, but no test pins
the boundary (exactly 100, 101, 200). The `appendHeartbeat`
test file likely only tests the happy path.

**Fix sketch:** add `tests/unit/dispatch/apply-truncation.test.ts`
with cases: 0→100, 100→100 (no truncation), 101→100 (truncated),
200→100 (truncated to the LAST 100, not the FIRST 100 — that's
the actual contract).

### D3. `noteDispatched` BATCH_LIMIT boundary has no race test — **LOW**
**File:** `tests/unit/batch-counter.test.ts:30-43`
**Problem:** The test iterates serially, so the lost-update race
from A1 cannot surface. The test passes with a non-atomic
read-modify-write because nothing else writes concurrently.

**Fix sketch:** after fixing A1 (wrap in file lock), add a parallel
counter test in the same file that spawns `Promise.all` of
`noteDispatched` calls and asserts the final count equals the
number of spawns. This will catch any future regression that
removes the lock.

---

## E. API stability / envelope contract

### E1. No `envelopeVersion` field on dispatch / heartbeat / share envelopes — **HIGH**
**File:** `src/shared/result.ts` (the `ok()` / `fail()` helpers),
all CLI action handlers
**Problem:** After audit-3rd #4 removed `data.prompt` from the
dispatch envelope, there is no marker a consumer can check to know
"is this the v2 envelope (no `prompt` field) or the v1 envelope
(`prompt` present)?". The plan-doc dim E flagged this: "is there
a version-marker (`envelopeVersion`) so future consumers can detect
shape changes?" Answer: no. The dispatch envelope will silently
drop or add fields forever; external LLM-side runners have no way
to detect a contract change except by trial.

**Fix sketch:** add `envelopeVersion: '2.1.0'` to the `data` object
in every `ok()` call from `dispatch-commands.ts`, `heartbeat-commands.ts`,
`share-commands.ts`. Bump on any future breaking change. Document
the version policy in `references/envelope-contract.md`.

### E2. Shared channel entry shape has no deprecation path — **LOW**
**File:** `src/services/context/shared-channel.ts:24-30`
**Problem:** The shape (`at`, `from`, `key`, `value`, `valueSize`)
is frozen per the plan-doc note, but if a future field is needed
(e.g. `valueType: 'json' | 'text'`), the existing readers will
ignore it (loose read) but the existing writers will lose it
(silent drop on serialization if a `JSON.stringify` short-circuits
unknown keys). No version marker means no deprecation cycle.

**Fix sketch:** add a `version: 1` field to `SharedChannelEntry`.
Document a 2-version deprecation policy: when `version: 2` lands,
`version: 1` is still readable for 1 minor release, then dropped.

---

## F. Documentation drift

### F1. `sub-agent-dispatch.md:52` still documents the removed `prompt` field — **HIGH**
**File:** `skills/peaks-solo/references/sub-agent-dispatch.md:43-71`
**Problem:** The envelope example in §"Dispatch contract" shows:

```json
"data": {
  "role": "rd",
  "ide": "claude-code",
  "prompt": "<complete prompt the LLM should pass through>",
  ...
}
```

This is the field audit-3rd #4 deliberately removed. A reader
following the doc as a contract will look for `data.prompt` in the
real envelope, not find it, and either crash or improvise. The
envelope is in the doc verbatim; the in-code replacement
(`originalPromptSize` + `promptSize`) is not.

**Fix sketch:** rewrite the envelope example in
`sub-agent-dispatch.md:43-71` to match `dispatch-commands.ts:260-291`
post-audit-3rd. Include a callout box: "audit-3rd #4 removed
`data.prompt`; prompt sizes are exposed via `originalPromptSize` /
`promptSize` only."

### F2. `sub-agent-dispatch.md:58` shows `prompt: "..."` inside `toolCall.args.prompt` — **MED**
**File:** `skills/peaks-solo/references/sub-agent-dispatch.md:58`
**Problem:** Inside the embedded `toolCall.args`, the doc shows
`"prompt": "..."`. This is correct — the prompt lives inside
`toolCall.args` (which the LLM passes to the IDE's tool). The audit
removed `data.prompt` but `toolCall.args.prompt` is unchanged. The
doc is internally consistent. However, a reader skimming the
example will conflate the two and panic. Add a note: "the prompt
content lives in `toolCall.args.prompt` (the IDE-arg the LLM
passes through), NOT in the outer envelope (`data.prompt` was
removed in 2.7.1; see audit-3rd #4)."

**Fix sketch:** one-line callout in the envelope example.

### F3. `swarm-dispatch-contract.md` says "≥ 2 leaves → default" but the file is titled "conditional" — **MED**
**File:** `skills/peaks-solo/references/swarm-dispatch-contract.md:1-9`
**Problem:** The header still describes Swarm as "conditional"
(line 9: "The Swarm phase is **conditional**, not unconditional"). But
audit-3rd + slice 5 (default fan-out) made it the default for any
DAG with ≥ 2 leaves. The file acknowledges this in line 7 ("the
previous 'conditional swarm' framing is replaced by the default
fan-out rule") but the body and headline still say "conditional".
A reader skimming will get the wrong model.

**Fix sketch:** change the headline to "default" (matching the
SKILL.md) and rewrite the "1. Why this exists" section's lead to
match. Add a one-line callout in §"Peaks-Cli Swarm parallel phase"
that the default-mode opt-out is `fanout.defaultMode: 'serial'`
in preferences.

### F4. Threshold tables in `context-governance.md` are duplicated with a small drift — **LOW**
**File:** `skills/peaks-solo/references/context-governance.md:120-128`
and `:182-190`
**Problem:** The G9 threshold table is presented twice in the same
file (once in §G9 head, once in §G9 "Body"). The in-code thresholds
in `src/services/context/threshold.ts` are **50% / 75% / 80% / 90%**
(4 tiers). The doc shows **50% / 75% / 80%** (3 tiers) — it omits
the 90% emergency tier. A future maintainer reading the doc will
not know the emergency tier exists.

**Fix sketch:** add a 90% row to the doc table; add a one-line
note that the in-code threshold.ts is the canonical source and
any drift must be fixed in BOTH places (or, better, generate the
table from `threshold.ts` constants at doc-build time).

---

## Recommended fix order (per plan-doc §"Suggested audit methodology")

1. **HIGH (functional / data-loss)**
   - **A1** — wrap `noteDispatched` in `withFileLockSync`
   - **A2** — `savePreferences` + `reset` use tmp+rename
   - **B1** — dispatch/heartbeat/share call `writeLogEntry`
   - **C1** — `peaks preferences migrate` CLI + manual recovery doc
   - **E1** — add `envelopeVersion: '2.1.0'` to all envelopes
   - **F1** — rewrite `sub-agent-dispatch.md` envelope example

2. **MED (maintainability / spec drift)**
   - A3, A4 — orphan-detection sweeps + dispatch-index acknowledgement
   - B2, C2 — batchId in LogEntry; toolCall version
   - D1, D2 — `queueMicrotask` race; applyTruncation boundary tests
   - F2, F3 — toolCall.args.prompt callout; swarm doc headline

3. **LOW (future-proofing)**
   - B3 — errorId on envelopes
   - D3 — BATCH_LIMIT parallel counter test
   - E2 — SharedChannelEntry.version
   - F4 — 90% threshold row in doc

Estimated scope: 6 HIGH + 8 MED + 4 LOW = 18 findings. A single
audit-4th-fixes slice (mirroring the prior three) can land them
in one pass; the largest item is the `preferences migrate` CLI
(C1) which deserves its own design doc.

## Branch state at handoff

- Branch: `develop` at `b933913`
- Findings file: this doc
- Next: 4 度审计 fix slice (or hand-pick HIGH-only if the user
  wants a smaller first cut)
