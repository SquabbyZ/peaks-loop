# Observability category audit — every declared category names its trigger

The observability schema declares a vocabulary of event categories
(`OBSERVABILITY_CATEGORIES` in `src/services/observability/observability-schema.ts`).
A declared category is a promise: "this program will tell you when this happens".
This document audits **every** declared category — where it is emitted, what
triggers it, whether it has ever fired in this repository's recorded history, and
what follows from that.

**This document changes nothing.** No category is deleted, no enum is edited, no
emitter is moved. A deletion changes how existing events are read, so it belongs
to a separate slice with its own review. What follows is a conclusion per
category, in one of three forms:

| conclusion | meaning |
|---|---|
| **① conditional** | it fires only in a flow this history never entered — the flow is named |
| **② wire it** | it has no live path to the stream; the place to add one is named |
| **③ delete it** | it should leave the enum — the reason is given |

## How "has it fired" was measured

The event stream is the only place an observability event is written:
`<projectRoot>/.peaks/_runtime/<sessionId>/metrics/slices.jsonl`, one JSON record
per line, appended by `emitObservabilityEvent`. The measurement below reads every
such file that exists in this repository today and counts the `category` field of
every record it can parse.

- **10** session directories carry a `metrics/slices.jsonl` stream.
- **1530** records in total.
- `compact-history.jsonl` is **not** part of this measurement: it is the
  compaction history (a `kind` field, a ratio, a checkpoint path), not the
  event stream, and its records carry no `category` from this vocabulary.

Two streams are excluded as fixtures rather than as history: the copies under
`2026-10-18-session-dedff6/qa/scratch/proj-absent/` and
`.../proj-inject/` are QA scratch trees that a test wrote, not sessions the
program ran.

## The table

| category | emitter location | trigger condition | fired in recorded history | conclusion |
|---|---|---|---|---|
| `slice-transition` | `src/services/artifacts/prerequisite-transition-event.ts` (`emitPrereqTransitionEvent`) and `src/services/artifacts/request-artifact-service.ts` (`transitionRequestArtifact`) | `peaks request transition` moves a request artifact to a new state; the prerequisite check that ran alongside the move is recorded on the same event | **yes — 1177** | ① conditional — live on the request-transition flow, which every recorded session used |
| `dispatch` | `src/cli/commands/dispatch-tool-call.ts` (`emitDispatchObservability`) | `peaks dispatch` builds a sub-agent dispatch for an IDE adapter; the adapter label and the prompt size are recorded | **yes — 322** | ① conditional — live on the dispatch flow |
| `lease` | `src/services/observability/observability-service.ts` (`emitLeaseEvent`), reached from `src/cli/commands/worktree-lease-{spawn,renew,release,gc}-command.ts` and from `src/services/dispatch/dispatch-record-writer.ts` (`autoRelease`, `autoRelease-failed`) | `peaks worktree spawn` / `renew` / `release` / `gc`, or the auto-release at the end of a dispatch | **yes — 29** | ① conditional — live on the worktree-lease flow |
| `checkpoint` | `src/services/session/session-checkpoint-service.ts` (`writeCheckpoint`) | a session checkpoint is written — by `peaks session checkpoint`, or by the request-transition hook in `src/services/compact/request-transition-hook.ts`; the snapshot's reason, plan length and question/decision counts are recorded | **yes — 2** | ① conditional — live on the checkpoint flow |
| `mode-gate` | `src/cli/commands/code-mode-gate-should-pause-envelope.ts` (the stale-presence branch and the ordinary decision branch) | `peaks code should-pause` evaluates a gated step and a session id resolves | **no — 0** | ① conditional — fires only in the code-mode gate flow, which no recorded session entered |
| `context-trigger` | `src/cli/commands/context-check-command.ts` (`emitContextTrigger`) | `peaks context check` measures the context ratio and a session id resolves; the trigger kind (`soft-warn` / `compact` / `defer`) is recorded | **no — 0** | ① conditional — fires only in the context-check flow |
| `post-compact` | `src/services/code/post-compact-detector.ts` (`emitPostCompactEvent`) | `peaks code post-compact-detect` finds a post-compaction checkpoint whose recorded mode can be read, and resumes from it | **no — 0** | ① conditional — fires only in the post-compact resume flow |
| `cycle` | `src/services/observability/observability-service.ts` (`emitCycleEvent`), reached from `src/services/loop/loop-observability.ts` (`emitCycleOutcome`) and called by `src/services/loop/run-driver.ts` | the loop driver finishes a cycle; one event per cycle, with `failed` for the cycle whose monotonic report carries a violation | **no — 0** | ① conditional — fires only in the loop-driver flow (`peaks loop run`) |
| `monotonic-trigger` | `src/services/observability/observability-service.ts` (`emitMonotonicTriggerEvent`), reached from `src/services/loop/loop-observability.ts` (`emitMonotonicReport`) and called by `src/services/loop/run-driver.ts` and `src/services/loop/monotonic-runner.ts` | the monotonic guard returns a report that is not `skip`; the guard's own code becomes the event's `action` | **no — 0** | ① conditional — fires only in the loop driver's monotonic guard |
| `token-usage` | `src/services/observability/observability-service.ts` (`emitTokenUsageEvent`), called by `src/cli/commands/final-review-prepare-command.ts` | `peaks prepare-final-review <rid>` records an input/output token count; the event says whether the count came from the provider or from an estimate | **no — 0** | ① conditional — fires only in the final-review prepare flow |
| `gate` | `src/services/artifacts/rd-gate-event.ts` (`emitRdGateEvent`), reached from the recorder built by `rdGateRecorder` and called by `src/services/artifacts/rd-transition-gates.ts` | an RD transition gate reaches a decision; the gate id, the phase, the declared type and the outcome (`pass` / `block` / `bypass`) are recorded | **no — 0** | ① conditional — fires only in the RD transition-gates flow |

