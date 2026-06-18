# Sub-agent dispatch (RD)

> Body of `## Sub-agent dispatch`. When this skill is launched as a sub-agent via `peaks sub-agent dispatch <role>` (then the LLM executes the returned toolCall) from `peaks-solo`, the following sections of THIS skill are **suspended** for the sub-agent run:

- **Session id** — use the parent's sid (read `.peaks/_runtime/session.json` or pass `--session-id <parent-sid>` to any session-creating CLI). Do NOT spawn your own session. The new `peaks session info --active` reads the canonical binding for you.
- **Skill presence (MANDATORY first action)** — do NOT call `peaks skill presence:set peaks-rd`. The sub-agent must not overwrite `.peaks/.active-skill.json`; the main Solo loop owns that file. If you need to mark your own state, write a marker file at `.peaks/_runtime/<sessionId>/system/sub-agent-rd.json` and only that.
- **Workspace initialization** — Solo has already run `peaks workspace init` before fan-out. Do not re-run it.
- **Mode selection** — Solo has already chosen the mode. Read it from the prompt arguments (or from `.peaks/.active-skill.json` if you can, but do not write it).
- **Statusline install** — already done by Solo at session startup; do not re-run.

What the sub-agent **MUST** still do, from this skill's contract:

0. **Do NOT call `peaks request init`** — Solo has already initialised the request artefact slot in the main loop before fan-out (the runbook has the exact `peaks request init --role rd --id <rid> --project <repo> --apply --type <type> --json` call). The sub-agent reads the slot via `peaks request show <rid> --role rd --project <repo> --json` if it needs to. Note: `peaks request init` is **dry-run by default**. Pass `--apply` to actually create the artifact.
2. `peaks request show <rid> --role prd --project <repo> --json` (and `--role ui` if UI is in the swarm plan).
3. Standards preflight (dry-run only; Solo owns the apply step).
4. Project-scan read; create `rd/project-scan.md` only if Solo flagged it missing in the dispatch prompt.
5. Write the planning artefact: `rd/tech-doc.md` (feature/refactor) or `rd/bug-analysis.md` (bugfix). If `--type` is `config|docs|chore`, **no planning artefact is required** — return immediately with `{"role":"rd-planning","status":"skipped","reason":"type=<type>"}`.
6. Return only a compact JSON envelope — Solo will run the convergence gate (`ls` checks):

```json
{
  "role": "rd-planning",
  "rid": "<rid>",
  "status": "ok" | "blocked" | "skipped",
  "artefacts": [".peaks/_runtime/<sessionId>/rd/tech-doc.md"],
  "warnings": [],
  "blockedReason": null
}
```

**Hard prohibitions** (sub-agent context, in addition to general red lines):

- Do NOT call `Skill(skill="...")` from inside the sub-agent — that defeats the fan-out.
- Do NOT call `peaks skill presence:set` — Solo owns the active-skill file.
- Do NOT commit, push, install hooks, or apply settings.json mutations.
- Do NOT ask the user interactive questions. If you need clarification, return `{"status":"blocked","blockedReason":"<text>"}` and let Solo handle the user message.
- Do NOT modify code (the Swarm phase is planning only; code edits happen in the RD implementation phase, which is a separate sub-agent or inline run after Gate B).

After returning, Solo re-checks Gate B (`ls .peaks/_runtime/<sessionId>/rd/tech-doc.md` etc.) and proceeds to RD implementation, which is a different sub-agent or inline run.

## Karpathy-guidelines context (Slice 1/6 — karpathy prompt-injection-lift)

When the dispatch primitive constructs the sub-agent prompt, the following context block MUST be appended to the sub-agent prompt verbatim. The block is the canonical injection source for any RD-spawned sub-agent (including 4-way fanout, including inline main-loop RD).

```
Karpathy-guidelines context (REQUIRED — read before any code action)

The 4 Karpathy guidelines are mandatory for every planning, implementation, refactor, and review action you take. If 200 lines could be 50, rewrite. Touch only what the request requires. Surface assumptions, do not hide them. Define verifiable success criteria.

1. Think Before Coding

Don't assume. Don't hide confusion. Surface tradeoffs. Before implementing: state assumptions explicitly; if multiple interpretations exist, present them; if a simpler approach exists, say so; if unclear, stop and ask.

2. Simplicity First

Minimum code that solves the problem. Nothing speculative. No features beyond what was asked. No abstractions for single-use code. No "flexibility" or "configurability" that wasn't requested. No error handling for impossible scenarios. If you write 200 lines and it could be 50, rewrite it. Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

3. Surgical Changes

Touch only what you must. Clean up only your own mess. When editing existing code: don't "improve" adjacent code, comments, or formatting; don't refactor things that aren't broken; match existing style. When your changes create orphans: remove imports/variables/functions that YOUR changes made unused. The test: every changed line should trace directly to the user's request.

4. Goal-Driven Execution

Define success criteria. Loop until verified. "Add validation" → write tests for invalid inputs, then make them pass. "Fix the bug" → write a test that reproduces it, then make it pass. For multi-step tasks, state a brief plan with verify checkpoints. Strong success criteria let you loop independently. Weak criteria require constant clarification.
```

Sub-agents MUST NOT silently drop this block. The regression test `tests/unit/skills/karpathy-prompt-injection.test.ts` asserts this block is present. The canonical skill id for the full guidelines text is `andrej-karpathy-skills:karpathy-guidelines`.