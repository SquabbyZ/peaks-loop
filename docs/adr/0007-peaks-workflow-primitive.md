# ADR 0007: peaks-workflow primitive

- **Status:** accepted — 2026-06-30 (v2 update)
- **Authors:** smallmark1912 + Claude (peaks-solo session 2026-06-12-session-dbc275; v2 update: 2026-06-30-session-f90141)
- **Target release:** v3.0.0 (Loop Engineering native)
- **Supersedes:** nothing
- **Superseded by:** nothing yet
- **Companion:** [[parked-2.1.0-browser-service]] (sibling parked ADR)
- **Related:** `.peaks/memory/parked-peaks-workflow-primitive.md` (deferral context); `.peaks/_runtime/2026-06-30-session-f90141/loop-eng-alignment/01-similar-75-gaps-25.md` (alignment matrix); `02-deep-research-synthesis.md` (Karpathy + SWE-bench + Anthropic first-source synthesis)

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

These were the same concerns I raised against ADR 0006; they apply here too. **v2 update (2026-06-30) resolves all 5**:

1. **State persistence layer.** Resolved: text + git. Storage = `.peaks/workflows/<id>.yaml` (project, git-tracked) or `~/.peaks/workflows/<id>.yaml` (global, cross-project). Schema is hand-rolled to avoid a new dep on `js-yaml`; reviewability is the core value (Karpathy 2017 evaluation-criterion thesis: the spec is the program).
2. **Workflow versioning.** Resolved: each workflow file carries `schemaVersion: 1`. When a referenced peaks-* skill is renamed, the LLM-driven reconciliation step surfaces a lint warning (`unknown role`); a future minor adds `peaks workflow migrate` for auto-rewrite. The on-disk SHA + the bundle of (phases, gates, evaluators, contextSnapshot, budget) is the contract.
3. **Cross-project composition.** Resolved: resolution order = project, then global, then bundled. Project-local workflows override; the bundled `default-fullauto-md` ships as the fallback so a fresh checkout always has a working workflow. Role paths inside `promptTemplate` are intentionally free-form text — peaks-cli does NOT resolve them as filesystem paths, only the role token (e.g. `peaks-rd`) is validated.
4. **LLM drift inside a phase.** Resolved (in scope of v3.0.0): the workflow spec captures the phase sequence + role + prompt template, narrowing drift to "did the role execute this prompt correctly" rather than "did the role pick the right phase order". The 4 native evaluators (`karpathy` / `code-review` / `security-review` / `perf-baseline`) + `verdict-aggregate` give the runtime a deterministic post-condition check; the future Slice C `peaks loop check-monotonic <rid>` enforces monotonic-improvement so silent drift auto-aborts (see alignment matrix 4.2).
5. **Token economics in re-recording.** Resolved: re-recording cost is amortized. Each invocation of `peaks workflow run` reads the YAML file (text, fast) and emits the run-plan order without an LLM roundtrip; the ~3-5k tokens of plan narration the LLM previously spent is now zero. The re-record cost only fires when a phase genuinely changes; the v2 schema includes `outputContract` so the LLM can refactor a single phase without touching the rest.

## v2 update — implementation summary

v3.0.0 ships the Slice A + Slice B of the Loop Engineering native refactor (per alignment matrix section 5.2):

- `.peaks/workflows/<id>.yaml` unlocked; bundled `default-fullauto-md.yaml` encodes the canonical peaks-solo step sequence.
- `peaks workflow run <id> --session <sid> --project <repo> --json` (deterministic replay).
- `peaks workflow graph <id> --session <sid> --json` (dry-run graph render; renamed from `plan` to avoid the existing `workflow plan <read|refresh|detect-trigger>` slice-025 collision).
- `peaks workflow lint <id> --session <sid> --json` (semantic validation).
- `peaks loop eval <rid> --evaluator <name> [--project <repo>] [--json]` (workflow-callable native evaluator; no LLM scheduling).
- 4 native evaluator types: `karpathy` / `code-review` / `security-review` / `perf-baseline` + the aggregate `verdict-aggregate` glue.
- Backward-compat: `peaks loop eval` envelopes flow through `verdict-aggregator` unchanged (the `AnyEnvelope` discriminated union already accepts the same shape; verified by `tests/unit/loop/evaluator-dispatcher.test.ts`).
- peaks-solo SKILL.md keeps its prose steps as a backing doc (downgraded, not deleted). The LLM may still read them when no workflow is bound, preserving v2.x behavior for projects that don't ship a workflow file.

## Defer-to-dogfood gate

Per user decision 2026-06-12, **no code work starts** until:

- `peaks-sop` is dogfooded in ≥3 non-trivial real workflows (publishing pipeline / data validation / cross-team approval) and usability gaps are documented
- The five open concerns above have user decisions
- A 2.1.0 release ships first

**v2 status (2026-06-30):** the gate is satisfied. v2.19.0 shipped 2026-06-30 with 2.13.1 verdict-aggregator + 2.13.3 envelope unification; peaks-sop dogfooded across publishing / data validation / cross-team approval per the `peaks-cli-fast-iteration-quality-loop` memory; all 5 concerns resolved above. v3.0.0 work proceeds.

## Out of scope (explicit)

- LLM-as-judge gate (existing peaks-sop already covers command/grep/file-exists; no LLM-judge gate in this primitive)
- Real-time collaborative editing of workflows (file-based + git, no CRDT)
- Visual workflow editor (defer to a later milestone; today: text + linter)
- Workflow marketplace (peaks-sop positioning is general workflow tool; marketplace is a separate concern)
