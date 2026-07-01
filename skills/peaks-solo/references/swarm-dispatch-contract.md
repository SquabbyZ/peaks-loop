# Swarm dispatch contract

> Reference for `peaks-solo` Swarm phase and the role sub-agents (`peaks-ui` / `peaks-rd` planning / `peaks-qa` test-cases). Defines the **mechanism** of fan-out: how Solo launches sub-agents, what the sub-agent prompt must contain, what the sub-agent must return, and how Solo reduces the result.

## Peaks-Loop Swarm parallel phase (sub-agent fan-out, default)

> **Slice 5 (2026-06-23) + slice 2026-06-23-audit-4th #F3:** the
> previous "conditional swarm" framing is replaced by the **default
> fan-out rule** in `skills/peaks-solo/SKILL.md` §"Peaks-Loop Default
> sub-agent fan-out". When the slice DAG has ≥ 2 leaves at the same
> topological level, dispatch goes through
> `peaks sub-agent dispatch --from-dag` (NOT one-at-a-time). The
> gate logic below remains the canonical source for: PRD state,
> request type, frontend touch, mode-driven shape, and degradation
> rules. As of 2.8.4 the `'serial'` opt-out was removed by user
> direction — single-sub-agent dispatch is no longer permitted when
> ≥ 2 leaves exist at one topological level (see
> `references/fanout-mandatory.md`).

The Swarm phase is the **default** for any DAG with ≥ 2 leaves at
the same topological level. Solo derives the fan-out set from the
DAG topology — not from a default of "always launch three", and
not from a strict conditional check. The swarm gate (PRD state +
request type + frontend touch), mode-driven fan-out shape, and
degradation rules live in the references file.

## 1. Why this exists

The previous "Swarm" used `Skill(skill="peaks-rd")` calls. That is **single-stack and blocking** — there is no concurrency. Three sequential `Skill` calls run in order on the same main loop, not in parallel. The "parallel Agent calls" wording in the old SKILL.md was a v1.x illusion.

