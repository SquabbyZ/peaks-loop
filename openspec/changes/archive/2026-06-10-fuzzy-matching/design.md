# Design: 2026-06-10-fuzzy-matching

> **Canonical design lives in the spec**: `docs/superpowers/specs/2026-06-10-fuzzy-matching-design.md`. This file is the OpenSpec-design-required pointer; the spec is the source of truth and is committed at 127e18a.

## Goal

Implement a deterministic, local, zero-token fuzzy-matching library plus
two CLI commands that let the LLM (and peaks skills) recall relevant
entries from `.peaks/memory/index.json` and
`.peaks/retrospective/index.json` on demand, with no network call, no
LLM tokens spent on the match, and byte-identical output for identical
inputs.

## Data Model

Reuses the existing peaks-cli patterns:

- `FuzzyMatchOptions` and `FuzzyMatchResult<T>` — defined in
  `src/services/fuzzy-matching/types.ts`.
- `MemorySearchInput` / `MemorySearchResult` — defined in
  `src/services/memory/memory-search-service.ts`. The `kind` filter is
  a value of the existing `ProjectMemoryKind` union.
- `RetrospectiveSearchInput` / `RetrospectiveSearchResult` — defined in
  `src/services/retrospective/retrospective-search-service.ts`. The
  `type` and `outcome` filters are values of the existing retrospective
  enums.
- The CLI emits the standard `peaks-cli` envelope: `{ok, command, data, warnings, ...}`.

## Components (per spec §Architecture)

```
LLM / skill → peaks memory search | peaks retrospective search
   ↓
src/cli/commands/memory-commands.ts        (NEW)
src/cli/commands/retrospective-commands.ts (extend)
   ↓
src/services/memory/memory-search-service.ts        (NEW)
src/services/retrospective/retrospective-search-service.ts (NEW)
   ↓
src/services/fuzzy-matching/fuzzy-match-service.ts  (NEW)
   ↓
fzf npm package
```

The kernel has no `node:fs` dependency. Loaders each handle: read
`index.json` → flatten to entries → apply optional structured filters →
call kernel → project kernel result into a domain-specific shape.

## API Contract (per spec §Component Details)

```ts
// generic kernel
export function fuzzyMatch<T extends string>(
  query: string, items: T[], options?: FuzzyMatchOptions
): FuzzyMatchResult<T>[];

export function fuzzyMatch<T>(
  query: string, items: T[],
  options: FuzzyMatchOptions & { keyFn: (item: T) => string }
): FuzzyMatchResult<T>[];

// memory loader
export function searchMemory(input: MemorySearchInput): MemorySearchResult[];
export function loadMemoryIndex(projectRoot: string): MemoryIndexSnapshot;

// retrospective loader
export function searchRetrospective(input: RetrospectiveSearchInput): RetrospectiveSearchResult[];
```

## Data Flow (per spec §Data Flow)

For both search commands:

1. CLI parses args (`query`, filters, `--limit`, `--project`, `--json`).
2. Resolves `projectRoot` (explicit → git root → cwd).
3. Loader reads `index.json`. Throws `INDEX_MISSING` on absent / `INDEX_INVALID` on malformed.
4. Flattens to a single `Entry[]` candidate list.
5. Applies optional structured filters (`kind` / `type` / `outcome`).
6. For each entry, builds `searchableText = name+description` (memory) or `title+summary` (retrospective).
7. Calls `fuzzyMatch(query, entries, { keyFn, limit: 6, caseSensitive: false })`.
8. Projects `MatchResult<Entry>[]` to the domain result shape.
9. Wraps in `ok('memory.search' | 'retrospective.search', { query, total, matches, warnings })`.

## Error Handling (per spec §Error Handling)

| Scenario | code | Notes |
|---|---|---|
| `index.json` missing | `INDEX_MISSING` | suggestion: extract / migrate |
| `index.json` malformed | `INDEX_INVALID` | suggestion: rebuild |
| projectRoot fails | `PROJECT_ROOT_NOT_FOUND` | suggestion: --project |
| empty query | `EMPTY_QUERY` | suggestion: list-all command |
| invalid kind/type | — | empty matches, ok:true |
| 0 hits | — | empty matches, ok:true |
| hits > limit | — | truncated; `total` = pre-truncation count |

## Testing (per spec §Testing)

4 layers, all required:

1. `tests/unit/fuzzy-match-service.test.ts` — kernel semantics + **determinism contract**.
2. `tests/unit/memory-search-service.test.ts` and
   `tests/unit/retrospective-search-service.test.ts` — loaders + filters
   + error codes. With `tests/fixtures/*.json` fixtures.
3. `tests/integration/*-cli.test.ts` — end-to-end CLI envelope via
   in-process `child_process.spawn`.
4. **Dogfood on this repo** — both `peaks memory search` and
   `peaks retrospective search` exercised on the current
   `.peaks/memory/index.json` and `.peaks/retrospective/index.json`. Raw
   stdout captured in the QA report per dev-preference rule.

## Dependencies

- `fzf` (npm, MIT, ~50 KB, zero transitive deps).
- `commander` (already in tree).
- `node:fs` / `node:path` (already in tree).
- Existing `peaks-cli` envelope, `cli-helpers`, and `loadRetrospectiveIndex`.

## Migration / Compatibility

- No breaking changes to existing CLI commands.
- No DB / state migration.
- No change to `package.json` scripts.

## Out-of-scope (explicit)

See proposal.md §Out of Scope.
