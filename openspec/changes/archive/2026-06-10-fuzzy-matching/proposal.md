# Change: 2026-06-10-fuzzy-matching

## Why

LLM-driven workflows in peaks-loop currently have two specific
token-inefficient patterns:

1. **Memory recall at session start** — `.peaks/memory/index.json` holds 57+
   entries; the LLM reads the full file (or significant slices) to find the
   1–3 entries relevant to the current task.
2. **Retrospective triage** — `.peaks/retrospective/index.json` holds 88
   entries; the LLM cannot preview the catalog cheaply.

A deterministic, local, zero-token fuzzy matcher lets the LLM (and peaks
skills) invoke a CLI to retrieve top-N relevant entries from these
indexes without scanning the whole file at session start.

## What Changes

- Add `fzf` (npm, MIT, ~50 KB) as a runtime dependency.
- Add a generic fuzzy-matching kernel at
  `src/services/fuzzy-matching/` (types.ts + fuzzy-match-service.ts).
- Add two specialized loaders:
  - `src/services/memory/memory-search-service.ts` (with new
    `loadMemoryIndex` reader).
  - `src/services/retrospective/retrospective-search-service.ts` (reuses
    existing `loadRetrospectiveIndex`).
- Add two CLI subcommands:
  - `peaks memory search <query> [--kind <kind>] [--limit <n>] [--json]`.
  - `peaks retrospective search <query> [--type <type>] [--outcome <outcome>] [--limit <n>] [--json]`.
- Add 4 test layers per the spec §Testing.

## Out of Scope

- Fuzzy match on `.md` body (only `index.json` fields).
- Highlight markers, AND/OR query syntax, `--threshold` flag, tags.
- Body previews or persistent index caches.
- TUI / HTTP / web surface.
- Changes to existing `peaks retrospective index/show/migrate`.
- A new `peaks cli match` command (deferred — YAGNI).
- Touching any `SKILL.md` file.

## Dependencies

- `fzf` npm package (MIT, zero transitive deps, ~50 KB).
- Existing `loadRetrospectiveIndex(projectRoot)` from
  `src/services/retrospective/retrospective-index.ts:48` (reused unchanged).
- Existing peaks-loop result envelope, cli-helpers, and `commander` setup.

## Risks

- R1. The `fzf` npm package's score shape and `positions` type may differ
  from the spec sketch. The implementation must pin the API in code; the
  spec is updated in-place if reality diverges. The unit tests drive the
  exact score normalization formula.
- R2. `loadMemoryIndex` is a new read function; the existing
  `project-memory-service.ts` has only write paths. The new reader accepts
  whatever `.peaks/memory/index.json` actually contains on disk — not
  whatever the writer would emit.
- R3. The dev-preference.md dogfood rule requires running both new
  commands on this repo before the slice is declared complete.
- R4. Identity rule: every `git commit` for this slice uses global
  gitconfig and never adds an AI co-author trailer.

## Acceptance Criteria

> **Canonical AC list lives in the PRD**: `.peaks/_runtime/2026-06-10-session-6bcac7/prd/requests/003-2026-06-10-fuzzy-matching-implementation.md` §Acceptance criteria (A1–A12). OpenSpec AC list stays in sync with the PRD.

- A1 — fuzzy match returns ranked candidates with the top hit's score within `confidenceThreshold` (default 0.6).
- A2 — exact-match shortcuts bypass scoring for known-good inputs.
- A3 — empty / whitespace / non-string inputs return an empty result, not an error.
- A4 — score decay is monotonic in edit distance; ties broken by source-order.
- A5 — cache hit returns within 1ms (P99 over 10K calls).
- A6 — `fzf`-backed backend is selected when `fzf` is on `PATH`, otherwise the JS scoring fallback runs.
- A7 — API surface is `peaks fuzzy match <query> --candidates <list> [--threshold <n>]` (no new top-level command).
- A8 — telemetry: every call logs `query_len`, `candidates_count`, `top_score`, `mode` (`exact` / `fuzzy` / `cache`).
- A9 — no new CLI top-level; the existing `peaks *` family owns invocation.
- A10 — under-the-hood JS scoring covers Levenshtein + substring + prefix match.
- A11 — when `peaks standards doctor` runs after the change, the fuzzy-match path is reported in the L3 layer.
- A12 — the LLM does NOT install or vendor `fzf`; the LLM reads the user's `PATH` and falls back.

## Spec reference (canonical)

- `docs/superpowers/specs/2026-06-10-fuzzy-matching-design.md` — full
  design, approved 2026-06-10 (commit 127e18a).
