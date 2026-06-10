# Tasks: 2026-06-10-fuzzy-matching

> Execute with TDD. Every implementation step that adds behavior starts with a failing test. Do not implement until the spec is approved (it is — see `docs/superpowers/specs/2026-06-10-fuzzy-matching-design.md`).

## 1. Add fzf dependency

- [ ] Add `fzf` to `package.json` runtime deps.
- [ ] Run `pnpm install`; verify lockfile regenerates cleanly.
- [ ] Commit (no AI trailer, global identity).

## 2. Generic kernel — types + service + tests

- [ ] Add `tests/unit/fuzzy-match-service.test.ts` with the full
  Layer 1 test list from the spec (exact match → top score = 1.0;
  substring match → score > 0; empty query → all items, neutral
  score; empty items → []; limit honored; case-insensitive default;
  `positions` correct; **determinism: 10× same input → identical output
  hash**; `string[]` overload without `keyFn`).
- [ ] Create `src/services/fuzzy-matching/types.ts` with
  `FuzzyMatchOptions` and `FuzzyMatchResult<T>` per spec.
- [ ] Create `src/services/fuzzy-matching/fuzzy-match-service.ts` with
  `fuzzyMatch` (string[] overload) and `fuzzyMatchWithKey` (keyFn
  overload) per spec. Implementation wraps `fzf` and normalizes scores
  to 0–1 with top = 1.0.
- [ ] Run vitest for this file → all green.
- [ ] Commit.

## 3. Memory loader + tests + fixture

- [ ] Add `tests/fixtures/memory-index-sample.json` (5 entries, mix of
  `hot.feedback`, `hot.rule`, `cold`).
- [ ] Add `tests/unit/memory-search-service.test.ts` with the full
  Layer 2 list: top-N sorted by score desc; `--kind` filter;
  `projectRoot` resolution; INDEX_MISSING; INDEX_INVALID; EMPTY_QUERY;
  searchable text = name + " " + description; absolute `sourcePath`;
  `hot[]+cold[]` flat; invalid kind → empty matches.
- [ ] Create `src/services/memory/memory-search-service.ts` with
  `loadMemoryIndex(projectRoot)` and `searchMemory(input)`. The
  `loadMemoryIndex` reader parses `.peaks/memory/index.json` exactly
  as it exists on disk (the on-disk shape from
  `.peaks/memory/index.json` is canonical — not whatever the writer
  in `project-memory-service.ts` would emit).
- [ ] Run vitest → all green.
- [ ] Commit.

## 4. Retrospective loader + tests + fixture

- [ ] Add `tests/fixtures/retrospective-index-sample.json` (8 entries,
  mix of types and outcomes).
- [ ] Add `tests/unit/retrospective-search-service.test.ts` with the
  full Layer 2 list: top-N sorted by score desc; `--type` filter;
  `--outcome` filter; `--type + --outcome` AND; INDEX_MISSING;
  EMPTY_QUERY; searchable text = title + " " + summary;
  `artifactPaths` preserved in result.
- [ ] Create `src/services/retrospective/retrospective-search-service.ts`
  with `searchRetrospective(input)`. Reuses existing
  `loadRetrospectiveIndex` from
  `src/services/retrospective/retrospective-index.ts:48`.
- [ ] Run vitest → all green.
- [ ] Commit.

## 5. Memory CLI command

- [ ] Add `tests/integration/memory-search-cli.test.ts` (Layer 3
  scaffolding — run after unit tests pass).
- [ ] Create `src/cli/commands/memory-commands.ts` with
  `registerMemoryCommands(program, io)`. Implements
  `peaks memory search <query> [--kind <kind>] [--limit <n>] [--project <path>] [--json]`.
- [ ] Register `registerMemoryCommands(program, io)` in
  `src/cli/program.ts`.
- [ ] Run vitest (in-process CLI spawn) → all green.
- [ ] Commit.

## 6. Retrospective CLI subcommand

- [ ] Add `tests/integration/retrospective-search-cli.test.ts` (Layer 3).
- [ ] Extend `src/cli/commands/retrospective-commands.ts` with
  `peaks retrospective search <query> [--type <type>] [--outcome <outcome>] [--limit <n>] [--project <path>] [--json]`.
- [ ] Run vitest → all green.
- [ ] Commit.

## 7. Integration tests + dogfood

- [ ] Run the full Layer 3 integration suite → all green.
- [ ] **Dogfood on this repo (mandatory)**:
  - `peaks memory search "wechat dogfood" --json` → must surface the
    wechat-post-sop entry.
  - `peaks retrospective search "sub-agent" --json` → must surface
    the sub-agent-session-sharing entries.
- [ ] Capture raw stdout in
  `.peaks/_runtime/<sessionId>/qa/test-execution.md` (for the QA
  report per dev-preference).
- [ ] Commit any final test-only adjustments.

## 8. Gates and handoff

- [ ] `pnpm typecheck` green.
- [ ] `pnpm vitest run` baseline (20-fail / 151-pass / 2-skip)
  unchanged + new tests green.
- [ ] `peaks request lint --role rd 2026-06-10-fuzzy-matching-implementation --project . --json` (no unfilled placeholders).
- [ ] `peaks scan diff-vs-scope --rid 2026-06-10-fuzzy-matching-implementation --project .` (Gate B8).
- [ ] Hand off to peaks-qa.
