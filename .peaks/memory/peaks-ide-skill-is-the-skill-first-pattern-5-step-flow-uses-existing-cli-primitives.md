---
name: peaks-ide-skill-is-the-skill-first-pattern-5-step-flow-uses-existing-cli-primitives
description: peaks-ide skill is the skill-first pattern: 5-step flow uses existing CLI primitives
metadata:
  type: convention
  sourceArtifact: .peaks/_runtime/2026-06-06-session-22f08c/txt/handoff.md
---

The `peaks-ide` skill (`skills/peaks-ide/SKILL.md`) is the canonical example of the dev-preference red line "skill is primary, CLI is auxiliary". The 5-step flow is: detect → AskUserQuestion → plan & preview → execute → audit. The execute step calls `peaks hooks install` / `peaks statusline install` / `peaks hook handle` — no new CLI was added. Future user-facing flows should follow the same pattern: write a skill, not a CLI.
