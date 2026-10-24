---
name: peaks-race-code
description: Fast lane for code work — this window edits source directly, with no sub-agents and no paperwork. Use it when a code task is small enough that opening a second context window is the whole cost, i.e. trivial and everyday small features and bug fixes whose diff you can hold in your head. Not for a task that touches one of the risk surfaces the fast-lane norm names (`../peaks-code/references/fast-lane-norm.md`), and not for work that needs a durable audit trail — those belong to peaks-code; read the norm before you decide. Triggers on "/peaks-race-code", "peaks race", "race this", "fast lane", "直接改，别走全流程".
---

<!-- peaks:loop-hygiene — HAND-MAINTAINED block, NOT generated; byte-identical in every SKILL.md, enforced by tests/unit/skills/loop-hygiene-block.test.ts. Edit one, edit all 23. -->

## Loop hygiene (every turn — MANDATORY)

**Skill header.** While this skill is active, open every turn with
`Peaks-Loop Skill: <skill> | Peaks-Loop Role: <role> | Peaks-Loop Gate: <gate> | Peaks-Loop Context: <ratio%> (<zone>) | Next: <one short action>`.
Every turn, not only the first — it is how the user knows which skill is driving.
`Role` and `Context` are machine facts: copy them from `peaks skill presence --json`
(`data.role`, `data.context.ratioPct`, `data.context.action`) — never invent them.

**Context is this skill's own business.** Run `peaks skill presence --json` every turn and
read its `context` block. When `action` is `auto-fire`, `pre-compact`, or `red-line`,
run `peaks code auto-compact --project .` **yourself**, then continue. Tell the user the
ratio in one line if it helps, but never hand them the compaction step: asking the user to
run `/compact` is the regression the zero-pause contract forbids. This holds in **every
mode** — standard *and* 24h. The mode moves the threshold, never the obligation.

**Read before you edit.** Read a file before your first `Edit` / `Write` / `MultiEdit` on
it — the normal way to work here — for every path outside `.peaks/**` (source, tests, docs,
config); `.peaks/**` writes are exempt.

**Expect one denial per file anyway — and do NOT pre-empt it.** A `PreToolUse` gate (ECC's
"Fact-Forcing Gate") denies the FIRST edit a session makes to any given path, once, by
design. Reading does NOT prevent it: the gate keys on the path's first touch, not on whether
you read it. **Do not recite its four questions before every edit** — it asks when it wants
them, and reciting unprompted burns a round-trip per file for nothing. Answer only when a
denial actually arrives.

