---
name: peaks-doctor
description: Orchestrate peaks-loop's L3 doctor (peaks audit + peaks doctor + peaks openspec from-doctor) for project health. Use when the user asks for a project health check, doctor report, audit, or wants to convert doctor findings into OpenSpec change records. Coordinates the L2 audit framework + the L3.2 doctor + the L3.3 from-doctor proposal generator. Triggers on `/peaks-doctor`, "peaks doctor", "项目健康", "doctor report", "health check", "check the project", "audit my repo".
internal: true
---
---

# Peaks-Loop Doctor

Peaks-Loop Doctor is the orchestration facade for the L3 doctor workflow. It runs the L2 audit framework (`peaks audit red-lines`) + the L3.2 doctor checks (`peaks doctor`) + the L3.3 from-doctor proposal generator (`peaks openspec from-doctor`). Use it when the user wants a project health check, a red-line audit, or to convert doctor findings into OpenSpec change records.

## Skill-first architecture note (read once, internalise)

This skill is the **primary surface**. The `peaks <cmd>` CLI is **auxiliary** — invoked by the skill prompt only when a primitive is the right tool. Behaviour only an LLM in a skill prompt would use lives **here in the SKILL.md**, not as a new CLI command. See `.claude/rules/common/dev-preference.md` for the decision template.

## Code-Change Red Line (BLOCKING — read before ANY tool call)

**Peaks-Loop Doctor is a doctor orchestrator, NOT an implementer. You MUST NOT write, edit, or modify any application source code directly.**

The doctor workflow is read-only by design. It produces:
- `peaks audit red-lines` report (121 red lines in the current repo, 6 cli-backed)
- `peaks doctor` report (69 checks: 68 pass, 1 fail — L3:l3-memory-health)
- Optional OpenSpec change records via `peaks openspec from-doctor`

If a doctor finding requires a code change, the workflow hands off to `peaks-rd` (or `peaks-code` for the full pipeline). The doctor itself does NOT modify code.

## Workflow (5 steps)

1. **Anchor**: `peaks workspace init --project <repo> --json` (idempotent; same as every peaks-* skill).
2. **Run audit**: `peaks audit red-lines --project <repo> --json` — returns the red-line audit (catalog-matched markers + live enforcer findings). Inspect the `enforcerFindings` array for runtime-detected issues.
3. **Run doctor**: `peaks doctor --json` — returns 69 checks. Pay special attention to:
   - `L3:l3-orphan-sessions` — invalid sids in .peaks/_runtime/
   - `L3:l3-memory-health` — .peaks/memory/index.json shape
   - `integration:gateguard-peaks-conflict` — third-party Edit/Write hook interference
   - `build:workspace-layout-canonical` — workspace layout
4. **Triage findings**: For each FAIL check, decide:
   - **Real bug requiring fix** → hand off to peaks-rd (run `peaks openspec from-doctor` first to generate a draft proposal; then peaks-rd to implement)
   - **Acceptable false positive** → document in the handoff; do not act
   - **Configuration drift** → run the suggested recovery command (e.g. `peaks workspace clean`)
5. **Generate proposals** (per FAIL finding): `peaks openspec from-doctor --project <repo> --check-id <id>` writes `openspec/changes/<date>-fix-<slug>/proposal.md`. Hand off to peaks-rd for implementation.

## CLI primitives the skill composes

- `peaks workspace init` — anchor the workspace (Step 0)
- `peaks audit red-lines` — L2 audit
- `peaks doctor` — L3.2 doctor
- `peaks openspec from-doctor` — L3.3 proposal generator
- `peaks openspec validate` — gate a draft proposal

## Boundaries

- The doctor is read-only. It does NOT modify code, fix bugs, or clean up sessions.
- The doctor does NOT install UA or any third-party tool. The opt-in UX is surfaced via `peaks understand opt-in`; the doctor just reports state.
- The doctor does NOT generate change records automatically; it surfaces findings + the LLM calls `peaks openspec from-doctor` to generate them.

## References

- `references/doctor-check-catalog.md` — every doctor check id + what it means
- `references/from-doctor-flow.md` — the end-to-end "finding → proposal" path
