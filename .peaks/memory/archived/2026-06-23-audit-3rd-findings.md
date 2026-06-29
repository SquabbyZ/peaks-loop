# 2026-06-23 3度审计 findings (post-fix 71bf964)
archived: 2026-06-29
reason: v2.16.0-alpha change-id axis scope reduction
status: archived

> **Context.** Third audit pass on commit `71bf964 refactor(sub-agent):
> address 2 HIGH + 4 MEDIUM + 2 LOW re-audit findings`. Brings 6 fresh
> dimensions that the prior two audits (P0 + re-audit) did not cover.
> Pick up by reading this file in a new session.

## Summary table

| # | Dim | Severity | Title | Location |
|---|-----|----------|-------|----------|
| 1 | Security | **HIGH** | `deriveProjectRoot` trusts input path — cross-project heartbeat write | `src/cli/commands/heartbeat-commands.ts:74` |
| 2 | Concurrency | **HIGH** | `writeSharedEntry` read-modify-write race loses concurrent writes | `src/services/context/shared-channel.ts:101-194` |
| 3 | Concurrency | **HIGH** | `appendHeartbeat` race vs `markCompleted` / parallel heartbeats | `src/services/dispatch/dispatch-record-writer.ts:163-194` |
| 4 | Security | **MEDIUM** | Dispatch envelope returns full `prompt` in stdout (secret leak surface) | `src/cli/commands/dispatch-commands.ts:271` |
| 5 | Security | **MEDIUM** | `playwright-commands.ts` does not validate `--user-data-dir` is under projectRoot | `src/cli/commands/playwright-commands.ts:170-178` |
| 6 | Documentation | **MEDIUM** | G8.4 share / shared-read / await sub-commands undocumented in SKILL.md | `skills/peaks-solo/SKILL.md` (absent) |
| 7 | Performance | **LOW** | `dispatch-commands.ts` at 524/800 lines — `runDispatchFromDag` split candidate | `src/cli/commands/dispatch-commands.ts:320-525` |
| 8 | Test isolation | **LOW** | `share-commands.test.ts` lastWriteWins test depends on millisecond timing | `tests/unit/cli/commands/share-commands.test.ts:99-111` |
| 9 | Error propagation | **LOW** | Share/heartbeat error envelopes lack actionable nextActions | `src/cli/commands/share-commands.ts:117, 174, 260` |
| 10 | Concurrency | **LOW** | `gcChannel` and `isOrphanChannel` use `require()` mid-module (sync I/O on hot path?) | `src/services/context/shared-channel.ts:251, 275` |
| 11 | Performance | **LOW** | `mkdirSync({ recursive: true })` runs on every `writeAtomic` even when dir exists | `src/services/dispatch/dispatch-record-writer.ts:377` |

## Detail

### 1. Security HIGH — `deriveProjectRoot` trusts input path

```ts
// heartbeat-commands.ts:74
assertSafeDispatchRecordPath(options.record, deriveProjectRoot(options.record));
```

`deriveProjectRoot(recordPath)` walks the record path itself, not a
trusted source. An attacker can pass a path that contains a `.peaks`
segment pointing at any project:

```bash
# User A's project: /home/A/proj/.peaks/_sub_agents/sid-A/...
# Attacker on user B's machine:
peaks sub-agent heartbeat --record /home/A/proj/.peaks/_sub_agents/sid-A/dispatch-...-...json \
  --status failed --progress 0
```

`deriveProjectRoot` returns `/home/A/proj`. The R-2 guard then checks
the path lives under `/home/A/proj/.peaks/_sub_agents/` — yes, so the
heartbeat is appended to A's record.

**Fix:** trust `options.project ?? process.cwd()` instead of deriving
from the path. The R-2 guard's `relative()` check is a backstop but
doesn't help here because the path IS in `projectRoot/.peaks/...` from
the attacker's view.

### 2. Concurrency HIGH — `writeSharedEntry` RMW race

```ts
// shared-channel.ts:101-194
let channel = readChannelOrEmpty(...);
const lastWriteWins = hasKey(channel.entries, opts.key);
const projectedChannel = { ...channel, entries: { ...channel.entries, [opts.key]: entry } };
// ... LRU eviction ...
writeAtomic(channelFile, projectedChannel);
```

Two parallel `peaks sub-agent share` calls for the same batch with
different keys will:

1. Both read the same empty channel
2. Both compute their projectedChannel independently (only their key present)
3. Both `renameSync` to the same file
4. Last write wins; the OTHER entry is lost

The dispatcher-mediated cross-sub-agent signal is supposed to be the
core of G8.4. Losing a signal is a real correctness issue for swarm
co-ordination.

**Fix:** add a file lock (e.g. `proper-lockfile`) or implement
compare-and-swap retry. At minimum, use `flock` via `fs.openSync` +
`flock(fd, LOCK_EX)` before the read-modify-write.

### 3. Concurrency HIGH — `appendHeartbeat` race

Same shape as #2 but for dispatch records. `appendHeartbeat` does
read-then-write of the record. If `markCompleted` runs concurrently
(e.g. the sub-agent exits and the parent marks it complete while a
straggler heartbeat lands), one of the writes is lost.

