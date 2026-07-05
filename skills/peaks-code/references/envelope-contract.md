# Envelope contract — `peaks` CLI JSON envelope versioning

> **Slice**: 2026-06-23-audit-4th #E1. Bump on any future breaking change.

## Versioning policy

Every `peaks` CLI action that returns a JSON envelope stamps
`data.envelopeVersion` on the success path. The version is a
semver-style string (`MAJOR.MINOR.PATCH`).

- **MAJOR** — breaking change (field removed, field renamed,
  type tightened). Consumers should refuse to operate on an
  envelope whose MAJOR version is greater than their pinned version.
- **MINOR** — additive change (new optional field, new union
  member). Consumers may ignore unknown fields; old consumers
  continue to work.
- **PATCH** — no observable contract change (comment fix, internal
  refactor that surfaces through serialization).

## Current version

**`2.1.0`** — slice 2026-06-23-audit-4th introduced the marker.
The only breaking change since `2.0.0` is the removal of
`data.prompt` from `sub-agent.dispatch` (slice
2026-06-23-audit-3rd #4).

## Per-command shape

### `sub-agent.dispatch` (single)

Top-level fields (post-2.1.0):

- `envelopeVersion: '2.1.0'`
- `role: string` — sub-agent role string
- `ide: string` — detected IDE label (`claude-code` etc.)
- `originalPromptSize: number` — bytes of the un-compressed prompt
- `promptSize: number` — bytes after headroom compression (or
  equal to `originalPromptSize` when `--use-headroom` is off or
  unavailable)
- `toolCall: { name: string; args: Record<string, unknown> }` —
  the per-IDE tool-call descriptor the LLM must execute
- `dispatchRecordPath: string` — absolute path to the dispatch
  record on disk
- `batchId: string` — uuid-like opaque token grouping one batch
- `dispatchedInBatch: number` — current count after this dispatch
- `headroomCompressed: boolean` — true if headroom-ai actually
  reduced the prompt
- `headroomResult: { mode, compressed, compressionRatio, tokensSaved, warning } | null`
- `forcedAt: string | null` — ISO8601 when `--force` overrode
  the G9 hard-reject tier
- `contextImpact: { promptBytes, artifactBytes, totalBytes }`
- `artifactMetas: ArtifactMeta[]` — `--write-artifact` results

Removed in 2.0.0: `data.prompt` (audit-3rd #4). Consumers MUST
read `data.toolCall.args.prompt` for the prompt content.

### `sub-agent.dispatch --from-dag`

Same fields as single dispatch, plus:

- `fromDag: string` — path to the input DAG file
- `dispatchCount: number` — N toolCalls emitted in this level
- `levelsTotal: number` — total topological levels
- `firstLevel: string[]` — slice ids at level 1 (the only ones
  surfaced to the CLI; levels 2+ are orchestrated internally)
- `toolCalls: SubAgentToolCall[]` — N tool calls (one per slice)
- `existingContractCount: number` — number of ancestor contracts
  spliced into the prompts

### `sub-agent.heartbeat`

- `envelopeVersion: '2.1.0'`
- `recordPath: string`
- `heartbeatCount: number`
- `lastBeatAt: string | null` (ISO8601)
- `status: 'queued' | 'running' | 'finalizing' | 'done' | 'failed' | 'stale'`
- `truncated: boolean` — true if the heartbeats[] array hit the
  100-entry cap and old entries were dropped

### `sub-agent.share`

- `envelopeVersion: '2.1.0'`
- `ok: true`
- `batchId: string`
- `entryKey: string`
- `writtenAt: string` (ISO8601)
- `channelSize: number` — bytes of the channel file after this write
- `lastWriteWins: boolean` — true if `entryKey` was already present
- `valueSize: number`

### `sub-agent.shared-read`

- `envelopeVersion: '2.1.0'`
- `ok: true`
- `batchId: string`
- `entries: Record<string, SharedChannelEntry>` — key → entry
- `totalEntries: number`
- `channelSize: number` — bytes of the filtered channel
- `updatedAt: string` (ISO8601)

### `sub-agent.await`

- `envelopeVersion: '2.1.0'`
- `batchId: string`
- `ide: string`
- `results: SubAgentBatchResult[]`
- `summary: { total, done, failed, cancelled, timeout }`

## Migration policy

When the `MAJOR` version increments, the audit memory doc
(`.peaks/memory/`) MUST ship a migration memo with:

1. A diff of removed/renamed fields with old → new mapping.
2. A code-search commit that updates any in-repo consumers
   (currently only `dispatch-commands.ts`, `heartbeat-commands.ts`,
   `share-commands.ts`, `dispatch-from-dag.ts`).
3. A test fixture that pins the v{N-1} → v{N} migration.

For `MINOR` increments, only a changelog line in
`.peaks/memory/<date>-envelope-<v>.md` is required.

## Why a version field and not just a stable schema

The alternative — Zod-validate the response — was rejected as
over-engineering for a CLI whose consumers are LLMs (not RPC
clients). A short `envelopeVersion: '2.1.0'` string is cheap
for the LLM to ignore when unnecessary, and unambiguous when
needed: "if you see `envelopeVersion` >= 3.x, do not assume
`data.toolCall` is still shape-valid."
