---
name: peaks-slice-decompose
description: Run multi-pass slice decomposition on a PRD-ready request and emit a v2 envelope with passes, cross-pass edges, and an LLM-arbitration trace. Use when a PRD is ready and the caller needs service-level and/or file-level cuts in one artifact.
---

## Two-axis naming convention

> **Read once at the top of this file; the rest of the skill is written against it.**

The `.peaks/` workspace is partitioned by **two orthogonal axes**: **change-id** (reviewable artifacts at `.peaks/_runtime/<changeId>/...`) and **session-id** (ephemeral state at `.peaks/_runtime/<sessionId>/...`), with a nested **sub-agent axis** under `.peaks/_sub_agents/<sessionId>/...`. Use `<changeId>` / `<sessionId>` placeholders (NEVER bare `<sid>`). CLI axis mapping: change-id → `peaks request *` / `peaks scan *`; session-id → `peaks session *`; sub-agent → `peaks sub-agent *`. Regression test `tests/unit/skills/skills-skill-md-naming.test.ts` enforces (a) zero bare `<sid>`, (b) every `.peaks/_runtime/<X>/` has an axis label, (c) this callout is present.

## Read via `SchemaRouter.readResult()` — never parse the file directly

> **BLOCKING for any consumer of the v2 envelope.**

The decomposition file at `.peaks/sc/slice-decomposition/<rid>.json` may be either v1 (no `schemaVersion` field) or v2 (`schemaVersion: 'v2'`). Callers MUST use `SchemaRouter.readResult(<path>)` from `src/services/slice/schema-router.ts` and narrow on the discriminator:

```ts
import { readResult } from '../../services/slice/schema-router.js';

const parsed = readResult(outPath);
if (parsed.schemaVersion === 'v2') {
  handleV2(parsed); // DecompositionResultV2
} else {
  handleV1(parsed); // DecompositionResult
}
```

Do NOT call `JSON.parse(readFileSync(...))` directly. Unknown `schemaVersion` values throw `UnknownSchemaVersionError` with code `UNKNOWN_SCHEMA_VERSION` — surface that to the CLI as exit-code-mapped failure, do not silently fall back to v1.

# Peaks-Cli slice-decompose

`peaks-slice-decompose` wraps the v2 multi-pass orchestrator (`MultiPassOrchestrator.decompose`) and the v1/v2 dual-read SchemaRouter. It owns the artifact shape emitted by `peaks slice decompose` when a non-default `--granularity` is passed.

## Trigger conditions

Invoke when ALL of the following hold:

- a PRD body exists for `<rid>` (under `.peaks/2026/prd/requests/`, `.peaks/prd/requests/`, or `.peaks/_runtime/*/prd/requests/`);
- the request is **PRD-ready** (the PRD has acceptance criteria and is past `peaks-prd`'s draft gate);
- the caller needs one or both of:
  - service-level cuts (Pass 1) AND/OR file-level cuts (Pass 2) in a single artifact, OR
  - cross-pass edges (type-shares / fixture-shares / import-re-export / llm-arbitrated) connecting the two granularity levels.

Do NOT invoke for:

- v1-only consumers still on the 6-stage path (use the default `--granularity both` and the v1 envelope);
- re-deriving the PRD — this skill consumes PRD output, it does not produce it.

## Preconditions

- `peaks codegraph index` has been run at least once (the orchestrator reads codegraph status during Pass 1 / Pass 2);
- the audit-goal envelope for the project exists (`.peaks/_runtime/<sid>/audit-goal/<rid>.md` or equivalent) — without it, downstream `peaks-rd` dispatch cannot read the LLM-call budget context;
- `--granularity` value is one of `service`, `file`, `both`, `auto`. The CLI rejects other values with `code: SLICE_DECOMPOSE_FAILED` BEFORE any I/O. Default `both` keeps the v1 path — for v2, pass an explicit non-default value.

## Invocation

```bash
peaks slice decompose <rid> --granularity <service|file|both|auto> [--project <path>] [--refresh]
```

| Flag | Type | Default | Effect |
|---|---|---|---|
| `--granularity` | enum | `both` | `service` → Pass 1 only. `file` → Pass 2 only (no parent subdivision). `both` → Pass 1 + Pass 2 per parent, no filtering. `auto` → Pass 1 + Pass 2 only for parents where `shouldSubdivide()` is not explicitly false. |
| `--project` | path | `.` | Target project root. |
| `--refresh` | flag | `false` | Re-run `peaks codegraph index` before reading. |

Exit code is non-zero only on `SLICE_DECOMPOSE_FAILED` (PRD not found, codegraph not initialised, invalid granularity, etc.). A successful run always emits the v2 envelope on disk; partial failures set `partial: true` rather than failing.

## Output

```text
.peaks/sc/slice-decomposition/<rid>.json
```

The envelope is a `DecompositionResultV2` (see `references/v2-schema.md`):

| Top-level field | Purpose |
|---|---|
| `schemaVersion` | Literal `'v2'`. Discriminator vs v1. |
| `rid` | The request id passed in. |
| `generatedAt` | ISO 8601 UTC. |
| `passes` | Ordered `PassResult[]` — Pass 1 first, then Pass 2 (one entry per qualifying parent). |
| `crossPassEdges` | Edges spanning passes (see `references/cross-pass-edge-interpretation.md`). |
| `llmArbitrations` | Trace of every LLM call made during decomposition (capped at 2 per invocation). |
| `codegraph` | `CodegraphEnvelope` — nodes/edges/dbMB/freshness/affectedCrossFile/note. |
| `understandAnything` | `UnderstandAnythingEnvelope` — kgNodes/kgEdges/available/fallback/note. |
| `partial` | `true` iff any pass failed to complete. |

The file is pretty-printed (`JSON.stringify(result, null, 2)`). Size scales with `passes.length * slices.length` plus the arbitration trace; typical runs are 5–80 KB.

## How peaks-rd / peaks-qa / peaks-final-review consume this

- `peaks-rd` reads `passes[*].slices` to build the dispatch graph; `crossPassEdges` become the `dependsOn` set in `peaks request init`.
- `peaks-rd` reads `llmArbitrations[*].callId` (referenced by `CrossPassEdge.arbitratedBy`) to audit any LLM-inferred relationship.
- `peaks-qa` reads `passes[*].partial` and the top-level `partial` flag to detect incomplete decomposition before launching the verification fan-out.
- `peaks-final-review` reads `passes[*].granularity` to confirm the slice topology matches the PRD's stated scope.

Consumers MUST go through `SchemaRouter.readResult()`. v1 envelopes still on disk (legacy) are read transparently as `DecompositionResult`; the router narrows on `schemaVersion`.

## Surgical-change contract

This skill does NOT modify source code. It documents the v2 envelope produced by the W2 orchestrator modules (`multi-pass-orchestrator.ts`, `granularity-decider.ts`, `cross-pass-edge-merger.ts`, `slice-topology-types.ts`, `schema-router.ts`). Schema changes require a `schemaVersion` bump and a router update.

## References

| File | Coverage |
|---|---|
| `references/v2-schema.md` | Field-by-field table for `DecompositionResultV2`, `PassResult`, `SliceV2`, `CrossPassEdge.arbitratedBy`, `LlmArbitration`. |
| `references/granularity-decision.md` | Decision tree for the 4 `--granularity` modes; `shouldSubdivide()` thresholds + tie-break semantics. |
| `references/cross-pass-edge-interpretation.md` | The 4 edge kinds and how `peaks-rd` should use them for dispatch ordering; `LlmArbitration` trace reader. |