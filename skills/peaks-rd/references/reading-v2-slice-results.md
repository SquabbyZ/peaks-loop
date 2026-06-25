# Reading v2 slice results (peaks-slice-decompose v2 schema)

`peaks-slice-decompose` produces a **v2 envelope** with multi-pass topology. RD reads it before dispatching implementation work. Routing is automatic via `SchemaRouter` (see `src/services/slice/schema-router.ts`); do not branch on version strings in the prompt.

## Envelope shape (v2)

```json
{
  "schemaVersion": "2.0",
  "result": {
    "passes": [
      {
        "passId": "pass-1",
        "granularity": "service",
        "slices": [
          { "sliceId": "s1", "parentSliceId": null, "files": ["src/foo.ts"], "edges": [] }
        ]
      },
      {
        "passId": "pass-2",
        "granularity": "file",
        "slices": [
          { "sliceId": "s2", "parentSliceId": "s1", "files": ["src/foo/bar.ts"], "edges": ["s1"] }
        ]
      }
    ]
  }
}
```

## Read fields in this order

1. `result.passes[]` — ordered list; Pass 1 runs before Pass 2.
2. `passes[].granularity` — `service` | `file` | `module`; informs dispatch shape.
3. `passes[].slices[].parentSliceId` — non-null on Pass ≥ 2 → child of a Pass 1 slice. Build a child→parent map before dispatch.
4. `passes[].slices[].edges[]` — cross-slice dependencies; honor topological order when fanning out.

## v1 fallback

Legacy v1 envelopes use `result.dependencyDAG.edges` and `result.workUnits`. `SchemaRouter` returns a v1-shaped view automatically when `schemaVersion === "1.0"`; treat `workUnit` ≈ v2 `slice`. Do not migrate v1 envelopes in-flight — read them as-is.

## LLM dispatch strategy

- **`passes.length === 1`** → single fan-out across `passes[0].slices`. One CC per slice, all parallel.
- **`passes.length > 1`** → per-pass fan-out. Run Pass 1 to completion first (so children resolve `parentSliceId`); then run Pass 2 in parallel. Do NOT interleave passes — child slices read parent outputs.
- Each CC receives **only its own slice subset** (filter `slices[]` by `sliceId`), never the full envelope. The orchestrator keeps the parent→child map.

## Verifiable success

- Every `sliceId` in the v2 envelope has a corresponding CC dispatch in the runbook.
- No CC receives a `sliceId` outside its pass.
- Child CCs run after their parent completes (when `parentSliceId` is set).

See `../peaks-slice-decompose/SKILL.md` for the v2 envelope contract.
