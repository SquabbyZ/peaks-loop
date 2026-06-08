# sub-agent-dispatch.md — peaks sub-agent dispatch orchestrator contract

> **Slice**: 2026-06-07-sub-agent-dispatch-decouple (G3 + G6)
> **Audience**: SKILL.md authors and LLM readers of peaks-solo / peaks-rd / peaks-qa
> **Status**: stable

This reference is the orchestrator-side contract for sub-agent dispatch.
It explains why the peaks family uses `peaks sub-agent dispatch <role>` as
the canonical primitive, how the dispatch envelope flows back to the LLM,
and how the new G6 heartbeat channel keeps the user informed during the
batch-sync wait. Read this before writing or extending any peaks-*
SKILL.md that dispatches sub-agents.

## Why a CLI primitive (skill-first / CLI-auxiliary)

The peaks skill family is the **product**. The CLI is a thin atomic
the skills compose. For sub-agent dispatch the relationship is:

| Surface | Who owns | What it does | Who calls it |
|---|---|---|---|
| SKILL.md (主面) | peaks-solo, peaks-rd, peaks-qa | Tells the LLM when and why to dispatch a sub-agent; what prompt to pass; what artifacts to expect back | LLM (during normal Solo / RD / QA flow) |
| CLI (副 / 原子) | `peaks sub-agent dispatch` | Validates the role, looks up the current IDE's `subAgentDispatcher`, returns a per-IDE tool-call descriptor + writes a dispatch record | LLM (read from the SKILL.md) |
| Dispatcher 抽象 (per-IDE) | `src/services/dispatch/sub-agent-dispatcher.ts` | Encapsulates the IDE-private tool name (claude-code: `Task`, trae: UNVERIFIED placeholder) and arg shape | CLI (called by the CLI) |

This is the **inverse** of the prior shape: SKILL.md used to hardcode
`Task(subagent_type="general-purpose", ...)`, which made peaks-cli
depend on Claude Code's specific tool name. Adding a new IDE meant
editing every SKILL.md that mentioned sub-agents. With the new shape,
the only per-IDE thing in the dispatch chain is the dispatcher — SKILL.md
stays IDE-agnostic.

> **Red line**: do not invoke `peaks sub-agent dispatch` from your own
> shell. The CLI is a primitive the LLM composes. Users do not need it.

## Dispatch contract

**Command**:

```
peaks sub-agent dispatch <role> --prompt <text> [--request-id <rid>] [--session-id <sid>] [--project <repo>] [--batch-id <uuid>] --json
```

**Envelope** (AC-8):

```json
{
  "ok": true,
  "command": "sub-agent.dispatch",
  "data": {
    "role": "rd",
    "ide": "claude-code",
    "prompt": "<complete prompt the LLM should pass through>",
    "toolCall": {
      "name": "Task",
      "args": {
        "subagent_type": "general-purpose",
        "description": "rd for rid=002-2026-06-07-...",
        "prompt": "..."
      }
    },
    "dispatchRecordPath": ".peaks/_sub_agents/2026-06-06-session-5b1095/dispatch-002-2026-06-07-...-...json",
    "batchId": "<uuid>",
    "dispatchedInBatch": 3
  },
  "warnings": [],
  "nextActions": [
    "Tool call is dry-run; LLM must execute the tool to actually dispatch the sub-agent.",
    "After dispatching, the sub-agent should call `peaks sub-agent heartbeat --record <dispatchRecordPath>` periodically."
  ]
}
```

**LLM side**: read `data.toolCall` (the `{name, args}` descriptor), look
up the tool by `name` in the current environment, and invoke it with
`args`. The CLI does not spawn anything. The IDE (Claude Code, Trae,
etc.) is the one that actually runs the sub-agent.

**Side effect**: the CLI writes a dispatch record to
`.peaks/_sub_agents/<sid>/dispatch-<rid>-<ts>.json` (R-2 path-guarded).
The record starts with `heartbeats: []`, `lastBeatAt: null`, `status: 'queued'`
and is updated by the heartbeat flow (§G6 below).

## Role model

`SubAgentRole` is a free-form string. The CLI **does not** enforce a
hard whitelist. Recommended roles:

- Top-level: `rd` | `qa` | `ui` | `txt` | `general-purpose`
- QA sub-roles: `qa-business` | `qa-perf` | `qa-security`
- Business sub-divisions: `qa-business-api` | `qa-business-frontend` |
  `qa-business-regression` | ... (≤ 2 levels deep per RL-4)
- Promotable Worker (architecture预留, slice #009 不实际提升): `prd-business` |
  `prd-technical` | `prd-ux` | `ui-visual` | `ui-flow` | `ui-component`

The only hard validation is: non-empty, ≤ 256 chars, no control
characters. Any other string is a convention, not a contract.

## Per-IDE dispatchers (G1)

| IDE | Tool name | Args shape | Status |
|---|---|---|---|
| `claude-code` | `Task` | `{subagent_type: "general-purpose", description, prompt}` | verified |
| `trae` | `Task` | byte-identical to claude-code by design | UNVERIFIED — pending real Trae dogfood |
| `null` (no IDE detected) | — | throws `IDE_NOT_SUPPORTED` | fallback |

Adding a new IDE means:

1. Add a new adapter to `src/services/ide/adapters/<id>-adapter.ts`.
2. Fill in `subAgentDispatcher: <yourDispatcher>` (implements
   `SubAgentDispatcher`).
3. Register the adapter in `ide-registry.ts`.

SKILL.md and existing dispatcher implementations are untouched.

## G6 — heartbeat + dynamic progress (RL-13..RL-16)

Sub-agents run for 30 s to 2 min. During that wait, the LLM platform
provides no progress signal to the Dispatcher. Without a heartbeat
channel, the user sees a frozen terminal and reasonably assumes the
system is dead. G6 is the rule that says: **no**.

### The three-layer contract

| Layer | Who | What | Cadence |
|---|---|---|---|
| **Sub-agent writes** | The sub-agent itself | Calls `peaks sub-agent heartbeat --record <dispatchRecordPath> --status <state> --progress <pct> --note "<text>"` to append a heartbeat | 30 s default; SKILL.md can override via `heartbeatIntervalSec: 15` |
| **Dispatcher reads** | peaks-solo main loop, during the batch-sync wait | In-process async poller (`BatchHeartbeatPoller`) reads `heartbeats[]` + `lastBeatAt` from each record, emits a single-line status per G6.5 | 10 s (offset from 30 s to avoid jitter) |
| **User / CLI reads** | Anyone, anytime | `peaks sub-agent list --session-id <sid> --json` (G5 RL-10, future slice) | manual |

### Sub-agent prompt template (heartbeat-aware + MCP-decoupled)

Every sub-agent prompt dispatched via `peaks sub-agent dispatch` should
include the heartbeat instruction so the LLM knows when and how to
report progress. The recommended paragraph (auto-generated by the CLI
and the SKILL.md heart of each Dispatcher) is:

```
While running, call `peaks sub-agent heartbeat --record <dispatchRecordPath>
--status <state> --progress <pct> --note "<text>"` at least every 30 seconds
(the Dispatcher expects 30s cadence). On completion call
`--status done --progress 100 --note "completed"`. On failure,
`--status failed`. Do not skip heartbeats; the parent Dispatcher uses them
to keep the user informed during the wait.
```

**Slice #016 retirement (G3 prompt template — MCP subsystem removed)**:
The MCP-decouple paragraph from slice #007-007 no longer applies.
peaks-cli no longer manages MCP install or invocation. Sub-agents
check their own tool list for `mcp__<server>__*` entries and invoke
the tool by name directly. The only prompt-template addition that
remains is the tool-list self-check:

```
This task may need an MCP server (playwright, chrome-devtools, figma,
or context7). Check your tool list for any `mcp__<server>__*` entry.
If present, invoke the tool by name directly. If absent, tell the user
the install command for their IDE (Claude Code:
`claude mcp add <server> -- <npx-command>`) and stop the sub-task until
the user installs the MCP. Do NOT hand-edit `.claude/settings.json` or
auto-install on the user's behalf.
```

The tool-list self-check is required for any sub-agent that needs a
browser, design, or docs-lookup capability. The CLI auto-generates it
for `role in (rd, qa, ui, txt)`.
when the active IDE is not `claude-code`; for `role = general-purpose`
or unknown roles, the caller (the SKILL.md heart of the Dispatcher) must
add it explicitly.

`heartbeatIntervalSec` is overridable per SKILL.md (5..600). Default 30.

### Status line shape (G6.5)

Single line, 80-120 chars:

```
[peaks-solo] swarm 3/3 running | rd-planning 45% (12s ago) | qa-test-cases 30% (5s ago) | ui-design 20% (2s ago)
[peaks-solo] swarm 3/3 running | rd-planning 70% (8s ago) | qa-test-cases 50% (3s ago) | ui-design 30% (6s ago)
...
[peaks-solo] swarm 3/3 done
```

If a sub-agent has not written a heartbeat in 5 minutes, the poller
appends `⚠ stale` to that sub-agent's segment and marks
`status: 'stale'` on the record. **It does not cancel, kill, or send
SIGTERM** (RL-15). Stale is a user-visible warning, not a failure.
The user decides.

### Truncation (RL-16)

`heartbeats[]` is append-only for audit, but capped at 100 entries.
Past 100, the oldest are dropped and `truncated: true` is set. The
record JSON can otherwise balloon to MB on long-running sub-agents.
100 is the LLM-friendly limit — stale heartbeats are not informative
once the poller has read them.

### Acceptance criteria covered

- AC-33 `peaks sub-agent heartbeat` CLI primitive (implemented)
- AC-34 Dispatch record schema upgrade (`heartbeats[]` + `lastBeatAt` + `status` aggregate, backward-compat defaults)
- AC-35 peaks-solo main loop batch-sync poller (10 s cadence, 5 min stale)
- AC-36 SKILL.md fan-out sections include heartbeat instruction
- AC-37 G6 E2E dogfood (3 heartbeats, 101 → truncated, stale simulation)

## Acceptance criteria (overall G1-G6)

- AC-1..AC-5: dispatcher interface + 3 adapter impls (`claudeCodeSubAgentDispatcher`, `traeSubAgentDispatcher`, `nullSubAgentDispatcher`)
- AC-6: dispatcher unit tests
- AC-7..AC-9: dispatch CLI signature + envelope + steps
- AC-10: dispatch CLI unit tests
- AC-11 / AC-11b / AC-11c: E2E dogfood on the live repo
- AC-12: `peaks --help` byte-level delta is `+1` line (`sub-agent <cmd>`)
- AC-13..AC-19: SKILL.md fan-out rewrites (peaks-solo 5 spots, peaks-rd 2, peaks-qa 3-way, peaks-ui 1; this reference is the canonical contract)
- AC-22..AC-24: R-2 path guard, prompt size limit, atomic write
- AC-25..AC-32: G5 resource lifecycle (RL-1 batch counter, dispatch record schema, reducer dispose, slice archive, cancel dispose)
- AC-33..AC-37: G6 heartbeat CLI, schema, poller, status line, E2E

## How to apply

When writing a SKILL.md that fans out sub-agents:

1. Use `peaks sub-agent dispatch <role>` (never `Task(...)`).
2. Issue all dispatches in a single message; the LLM will fire all
   returned toolCalls in parallel.
3. Pass `--request-id` and `--session-id` (or omit and let the CLI
   resolve the active session).
4. The sub-agent prompt **must** include the heartbeat instruction
   (30 s cadence; override via `heartbeatIntervalSec` if needed).
5. After the fan-out returns, the Dispatcher reducer reads the
   dispatch record + the artifacts the sub-agents wrote, marks
   `disposed: true` on each record, and advances the state machine.
6. The poller handles the 5-min stale case as a warning, never as a
   failure. The user is the one who decides to cancel.

## Cross-reference

- PRD #009 G1-G6 (this slice's source of truth)
- RD request #009 in-scope files (implementation contract)
- `.peaks/memory/sub-agent-resource-lifecycle-red-line.md` (G5 red line)
- `.peaks/memory/sub-agent-heartbeat-progress-red-line.md` (G6 red line)
- `skills/peaks-solo/references/swarm-dispatch-contract.md` (predecessor contract)
- `skills/peaks-qa/references/qa-fanout-contract.md` (QA-specific fan-out)
