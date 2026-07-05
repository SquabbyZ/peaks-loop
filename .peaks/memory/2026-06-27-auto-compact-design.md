---
name: 2026-06-27-auto-compact-design
description: v2.13.0 auto-compact protocol design — peaks-loop drives context compaction autonomously (zero human / zero LLM intervention) so the LLM-runner stays alive with context < 95% on any AI CLI.
metadata:
  affects: peaks-code auto-compact, IdeAdapter.compact, context-monitor D6
  related: 2026-06-27-v2-12-fanout-3way.md, 2026-06-27-prose-only-catalog-followup.md
---

# Auto-compact protocol (v2.13.0)

## Motivation

The v2.11.0 D6 context monitor (`peaks context check --auto-trigger`)
returns a trigger path the LLM should follow, but does NOT auto-fire.
That design is too cautious for sustained LLM runs: every `/compact`
emitted by the LLM is a panic-driven decision that loses context
that peaks-loop could have preserved (current plan, open questions,
recent decisions, todo state, recent artifact paths, in-flight
batches).

peaks-loop knows the project better than the IDE. Auto-compact moves
the decision loop to peaks-loop: it probes the ratio, prepares a
rich checkpoint, dispatches IDE-side compact, and lets the LLM
runner keep working without human intervention.

## Two-tier threshold

| Tier | Ratio | Action | LLM / human action |
|---|---|---|---|
| **soft-warn** | 50–85% | log one-line info row | none — runner continues |
| **pre-compact** | 85–95% | peaks-loop writes pre-compact checkpoint + convergence plan + auto-decisions log + IDE-side compact dispatch | none — fully automatic |
| **RED LINE** | ≥ 95% | peaks-loop refuses sub-agent dispatch + forces synchronous IDE compact + wait until ratio < 85% before allowing further work | none — fully automatic, mandatory |

At 0.85 the runner has 10 percentage points of headroom to do
intelligent convergence (wait for in-flight sub-agent, finish current
todo row, persist checkpoint). At 0.95 the window is gone; peaks-loop
takes over synchronously to keep the runner alive.

## Why zero human intervention

The user-facing requirement (v2.13.0 design directive): "the LLM-runner
should keep working with context < 95% without human intervention."
This overrides Karpathy §4 ("do not auto-execute") for the auto-
compact surface specifically — peaks-loop's project-aware convergence
strictly beats `/compact`'s blind transcript compression.

The LLM is still the consumer — it reads the auto-decisions log on
the post-compact turn and resumes. But the LLM does NOT have to
decide when to fire compact; peaks-loop decides based on the ratio.

## Adapter-driven protocol (no hard-coded IDE names)

The v2.13.0 design adds `IdeAdapter.compact?: IdeCompactProfile`:

```typescript
export interface IdeCompactProfile {
  readonly envVarForContextPercent: string;
  readonly compactCommand: string;
  readonly compactPathway: 'shell-exec' | 'ide-native' | 'llm-self-compress' | 'noop';
  readonly postCompactDetectCommand?: string;
}
```

- **`envVarForContextPercent`** — env-var the IDE writes per turn
  (Claude Code MVP: `CLAUDE_CONTEXT_USAGE_PERCENT`). Read by AC-1
  via `readContextPercent`.
- **`compactCommand`** — slash command or shell-call the IDE accepts
  to trigger compact (Claude Code MVP: `claude --compact`). Dispatched
  via `child_process.spawn` (`shell-exec` pathway) by AC-3.
- **`compactPathway`** — `shell-exec` (Claude Code MVP) /
  `ide-native` (future) / `llm-self-compress` (no IDE integration
  needed) / `noop` (adapter explicitly opted out).
- **`postCompactDetectCommand`** — optional command the runner
  invokes to confirm ratio dropped (Claude Code MVP:
  `peaks context now --json`).

Claude Code is the MVP: `src/services/ide/adapters/claude-code-adapter.ts`
fills `compact` with the four-field profile. Other IDEs (trae /
codex / cursor / qoder / tongyi-lingma / hermes / openclaw) ship
without `compact` until L2-dogfood verifies each surface — when
they register `compact`, the auto-compact protocol activates for
that IDE without further orchestrator changes.

## Five sub-tasks (AC-1..AC-5)

- **AC-1**: `peaks solo context-now` (AC-1) probes the adapter-
  declared env-var. Falls back to statusline poll + transcript
  estimate ONLY for adapters that opt in (Claude Code MVP). Other
  adapters without `compact` return `source: 'conservative-fallback',
  ratio: 0` so the orchestrator never auto-fires on a missing
  signal.
- **AC-2**: `src/services/solo/auto-compact-orchestrator.ts` —
  `evaluateCompactTrigger` (pure), `runAutoCompact` (side effects).
  Two tiers (0.85 pre-compact / 0.95 red-line); honors D6.e in-flight
  deferral for pre-compact zone; forces synchronous dispatch at red
  line.