**When one does arrive:** a denial is not a failure and the tool is not broken — your edit
was NOT applied. State the facts it asks for (importers, affected API, data schemas if any,
the user's verbatim instruction), then retry the SAME operation. The retry is allowed. Do not
switch tools, do not give up, do not retry blindly. One more thing worth knowing: an idle gap
of ~30 minutes clears the gate's "already passed" list, so a file you cleared earlier can be
denied again after a long pause. That is the gate resetting, not you regressing.
<!-- /peaks:loop-hygiene -->

# Peaks-Loop Race Code (the fast lane)

**This is a lane, not a mode of `peaks-code`.** `peaks-code`'s red line — the orchestrator is
not the implementer — is the reason it opens separate context windows, so a lane that lets
one window both orchestrate and implement cannot be one of its switches. It is a sibling
skill. There are three lanes, and this is the third:

| Lane | Who implements | Ceremony kept |
|---|---|---|
| `peaks-code` (full) | a separate RD sub-agent | the whole workflow: all steps, Gate A–G, transition state machine |
| `peaks-code` fast mode | a separate RD sub-agent | fewer steps, the same separation of duties |
| **`peaks-race-code`** | **this window** | none of the above — see "What this lane does not write" |

Do not offer `peaks-code` fast mode as a working alternative: it is designed but not proven —
its executable path has no callers and `peaks code plan --fast` only prints a plan. Why the
three rungs stay apart, stated here so no reader needs a document outside this one: the two
fast rungs buy their speed from different things. `--fast` cuts ceremony — the full memory
load, the standards fan-out, the QA repair loop — and keeps a separate implementer for the
diff. This rung removes the separate implementer, which is the one cost that cutting ceremony
cannot reach. Merging them into a single rung would strand the work in between: tasks that do
want their diff implemented and reviewed by someone else, and do not want the rest of the
workflow.

**Loop Engineering role.** The red lines that govern every Loop-Engineering-participating
`peaks-*` skill live at `.peaks/standards/loop-engineering-guidelines.md`. This skill honours
`RL-1` (the user speaks or picks; the user never types a CLI verb) and `RL-8`. Read the RL-8
boundary carefully, because this name sits close to it: **`race` is a lane axis, not a
variant of `peaks-code`.** This skill shares peaks-code's domain and shares none of its
implementation right — that difference is the whole of it.

## The gate: what lets this window edit source

The CLI gate over direct source edits opens when **the driver resolved for this session is
`peaks-race-code`** — and that resolution has a precondition this file cannot meet for you:
the hook payload's caller id (`caller_id ?? session_id`) must equal the lease's own
`callerId`. When they differ the driver resolves to nothing, the edit is denied, and nothing
available here changes that — it is spec §12 **U4**, the design's own recorded biggest
engineering risk, deliberately left outside this slice. Where the two agree, set the driver
before your first edit, not after:

```bash
peaks skill presence:set peaks-race-code --project . --mode <mode> --gate <gate>
```

The name is a self-report — the command accepts any string — so read the next four points
as the terms of the deal, not as caveats:

- **This is a discipline gate, not a security boundary.** It stops the reflex ("this change
  is small, I will just do it here"), not an actor. It already fails open on a malformed
  payload, a missing path and an internal error, and it is not hardened against a deliberate
  bypass. Never describe it as enforcement, and do not spend effort making it one.
- **Once the hook entry is installed**, a direct edit under a hard-blocked path family is
  refused unless the resolved driver is `peaks-race-code` (exit 2,
  `PEAKS_CODE_PROHIBITED_DIRECT_EDIT`); a driver that resolves to nothing gets the same
  verdict. Fix the driver when the driver is what is wrong; when the deny is the U4 mismatch
  above, do not hunt for a fix that does not exist — name it as the known gap, and never
  route around the refusal either way.
- **Nothing in this lane is blocked before the fact.** The gate bites only where its hook
  entry is installed (`peaks hooks install`), and the commit-side rule is detect-only (proof
  3 below). Never tell the user a rule was enforced when the only thing that happened is that
  nobody looked.
- **A second gate exists, and this section does not speak for it.** `peaks hooks install
  --scope global` also copies `src/services/hooks/pre-tool-code-gate.sh` into the IDE's
  skills directory; a project-scope install copies nothing. Nothing wires that copy up —
  every hook entry the installer writes is a `peaks …` command, and no settings template
  invokes a `.sh`, so it lies inert until a harness is pointed at it by hand. If one is: it is a
  **thin wrapper** that execs `peaks code-gate` — so where a Node CLI is reachable it takes the
  driver input and honours the fast lane exactly as the command does, and it refuses rather than
  guessing when it cannot place the file. Only a machine with **no** Node CLI reachable reaches
  its **no-CLI fallback**, which denies the hard-blocked families unconditionally, refused even in
  this lane, and its refusal will not mention this file. That asymmetry is known and
  left conservative on purpose — assigning it is not this skill's job, and teaching the shell
  gate about lanes is not yours.

## Completion proofs — four, and they are actions, not a document

Show the command and its real output. "It should pass" is not a proof, and this lane has no
gate machinery behind you to catch it.

1. & 2. **The shared acceptance gate** — whatever §1 of
   `../peaks-code/references/fast-lane-norm.md` says it is, no more and no less. It is stated
   once, for both fast lanes, there. Go and run it there; do not re-derive it from this file,
   and do not restate it in the trace as if this file said it.
3. **An honest commit.** The message says what changed and why. **No part of the commit path
   intercepts an AI-attribution trailer before the commit exists.** A pre-commit hook does run
   — it lints the staged files and ratchets the gate — but it reads files and never the
   message, and there is no commit-msg hook in `.husky/` (its absence is a recorded decision,
   not an oversight). The only mechanical support is
   `tests/unit/standards/no-ai-co-author-trailer.test.ts`, which reads `git log` and fails;
   its remedy is rewriting history, so it cannot un-land a trailer. Never add the trailer, and
   never tell the user one was blocked.
4. **A retractable unit.** Land the change on one commit (or one branch) and be able to say
   the exact command that undoes it. This lane is the only one allowed to edit source
   directly and it skips the transition checks, so "it can be undone" is the only backstop
   left. Say the command out loud rather than assuming it.

## Risk surfaces — where this lane stops

The list of changes that do not belong in a fast lane lives in
`../peaks-code/references/fast-lane-norm.md` §2. That file is the single source: read it
before you start, and again once a diff exists. It is not restated here, and a second copy
here would be exactly the drift the norm exists to prevent.

Two things that section says about itself, and that you must not paper over on its behalf: it
is a judgement list rather than a gate, and its size row has no threshold behind it yet, so a
size is not a decision you can make from it. What happens when a row is hit is the next
section.

## Escalation — one way for you, never for the user

- **If you find mid-task that the change crosses a risk row: stop, say so, and hand the task
  to `peaks-code`.** Do not press on because you are nearly done. That is the one thing this
  lane may not do — peaks-code does not get to downgrade a task either, and neither do you.
- **The user may push it back.** Say the risk in one sentence, do not block, and write the
  override and the row it overrode into the trace. Silently allowing it is not an option
  either.
- **Per task, not per session.** The one-way rule binds the task that hit the wall. The next
  task may take this lane again; one misjudgement must not lock the user out of the fast lane.
- **Hand over, do not walk away.** Before you escalate, record whether the tree is clean,
  whether the half-done work is committed, whether it passes the acceptance gate, which files
  you touched and why you stopped. Ownership moves when that record lands — an unexplained
  dirty tree is the one state `peaks-code` cannot start from.
- Hold all of this in the trace and in the user's presence in the window. The
  machine-checkable half of the risk list does not exist, so nothing else is holding it.

## Traces

- Create the session workspace once — `peaks workspace init --project .`. It is the
  precondition of `presence:set`, which refuses when no session is bound. One CLI call, not a
  step.
- Write one short record at `.peaks/_runtime/<sessionId>/race/<rid>.md`: the need in one
  sentence; the lane and who chose it; the files you changed; the four proofs with their
  actual results and the commands that produced them; and any risk row you hit, with the
  user's override if there was one.
- **Memory is for boundaries and new pitfalls only.** Sediment into `.peaks/memory/` when the
  change drew a risk boundary or tripped something new; everyday small changes stay in the
  runtime record. Sediment everything and memory stops being worth reading.

## What this lane does not write

No sub-agent dispatches — the read-only diagnosis fan-out of batch mode below is the one
exception. No Gate A–G file chain. No `peaks request transition` state machine.
No planning or review documents — no tech doc, bug analysis, review envelope, audit envelope,
QA report or verdict. No job shape, no slice DAG, no swarm fan-out, no PRD phase, no
orchestrator-to-implementer handoff.

Keep the parts that cost no wall-clock, because they are habits rather than ceremony: read a
file before editing it, the TDD micro-cycle, the four Karpathy guidelines, one codegraph
query for the affected surface, one sentence before you start on what you will change and
why, and nothing dropped in the project root.

## Batch mode (批量模式)

**When it engages.** The user gives you **two or more mutually independent** bugs or small
requirements in one go. That is the whole trigger — nothing to configure, no threshold to
clear. **One item is not a batch:** a single task takes exactly the path it takes today —
no diagnosis fan-out, no rule pre-read, no topology step — and none of the machinery below
applies to it. Batch mode is an addition to this lane, never a substitute for it.

**The four phases.**

1. **Parallel read-only diagnosis.** One reader per item, each reporting the root cause,
   the files it expects to touch, and whether it hit a risk surface.
2. **Topology.** The measured file sets decide what may run together: items whose file
   sets are disjoint may proceed together, and an item that collides with another is
   deferred behind it.
3. **Fix.** Each item is fixed from its own diagnosis rather than from a fresh one, and
   every item runs its scoped test as soon as it is fixed.
4. **One unified verification.** The whole batch goes through the acceptance gate
   **once** — the gate that §1 of `../peaks-code/references/fast-lane-norm.md` names, the
   same one a single task runs. Only the count changes; the strictness does not. A red
   unified verification points at the integration between items rather than at one item:
   an item's own breakage is caught by its own scoped test.

**The diagnosis phase is read-only.** A diagnostician reads and reports; it does not edit.
`Edit`, `Write` and `MultiEdit` are forbidden there, and the reason is mechanical rather
than stylistic: the file set it reports is the only input the topology step has, so a
diagnostician that also wrote files would be reporting a guess.

**Risk surfaces are judged per item, not per batch.** An item that touches any of the risk
surfaces in §2 of `../peaks-code/references/fast-lane-norm.md` is pulled out of the batch
and takes the single-task path on its own. That list lives in the norm and is not restated
here; read it, judge each item against it, and pull the ones that hit it. A batch is not a
way to carry a task that does not belong in this lane.

**Where this lane leaves the window.** Batch mode is the only place it does, and only for
the read-only diagnosis phase: the diagnosis fan-out writes nothing, and every write stays
in this window.
