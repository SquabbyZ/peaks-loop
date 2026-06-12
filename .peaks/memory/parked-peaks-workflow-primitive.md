---
name: parked-peaks-workflow-primitive
description: Proposed peaks-workflow primitive (skill + CLI) — parked 2026-06-12 pending peaks-sop dogfood + 5 open concerns
metadata:
  type: project
---
paused 2026-06-12.

User pain: peaks-solo re-derives the phase plan (~3-5k tokens) on every invocation, plus risk of LLM drifting the phase order. Wants to capture an agent loop / workflow once and replay it deterministically, saving tokens and improving efficiency.

**Decision (proposed, parked before code):** new primitive `peaks-workflow` (skill) + `peaks workflow` CLI. Workflow bundles WHO (role) + HOW (CLI/runbook sequence) + WITH-WHAT (artifact contract). Pairs with `peaks-sop` for WHAT (gates). Workflows live in `.peaks/workflows/<id>.md` (project, git) or `~/.peaks/workflows/<id>.md` (global).

**Skill-first posture reinforced:** user does not call `peaks workflow` directly. LLM-mediated via the skill.

**Granularity target:** 细 — sequence + prompt template + context snapshot, all baked in. Token savings come from the LLM not re-deriving these at run time.

**External survey (LangGraph / Temporal / Inngest / CrewAI / Autogen / n8n):** none integrate "gates" as a first-class primitive. peaks-cli's moat is the gate-first posture; peaks-workflow wraps it rather than replacing it.

**Open concerns (5, not yet decided):**
1. State persistence layer — text+git vs binary store.
2. Workflow versioning + schema migration (captured workflow references a renamed skill).
3. Cross-project composition (global workflow referencing project-relative paths).
4. LLM drift inside a phase (workflow freezes the sequence but not the per-phase behavior).
5. Token economics in re-recording (savings only after the workflow stabilizes).

**Defer-to-dogfood gate (per user):**
- `peaks-sop` must be dogfooded in ≥3 non-trivial real workflows first
- All 5 open concerns resolved
- 2.1.0 ships first

Until then: zero code. ADR at `docs/adr/0007-peaks-workflow-primitive.md` is the design record.

**Cross-link:** companion to [[parked-2.1.0-browser-service]] (sibling parked ADR). The two parkings are independent — the user did NOT conflate them. Browser service is a separate evaluation that may not happen at all.

**How to apply:**
- Do NOT open a `feature/peaks-workflow` branch until the dogfood gate opens.
- When dogfood is done, re-evaluate: maybe the four primitives (skills + sop + runbook + presence) plus a `peaks workflow` thin wrapper is enough; maybe the gates + roles need a deeper rethink.
- Reuse the same "1+2" deferral pattern: design first, dogfood first, code second.
