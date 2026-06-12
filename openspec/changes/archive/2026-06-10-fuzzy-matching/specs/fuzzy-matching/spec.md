# Spec: fuzzy-matching

> **Canonical spec lives in** `docs/superpowers/specs/2026-06-10-fuzzy-matching-design.md`. This file is the OpenSpec-spec-required pointer; the spec is the source of truth.

## Purpose

Provide peaks-cli with a deterministic, local, zero-token fuzzy matcher
that the LLM (and peaks skills) can invoke to retrieve top-N relevant
entries from `.peaks/memory/index.json` and
`.peaks/retrospective/index.json` on demand, instead of bulk-reading the
indexes at session start.

## Requirements

### R-MEM-SEARCH

The `peaks memory search` command SHALL:

- Accept `<query>` (required, non-empty) and optional `--kind` filter
  from the existing `ProjectMemoryKind` union.
- Read `.peaks/memory/index.json` from the resolved project root
  (explicit `--project` → `findProjectRoot(cwd)` → `cwd`).
- Match query against the searchable text `name + " " + description`
  of each entry.
- Return at most `--limit` (default 6) entries sorted by score
  descending; the JSON envelope is `{ok, command, data: { query,
  total, matches, warnings }}`.
- Emit `INDEX_MISSING` when the index is absent; `EMPTY_QUERY` when
  the query is empty string; `INDEX_INVALID` when the JSON is
  malformed.
- Determinism: identical input must produce byte-identical output
  across runs.

### R-RETRO-SEARCH

The `peaks retrospective search` command SHALL:

- Accept `<query>` (required, non-empty) and optional `--type` and
  `--outcome` filters (the existing retrospective enums).
- Reuse `loadRetrospectiveIndex(projectRoot)` from
  `src/services/retrospective/retrospective-index.ts:48`.
- Match query against `title + " " + summary` of each entry.
- Same envelope, limit, and error contract as R-MEM-SEARCH.
- `--type` and `--outcome` compose with AND.

### R-FUZZY-KERNEL

The `src/services/fuzzy-matching/` module SHALL:

- Export `fuzzyMatch(query, items, options?)` and an overload
  `fuzzyMatch(query, items, { keyFn, ...options })` per spec
  §Component Details.
- Normalize fzf's score such that the top match in the current batch
  is 1.0 and all others are in [0, 1].
- Return `{ item, score, positions }[]` for each match.
- Depend only on the `fzf` npm package — no `node:fs`.

### R-DEPENDENCY

`package.json` SHALL include `"fzf"` as a runtime dependency. MIT
licensed, zero transitive deps.

### R-TESTS

The slice SHALL include 4 test layers per the spec:

1. `tests/unit/fuzzy-match-service.test.ts` — kernel semantics +
   determinism contract.
2. `tests/unit/memory-search-service.test.ts` and
   `tests/unit/retrospective-search-service.test.ts` — loaders +
   filters + error codes.
3. `tests/integration/*-cli.test.ts` — end-to-end CLI envelope.
4. **Dogfood on this repo** — both commands exercised on the current
   `.peaks/memory/index.json` and `.peaks/retrospective/index.json`.

The existing vitest baseline (20-fail / 151-pass / 2-skip) MUST NOT
regress.

### R-IDENTITY

All commits SHALL use the user's global gitconfig identity and SHALL
NOT include any AI co-author trailer.
