---
name: custom-sop-and-gate-metering
description: Planned iteration — user-authored SOP skills (A) then open-core slotted gate metering (B).
metadata:
  type: project
---
New iteration discussed 2026-05-29 (peaks-prd brainstorm). PRD confirmed at `.peaks/2026-05-29-session-746113/prd/requests/001-2026-05-29-custom-sop-gate-metering.md`. Two layered features:

**Feature A — user-authored SOP skills (build first, standalone value):** scaffolder + gate manifest schema + `peaks sop lint` + register into presence/statusline/mode-enforcement. Builds on existing skill-registry, skill-create, install-skills.mjs. Scope = "range 3" (custom gates truly block transitions via a gate registry).

**Feature B — slotted gate metering + tiers (open-core商业层, on top of A):** free=2 / pro=6 / max=18 / ultra=∞ gates.

Locked decisions (treat as preserved behavior for downstream RD/QA):
- **Metering unit = total gate pool per workspace/account** (not per-SOP cap, not SOP count). Counts only user-authored SOP gates. Resilient to split/merge; server-verifiable; client-visualizable as "used 4/6".
- **Built-in peaks-* family gates are ALWAYS exempt and never counted.** free=2 must NOT break the bundled skills. Selling authoring power, not "our product's safety".
- **Open-core**: CLI core stays MIT; paywall via server-side entitlement, NOT a client-side tier check (MIT+public npm → trivially forked).
- A gate = a CLI-evaluable checkpoint returning pass/fail/blocked, bound to a SOP transition, with a stable addressable id (decided now so B doesn't force a schema rewrite).
- Approach **(a) gate registry**: custom gates register into a table that mode-enforcement reads dynamically and layers onto the existing hardcoded `ASSISTED_CONFIRM_TRANSITIONS` — single enforcement integration point at request-artifact-service transition.
- Client (visualization cockpit) is a **non-goal for now** but a hard design constraint: every A-phase command must ship `--json` + `--dry-run` + stable envelope `{ok,command,data,warnings,nextActions}`. Engine first, cockpit later.

RD owns OQ1-OQ5 (registry schema/location, `command`-gate sandbox/allowlist security, SOP id namespace isolation, transition key shape). QA owns AC1-AC10 + P1-P7 regression matrix.

**Why:** gates are where Peaks' value lives ("不丢环节"), so metering gates charges for delivered value, not an arbitrary axis.
**How to apply:** A precedes B. Keep [[coverage-red-line]] (95%/100% gate) and [[main-branch-iteration]] (edit main, no worktree) in force.
