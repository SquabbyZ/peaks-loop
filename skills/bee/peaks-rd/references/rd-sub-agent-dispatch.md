# Sub-agent dispatch (RD)

> Body of `## Sub-agent dispatch`. When this skill is launched as a sub-agent via `peaks sub-agent dispatch <role>` (then the LLM executes the returned toolCall) from `peaks-code`, the following sections of THIS skill are **suspended** for the sub-agent run:

## Default `--from-dag` is mandatory (slice 2026-06-24-efficiency-4p-bundle / G2 / P0.3)

> **Hard constraint**: when the swarm plan DAG has ≥ 2 leaves at the
> same topological level, the **only** allowed dispatch shape is
>
> ```
> peaks sub-agent dispatch --from-dag <dag-file> --batch-id <id>
> ```
>
> — i.e. one batch with `dispatchCount === N` parallel `buildToolCall`
> envelopes. Do NOT fan out by issuing N separate
> `peaks sub-agent dispatch <role> --prompt ...` calls in sequence
> (or as a non-DAG multi-call in one message); that serialises the
> wait and turns wall-time into `sum`, not `max`. The CLI rejects
> hand-rolled serial fan-out for ≥ 2-leaf DAGs at the SKILL.md /
> orchestrator level — there is no preference, env-var, or CLI flag
> that overrides this constraint.
>
> Single-leaf (≥ 1 leaf, exactly 1) DAGs may still use the legacy
> single-dispatch shape `peaks sub-agent dispatch <role> --prompt ...`
> because no parallelism is on the table. `config | docs | chore`
> request types still skip Swarm (no DAG emitted) and remain on the
> single-dispatch path.
>
> This constraint is **text-locked** in this reference (so the LLM
> runner sees the rule every time it reads the dispatch contract) and
> **test-locked** by
> `tests/unit/dispatch/dispatch-fanout-mandatory.test.ts` (≥ 8 cases
> covering 1-leaf, 2-leaf, 3+-leaf, config/docs/chore type-bypass, and
> the preferences-with-serial-default fan-out escape hatch). See also
> `skills/peaks-code/references/fanout-mandatory.md` for the
> orchestrator-side rationale; the two files share the same wording by
> design — if either changes, update the other.

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
5. Write the planning artefact: `rd/requests/<rid>.md` (feature/refactor, per the `artifact-per-request.md` contract) or `rd/bug-analysis.md` (bugfix). If `--type` is `config|docs|chore`, **no planning artefact is required** — return immediately with `{"role":"rd-planning","status":"skipped","reason":"type=<type>"}`.

   > **v2.11.0 change (Group A):** `rd/tech-doc.md` is removed. The per-slice planning record is the per-request artefact at `rd/requests/<rid>.md`; the slice's source-of-truth architecture is the immutable peaks-prd handoff at `prd/handoff.md` (verify handoff hash = `<dispatched value>` before reading).
6. Return only a compact JSON envelope — Solo will run the convergence gate (`ls` checks):

```json
{
  "role": "rd-planning",
  "rid": "<rid>",
  "status": "ok" | "blocked" | "skipped",
  "artefacts": [".peaks/_runtime/<sessionId>/rd/requests/<rid>.md"],
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

After returning, Solo re-checks Gate B (`ls .peaks/_runtime/<sessionId>/rd/requests/<rid>.md` etc.) and proceeds to RD implementation, which is a different sub-agent or inline run.

## Test Tool Detection (mandatory)

The dispatch CLI (`peaks sub-agent dispatch`) automatically prepends a Test Tool Detection block to every sub-agent prompt — telling the sub-agent to read `package.json#scripts.test` first and use the project-local runner (`./node_modules/.bin/<runner>` or `pnpm test -- <file>`). NEVER use `npx <runner>`. This rule is machine-injected, not a prompt ritual — every sub-agent gets it including rd/qa/ui/txt/sc.

If the framework is not obvious from `package.json#scripts.test`, the sub-agent should run `peaks test --json` to introspect the resolved framework + argv before picking a runner.

See the block constant at `src/services/dispatch/test-tool-detection.ts` for the verbatim text.

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