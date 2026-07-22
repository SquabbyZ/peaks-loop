# peaks-code Memory Preflight — Design Spec

- **Date**: 2026-07-22
- **Status**: Brainstorming approved (1–4); awaiting spec review before
  implementation plan is written.
- **Owner**: peaks-rd → peaks-qa → peaks-code (orchestrator hook)
- **Targets**: peaks-loop 4.x → 4.1.0 (shipped as part of the next
  minor release once writing-plans breaks it down)
- **Related**:
  - `.peaks/memory/peaks-release-4-0-2-published.md` —
    the bug behind the v4.0.x pre-publish accidents that motivated
    this enhancement (LLM dispatching into a *publish* task had
    no in-context reminder about the prior 4.0.0 / 4.0.2 accidents
    and re-derived the same trap).
  - `.peaks/memory/peaks-unpublish-4-0-0-and-4-0-2-stuck.md` — the
    second part of the same lesson (npm OIDC cannot unpublish;
    the operator MUST use the npmjs.com web UI).
  - `.peaks/memory/peaks-cli-version-shared-chicken-egg.md` —
    the third installment (peaks-loop<new> pins peaks-loop-shared<old>
    when publishing too fast; bumps must be in lockstep).
  - `src/cli/commands/core/memory-command.ts` — the existing
    `peaks memory search` CLI that this design reuses via internal
    child-process invocation.
  - `src/services/context/headroom-client.ts` — the headroom-ai
    helper that this design consumes for hard cap enforcement.

## Problem

The 2026-07-22 v4.0.0 / 4.0.2 publish accident series exposed a
recurring class of bug in peaks-loop:

1. peaks-loop is a long-running project; over time, the
   orchestrator-side LLM accumulates important "I've been here
   before" knowledge in `.peaks/memory/*.md` (currently 15 hot
   feedback items including the three accidents above).
2. When a future session opens and the operator (or another LLM)
   asks peaks-code to dispatch a sub-agent for a *publish*-class
   task, **the sub-agent has no automatic way to recall the
   previously-recorded accidents**. The memory exists on disk but
   does not bleed into the sub-agent's system prompt.
3. As a direct result, peaks-loop would re-walk traps that were
   already diagnosed and recorded. The same trap was walked three
   times in one session (the v4.0.0-beta.21 → 4.0.2 → 4.0.0
   sequence).

The peaks-loop operator (SquabbyZ) confirmed during brainstorming
that the fix path is **not "expand memory scope with new tools
(graphify, etc.)"** but **"make existing memory actually reach the
sub-agent"**. peaks-loop already ships `peaks memory search
--compress-results` (using `headroom-ai`) and `peaks project
context` reads the index; the missing piece is **a hook in
peaks-code's sub-agent dispatch path** that pulls the relevant
memory and injects it into the system prompt before the sub-agent
sees its task brief.

## Goal

Make the existing `.peaks/memory/index.json`+ headroom-ai
combination **discoverable to sub-agents by default**, with:

- low stable token cost (~200 token baseline + on-demand),
- high precision (only the `feedback / layer A` corpus — the
  "I was here before" lessons — gets injected by default),
- sub-agent can pull full memory content on demand via the
  existing `peaks memory search` CLI,
- zero new npm dependencies (peaks-loop already depends on
  `headroom-ai@0.22.4`),
- hard token ceiling to guarantee context-window safety,
- per-session cache to make repeated dispatch nearly free,
- silent degradation when memory index is missing.

## Non-goals

- No graphify / knowledge-graph integration (`graphify` is a
  Python package with `uv` precondition — incompatible with the
  npm-native peaks-loop distribution; the right tool for the user's
  stated pain is the existing memory + headroom-ai).
- No codegraph integration — `peaks codegraph <sub>` already
  exists and serves the **code-only** indexing surface; memory
  preflight is the **abstract / post-mortem** surface. They are
  orthogonal; combining them would be over-engineering for the
  actual pain point.
- No new top-level CLI command — the integration is internal to
  peaks-code orchestrator; the user-facing surface stays
  unchanged.
- No memory write path — this design is **read-only** with
  respect to memory. New memories still arrive via the existing
  extract / promote pipeline.

## Architecture

```
[operator triggers peaks-code orchestrator]
       │
       ▼
