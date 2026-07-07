# Change: 2026-06-12-code-step-0-55-1x-detection

## Why

Slices 1 + 2 of the 1.x → 2.0 closeout shipped: the postinstall auto-detects 1.x state and the standards-migrate thin path works. The remaining gap is that the peaks-code skill (which is the user-facing orchestration surface) does NOT know about 1.x project state — when a user invokes /peaks-code in a 1.x consumer project, peaks-code proceeds with the standing 1.x layout instead of prompting the upgrade. Slice 3 adds a new Step 0.55 to peaks-code between Step 0.5 (OpenSpec opt-in) and Step 0.7 (resume detection) that: (a) calls the existing `detect1xProjectState` logic via a new TypeScript service, (b) presents an AskUserQuestion when isOneX=true, (c) persists the decision to `.peaks/preferences.json` so we don't re-ask.

## What Changes

- New `src/services/upgrade/1x-detector-service.ts` (mirror of `scripts/install-skills.mjs:detect1xProjectState` but in TypeScript so the peaks-code skill can call it). Returns `{ isOneX, signals, projectRoot, configPath }`.
- New CLI surface: `peaks upgrade --detect-1x [--project <path>]` returns the JSON envelope. The skill reads this back to gate the AskUserQuestion.
- New `### Peaks-Loop Step 0.55: 1.x → 2.0 detection` section in `skills/peaks-code/SKILL.md` between Step 0.5 and Step 0.7. The step calls the new CLI, surfaces an AskUserQuestion if isOneX=true, and persists the decision to `.peaks/preferences.json` via `peaks preferences set --key autoUpgradePrompt --value <opt-in|skip|never>`.
- New `references/step-0-55-1x-detection.md` reference file with the full detection algorithm, the AskUserQuestion options, and the persistence contract.
- TDD test coverage for the new service in `tests/unit/services/upgrade/1x-detector-service.test.ts` — fixtures mirror the existing `tests/unit/scripts/install-skills-1x-detector.test.ts` cases (legacy global config / dev-preference / missing preferences / 1.x schema / no .peaks/_runtime/ / happy path).
- Regression test: extend the existing peaks-code SKILL.md naming test to ensure the new `## Step 0.55` heading follows the established pattern.

## Out of Scope

- Re-authoring the 1.x → 2.0 detection heuristics (they ship in install-skills.mjs; Slice 3 just mirrors them in TypeScript).
- Auto-running the upgrade umbrella when the user opts in (the skill should invoke `peaks upgrade --to 2.0 --auto` after the AskUserQuestion). This is documented in the SKILL.md step but the auto-upgrade itself is the umbrella's responsibility.
- The peaks-code SKILL.md body beyond the new Step 0.55 section. Slice 3 only adds the new section + reference file.
- Skill presence or workspace init changes (Slice 3 is purely additive — a new step in the startup sequence).

## Dependencies

- `scripts/install-skills.mjs:detect1xProjectState` (already shipped in previous session) — the canonical implementation; Slice 3 mirrors it in TypeScript
- `src/services/preferences/preferences-types.ts` (already ships) — the .peaks/preferences.json schema
- `src/services/upgrade/upgrade-service.ts` (already ships) — the umbrella that Step 0.55 may invoke
- `skills/peaks-code/SKILL.md` (already ships) — Slice 3 adds Step 0.55 between Step 0.5 and Step 0.7

## Risks

- Mirroring `detect1xProjectState` from `.mjs` to TS risks drift if the two implementations diverge. Mitigation: Slice 3 writes a contract test that exercises both the TS service AND the .mjs function and asserts their outputs match for the same fixture (a small standalone integration test).
- Adding Step 0.55 to peaks-code breaks the `tests/unit/skills/skills-skill-md-naming.test.ts` invariant (zero bare `<sid>`, every `.peaks/_runtime/<X>/` has an axis label). Mitigation: carefully follow the established pattern (the step heading, the reference file path, the CLI invocation pattern).
- The new `peaks upgrade --detect-1x` CLI subcommand is a NEW CLI surface. Per the dev-preference `default-no on new CLI commands` rule, this is justified because (a) the skill needs a structured JSON envelope to gate a downstream decision (AskUserQuestion for the 1.x upgrade prompt).

## Acceptance Criteria

- `pnpm vitest run tests/unit/services/upgrade/1x-detector-service.test.ts` passes with ≥6 cases.
- `peaks upgrade --detect-1x --project . --json` returns `{ isOneX, signals, projectRoot, configPath }` matching the install-skills.mjs version's contract.
- `skills/peaks-code/SKILL.md` has a new `### Peaks-Loop Step 0.55` section between Step 0.5 and Step 0.7, under 50 lines, with the AskUserQuestion options matching the OpenSpec opt-in precedent.
- `skills/peaks-code/references/step-0-55-1x-detection.md` exists, under 80 lines.
- `peaks preferences set --key autoUpgradePrompt --value <opt-in|skip|never>` persists the decision to `.peaks/preferences.json`.
- Full `pnpm vitest run` green (no regressions). `pnpm tsc --noEmit` clean. `peaks slice check` stages 1-6 all PASS.
- Dogfood: scaffold a 1.x fixture in a temp dir, run `peaks upgrade --detect-1x --project <tmp>`, confirm isOneX=true + signals.length > 0.
