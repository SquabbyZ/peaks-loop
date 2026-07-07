---
title: peaks-loop positioning — Loop Engineering crystallization (2026-07-08)
date: 2026-07-08
status: active
applies_to: peaks-loop product narrative, peaks-* skill family, future desktop client, future cross-user share surface
spec_ref: docs/superpowers/specs/2026-07-07-peaks-loop-loop-engineering-crystallization-design.md
supersedes: peaks-loop "workflow tool" framing (declarative, no migration needed)
---

# peaks-loop positioning — Loop Engineering crystallization

## TL;DR (one sentence)

peaks-loop is a **Loop Engineering crystallization system**, not a workflow tool —
it crystallizes Loop Engineering assets out of real, completed work and only evolves
them through karpathy-engineered rules verified by darwin-style independent evaluation.

## New product definition

```
peaks-loop crystallizes Loop Engineering assets from real, completed work,
and evolves them only through verified improvements. The user operates the
system through natural language and choices; the LLM performs every
structured action.
```

The Loop Engineering Asset is the **first-class product**. The Bee Asset is the
**executable body**. The Workflow Trace is **evidence, not the durable product**.
The Evolution Evaluation is the **anti-drift gate** mandatory for any durable change.

## Four-layer asset model (per §3 of the spec)

| # | Layer | Role |
|---|---|---|
| 1 | Loop Engineering Asset | method system, first-class; owns main + supporting + retired bees |
| 2 | Bee Asset | executable body, first-class; runtime carrier for one or more loops |
| 3 | Workflow Trace | execution evidence; immutable per-run record; NOT the durable product |
| 4 | Evolution Evaluation | anti-drift gate; independent scorer + regression skeptic + ratchet |

## karpathy × darwin — co-equal layers (not sequential)

| Layer | Source library | Role in peaks-loop |
|---|---|---|
| Methodology | `multica-ai/andrej-karpathy-skills` | engineering rules — failure modes + imperative→declarative rewrite + self-check + out-of-scope |
| Execution | `alchaincyf/darwin-skill` | verifying improvements — single editable asset, single optimization dimension, independent-context evaluator, regression skeptic, ratchet |

These two layers are **co-equal partners**, not sequential. Removing either causes
drift: karpathy-only writes drift because nothing verifies them; darwin-only enforces
scores on principles that were never clearly defined. The relationship is locked as
RL-0 in `.peaks/standards/loop-engineering-guidelines.md`.

## Four crystallization triggers (none required, user explicit is highest)

| Trigger | Priority | Required conditions |
|---|---|---|
| `user_explicit` (e.g. "沉淀这个" / "复用这个" / "创建一条 loop") | Highest | None — fires immediately |
| `llm_suggested` (with evidence brief) | High | ≥ 2 reuse signals + named scenario + ≥ 1 failure-repair or preference extraction + expected user-input reduction |
| `success_default_prompt` (lightweight prompt in handoff) | Low | Always available, never auto-defaults to "create" |
| `similar_task_recurrence` (2nd–3rd run of similar shape) | Medium | ≥ 2 similar traces; brief must show similarity AND divergence |

A run may trigger multiple paths; the system resolves by priority order. The user
is the final decider for any durable behavior change.

## peaks-code stays code-domain only (RL-8)

`peaks-code` is the **code-domain long-task loop engineering orchestrator**. It is
**not** a general-purpose orchestrator. Other domains (research, content, product,
medical, …) ship as independent `peaks-*` skills that import
`.peaks/standards/loop-engineering-guidelines.md` and pass
`peaks skill lint --category loop-engineering-readiness`. They are **not** subclasses
or variants of `peaks-code`. See RL-8 in `.peaks/standards/loop-engineering-guidelines.md`.

## Desktop client + cross-user share extension surface (RL-9)