┌─────────────────────────────────────────────────────────────────────┐
│ peaks-code orchestrator (src/services/context/orchestrator.ts)        │
│                                                                       │
│   dispatchSubAgent(taskTitle, taskBody, options)                     │
│       │                                                               │
│       ├─ calls MemoryPreflightService.fetchBlock(taskTitle)           │
│       │       │                                                       │
│       │       ▼                                                       │
│       │   - Reads .peaks/memory/index.json (cached AT START of session)│
│       │   - Selects entries where kind=feedback AND layer contains 'A'│
│       │   - Builds a compact name + path list block (~200 token)     │
│       │   - Reads cached memo contents from `~/.peaks/cache/...`      │
│       │     (if sub-agent asked for them via peaks memory search)    │
│       │   - Trims block to memoryPreflight.maxTokens (default 1.2k)  │
│       │                                                               │
│       ├─ prepends memory block to sub-agent's system prompt          │
│       │   under header:                                              │
│       │   `## Project memory relevant to this task`                  │
│       │                                                               │
│       └─ invokes sub-agent with augmented prompt                      │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
       │
       ▼
[sub-agent LLM] sees augmented system prompt:
  - ## Project memory relevant to this task:
    - * peaks-release-4-0-2-published
        Path: /C:/Users/smallMark/.../.peaks/memory/peaks-release-4-0-2-published.md
        One-line: tag vX.Y.Z → bumped 4.0.2 by mistake, lessons learned
    - * peaks-cli-version-shared-chicken-egg
        ...
  - ## Task:
    {original task brief}
       │
       ▼
  sub-agent may also invoke `peaks memory search "<keyword>"` on its
  own to fetch full content of any path listed above; the result
  is cached so subsequent dispatches in this session reuse it.
```

### Component map

| Component                          | File                                          | Status |
|------------------------------------|-----------------------------------------------|--------|
| MemoryPreflightService (new)       | `src/services/context/memory-preflight-service.ts` | new |
| Orchestrator dispatch hook (new)   | `src/services/context/orchestrator.ts` (modify)   | modify |
| Cache (new)                        | `src/services/context/memory-cache.ts`             | new |
| Headroom hard cap (existing)        | `src/services/context/headroom-client.ts`          | reuse  |
| Memory search CLI (existing)       | `src/cli/commands/core/memory-command.ts`          | reuse  |
| Memory index reader (existing)      | `src/services/memory/memory-search-service.ts`    | reuse  |

### Data flow (per sub-agent dispatch)

1. Orchestrator receives a `dispatchSubAgent(taskTitle, taskBody)`
   call. (Step 0 in the orchestrator's existing pipeline.)
2. Orchestrator calls
   `MemoryPreflightService.fetchBlock({taskTitle})`. The service:
   a. **Warm cache on miss**: opens `.peaks/memory/index.json`
      once per session (file mtime tracked) and caches the
      parsed entries in memory. Subsequent calls reuse the
      parsed index.
   b. **Filters entries**: select only entries where
      `entry.kind === 'feedback'` AND `entry.layer === 'A'`
      (matching the description frontmatter
      `<!-- peaks-feedback-promoted: layer=A -->`).
      This is the **only way** sub-agent dispatch fetches
      memory automatically.
   c. **Renders a list block**: emits a 2-line block per entry
      (name + path + 1-line summary from `description`), capped
      at the `memoryPreflight.listCap` (default 12 entries).
   d. **Reads the cache for full contents** that the sub-agent
      has already requested via `peaks memory search` (per-session
      LRU keyed by memo path).
   e. **Composes the final block** in the order:
      `name + path + summary` (for each `feedback/A` entry) →
      `\n## Requested memory details:\n<cached full text>`
      (for any entry the sub-agent has explicitly queried since
      session start).
   f. **Applies the hard token cap** via `headroom-ai`:
      caps the entire block to `memoryPreflight.maxTokens`
      (default 1.2k). The cap is the LAST step; if it kicks in,
      we drop the bottom-most entries first (least-recently-
      accessed by sub-agent) and log a warning.
   g. Returns either the block, or a sentinel object
      `{ available: false, reason: <string> }` if no memory
      index exists or the file is unparseable.
