# M9 — Narrative Update + peaks-workflow Demotion

**Goal:** Demote `peaks-workflow` (ADR 0007) from "durable asset" to "execution trace mechanism". Rewrite the README zh/en to lead with "Loop Engineering". Add the RL-8 self-description to `peaks-code` SKILL.md. Write a positioning memory entry.

**Architecture:**
- `docs/adr/0007-peaks-workflow-primitive.md` — append a §"v3 demotion" section that states the workflow file is now an execution trace, not a durable asset; the user-facing verb is "replay this run", not "create a new asset".
- `README.md` and `README-en.md` — the hero section leads with "Loop Engineering"; the in-box section names `peaks-code` as code-domain only and references the peaks-* skill family for other domains; the sediment section explains the dual-asset model (loop + bee).
- `skills/peaks-code/SKILL.md` — add a §"## Scope" subsection that self-identifies as code-domain long-task loop engineering, NOT a general orchestrator (RL-8).
- `.peaks/memory/peaks-loop-positioning-loop-engineering.md` — capture the new positioning, the dual-asset model, the karpathy × darwin co-equal layers, the four triggers, and the desktop/share extension surface.

**File Structure (M9):**
- `docs/adr/0007-peaks-workflow-primitive.md` (modify)
- `README.md` (modify)
- `README-en.md` (modify)
- `skills/peaks-code/SKILL.md` (modify)
- `.peaks/memory/peaks-loop-positioning-loop-engineering.md` (create)

**Validation (M9 exit):** AC-18 — `peaks-code/SKILL.md` self-identifies as code-domain only. ADR 0007 has the v3 demotion section. README leads with "Loop Engineering". Memory entry is committed.

**Karpathy 4-section form (M9 enforces the existing RL-1 / RL-8; introduces no new red line):**
- Failure modes: README still leads with "workflow"; peaks-code SKILL.md still claims general orchestrator; ADR 0007 still claims the durable asset role.
- Rewrite: README hero is the loop engineering assertion; peaks-code SKILL.md has a §"Scope" subsection; ADR 0007 has §"v3 demotion".
- Self-check: `peaks-code/SKILL.md` contains the string "code-domain long-task loop engineering"; `README.md` leads with "Loop Engineering"; `ADR 0007` contains "v3 demotion".
- Out-of-scope: rewriting peaks-maker SKILL.md (M6); the desktop implementation (future).
