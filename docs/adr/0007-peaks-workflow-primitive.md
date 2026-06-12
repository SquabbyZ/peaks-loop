# ADR 0007: peaks-workflow primitive

- **Status:** proposed — 2026-06-12
- **Authors:** smallmark1912 + Claude (peaks-solo session 2026-06-12-session-dbc275)
- **Target release:** post-2.1.0 (no earlier than 2.2.0)
- **Supersedes:** nothing
- **Superseded by:** nothing yet
- **Companion:** [[parked-2.1.0-browser-service]] (sibling parked ADR)

## Context

peaks-cli today has four orchestration primitives that together describe a workflow but are not bundled into one capture-able object:

- **Skills** (`skills/peaks-*/SKILL.md`) — LLM role = system prompt + tool list
- **SOPs** (`peaks-sop` + `sop.json`) — phase gates (file-exists / grep / command)
- **Runbook** (`peaks-solo/references/runbook.md`) — CLI sequence for the full-auto profile
- **Artifacts** (`.peaks/_runtime/<sid>/{prd,rd,qa,sc}/`) — per-slice outputs

To reuse a workflow, a user must re-narrate to `peaks-solo` what they want, and the LLM re-derives the phase plan each invocation (~3-5k tokens of plan narration, plus a real risk of LLM drifting the phase order or skipping a role). Token cost + drift are the user's stated pain.

External survey (LangGraph / Temporal / Inngest / CrewAI / Autogen / n8n) showed: all of them cover state persistence + role routing to some degree, **none** integrate "gates" (file-exists / grep / command) as a first-class primitive. That gate-first posture is peaks-cli's moat and should not be replaced; it should be wrapped.

## Decision (proposed)

Add a new peaks primitive: **`peaks-workflow`** (skill) + **`peaks workflow` CLI**. Workflows are the **WHO/HOW/WITH-WHAT** layer; SOPs remain the **WHAT** layer. They compose — a workflow can reference an SOP for its gates.

### Vocabulary (proposed)

```
WORKFLOW = sequence(phase[])
phase = {
  role: peaks-*                       # WHO runs this phase
  promptTemplate: <string>            # WHAT to ask that role (细粒度要求:沉淀 prompt)
  contextSnapshot: <archetype+files>  # 项目上下文快照 (细粒度要求:沉淀 context)
  gateManifest: <sop.json ref>        # 引用 peaks-sop 的门禁,不复制定义
  inputArtifacts: <paths>             # WITH-WHAT input
  outputContract: <schema>            # WITH-WHAT output shape
}
```

### CLI surface (proposed)

```
peaks workflow record    # capture the current peaks-solo run as a workflow object
peaks workflow run <id>  # replay a captured workflow deterministically
peaks workflow list      # show captured workflows (project + global)
peaks workflow show <id> # show the captured structure + diff vs. last run
peaks workflow lint <id> # validate phase contracts + gate coverage
```

### Storage (proposed)

- Project-scoped: `<repo>/.peaks/workflows/<id>.md` (committed, shared with team)
- Global: `~/.peaks/workflows/<id>.md` (personal cross-project)

### Skill-first posture (reinforced by user 2026-06-12)

The user does **not** call `peaks workflow` directly. The LLM-mediated flow:

```
user: peaks-workflow 保存这个流程
  → skill peaks-workflow invokes `peaks workflow record` internally
  → LLM reads peaks-solo state, phase transitions, prompts, context
  → emits .peaks/workflows/<id>.md

user: peaks-workflow 跑一下 OAuth 流程
  → skill peaks-workflow invokes `peaks workflow run oauth-callback`
  → LLM reads the captured workflow + the project's current state
  → drives phases by role; no re-derivation of the phase plan
```

This matches the project-wide dev-preference rule (skill-first, CLI-auxiliary) and the existing `peaks-solo` pattern.

## Why a new primitive (not extending peaks-sop)

| Option | Reason rejected |
|---|---|
| Extend `peaks-sop` with `role` field | Conflates "gate" with "role-routing". `peaks-sop` becomes a 200+ line schema; reviewers lose the simple mental model "sop = gates". |
| Wrap LangGraph / Temporal | Single-binary product shape breaks. 2-3× tarball size. Maintenance tax on a moving target. |
| Add a "workflow" artifact kind to the existing `peaks request` state machine | `peaks request` is per-slice; workflows are templates across many slices. Conflating them muddies the state-machine semantics. |

A new primitive is the cleanest. The composability story (workflow ↔ sop ↔ skill ↔ request) is documented in a follow-up "orchestration primitives diagram" once the four-primitive vocabulary is stable.

## Token / efficiency benefit (quantified target)

| Invocation | Today | After (target) |
|---|---|---|
| `peaks-solo <task>` plan narration | ~3-5k tokens | 0 (workflow runs as deterministic machine flow) |
| Per-phase role prompt construction | ~500-1k tokens | 0 (prompt template baked into workflow) |
| Project context re-derivation | ~1-2k tokens | 0 (context snapshot baked into workflow) |
| LLM drift risk (wrong phase order, skipped role) | Real | 0 (phase sequence is data, not LLM decision) |

## Open concerns (lifted from sibling ADR 0006 review)

These were the same concerns I raised against ADR 0006; they apply here too and are **not yet resolved**:

1. **State persistence layer.** Where does the captured workflow live between record and run? `.peaks/workflows/<id>.md` (text, git-friendly, reviewable) vs. a binary store (faster, less transparent). Recommendation: text + git, since reviewability is peaks-cli's core value.
2. **Workflow versioning.** `peaks workflow show <id>` should diff against last-run. Schema migration: what happens when the captured workflow references a peaks-* skill that has since been renamed?
3. **Cross-project composition.** A user-authored workflow in `~/.peaks/workflows/oauth-callback.md` references `skills/peaks-rd/SKILL.md` (project-relative) — does the global workflow work in every project, or do project workflows override?
4. **LLM drift inside a phase.** Even with a frozen phase sequence, the LLM executing the phase can still drift. The workflow primitive does not solve this; it just narrows the surface.
5. **Token economics in re-recording.** If the user re-records the same workflow weekly (because peaks-solo gets a feature), that's another 3-5k tokens per record. The "savings" only accrues after the workflow stabilizes.

## Defer-to-dogfood gate

Per user decision 2026-06-12, **no code work starts** until:

- `peaks-sop` is dogfooded in ≥3 non-trivial real workflows (publishing pipeline / data validation / cross-team approval) and usability gaps are documented
- The four open concerns above have user decisions
- A 2.1.0 release ships first

Until then, the RD slice spec skeleton is parked alongside the parked 2.1.0 browser-service ADR. Reopen when the dogfood is done.

## Out of scope (explicit)

- LLM-as-judge gate (existing peaks-sop already covers command/grep/file-exists; no LLM-judge gate in this primitive)
- Real-time collaborative editing of workflows (file-based + git, no CRDT)
- Visual workflow editor (defer to a later milestone; today: text + linter)
- Workflow marketplace (peaks-sop positioning is general workflow tool; marketplace is a separate concern)