3. Orchestrator prepends the block (or skips silently if the
   sentinel came back) to the sub-agent's system prompt.
4. Sub-agent sees its task brief. If it wants full content
   for a specific memo, it invokes
   `peaks memory search "<its understanding of the relevant
   keyword>"` via the existing peak loop CLI. The result is
   fed to it by the dispatcher's child-process runner (existing
   mechanism) AND cached by `MemoryPreflightService` for
   subsequent dispatches in the same session.

## Configuration

The defaults are picked so that **no operator action is required**
for the feature to be useful. All knobs live in
`.peaks/preferences.json` under the `memoryPreflight` key:

```jsonc
{
  "memoryPreflight": {
    // master switch; default true. false = silent skip (legacy behavior).
    "enabled": true,

    // hard ceiling on the memory block size (post headroom-ai).
    // Sub-agent dispatch refuses to embed more than this many tokens
    // into the system prompt from this source.
    "maxTokens": 1200,

    // maximum number of `feedback/A` entries to enumerate in the
    // default name + path list block. 12 is plenty for peaks-loop's
    // current 15-entry hot layer; trimmed if memory grows.
    "listCap": 12,

    // hard ceiling on cached full content (post headroom-ai) per
    // memo path before LRU eviction. Defaults are conservative.
    "contentCacheBytes": 6000
  }
}
```

If `.peaks/preferences.json` doesn't define these keys, the
defaults above apply. Operators can override per-project in
`./.peaks/preferences.json`.

## Component details

### MemoryPreflightService

Public surface:

```typescript
type MemoryPreflightResult = {
  available: boolean;
  block?: string;                  // markdown-wrapped, token-bounded
  feedbackListItems?: number;      // how many feedback/A entries were rendered
  cachedItemCount?: number;         // how many were re-served from cache
  reason?: string;                 // populated if available=false
  truncated?: boolean;              // true if headroom-ai had to drop entries
  droppedCount?: number;            // how many entries were dropped due to cap
};

export interface IMemoryPreflightService {
  /**
   * @param taskTitle - the canonical task title used as the primary
   *  search-key candidates (e.g. "publish peaks-loop@4.0.1").
   * @returns either a memory block to be prepended to a sub-agent
   *  system prompt, or {available:false,reason:...} on miss.
   */
  fetchBlock(taskTitle: string): Promise<MemoryPreflightResult>;

  /**
   * Cache a memo path's full content for future dispatches in the
   * same session. Invoked by the dispatcher's child-process runner
   * when a sub-agent invokes `peaks memory search "<q>"`.
   */
  cacheMemoContent(path: string, content: string): void;

  /** Disk-based session cache for memo contents. */
  persistCache(directory: string): Promise<void>;
  loadCache(directory: string): Promise<void>;
}
```

Production implementation in
`src/services/context/memory-preflight-service.ts`.

### Caching strategy

Two layers:

1. **In-memory caches** (per process / per orchestrator invocation):
   - parsed `index.json` entries keyed by entry name (one-time
     cost per session);
   - per-path full content of memos that the sub-agent has
     requested, LRU capped at `contentCacheBytes` total.
2. **Disk-based cache** (optional):
   - The orchestrator writes the LRU cache to
     `.peaks/_runtime/<sid>/cache/memo-paths/<hash>.md` on
     subprocess exit; reload on next session start.
   - This is **optional**; the in-memory layer alone provides
     the "cache within one session" guarantee.

The cache key for memo content is the SHA-256 of the canonical
absolute path of the `.peaks/memory/*.md` file. (The `description`
frontmatter is intentionally not part of the key — promotion of
a memory file from `feedback/B` to `feedback/A` does NOT
invalidate the cached body.)

## Error handling & silent degradation

The service MUST NOT raise exceptions to the orchestrator. Any
failure maps to `MemoryPreflightResult {available: false, reason:
<string>}`:

| Failure                                  | behavior                                        |
|------------------------------------------|-------------------------------------------------|
| `.peaks/memory/index.json` missing        | `available=false reason="MEMORY_INDEX_MISSING"` |
| `.peaks/memory/index.json` unparseable    | `available=false reason="MEMORY_INDEX_INVALID"` |
| `feedback/A` filter returns 0 entries      | `available=false reason="NO_FEEDBACK_LAYER_A"` |
| headroom-ai throws (timeout / Network)    | log warning; recurse to unescaped block, drop cap   |
| cap truncation required                   | `truncated=true droppedCount=N`, log info        |

The orchestrator ignores the `available=false` verdict silently
(the sub-agent just sees a tighter system prompt — equivalent
to today's behavior). All other fields are logged for
debugging but never returned to the user.

## Testing

Four cases minimum (under
`tests/unit/services/context/memory-preflight-service.test.ts`):

1. **happy path**: a fake `.peaks/memory/index.json` with 5
   `feedback/A` entries + 2 `feedback/B` + 3 `project`
   entries; preflight block returned → only the 5 entries
   appear in the list block; headroom-ai path is exercised with
   a tiny mock that records inputs.
2. **silent skip on no index**: missing `.peaks/memory/index.json`
   → `available=false reason="MEMORY_INDEX_MISSING"`.
3. **silent skip on no `feedback/A`**: index exists with only
   `feedback/B` and `project` entries → `available=false
   reason="NO_FEEDBACK_LAYER_A"`.
4. **hard cap fires**: 20 `feedback/A` entries + `maxTokens=200`
   → block returned with `truncated=true droppedCount>=N`;
   headroom-ai mock observes a truncation request.
5. **content cache round-trip**: stub dispatcher invokes
   `peaks memory search "phrase"`, the preflight caches the
   response, a second dispatch with the same phrase returns
   the cached body without invoking peaks memory search
   again.

Plus **one orchestrator integration test**:

6. **dispatch wiring**: a fake sub-agent receives a `dispatch`
   invocation; we assert that its system prompt payload
   contains the prefixed `## Project memory relevant to this
   task` block before the task brief.

## Acceptance criteria

- Sub-agent system prompts dispatched via peaks-code
  orchestrator automatically include a `## Project memory
  relevant to this task` block when `.peaks/memory/index.json`
  exists with at least one `feedback/A` entry.
- Total memory block size is always ≤ `memoryPreflight.maxTokens`
  post headroom-ai compression.
- Sub-agent that wants full memo content invokes
  `peaks memory search "<query>"`; first call costs the full
  content size, subsequent identical-query calls in the same
  session reuse cached content.
- If `.peaks/memory/index.json` is missing, the orchestrator's
  behavior is byte-identical to today's behavior (no error,
  no log, no prompt change).
- No new npm dependency introduced.
- No new top-level CLI command introduced; existing
  `peaks memory search` remains the user-facing way to query
  memory.

## Risks & open questions

- **First-dispatch latency**: warming the cache parses
  `.peaks/memory/index.json` (~10–20 KB). Negligible per
  dispatch. Acceptable.
- **LLM adds new entries**: when a sub-agent promotes a new
  memory file (via the existing extract / promote pipeline),
  the cache must invalidate to surface it. Mitigation: cache
  the index's mtime + parsed entries together; an mtime change
  triggers re-parse.
- **Existing dispatcher's child-process runner** already
  invokes CLI commands; this design reuses that path without
  introducing a new IPC channel.
- **`.peaks/memory/` is platform-specific to peaks-loop**:
  this design assumes `.peaks/preferences.json` is the source
  of operator preferences (existing convention). We do NOT
  introduce a global-config fallback in this slice.

## Done

- Concrete `IMemoryPreflightService` interface above.
- Configuration key path `.peaks/preferences.json::memoryPreflight`
  decided.
- Existing dependencies (`headroom-ai`, `peaks memory search`)
  confirmed sufficient.
- Operating mode: silent degradation on any failure, hard cap
  enforced via headroom-ai, per-session cache reduces repeated
  cost.
