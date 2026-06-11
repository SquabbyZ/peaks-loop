# Tasks

## Service scaffold + TDD red

- [ ] Create src/services/standards/migrate-claude-rules-service.ts (skeleton + types)
- [ ] Create tests/unit/services/standards/migrate-claude-rules-service.test.ts with vitest fixtures (empty / thick / no .peaks/standards/ / readonly / idempotent re-run)
- [ ] Run pnpm vitest run — confirm RED (tests fail because no implementation yet)

## Service implementation (TDD green)

- [ ] Implement backupCluadeRulesTree() — copies .claude/rules/ to .peaks-2.0-backup-<ts>/
- [ ] Implement replaceWithPointer() — writes 2-line pointer to each .md file
- [ ] Implement scaffoldPeaksStandards() — creates .peaks/standards/{common,typescript}/ with the 2.0 canonical rules
- [ ] Implement migrateClaudeRules(projectRoot, options) — orchestrates the 3 steps above
- [ ] Run pnpm vitest run — confirm GREEN

## Wire CLI

- [ ] Update src/cli/commands/standards-commands.ts to call the new service as part of `standards migrate --from-claude-rules`
- [ ] Add --write-to .peaks/standards/ flag to `peaks standards init` / `peaks standards update`
- [ ] Add `peaks standards ls` / `peaks standards cat <name>` subcommands for inspection

## Integration test + dogfood

- [ ] Extend tests/integration/standards/ (or create) with an end-to-end test that runs `peaks standards migrate --from-claude-rules --apply` in a temp project with 1.x fixtures
- [ ] Write scripts/dogfood-standards-migrate-2x.mjs that scaffolds a 1.x temp project + thick .claude/rules/, runs the migration, and reports the post-migration tree shape
- [ ] Run dogfood + capture report to .peaks/_runtime/<sid>/rd/standards-migrate-2x-dogfood.md

## Validation gates

- [ ] Run pnpm vitest run — full suite green
- [ ] Run pnpm tsc -p tsconfig.json --noEmit — clean
- [ ] Run peaks slice check — stages 1-6 all PASS
- [ ] Capture dogfood report path in QA validation report
