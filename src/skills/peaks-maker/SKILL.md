---
name: peaks-maker
description: Sediment and SkillHub author. Use when the user describes — in natural language — intent to (a) capture a workflow as a reusable skill, (b) refine or clone an existing bee, (c) export / import a skill bundle, (d) retain a release for the local SkillHub, or (e) dispose a previous release. Intent-based, never keyword-based: "调一下", "改改", "下次复用" all map to the same concrete `peaks skill sediment …` verb. User never types CLI; peaks-maker runs it on the user's behalf.
---

# Peaks-Maker

peaks-maker is the user-facing skill that turns natural-language intent into `peaks skill sediment …` CLI calls. It is always-loaded. It is the only entry that writes the pool and the local SkillHub.

## What peaks-maker does

1. Reads the user's intent (NL — never a CLI verb list).
2. Disambiguates only when genuinely ambiguous (via `AskUserQuestion` multi-choice).
3. Runs the right `peaks skill sediment …` subcommand on the user's behalf.
4. Reports back in NL.

## What peaks-maker must NOT do

- Never require the user to type a CLI verb, JSON, or path.
- Never bypass `AskUserQuestion` for genuine ambiguity.
- Never write to `.system/` (the soft-protection guard refuses).
- Never run `sqlite3` directly against `~/.peaks/skills/state.db` — only via the `peaks skill sediment …` surface.
- Never auto-promote. Always ask the user in NL.
- Never invent a CLI verb. The fixed set is `add-segment`, `add-bee`, `refine-bee`, `clone-bee`, `promote`, `retire`, `dispose`, `releases`, `release-show`, `release-diff`, `export`, `import`, `gc-blobs`, `list`, `show`, `search`, `recent`, `rebuild-index`. The blessed 18 are defined in `docs/superpowers/specs/2026-07-04-peaks-maker-dynamic-skill-sediment-design.md` §4.2. Adding/removing verbs requires updating the spec, the plan, and the CLI surface together.

## Loop Engineering role

peaks-loop's first-class product is the user's **Loop Engineering** —
the user's reusable method systems, not the user's ad-hoc workflows.
peaks-maker participates in Loop Engineering as three coordinated
roles, replacing the older "bee sediment gatekeeper" framing
(spec §7.5 / §10 RL-8):

1. **Loop crystallizer.** Reads a completed run's evidence (brief,
   trace pointers, evaluator verdicts) and drives the user through a
   single `AskUserQuestion` choice among
   `create_new_loop | update_existing_loop | trace_only`. The LLM
   then invokes `peaks asset crystallize` on the user's behalf. The
   crystallization prompt is gated to completed-task evidence only
   (RL-2 — Post-run crystallization).
2. **Bee creator.** Writes the executable body that runs the loop
   (main bee + supporting bees) using `peaks skill sediment add-bee`
   and `peaks skill sediment refine-bee`. Bees are created or
   updated only in the same transaction as their owning loop
   (RL-3 — Loop + Bee dual-asset).
3. **Evolution gatekeeper.** Honors the Darwin-style ratchet
   (RL-4 / RL-5 / RL-6) when the user wants to evolve a loop or
   bee: enforces a single editable asset, a single optimization
   dimension, an independent-context evaluator (≠ author), and a
   regression skeptic. Promotion requires the user to confirm in
   natural language; LLM runs `peaks evolution propose / evaluate /
   mark-keep / revert` on the user's behalf.

### Reference

- The shared karpathy-engineered red lines that govern every
  Loop-Engineering-participating peaks-* skill live at
  `.peaks/standards/loop-engineering-guidelines.md`. peaks-maker
  imports that file (not a copy) and is bound by RL-0..RL-9.
- The post-run crystallization prompt is surfaced by
  `peaks asset crystallize` (M5 umbrella verb; spec §7.4).
- The Darwin-style ratchet is enforced by
  `peaks evolution propose / evaluate / mark-keep / revert`
  (M4 ratchet CLI surface; spec §6).

### Readiness gate

Any new peaks-* skill that participates in Loop Engineering must
pass the readiness lint:

```text
peaks skill lint --category loop-engineering-readiness --path <skill-dir>
```

The lint asserts three things (see
`src/services/standards/loop-engineering-readiness-lint.ts`):

1. the SKILL.md references
   `.peaks/standards/loop-engineering-guidelines.md`;
2. the SKILL.md does not introduce a CLI verb the user is meant to
   type (only LLM-coordinated verbs from the sediment / asset /
   evolution surface are allowed; RL-1);
3. the SKILL.md does not introduce a JSON / manifest
   hand-authoring surface (RL-1).

peaks-maker itself passes this lint today; the linter is what stops
a future peaks-* skill from regressing the two-forms-only / NL-only
rule at the textual layer.
