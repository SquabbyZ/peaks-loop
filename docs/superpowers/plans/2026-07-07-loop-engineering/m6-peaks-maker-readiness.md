# M6 — peaks-maker Re-positioning + Loop-Engineering-Readiness Lint

**Goal:** Re-narrate `peaks-maker` from "bee sediment gatekeeper" to "loop crystallizer + bee creator + evolution gatekeeper" without changing its id or wire format. Add `peaks skill lint --category loop-engineering-readiness` so any new peaks-* skill that participates in Loop Engineering must import the guideline file and pass the readiness check.

**Architecture:**
- `skills/bee/peaks-maker/SKILL.md` re-narrated: adds a §"Loop Engineering role" section that references `.peaks/standards/loop-engineering-guidelines.md` and points at the M5 crystallization prompt + the M4 ratchet.
- `src/services/standards/loop-engineering-readiness-lint.ts` — reads a peaks-* skill's SKILL.md, asserts:
  - the file references `.peaks/standards/loop-engineering-guidelines.md` (or its alias),
  - the file does not introduce a CLI verb that bypasses the LLM,
  - the file does not introduce a JSON / manifest hand-authoring surface.
- `src/cli/commands/skill-loop-engineering-readiness.ts` (or extension of an existing skill-lint command) — `peaks skill lint --category loop-engineering-readiness`.

**File Structure (M6):**
- `skills/bee/peaks-maker/SKILL.md` (modify)
- `src/services/standards/loop-engineering-readiness-lint.ts`
- `src/cli/commands/skill-loop-engineering-readiness.ts` (or extend existing)
- `tests/unit/standards/loop-engineering-readiness.test.ts`
- `tests/integration/skill-loop-engineering-readiness-cli.test.ts`

**Validation (M6 exit):** AC-19, AC-20 — a new peaks-* skill that does not import the guideline file is rejected with a clear error; peaks-maker's SKILL.md references it.

**Karpathy 4-section form (M6 enforces the existing RL-1 / RL-8; introduces no new red line):**
- Failure modes: a new peaks-* skill that ships a CLI verb the user is meant to type; a new skill that does not import the guideline file; peaks-maker keeps the "bee sediment gatekeeper" framing.
- Rewrite: every peaks-* skill SKILL.md has a "## Loop Engineering references" section that cites the guideline file; peaks-maker's SKILL.md has a "## Loop Engineering role" section.
- Self-check: `skill_lint(category='loop-engineering-readiness') === ok` for any new peaks-* skill.
- Out-of-scope: a peaks-* skill that does not touch Loop Engineering (it does not need this lint).