- **AC-3**: `src/services/context/auto-compact-dispatcher.ts` —
  reads `IdeAdapter.compact`, dispatches via the declared pathway.
  `shell-exec` → `child_process.spawn`; `ide-native` → reserved for
  future slice; `llm-self-compress` → noop + LLM summarizes on next
  turn; `noop` → explicit noop for legacy adapters.
- **AC-4**: `peaks solo auto-compact` CLI command + `peaks solo
  context-now` (always JSON). 0 human intervention loop:
  context-now → auto-compact → IDE compact → D7 post-compact-detect
  → runner resumes from auto-decisions.md.
- **AC-5**: this memory + tests (`tests/unit/services/context/
  auto-compact-reader.test.ts`, `auto-compact-orchestrator.test.ts`,
  `auto-compact-dispatcher.test.ts`) + updated Solo Step N+2 prose.

## Files

- `src/services/context/auto-compact-types.ts` — types + constants
- `src/services/context/auto-compact-reader.ts` — AC-1 probe
- `src/services/context/auto-compact-dispatcher.ts` — AC-3 IDE dispatch
- `src/services/solo/auto-compact-orchestrator.ts` — AC-2 + AC-4 core
- `src/cli/commands/solo-commands.ts` — `peaks solo auto-compact` +
  `peaks solo context-now` subcommands
- `src/services/ide/ide-types.ts` — `IdeAdapter.compact` field
- `src/services/ide/adapters/claude-code-adapter.ts` — MVP profile

## Open follow-ups

1. **L2-dogfood**: register `compact` profiles for trae / codex /
   cursor / qoder / tongyi-lingma / hermes / openclaw as each IDE's
   actual env-var + compact-command is verified. Schema is ready;
   the per-IDE fill is a 4-line addition per adapter.
2. **`ide-native` pathway**: reserved for future slice. Will write
   the compact intent to the IDE's hook file (per
   `IdeSettingsLocation`) when an IDE requires registered hooks
   rather than a runtime command.
3. **Solo Step N+2 prose update**: `skills/peaks-code/SKILL.md`
   should mention `peaks solo context-now` + `auto-compact` so LLM
   sessions invoke the autonomous loop instead of `--prompt-size`
   hand-passing.
4. **Statusline integration**: the `peaks statusline install` could
   surface the current ratio + verdict inline so the user always
   sees "context: 67% (ok)" in their statusline.

## Limitation discovered during in-session dogfood

The v2.13.0-alpha.1 shell-exec pathway spawns the IDE's compact
command via `child_process.spawn` — this fires a **separate** child
process. It does NOT compact the **current** LLM runner session.

Concrete example: when `peaks solo auto-compact` runs in a Claude
Code session at 100% context-fill, the dispatcher's
`shell-exec('claude --compact')` spawns a new `claude` process in
the shell. The original Claude Code runner that invoked
`auto-compact` is unaffected — its own context window stays at 100%
until that runner's own compact logic kicks in (Claude Code's own
auto-compact, or a user-issued `/compact` slash command).

This means:

- **Peaks-solo mode**: the LLM in the runner reads
  `auto-decisions.md` on the next turn and self-issues `/compact`.
  Net effect: zero-human-intervention. ✓
- **Ad-hoc Claude Code runner**: peaks-loop can detect + checkpoint
  + dispatch, but the runner's own context stays at 100% until the
  user (or Claude Code's own auto-compact) triggers compact. peaks-loop
  cannot externally compact a session it doesn't own.

### Future slice (out of v2.13.0-alpha.1 scope)

To close the ad-hoc-runner gap, register a **PreToolUse hook** via
`peaks hooks install` that:

1. Reads the current ratio via `CLAUDE_CONTEXT_USAGE_PERCENT`.
2. When ratio ≥ 0.95, REJECTS the next Bash tool call and writes a
   one-line hint to stderr: `peaks: ratio=98%; please run /compact`.
3. The next user turn sees the hint and issues `/compact` manually.

This hook-based pathway is the `ide-native` slot already reserved in
`IdeCompactProfile.compactPathway = 'ide-native'`. A future slice
fills the dispatcher's `ide-native` branch with the hook-write
implementation, completing the loop for ad-hoc Claude Code runners
without changing the public API.

## Why 0.85 / 0.95 specifically

- 0.85 leaves 10 percentage points of headroom (~25K tokens on a
  256K window) for the LLM to finish its current todo row, write
  a checkpoint, and call auto-compact before the next tool call.
- 0.95 leaves only 5 percentage points (~13K tokens) — too tight
  for any further tool call to succeed reliably; synchronous
  red-line kicks in here.

## Why not just lower the red line to 0.90

At 0.90 there's still ~25K tokens of headroom; a typical sub-agent
dispatch + response can fit. But peak-cli can do better: it
prefetches the convergence plan at 0.85 and lets the LLM do rich
context work in the 0.85–0.95 zone. By 0.95 the LLM has had a full
10% to act; if it didn't, peaks-loop forces compact.