---
name: skill-first-cli-auxiliary-sub-agent-dispatch
description: New `peaks sub-agent dispatch` is a SKILL primitive, not a user-facing command
metadata:
  type: decision
  sourceArtifact: .peaks/_runtime/2026-06-06-session-5b1095/prd/requests/002-2026-06-07-sub-agent-dispatch-decouple.md
---

Slice #009 (PRD #002) added a new `peaks sub-agent dispatch <role> --prompt <text> --json` CLI primitive. **It is the IDE-agnostic primitive that the peaks-solo / peaks-rd / peaks-qa / peaks-ui / peaks-txt SKILL.md compose to dispatch sub-agents. Users do NOT invoke this directly.**

## Why

The dev-preference red line (top of `.claude/rules/common/dev-preference.md`) says: "skill-first / CLI-auxiliary". When designing a new peaks-loop feature, the user flow lives in the skill's `SKILL.md`; CLI commands are invoked by the skill prompt when they are the right primitive (atomic side effect, machine-enforced gate, structured JSON envelope for a downstream decision, or backstop the LLM from skipping a step).

The `peaks sub-agent dispatch` CLI clears that bar on grounds 2 (structured JSON envelope: `data.toolCall = { name, args }`) and is the natural machine primitive for "give me a tool-call descriptor I can invoke in my environment". The skill text in `skills/peaks-solo/SKILL.md` (and the runbook / references) is the only place the LLM learns to call it. The CLI's `--help` text declares this explicitly:

> This command is the primitive that peaks-solo / peaks-rd / peaks-qa / peaks-ui / peaks-txt SKILL.md compose to dispatch sub-agents. Users do not invoke this directly.

The `nextActions` field in the dispatch envelope reinforces the point: "Tool call is dry-run; LLM must execute the tool to actually dispatch the sub-agent."

## What does NOT satisfy this rule

- A future engineer who refactors the SKILL.md to "ask the user to call `peaks sub-agent dispatch` directly" — that violates the red line; the user has no business typing the command.
- A future engineer who adds a new `peaks sub-agent ...` subcommand (e.g. `list`, `show`, `gc`) and makes it the user-facing surface — that collapses the primitive/product distinction. (Future `list`/`show`/`gc` are *also* skill-primitives; the user still doesn't invoke them directly.)
- A future engineer who removes the `instruction` / `nextActions` field from the dispatch envelope that names the SKILL.md contract — the LLM loses the bridge from CLI to skill.
- A future engineer who, when adding a new IDE, leaks its private tool name into SKILL.md (e.g. a hand-coded `Task` literal in a SKILL.md) instead of going through `peaks sub-agent dispatch` — the whole point of the abstraction is to keep SKILL.md free of IDE-private details.

## How to apply

When modifying or extending the sub-agent dispatch surface:

1. The SKILL.md text in peaks-solo / peaks-rd / peaks-qa / peaks-ui (and any future Dispatcher) is the **only place** the LLM learns to call the CLI. Do not assume the LLM "knows" the CLI exists; document the call pattern explicitly.
2. The dispatch envelope's `instruction` field must keep the wording that names the SKILL.md contract (the reference doc `skills/peaks-solo/references/sub-agent-dispatch.md`).
3. The CLI's `--help` text must continue to declare the "users do not invoke this directly" sentence. Linters/hooks that auto-format help text should not strip it.
4. New per-IDE dispatchers (in `src/services/dispatch/sub-agent-dispatcher.ts`) are added by extending the `SubAgentDispatcher` interface and wiring the new dispatcher into the new `IdeAdapter.subAgentDispatcher` field. SKILL.md does NOT need to change to add a new IDE — that's the whole point of the abstraction.
5. The `SubAgentRole = string` type alias is intentional. Do NOT narrow it to a string-literal union. The whole architecture (Promotable Worker, peaks-qa business subdivide) depends on accepting any non-empty string. CLI does soft-whitelist hint in `--help`, not hard validation.

## Cross-reference

- [[slim-ideadapter-shape-is-the-contract]] — `subAgentDispatcher` is part of the IdeAdapter contract (additive on `subAgentToolMatcher`).
- [[peaks-memory-scan-is-intentionally-not-a-cli]] — precedent for "skill-first CLI primitive"; this is the dispatch counterpart.
- [[sub-agent-resource-lifecycle-red-line]] — G5 governs the **use** of this dispatch surface, not its shape.
- PRD #002 AC-19 / AC-20 / AC-21: the help text + the `nextActions` field are the enforcement mechanism for the red line.
