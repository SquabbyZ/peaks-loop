# Change: 2026-06-12-standards-migrate-claude-rules

## Why

The 1.x peaks-loop install copied a thick `.claude/rules/**/*.md` tree (skill-first / CLI-auxiliary / dogfood / commit-trailer rules) into consumer projects. In 2.0, the canonical rules should live in `.peaks/standards/` (project-local) — the install should write the 2.0 vocabulary there and replace `.claude/rules/**/*.md` with a 2-line pointer. The `peaks standards migrate --from-claude-rules` CLI already handles the CLAUDE.md legacy heartbeat block (in-place rewrite via `migrate-service.ts`) but has NO path for `.claude/rules/`. The umbrella `peaks upgrade --to 2.0` (Slice 1) calls `standards-migrate` as one of its 6 sub-steps; that sub-step currently no-ops on the .claude/rules/ tree. After Slice 1's TDD coverage, this is the second-largest gap in the 1.x → 2.0 closeout.

## What Changes

- New `src/services/standards/migrate-claude-rules-service.ts` that, given a project root, (a) backs up the existing `.claude/rules/` tree to `.claude/rules/.peaks-2.0-backup-<ts>/` (git-ignored at runtime, included in commit for forensic purposes), (b) replaces each `.claude/rules/**/*.md` file with a 2-line pointer to the 2.0 canonical rules at `.peaks/standards/`.
- New `peaks standards init` / `peaks standards update` mode `--write-to .peaks/standards/` (default true) that scaffolds the 2.0 canonical rules into `<project>/.peaks/standards/{common,typescript}/`. The 2.0 content is the 1.x dev-preference ruleset (skill-first / CLI-auxiliary / dogfood / commit-trailer), re-rendered with the 2.0 vocabulary and without the legacy 1.x-vintage references.
- Wire `peaks standards migrate --from-claude-rules` to also call the new `migrate-claude-rules-service` as part of the same `--apply` pass. After this slice, `peaks upgrade --to 2.0`'s `standards-migrate` sub-step covers BOTH the CLAUDE.md heartbeat block AND the .claude/rules/ thinning.
- The `.peaks/standards/` directory becomes the canonical 2.0 path. The `peaks standards init` CLI gains a `ls` / `cat` subcommand to inspect the canonical rules.
- TDD test coverage for the new service in `tests/unit/services/standards/migrate-claude-rules-service.test.ts` — fixtures cover: empty .claude/rules/, thick 1.x tree, no .peaks/standards/, no backup possible (readonly), idempotent re-run.
- Extend `tests/integration/standards/migrate-from-claude-rules.test.ts` (or create if missing) with an end-to-end test that runs the standards-migrate CLI in a temp project with 1.x fixtures and asserts the .peaks/standards/ tree is created and the .claude/rules/ tree is thinned.

## Out of Scope

- Re-authoring the content of the 2.0 canonical rules — the 1.x rules are already correct in spirit; this slice just relocates them. A separate 'update 2.0 rule content' slice may follow.
- The `peaks skills` family bodies (peaks-solo, peaks-rd, peaks-qa, etc.) — Slice 3 is about adding Step 0.55 to peaks-solo, not editing other skill bodies.
- The umbrella `peaks upgrade --to 2.0` — Slice 1 already shipped and committed. Slice 2 only changes the `standards-migrate` sub-step's behavior; the umbrella's CLI surface is unchanged.
- `peaks standards migrate` for the umbrella upgrade — the umbrella auto-runs the new service after Slice 2 lands; the umbrella code itself is unchanged.

## Dependencies

- `src/services/standards/migrate-service.ts` (already ships, handles CLAUDE.md heartbeat block)
- `src/services/standards/ide-aware-standards-service.ts` (handles per-IDE rules initialization)
- `src/cli/commands/standards-commands.ts` (CLI surface, needs the new --write-to flag and the wired-up migrate path)

## Risks

- The 2.0 canonical rules content needs to be carefully derived from the 1.x dev-preference.md — risk of unintentional content drift. Mitigation: start with a verbatim copy of the 1.x rules, then apply the 2.0 vocabulary renames (1.x `~/.peaks/config.json` → 2.0 `.peaks/preferences.json`, etc.) in a follow-up content slice.
- Backing up the existing `.claude/rules/` to a hidden directory may surprise users with 1.x-installed rules. Mitigation: clear documentation in the umbrella's nextActions output, and the backup directory is git-ignored so it does not leak.
- If `.peaks/standards/` already exists (e.g. from a previous `peaks standards init` run), the migrate service must not overwrite. Mitigation: the service detects existing content and merges (preserves 2.0 content, never overwrites).

## Acceptance Criteria

- `pnpm vitest run tests/unit/services/standards/migrate-claude-rules-service.test.ts` passes with ≥5 cases (empty / thick / no .peaks/standards/ / readonly / idempotent re-run).
- `pnpm vitest run tests/integration/standards/` passes with the new end-to-end test.
- `peaks standards init --project . --apply --json` creates `<project>/.peaks/standards/{common,typescript}/dev-preference.md` (and friends) with the 2.0 vocabulary.
- `peaks standards migrate --from-claude-rules --project . --apply --json` on a 1.x fixture produces: (a) backup at `.claude/rules/.peaks-2.0-backup-<ts>/`, (b) `.claude/rules/**/*.md` replaced with a 2-line pointer, (c) `.peaks/standards/` populated.
- Dry-run (`--dry-run` or no `--apply`) shows the would-change diff without writing.
- Full `pnpm vitest run` is green (no regressions).
- `pnpm tsc -p tsconfig.json --noEmit` is clean.
- `peaks slice check` for the slice passes stages 1-6.
- Dogfood: a script that scaffolds a 1.x project with thick `.claude/rules/`, runs `peaks standards migrate --from-claude-rules --apply`, and reports the post-migration tree shape (verdict PASS).
