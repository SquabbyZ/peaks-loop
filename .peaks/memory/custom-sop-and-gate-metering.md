---
name: custom-sop-and-gate-metering
description: Planned iteration — user-authored SOP skills (A) then open-core slotted gate metering (B).
metadata:
  type: project
---
New iteration discussed 2026-05-29 (peaks-prd brainstorm). PRD confirmed at `.peaks/2026-05-29-session-746113/prd/requests/001-2026-05-29-custom-sop-gate-metering.md`. Two layered features:

**Feature A — user-authored SOP skills (build first, standalone value):** scaffolder + gate manifest schema + `peaks sop lint` + register into presence/statusline/mode-enforcement. Builds on existing skill-registry, skill-create, install-skills.mjs. Scope = "range 3" (custom gates truly block transitions via a gate registry).

**Feature B — tiered SOP metering (open-core商业层, on top of A):** free=2 / pro=6 / max=18 / ultra=∞ **complete SOPs**.

Locked decisions (treat as preserved behavior for downstream RD/QA):
- **Metering unit = number of complete (registered) SOPs per workspace/account** — REVISED 2026-05-29 from the earlier "total gate pool" decision per user ("套餐不应该卡 cli 门禁，而是卡完整 sop 数"). Rationale: buyer mental model ("free = 2 workflows") is far clearer; doesn't penalize thorough SOPs (gate-count metering would push users to add fewer gates, weakening the core value); aligns with "how many processes you enforce." Count = `registry.sops.length` (A's registry already enumerates `sops[]`, so the seam needs zero rework — simpler than gate counting). Only counts user-authored SOPs; built-in peaks-* never counted. Mild tradeoff on record: gameable by cramming many flows into one mega-SOP, but mega-SOPs are self-limitingly unwieldy.
- **Built-in peaks-* family gates are ALWAYS exempt and never counted.** free=2 must NOT break the bundled skills. Selling authoring power, not "our product's safety".
- **Open-core**: CLI core stays MIT; paywall via server-side entitlement, NOT a client-side tier check (MIT+public npm → trivially forked).
- A gate = a CLI-evaluable checkpoint returning pass/fail/blocked, bound to a SOP transition, with a stable addressable id (decided now so B doesn't force a schema rewrite).
- Approach **(a) gate registry**: custom gates register into a table that mode-enforcement reads dynamically and layers onto the existing hardcoded `ASSISTED_CONFIRM_TRANSITIONS` — single enforcement integration point at request-artifact-service transition.
- Client (visualization cockpit) is a **non-goal for now** but a hard design constraint: every A-phase command must ship `--json` + `--dry-run` + stable envelope `{ok,command,data,warnings,nextActions}`. Engine first, cockpit later.

RD owns OQ1-OQ5 (registry schema/location, `command`-gate sandbox/allowlist security, SOP id namespace isolation, transition key shape). QA owns AC1-AC10 + P1-P7 regression matrix.

**Status (2026-05-29):** Feature A SHIPPED — `peaks sop init/lint/register/registry/check/advance` all implemented, CR'd, QA verdict pass, documented in README/README-en. **Feature B DEFERRED** by the user: dogfood the custom-SOP authoring flow first to find usability improvements, then revisit B. A B1 PRD draft (client-side open-core half: entitlement model + Ed25519-style pubkey verify + login + register quota gate) was written and archived at `.peaks/2026-05-29-session-746113/prd/requests/002-2026-05-29-gate-metering-entitlement.md` (state: deferred) as future input. NOTE: that draft's "store token refs only" approach is SUPERSEDED by [[token-encrypted-storage-decision]] (encrypt-at-rest, decrypt-on-use).

**Why:** gates are where Peaks' value lives ("不丢环节"), so metering gates charges for delivered value, not an arbitrary axis.
**How to apply:** A is done. Next = dogfood custom SOP for usability gaps before resuming B. Keep [[coverage-red-line]] (95%/100% gate) and [[main-branch-iteration]] (edit main, no worktree) in force.
