# Loop Engineering Crystallization (Authoring) — what_happened

The user asked "整体看下当前的项目还有哪些可以优化的；我想到的是目前能沉淀下来的是 workflow，不太像 loop engineering". The orchestrator surfaced 3 optimization approaches; the user chose **C (Dual-Asset Model: Loop + Bee + Workflow Trace + Evolution Evaluation)**. From there the design crystallized through 10 clarifying rounds and 4 cross-cutting corrections:

- Loop Engineering as the first-class product (workflow demoted to evidence)
- Post-run crystallization as the only durable-change entry
- Darwin-style ratchet + karpathy-style engineering (co-equal, not sequential)
- Independent-context evaluation + no self-scored evolution
- Evidence Brief mandatory for every recommendation
- peaks-code stays code-domain only; other domains are peaks-* skills
- Desktop + cross-user share extension surface locked now (peaks.bundle/1)
- 9 red lines in the 4-section karpathy form

The session shipped the spec at `docs/superpowers/specs/2026-07-07-peaks-loop-loop-engineering-crystallization-design.md` (2 commits: base + desktop/share extension) and a 10-slice implementation plan at `docs/superpowers/plans/2026-07-07-loop-engineering/`. The plan was then implemented slice-by-slice via RD sub-agent dispatch, with each slice's exit conditions committed to main.

---

## Concise handoff block (for the CLI --brief-what-happened flag)

A user complaint about "looks like workflow, not loop engineering" drove a 10-slice long-task that shipped:

- A four-layer asset model: Loop Engineering Asset + Bee Asset + Workflow Trace + Evolution Evaluation
- 9 red lines in karpathy 4-section form at `.peaks/standards/loop-engineering-guidelines.md`
- Darwin-style ratchet + independent-context evaluator + regression skeptic (no self-score)
- Evidence Brief required for every recommendation (4 sections, no count-only evidence)
- peaks-code stays code-domain only; non-code domains are new peaks-* skills that import the guidelines
- Desktop + share extension surface locked: `peaks.bundle/1` format, run-state read-only contract, import-as-candidate gate
- SkillHub now stores `loop_release`, `loop_bee_relation`, `evolution_evaluation`, `crystallization_event` tables plus the M3 extension columns
- New CLI verbs: `peaks loop *`, `peaks bee *`, `peaks asset *`, `peaks evolution *`, `peaks skill lint --category loop-engineering-readiness`
- 8 implementation slices (M0..M7) committed with green vitest at every exit condition
- peaks-maker re-positioned to "loop crystallizer + bee creator + evolution gatekeeper"
- This dogfood slice (M8) is itself the proof that the design works end-to-end