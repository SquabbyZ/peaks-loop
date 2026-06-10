# peaks-cli Fuzzy Matching — Design Spec

- **Date**: 2026-06-10
- **Status**: Approved (brainstorming §1–§4)
- **Owner**: peaks-rd → peaks-qa
- **Targets**: peaks-cli 1.4.x → 1.5.x

## Problem

LLM-driven workflows in peaks-cli currently have two specific token-inefficient
patterns:

1. **Memory recall at session start**: `.peaks/memory/index.json` holds 57+
   entries; the LLM has been reading the full file (or significant slices of
   it) to find the 1–3 entries relevant to the current task. That is wasted
   context for every session.

2. **Retrospective triage**: `.peaks/retrospective/index.json` holds 88
   entries; the LLM cannot preview the catalog cheaply. Slice #023 (R3) just
   collapsed the per-workflow MD tree into a single `index.json`, which makes
   the *bulk-read* cheaper but does not solve the *select-the-relevant-N*
   problem.

We need a deterministic, local, zero-token fuzzy matcher that the LLM (and
peaks skills) can invoke to retrieve top-N relevant entries from these
indexes without scanning the whole file at session start. The match is
algorithmic, not LLM-driven, so the same query always returns the same result
(deterministic) and consumes zero LLM tokens (purely local).

## Goals & Non-Goals

**Goals**

- Provide a small, well-typed TypeScript library that wraps `fzf`'s
  Smith-Waterman + position-weighting algorithm and exposes a generic
  `fuzzyMatch<T>` entry point.
- Provide two specialized loaders: `searchMemory` and
  `searchRetrospective`, each of which reads its `index.json`, filters by
  optional structured dimensions (`kind` / `type` / `outcome`), runs the
  generic matcher, and returns a typed result.
- Expose both loaders to LLM and skill consumers via `--json`-emitting CLI
  subcommands: `peaks memory search` and `peaks retrospective search`.
- Keep the design aligned with `dev-preference.md` red lines:
  - skill-first (LLM/skill is the consumer — no new TUI),
  - default-no on new CLI (justified: structured-JSON consumer,
    per criterion (2) of the dev-preference decision template),
  - dogfood on every iteration (the new commands must be exercised on
    this repo before the slice is declared complete),
  - human-only identity on commits (no AI co-author trailer).

**Non-Goals (v1)**

- Fuzzy match on the body of `.peaks/memory/*.md` or on
  `.peaks/retrospective/.../txt/handoff.md`. v1 only matches fields
  present in `index.json`.
- Highlight markers, AND/OR query syntax, threshold flags, fuzzy on tags
  (the indexes have no structured tag field — only `kind` / `type`).
- Body-level preview blobs. The `description` / `summary` field in the
  index *is* the preview; we trust it.
- A web/UI surface. TUI or HTTP is out of scope.
- A persistent index cache. `index.json` is small (~50 KB) and the matcher
  is fast (<1 ms for ~100 entries); re-reading per call is acceptable.

## Architecture

```
LLM / skill invokes via Bash:
  $ peaks memory search <query> --kind <kind> --limit 6 --json
  $ peaks retrospective search <query> --type <type> --outcome <outcome> --limit 6 --json
                          │
                          ▼
       ┌─────────────────────────────────────────────┐
       │  CLI layer                                  │
       │  - memory-commands.ts        (NEW file)    │
       │  - retrospective-commands.ts (extend)      │
       └─────────────────────────────────────────────┘
                          │
                          ▼
       ┌─────────────────────────────────────────────┐
       │  Specialized loaders                        │
       │  - memory-search-service.ts        (NEW)   │
       │  - retrospective-search-service.ts (NEW)   │
       │  - read .peaks/memory/index.json            │
       │  - read .peaks/retrospective/index.json    │
       │  - filter, build candidate texts, dispatch │
       └─────────────────────────────────────────────┘
                          │
                          ▼
       ┌─────────────────────────────────────────────┐
       │  Generic kernel                             │
       │  - fuzzy-match-service.ts           (NEW)   │
       │  - types.ts                          (NEW)  │
       │  - pure: takes (query, items, opts)         │
       │  - depends only on `fzf` npm package        │
       └─────────────────────────────────────────────┘
                          │
                          ▼
                   fzf npm package
                   (Smith-Waterman + position weighting)
```