The future desktop client is a **UI accelerator**, not a new verb surface. Every UI
action must be 1:1 mappable to a single peaks CLI command. The four reserved contract
surfaces are: (1) `peaks skill sediment list / show / search / recent`, (2)
`peaks skill sediment add-segment / add-bee / clone-bee / refine-bee`,
(3) `adapter.resolveScratchDir(provider)` / `adapter.materialize(bee)`, and
(4) `bees/<bee-id>/run-state.json` (read-only).

Cross-user share uses the **`peaks.bundle/1`** bundle format. Bundles never include
private run-state, personal `.peaks/memory/` files, or raw `state.db` rows. Receiver
must import as `candidate` and must run an independent evaluation before any durable
change. The run-state contract is locked as a read-only JSON shape the desktop
client may read but never mutate.

## Red lines (9, all in `.peaks/standards/loop-engineering-guidelines.md`)

| # | Name | Source |
|---|---|---|
| RL-0 | karpathy × darwin co-equal layers | spec §9.3 |
| RL-1 | Human-NL-Choice-Only | `.peaks/memory/human-nl-choice-only-tenet.md` |
| RL-2 | Post-run crystallization | spec §5 |
| RL-3 | Loop + Bee dual-asset | spec §3 |
| RL-4 | Darwin-style ratchet (enforced) | spec §6 |
| RL-5 | Independent-context evaluation | spec §6.2 |
| RL-6 | No self-scored evolution | spec §6.3 |
| RL-7 | Evidence brief required | spec §4.7 |
| RL-8 | peaks-code domain boundary | `.peaks/memory/peaks-loop-24h-ai-programmer-positioning.md` |
| RL-9 | Desktop and share go through CLI | spec §7A |

(Counted as 9 entries; the spec numbers them RL-0 through RL-9 inclusive — 10 IDs.
The list above mirrors the spec.)

## User-facing verbs (post-M9)

- **"replay this run"** — replay a captured workflow trace (was previously framed
  as "create a new asset" under the old peaks-workflow narrative; reframed now that
  the workflow file is an execution trace, not a durable asset — see ADR 0007
  §"v3 demotion (2026-07-07)").
- **"crystallize this"** — write `loop_release` + `bee_release` + `loop_bee_relation` +
  `crystallization_event` after a real run.
- **"evolve this loop / bee"** — single-object, single-dimension, ratchet-validated
  improvement with independent scorer + regression skeptic.
- **"share this loop / bee"** — export as a `peaks.bundle/1` tarball.
- **"import that bundle"** — receiver-side; lands as `candidate`, never `stable`
  directly.

## Why this matters

Without this positioning, peaks-loop reads as a workflow tool that happens to have
loops in the name. The user's own judgment — "looks like workflow, not loop
engineering" — is correct under the old framing. The four pillars the new positioning
guarantees:

1. A Loop Engineering asset exists (the method system).
2. Post-run crystallization is the only entry into durable change.
3. Anti-drift evolution (darwin ratchet + karpathy-engineered rules) is mandatory.
4. Principles are engineered (failure modes + rewrite + self-check + out-of-scope),
   not slogan-ed.

## Related

- Loop Engineering crystallization design: `docs/superpowers/specs/2026-07-07-peaks-loop-loop-engineering-crystallization-design.md`
- Sediment pool (4.x predecessor): `docs/superpowers/specs/2026-07-04-peaks-maker-dynamic-skill-sediment-design.md`
- ADR 0007 v3 demotion: `docs/adr/0007-peaks-workflow-primitive.md` §"v3 demotion (2026-07-07)"
- karpathy guidelines file: `.peaks/standards/loop-engineering-guidelines.md`
- Human-NL-Choice-Only tenet: `.peaks/memory/human-nl-choice-only-tenet.md`
- Two-forms-only rule: `.peaks/memory/two-forms-only-rule.md`
- peaks-code 24h AI programmer positioning (RL-8 origin): `.peaks/memory/peaks-loop-24h-ai-programmer-positioning.md`
- Desktop client entry points (RL-9 origin): `.peaks/memory/4x-sediment-pool-reserves-desktop-client-entry-points.md`