This contract (slice #009) replaces the IDE-private sub-agent literal with the IDE-agnostic primitive `peaks sub-agent dispatch <role>`. The CLI returns a JSON `data.toolCall` descriptor; the LLM executes that tool in its own environment. SKILL.md is now free of IDE-private tool names and the same prompt works on every registered IDE. Real concurrent fan-out is achieved by Solo launching N dispatch calls in a single message and the platform scheduling the returned toolCalls concurrently.

```
You are a sub-agent invoked by peaks-solo. You are NOT the main Claude session.
Your job: execute ONE role from the peaks skill family and write its artefact(s).
Return a compact JSON envelope — do not write prose.

## Hard prohibitions
- Do NOT call Skill(skill="..."). You are the role.
- Do NOT call `peaks skill presence:set` — the main loop owns .peaks/.active-skill.json.
  If you need to record state, write to .peaks/_runtime/<session-id>/system/sub-agent-<role>.json.
- Do NOT commit, push, install hooks, or apply settings.json mutations.
- Do NOT ask the user interactive questions. If you need clarification, return
  {"status":"blocked","blockedReason":"<text>"} and let the main loop handle it.

## Runtime arguments (provided by Solo)
- project: <repo>            (git repo root, NOT a sub-package)
- session-id: <sid>          (from .peaks/.active-skill.json or .peaks/.session.json)
- request-id: <rid>          (PRD id)
- type: <type>               (feature | bugfix | refactor | config | docs | chore)
- mode: <mode>               (full-auto | swarm | assisted | strict)
- project-scan-path: <path>  (read this for component library / CSS / build tool)
- existing-system-path: <path>  (legacy projects only)
- frontendOnly: <bool>       (from project-scan)
- frontendKeywordHit: <bool> (Solo's PRD scan result)
```

### 3.2 peaks-ui sub-agent prompt

Append after the common header:

```
## Role: UI design direction
You are running peaks-ui. Produce design direction, not code. RD will implement.

Steps:
1. peaks request init --role ui --id <rid> --project <repo> --apply --type <type> --json
2. peaks request show <rid> --role prd --project <repo> --json
3. Read <project-scan-path> for component library / CSS framework.
4. Run the prototype fidelity gate: Figma file? PRD visuals? Headed browser?
5. Write TWO artefacts:
   - .peaks/_runtime/<sid>/ui/design-draft.md
   - .peaks/_runtime/<sid>/ui/requests/<rid>.md
6. Return:
   {
     "role": "ui",
     "rid": "<rid>",
     "status": "ok" | "blocked" | "skipped",
     "artefacts": [".peaks/_runtime/<sid>/ui/design-draft.md", ".peaks/_runtime/<sid>/ui/requests/<rid>.md"],
     "warnings": [],
     "blockedReason": null
   }

If you determine the request is non-visual (no UI surface, no design impact),
return {"status":"skipped","reason":"non-frontend-request"} so Solo can record
the misfire in sc/swarm-plan.json.
```

### 3.3 peaks-rd (planning) sub-agent prompt

```
## Role: RD planning
You are running peaks-rd's planning step. Produce the planning artefact, not code.
Code is written in a later sub-agent or inline run.

Steps:
1. peaks request init --role rd --id <rid> --project <repo> --apply --type <type> --json
2. peaks request show <rid> --role prd --project <repo> --json
3. peaks request show <rid> --role ui  --project <repo> --json  (if ui in plan)
4. Read <project-scan-path>. If absent and Solo did not pre-create it, create it
   by running `peaks scan archetype --project <repo> --json` and copying the JSON
   into rd/project-scan.md.
5. Read <existing-system-path> if archetype is legacy-*.
6. Write the type-appropriate planning artefact:
   - feature | refactor  → .peaks/_runtime/<sid>/rd/tech-doc.md
   - bugfix              → .peaks/_runtime/<sid>/rd/bug-analysis.md
   - config | docs | chore → no planning artefact required. Return skipped.
7. Return:
   {
     "role": "rd-planning",
     "rid": "<rid>",
     "status": "ok" | "blocked" | "skipped",
     "artefacts": [".peaks/_runtime/<sid>/rd/tech-doc.md"],   // or [] when skipped
     "warnings": [],
     "blockedReason": null
   }
```

### 3.4 peaks-qa (test-cases) sub-agent prompt

```
## Role: QA test-case generation (planning, not execution)
You are running peaks-qa's planning step. Produce test cases, do NOT execute them.
The execution step runs after RD implementation in a separate sub-agent.

Steps:
1. peaks request init --role qa --id <rid> --project <repo> --apply --type <type> --json
2. peaks request show <rid> --role prd --project <repo> --json
3. peaks request show <rid> --role rd  --project <repo> --json
4. Read <project-scan-path>.
5. Write .peaks/_runtime/<sid>/qa/test-cases/<rid>.md with test cases linked to PRD
   acceptance items (use **Acceptance:** A1, A2 style).
6. Return:
   {
     "role": "qa-test-cases",
     "rid": "<rid>",
     "status": "ok" | "blocked" | "skipped",
     "artefacts": [".peaks/_runtime/<sid>/qa/test-cases/<rid>.md"],
     "warnings": [],
     "blockedReason": null
   }

If --type is docs|chore, return {"status":"skipped","reason":"type=<type>"} —
no acceptance surface to plan tests for.
```

## 4. Reducer (Solo side)

After all sub-agent dispatch calls return and the LLM has invoked the toolCalls, Solo:

1. Restores presence ONCE (not per-agent):
   ```
   peaks skill presence:set peaks-solo --project <repo> --mode <mode> --gate swarm-converged
   ```
2. Runs `ls` checks against `sc/swarm-plan.json` — every promised artefact must exist (Gate B hard). If any are missing, apply the degradation rules in "Degradation when swarm roles fail or are absent" (main SKILL.md).
3. Updates `sc/swarm-plan.json` with the final status of each sub-agent (ok / blocked / skipped / error).
4. Advances to step 4 (RD implementation) with all the artefacts in hand.

## 5. Presence restoration (single-shot)

Sub-agents are explicitly forbidden from calling `peaks skill presence:set`. That means `.peaks/.active-skill.json` does not move during the fan-out. Solo sets it to `gate=swarm-fan-out` before fan-out and to `gate=swarm-converged` once after all Tasks return. The status header (the `Peaks-Loop Skill: peaks-solo | Peaks-Loop Gate: <gate>` line) therefore reads consistently across the fan-out window.

If a sub-agent is misbehaving and writes to `.peaks/.active-skill.json` anyway, the next Solo presence-set (after fan-out) overwrites it — the bug self-heals on the next gate advance, but the swarm-phase display may be off. The hard prohibition is there to prevent this; Solo should still treat the file as a single-writer resource.

## 6. Why not a `peaks-swarm` skill?

A skill cannot itself trigger sub-agents — the Skill tool runs in the main loop. The orchestrator (peaks-solo) has to be in the main loop and has to call `peaks sub-agent dispatch` directly. Putting swarm logic into a separate skill would either re-introduce the "single-stack blocking" anti-pattern or require a custom slash command that bypasses the Skill tool. The current design keeps swarm control in peaks-solo where it belongs.

## 7. Tests / dogfood

- `peaks scan archetype --project <repo> --json` must keep emitting `frontendOnly` and `frontendOnlyReason`. Both fields are read here and by the existing pre-RD scan contract.
- `peaks request show <rid> --role prd --json` must surface the `--type` chosen at `peaks request init`. Sub-agents pass it through unchanged.
- `peaks skill presence:set` must remain single-writer-friendly (the sub-agents do not call it).
- Smoke test: a full-auto peaks-solo run on a `legacy-frontend` project with a UI-affecting PRD should produce `sc/swarm-plan.json` containing all three sub-agents and three corresponding artefacts in `ui/`, `rd/`, `qa/`.

---

### Swarm gate (decide BEFORE fan-out)

> Body of `### Swarm gate`. Before launching any sub-agent, Solo must compute the **swarm plan** from three signals:

1. **PRD state** — `prd/requests/<rid>.md` must be in state `confirmed-by-user` or `handed-off`. If not, STOP. The Swarm is downstream of PRD, not a substitute for it.
2. **Request type** (`--type` from `peaks request init`):
   - `feature` / `refactor` / `bugfix` → RD(planning) and QA(test-cases) are always in the swarm
   - `config` / `docs` / `chore` → no swarm. RD/QA artefacts are not required by Gates B/C/D for these types. Skip the Swarm phase entirely and proceed to step 4 (RD implementation) with only the PRD in hand.
3. **Frontend touch** — does the request affect user-visible behavior? This is decided by:
   - Reading `.peaks/_runtime/<sessionId>/rd/project-scan.md` `## Project mode` for `frontendOnly` (project-shape signal)
   - **AND** scanning the PRD body for frontend keywords: 页面 / 组件 / 表单 / 弹窗 / 表格 / 样式 / 布局 / 交互 / UI / UX / page / component / form / modal / table / styling / layout / interaction
   - UI joins the swarm when (a) is `true` OR (b) matches. Both signals required `false` to skip UI.

Solo records the swarm plan in `.peaks/_runtime/<sessionId>/sc/swarm-plan.json` so SC and TXT can audit what was launched:

```json
{
  "rid": "<rid>",
  "type": "feature",
  "frontendOnly": true,
  "frontendKeywordHit": true,
  "subAgents": ["ui", "rd-planning", "qa-test-cases"]
}
```

Sub-agent presence in this list = Solo launched a Task for it. Absence = the role was skipped with documented reason.

### Mode-driven fan-out shape

> Body of `### Mode-driven fan-out shape`.

| Mode | How the swarm plan is decided | What Solo does |
|---|---|---|
| `full-auto` | Compute plan from signals above, no question to user | Auto-launch all sub-agents in the plan in parallel |
| `swarm` | Same as `full-auto` | Same as `full-auto` (this profile name is historical — behavior is identical) |
| `assisted` | `AskUserQuestion` with three options: (a) Full — UI + RD(planning) + QA(test-cases); (b) Backend-only — RD(planning) + QA(test-cases); (c) Sequential — run RD first, then QA, skip UI | Use the user's choice as the plan |
| `strict` | Same as `assisted` (the question is informational; strict still enforces confirmation gates later) | Same as `assisted` |

In all modes, **the plan must be written to `sc/swarm-plan.json` before any Task call.** Solo updates `.peaks/.active-skill.json` to `gate=swarm-fan-out` at this point.

### Degradation when swarm roles fail or are absent

> Body of `### Degradation when swarm roles fail or are absent`.

| Condition | Solo action | TXT handoff note |
|---|---|---|
| UI sub-agent returns blocked/error | RD continues with PRD visual descriptions | `ui-design-missing` |
| RD planning sub-agent returns blocked/error | RD continues with PRD-derived planning | `tech-doc-missing` |
| QA test-cases sub-agent returns blocked/error | RD continues; QA backfills test cases before verdict | `qa-test-cases-missing` |
| Two or more of the above | Fall back to sequential: `peaks request transition rd → spec-locked` then inline RD run, then QA | `swarm-degraded-to-sequential` |
| All three fail | Pause workflow; surface to user; request confirmation to continue | `swarm-aborted` |

Skipping the entire swarm (when `--type` is `config|docs|chore`) is not a degradation — record `swarm-skipped: type=<type>` and proceed.