The kernel has no `node:fs` dependency. The specialized loaders each
handle: read `index.json` → flatten to entries → apply optional structured
filters → call kernel → project kernel result into a domain-specific
result shape.

## Component Details

### `fuzzy-match-service.ts` — generic kernel

```ts
// signature
export interface FuzzyMatchOptions {
  limit?: number;             // default 6
  caseSensitive?: boolean;    // default false
}

export interface FuzzyMatchResult<T> {
  item: T;
  score: number;              // 0–1, normalized so the top of the batch is 1.0
  positions: number[];        // char indices in the searchable text that matched
}

export function fuzzyMatch<T>(
  query: string,
  items: T[],
  options: FuzzyMatchOptions & { keyFn: (item: T) => string }
): FuzzyMatchResult<T>[];

export function fuzzyMatch<T extends string>(
  query: string,
  items: T[],
  options?: FuzzyMatchOptions
): FuzzyMatchResult<T>[];   // overload: keyFn omitted when items are strings
```

The kernel takes care of:

- Calling `fzf`'s `find(query)` to obtain raw scores and positions.
- Sorting by score descending.
- Truncating to `limit` (or the caller's value).
- Normalizing scores: the highest score in the current batch becomes `1.0`;
  the rest are scaled linearly. LLM consumers can read 0.95 / 0.40 and
  reason about "probably this one" vs "weak signal".

### `memory-search-service.ts` — memory loader

```ts
export interface MemorySearchInput {
  query: string;
  projectRoot?: string;       // default: findProjectRoot(cwd) ?? cwd
  limit?: number;             // default 6
  kind?: ProjectMemoryKind;   // filter: 'feedback' | 'rule' | 'decision' | ...
}

export interface MemorySearchResult {
  name: string;
  kind: ProjectMemoryKind;
  description: string;        // copied from index.json (already a preview)
  sourcePath: string;         // absolute path to the .md file
  score: number;
  positions: number[];        // in the searchable text
}

export function searchMemory(input: MemorySearchInput): MemorySearchResult[];

// Helper: reads .peaks/memory/index.json
export function loadMemoryIndex(projectRoot: string): MemoryIndexSnapshot;
// Throws:
//   { code: 'INDEX_MISSING', ... }     if .peaks/memory/index.json absent
//   { code: 'INDEX_INVALID', ... }     if JSON is malformed
```

`searchMemory` builds the candidate set by flattening `hot[<kind>][]` and
`cold[]` arrays from the index, then for each entry sets the searchable
text to `` `${e.name} ${e.description}` ``. It does not read the .md body.

`loadMemoryIndex` is the minimum new function needed; the rest of
`project-memory-service.ts` stays unchanged.

### `retrospective-search-service.ts` — retrospective loader

```ts
export interface RetrospectiveSearchInput {
  query: string;
  projectRoot?: string;       // default: findProjectRoot(cwd) ?? cwd
  limit?: number;             // default 6
  type?: RetrospectiveType;   // 'chore' | 'refactor' | 'feat' | 'fix' | ...
  outcome?: RetrospectiveOutcome; // 'shipped' | 'in-flight' | 'abandoned'
}

export interface RetrospectiveSearchResult {
  id: string;
  sessionId: string;
  type: RetrospectiveType;
  title: string;
  summary: string;
  outcome: RetrospectiveOutcome;
  artifactPaths: string[];    // so LLM can follow up with `peaks retrospective show <id>`
  score: number;
  positions: number[];
}

export function searchRetrospective(input: RetrospectiveSearchInput): RetrospectiveSearchResult[];
```

Reuses the existing `loadRetrospectiveIndex` from
`src/services/retrospective/retrospective-index.ts:48`. Searchable text per
entry: `` `${e.title} ${e.summary}` ``.

### CLI surface

```
peaks memory search <query> [--kind <kind>] [--limit <n>] [--project <path>] [--json]
peaks retrospective search <query> [--type <type>] [--outcome <outcome>] [--limit <n>] [--project <path>] [--json]
```

Both commands emit the standard `peaks-cli` result envelope:

```json
{
  "ok": true,
  "command": "memory.search",
  "data": {
    "query": "wechat dogfood",
    "total": 6,
    "matches": [
      {
        "name": "dogfood-2026-06-02-wechat-post-sop",
        "kind": "feedback",
        "description": "Real-world dogfood of the 公众号发文 SOP ...",
        "sourcePath": "C:\\...\\.peaks\\memory\\dogfood-2026-06-02-wechat-post-sop.md",
        "score": 0.95,
        "positions": [3, 7, 11]
      }
    ],
    "warnings": []
  }
}
```

Both commands are read-only. No `--apply` flag.

### Dependencies

- `fzf` (npm, MIT, ~50 KB, zero transitive deps). Replaces nothing
  currently in the tree. No removal needed.
- `commander` (already in tree).
- `node:fs` / `node:path` (already in tree).

`fzf` is justified under `dev-preference.md` rule 1(criterion 2):
"produces a structured (JSON) response that the skill reads back to gate
a downstream decision". The CLI surface is justified under the same rule.

## Data Flow

### Memory search

1. CLI parses args: `query`, `--kind`, `--limit`, `--project`, `--json`.
2. CLI resolves `projectRoot` (explicit `--project` → `findProjectRoot(cwd)` → `cwd`).
3. `searchMemory({ query, projectRoot, kind, limit })` is called.
4. `loadMemoryIndex(projectRoot)` reads `.peaks/memory/index.json`.
   - File absent → throws `{ code: 'INDEX_MISSING' }`.
   - JSON malformed → throws `{ code: 'INDEX_INVALID' }`.
5. The `hot[<kind>][]` and `cold[]` arrays are flattened into a single
   `MemoryEntry[]` candidate list.
6. If `--kind` is set, the candidate list is filtered to that kind.
7. For each entry, `searchableText = `${e.name} ${e.description}``.
8. `fuzzyMatch(query, entries, { keyFn: e => e.searchableText, limit, caseSensitive: false })`
   is called.
9. The `MatchResult<MemoryEntry>[]` is projected to
   `MemorySearchResult[]` (drop the internal `searchableText`).
10. The result is wrapped in `ok('memory.search', { query, total, matches, warnings })`
    via the existing `cli-helpers.printResult`.

### Retrospective search

Same flow, with the following differences:

- Step 4 calls the existing `loadRetrospectiveIndex(projectRoot)`.
- Step 5 flattens `entries[]` directly.
- Step 6 applies `--type` and/or `--outcome` filters (AND between them).
- Step 7 builds `` `${e.title} ${e.summary}` ``.
- Step 10 emits `ok('retrospective.search', { ... })`.

## Error Handling

| Scenario | `ok` | `code` | Suggestions emitted to LLM |
|---|---|---|---|
| `index.json` missing | `false` | `INDEX_MISSING` | `peaks memory extract --apply` / `peaks retrospective migrate --apply` |
| `index.json` malformed | `false` | `INDEX_INVALID` | `re-run peaks memory extract --apply` to rebuild |
| `projectRoot` resolution fails | `false` | `PROJECT_ROOT_NOT_FOUND` | `peaks memory search <q> --project <path> --json` |
| `query` is empty string | `false` | `EMPTY_QUERY` | `peaks memory index` / `peaks retrospective index` to list all |
| `--kind` not in valid set | `true` | — | empty `matches`, `total: 0` (no throw; LLM degrades) |
| fzf matches 0 entries | `true` | — | `matches: []`, `total: 0` |
| `> limit` matches found | `true` | — | truncated; `total` = pre-truncation count, `matches.length` = `limit` |

All error codes use the existing `peaks-cli` envelope conventions from
`src/shared/result.ts`. Error handling lives in the loader, not the kernel.

## Testing

Four test layers, all required:

### Layer 1 — Generic kernel unit tests

`tests/unit/fuzzy-match-service.test.ts`

- exact match → top score = 1.0 (normalized)
- substring match → score > 0
- empty query → all items returned, neutral score
- empty items → `[]`
- `limit` honored
- case-insensitive default; `caseSensitive: true` opt-in
- `positions` point to correct char indices in the searchable text
- **determinism**: same `(query, items)` 10× → identical output hash
- `string[]` overload works without `keyFn`

The determinism test is the contract for the "zero-token / same-input
same-output" property the user asked for. If fzf ever drifts from
deterministic, this test fails.

### Layer 2 — Specialized loader unit tests

`tests/unit/memory-search-service.test.ts` and
`tests/unit/retrospective-search-service.test.ts`

- returns top-N sorted by score desc
- `--kind` / `--type` / `--outcome` filters exclude non-matching entries
- `--type` and `--outcome` compose with AND
- `projectRoot` resolution order: explicit > git root > cwd
- throws `INDEX_MISSING` when `index.json` absent
- throws `INDEX_INVALID` when JSON malformed
- throws `EMPTY_QUERY` when `query` is `""`
- searchable text is `name + " " + description` (memory) /
  `title + " " + summary` (retrospective)
- `sourcePath` is absolute
- memory loader handles both `hot[<kind>][]` and `cold[]` groups
- retrospective loader preserves `artifactPaths` in result

Fixtures: `tests/fixtures/memory-index-sample.json` (5 entries) and
`tests/fixtures/retrospective-index-sample.json` (8 entries).

### Layer 3 — CLI integration tests

`tests/integration/memory-search-cli.test.ts` and
`tests/integration/retrospective-search-cli.test.ts`

- `--json` outputs the `{ok, command, data, ...}` envelope
- `command` value is `"memory.search"` / `"retrospective.search"`
- non-zero exit code on `INDEX_MISSING`, `EMPTY_QUERY`, `INDEX_INVALID`
- `--kind` / `--type` / `--outcome` / `--limit` propagate to the service
- error envelope on a bad `--project` path
- happy path: write a 3-entry fixture index to a `tmpdir`, run the CLI,
  parse stdout JSON, assert match

Implementation: `child_process.spawn` the built CLI, parse stdout, use
`node:assert`.

### Layer 4 — Dogfood on this repo

Required by `dev-preference.md` ("dogfood on every adjustment"). When the
slice is declared complete, the QA report must include the actual output
of:

```bash
$ peaks memory search "wechat dogfood" --json
$ peaks retrospective search "sub-agent session" --json
```

Both should return non-empty `matches` whose top entry is plausibly the
"wechat-post-sop" memory and the "sub-agent-session-sharing" retrospective
respectively.

### Performance baseline (informational)

Iterate-time `time` of:

```bash
$ time peaks retrospective search "slice" --limit 10 --json > /dev/null
```

Expected: < 200 ms wall-time on this repo (88 entries). No hard threshold
is enforced; if it deviates significantly, the slice's PR description
records the actual number.

### Coverage targets

- `fuzzy-match-service.ts`: line ≥ 90%, branch ≥ 85%.
- `memory-search-service.ts`, `retrospective-search-service.ts`: line ≥ 85%, branch ≥ 80%.
- CLI command files: line ≥ 80% (integration tests cover happy path; unit
  tests for branches are encouraged).

These are the floors, not the only goal. Visual or behavioral smoke
checks (e.g. dogfood) carry additional signal that line counts do not.

## Migration / Compatibility

- **No breaking changes** to existing CLI commands. `peaks memory` is
  new; `peaks retrospective` gains a new subcommand under an existing
  noun.
- **No DB / state migration**. The new code reads the same `index.json`
  files that the project already maintains.
- **No change to `package.json` scripts** (`build`, `test`, `typecheck`,
  `lint`). `fzf` is added as a runtime dep; `pnpm install` regenerates
  `pnpm-lock.yaml`.

## Open Questions (none at design time)

All design questions resolved during brainstorming §1–§4.

## Cross-References

- `dev-preference.md` (project-local):
  - "skill is primary, CLI is auxiliary" → CLI here is justified per
    criterion (2) of the decision template.
  - "dogfood on every adjustment" → Layer 4 test is mandatory.
  - "commits belong to the human" → commit gate enforced at slice end.
- Slice #023 (R3 retrospective compaction): the new search consumes the
  single `index.json` introduced by R3. R3 reduced the *data shape*; this
  slice adds the *access pattern* on top.
- `src/services/retrospective/retrospective-index.ts:48`:
  `loadRetrospectiveIndex` is reused unchanged.
- `src/shared/result.ts`: envelope and error conventions are reused.
- `src/cli/cli-helpers.ts`: `printResult`, `addJsonOption`, `getErrorMessage`
  are reused.