## The seven that have never fired

Seven of the eleven declared categories have **never** fired in this
repository's recorded history: `mode-gate`, `context-trigger`, `post-compact`,
`cycle`, `monotonic-trigger`, `token-usage`, and `gate`. Six of those are
among the ten categories that predate the RD transition gates; the seventh,
`gate`, is the newest one, and it is counted here for the reason given in
the next section.

Each one has a live emitter and a reachable command behind it, so each is
**① conditional** rather than ② or ③: the flow that produces it is one this
repository's sessions did not enter — the code-mode gate, the context check,
the post-compact resume, the loop driver (which produces two of them, `cycle`
and `monotonic-trigger`), the final-review prepare, and the RD transition
gates. None of them is a dead declaration, and none of them is wrong. But a
declared-but-silent category is still a schema promising something it has not
yet delivered, and a reader of the stream cannot tell "this never happened"
from "this was never wired" — the difference is only visible in the source.
Naming the flow, as the table above does, is what turns the promise into
something checkable.

### `gate` specifically

`gate` is the newest category. It has an emitter, and it is wired into the RD
transition gates — but it **has not fired in this repository's recorded
history**, because every recorded session predates the emitter. It is not
live evidence; it is a forward-looking declaration. Do not read a
`gate`-free stream as "no gate ever ran".

## Two findings that are about a detail, not about a category

The table above judges the eleven categories. Two smaller gaps sit underneath
one of them and are worth naming, because each is a declared thing with no
producer — the same shape as the category-level problem, one level down.

1. **`autoRelease-skipped` has no emitter.** `LeaseEventKind`
   (`src/services/observability/observability-service.ts`) declares
   `'autoRelease-skipped'` with a documented reason ("no-lease",
   "non-terminal-status"), and `src/cli/commands/lease-metrics-commands-support.ts`
   counts it as one of the lease kinds a reader may find. **No call site emits
   it.** The auto-release path in
   `src/services/dispatch/dispatch-record-writer.ts` emits `autoRelease` and
   `autoRelease-failed`, and nothing else — the skip is decided and then
   dropped. **② wire it**, in `tryAutoReleaseLease`'s own guard, where the
   skip is already known. Until then the counter is structurally always zero.

2. **`emitDispatchEvent` has no call site.** The helper
   (`src/services/observability/observability-service.ts`) writes a canonical
   `dispatch` envelope, but the only live dispatcher —
   `src/cli/commands/dispatch-tool-call.ts` — builds its own envelope instead.
   The category fires; this helper does not. **② wire it**, by having the
   dispatcher use it, or delete the helper — but deleting it is a separate
   decision from this audit, and the helper is not a category.

Neither finding changes a category's conclusion, and neither is repaired here.

## The invariant this document exists to hold

**Every declared category must be able to name its trigger condition.**

A category that cannot name one is a promise the schema makes and the program
does not keep. The cheapest way to keep that promise true is the one this
audit takes: when a category is added, the row saying where it is emitted and
what fires it is written with it, not afterwards.

The second invariant follows from the first:

**A category that has never fired must say so, and must name the flow it waits
for.** A silent category is not a defect; an undocumented silent category is.

## How to re-run the measurement

The "fired in recorded history" column is a count over the event streams that
exist on disk. To reproduce it, read every
`.peaks/_runtime/<sessionId>/metrics/slices.jsonl`, parse each line, and count
the `category` field. A category that is declared but absent from the counts is
either a flow the history never entered (①) or a category with no live path to
the stream (②) — and the source says which.
