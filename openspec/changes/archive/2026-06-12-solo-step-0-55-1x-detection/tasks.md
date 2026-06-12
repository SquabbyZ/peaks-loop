# Tasks

## Service scaffold + TDD red

- [ ] Create src/services/upgrade/1x-detector-service.ts (skeleton + types)
- [ ] Create tests/unit/services/upgrade/1x-detector-service.test.ts with vitest fixtures (mirror the existing install-skills-1x-detector.test.ts cases)
- [ ] Run pnpm vitest run — confirm RED (tests fail because no implementation yet)

## Service implementation (TDD green) + parity test

- [ ] Implement detect1xProjectState() — mirror the .mjs version 1:1
- [ ] Write a parity test that exercises both the TS service AND the .mjs function on the same fixture and asserts their outputs match
- [ ] Run pnpm vitest run — confirm GREEN

## Wire CLI

- [ ] Add `peaks upgrade --detect-1x [--project <path>]` to src/cli/commands/upgrade-commands.ts
- [ ] Add the JSON envelope wrapper (ok / command / data / warnings / nextActions)
- [ ] Run pnpm upgrade --detect-1x --project . --json — confirm valid envelope

## SKILL.md + reference

- [ ] Add ### Peaks-Cli Step 0.55: 1.x → 2.0 detection to skills/peaks-solo/SKILL.md between Step 0.5 and Step 0.7
- [ ] Create skills/peaks-solo/references/step-0-55-1x-detection.md
- [ ] Run pnpm vitest run tests/unit/skills/skills-skill-md-naming.test.ts — confirm no regression

## Dogfood + validation

- [ ] Write scripts/dogfood-step-0-55.mjs that scaffolds a 1.x temp project + runs peaks upgrade --detect-1x, captures the JSON envelope, writes the report to .peaks/_runtime/<sid>/rd/step-0-55-dogfood.md
- [ ] Run dogfood + verify verdict: PASS
- [ ] Run pnpm vitest run — full suite green
- [ ] Run pnpm tsc -p tsconfig.json --noEmit — clean
- [ ] Run peaks slice check — stages 1-6 all PASS