A heartbeat arriving 100ms before `markCompleted` can be silently
discarded. The parent dispatcher may then see the sub-agent as
"completed" but missing the last progress update.

**Fix:** same as #2 — flock, or make `appendHeartbeat` merge-based
(read latest, append to existing heartbeats, write back).

### 4. Security MEDIUM — Dispatch envelope leaks prompt in stdout

```ts
// dispatch-commands.ts:271
printResult(io, ok('sub-agent.dispatch', {
  role,
  prompt: effectivePrompt,  // ← full prompt in JSON output
  ...
```

Prompts frequently contain user content, sometimes secrets (test
credentials, internal URLs). With `--json` mode, this lands in stdout
where shell history, log aggregators, and tmux scrollback can capture
it. The dispatch record on disk (`.peaks/_sub_agents/...`) is at least
under a project-relative gitignored path.

**Fix:** drop `prompt` from the envelope; keep `promptSize` /
`originalPromptSize` only. LLM-side runner already has the prompt
locally — it doesn't need it echoed back.

### 5. Security MEDIUM — `--user-data-dir` not validated

```ts
// playwright-commands.ts:170
spawn('npx', ['playwright-mcp@latest', ..., `--user-data-dir=${userDataDir}`], ...);
```

If a user passes `--user-data-dir /etc/peaks-userdata` (or any path
outside the project), the playwright browser will write to that
location. Not a privilege escalation, but it does silently write
browser state to arbitrary paths.

**Fix:** assert the path is under `projectRoot` (or under the
`.peaks/_runtime/playwright-userdata/` default).

### 6. Documentation MEDIUM — G8.4 sub-commands undocumented

`skills/peaks-solo/SKILL.md` mentions `dispatch` (in 2 places) and
the `dispatch --from-dag` path, but never mentions `share` /
`shared-read` / `await`. The LLM-side runner has no entry point in
the SKILL.md to know these exist. The only documentation is in the
CLI `--help` text, which the LLM may not surface.

**Fix:** add a one-paragraph block in SKILL.md near the existing
"sub-agent dispatch" section, linking to the CLI.

### 7. Performance LOW — `dispatch-commands.ts` at 524/800 lines

`runDispatchFromDag` alone is ~200 lines (lines 320-525). Still under
the 800-line cap, but the next audit may push it over. Pre-emptive
split: move `runDispatchFromDag` and its lazy imports into
`dispatch-from-dag.ts` (sibling to `dispatch-commands.ts`).

### 8. Test isolation LOW — `lastWriteWins` test timing

```ts
// share-commands.test.ts:99
await write('{"ms":120}');
const { stdout } = await write('{"ms":150}');  // ← assumes `at` is later
```

The test relies on two consecutive `await runCommand` calls producing
strictly increasing ISO timestamps. The CLI process spawn time +
JSON serialization might collide on millisecond resolution on a
fast machine. Pin a clock mock or assert `>=` instead of `true`.

### 9. Error propagation LOW — Generic nextActions on share/heartbeat

`SHARE_ERROR`, `SHARED_READ_ERROR`, `AWAIT_ERROR`, `HEARTBEAT_ERROR`
all fall through to "see error message". For an LLM-side runner
parsing the envelope, the `nextActions` field is the most useful
piece — the current hints don't help narrow down WHICH error
condition occurred.

**Fix:** branch on `error.code` to emit specific nextActions
(e.g. for `INVALID_RECORD_PATH`, suggest "check the dispatch record
path" instead of the generic message).

### 10. Concurrency LOW — `require()` in `gcChannel` / `isOrphanChannel`

```ts
// shared-channel.ts:251, 275
const { unlinkSync } = require('node:fs') as typeof import('node:fs');
const stat = require('node:fs') as typeof import('node:fs');
```

Mid-module `require()` is a code smell in an ESM project. The static
`existsSync` and `unlinkSync` imports already work in ESM. Refactor
to top-level imports.

### 11. Performance LOW — `mkdirSync({ recursive: true })` on every write

`writeAtomic` calls `mkdirSync(dir, { recursive: true })` even when
the dir exists. On macOS this is fast (~50µs) but it's a syscall on
the hot path. Cache the "dir exists" flag per process, or check
`existsSync` once.

## Recommended fix order

1. **#1** (Security HIGH) — deriveProjectRoot fix is ~5 lines and
   blocks cross-project writes. One-line patch.
2. **#2, #3** (Concurrency HIGH) — file lock for shared channel +
   dispatch record. Needs a small `flock` helper. Blocks data loss.
3. **#4** (Security MEDIUM) — drop `prompt` from dispatch envelope.
   One-line patch; backward compat risk: any LLM-side runner that
   reads `data.prompt` will break. Check before commit.
4. **#5, #6** (Security/Docs MEDIUM) — separate small fixes.
5. **#7-#11** — backlog.

## Branch state

- Branch: `develop` (post-merge of fix/audit-p0-2026-06-23)
- HEAD: `c6a2bbf merge: audit-p0-fixes (3 P0 + re-audit 2 HIGH/4 MEDIUM/2 LOW cleanups)`
- Last fix commit: `71bf964 refactor(sub-agent): address 2 HIGH + 4 MEDIUM + 2 LOW re-audit findings`
- New findings (this audit): 3 HIGH + 3 MEDIUM + 5 LOW
