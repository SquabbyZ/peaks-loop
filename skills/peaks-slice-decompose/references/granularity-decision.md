# Granularity decision

Source of truth: `src/services/slice/multi-pass-orchestrator.ts` (orchestrator) + `src/services/slice/granularity-decider.ts` (`shouldSubdivide`). Defaults: `granularity = 'both'`. `DEFAULT_THRESHOLDS = { maxFiles: 3, maxLoc: 400 }`.

This reference is what `peaks-rd` reads to decide which `--granularity` value to pass when invoking `peaks slice decompose` for a given PRD.

## Top-level decision

```
peaks slice decompose <rid> --granularity ?
            |
            v
    ┌───────┴────────┐
    │                │
 service           file / both / auto
 (Pass 1 only)          |
                        v
              run Pass 1 if granularity includes 'service'
                        |
                        v
              run Pass 2 if granularity includes 'file'
                        |
                        v
              crossPassEdges = llmRunner ? merge(passes) : []
```

## Mode table

| `--granularity` | Pass 1? | Pass 2? | Parent subdivision? | Per-parent filter |
|---|---|---|---|---|
| `service` | yes | no | n/a | n/a |
| `file` | no | yes (one call, full scope) | no — every `WorkUnit` becomes a Pass 2 slice with `parentSliceId: null` | none |
| `both` | yes | yes (one Pass 2 call per Pass 1 slice) | yes — every Pass 1 slice becomes a parent | none — every Pass 1 slice gets a Pass 2 expansion |
| `auto` | yes | yes (one Pass 2 call per qualifying Pass 1 slice) | yes — but only for parents where `shouldSubdivide(wu).subdivide !== false` | `shouldSubdivide(wu)` (see below) |

Default is `both`. The CLI description flags this: `"both"` is the v1 path-equivalent; non-default values enable v2 multi-pass.

## `shouldSubdivide(wu, thresholds?)` semantics

Source: `granularity-decider.ts`. Pure function. No LLM dependency.

```ts
interface GranularityThresholds {
  readonly maxFiles: number;  // default 3
  readonly maxLoc: number;    // default 400
}
```

The function returns one of three branches:

| Branch | Trigger | Meaning |
|---|---|---|
| `{ subdivide: true, reason }` | `wu.loc > maxLoc` OR `wu.files.length > maxFiles` | Strictly over threshold. Split now. |
| `{ subdivide: 'tie-break', reason }` | `wu.loc > maxLoc * 0.8` OR `wu.files.length > maxFiles * 0.8` (and not strictly over) | Within 20% of threshold. Defer to LLM arbitrator for the final call. |
| `{ subdivide: false, reason }` | otherwise | Under threshold. Stop subdividing. |

### Boundary semantics

- `>` (strict). At the exact threshold (`wu.loc === maxLoc`, `wu.files.length === maxFiles`) the result is `subdivide: false`. The threshold is exclusive — we only subdivide what is OVER it.
- `auto` mode treats both `true` and `'tie-break'` as qualifying (`subdivide !== false`). Only `false` is filtered out.

### Tie-break behavior

`auto` mode does NOT itself consult the LLM — the `'tie-break'` branch only signals that the workUnit is borderline. The actual LLM call happens during cross-pass edge detection in `cross-pass-edge-merger.ts` (see `references/cross-pass-edge-interpretation.md`). The merge step may add an `llm-arbitrated` edge even when the parent was subdivided as `'tie-break'`.

## `auto` decision tree

For each Pass 1 slice, the orchestrator asks `shouldSubdivide(slice).subdivide !== false`:

```
Pass 1 slice
    |
    v
shouldSubdivide(wu)?
    |
    ├── true           ──> qualifies for Pass 2 expansion
    ├── 'tie-break'    ──> qualifies for Pass 2 expansion
    └── false          ──> skip Pass 2 (slice remains a leaf)
```

## `both` decision tree

```
Pass 1 slice
    |
    v
always qualifies for Pass 2 expansion
```

`both` is the unfiltered superset. Use it when you want maximum resolution at the cost of file-size growth.

## When to use which mode

| Mode | Use when |
|---|---|
| `service` | The PRD is about service boundaries (monorepo → micro-services, layered architecture). Pass 1 alone is sufficient; file-level cuts would dilute the boundary signal. |
| `file` | The PRD is about a single large surface (one file or one module). Skip the service-level cut; go straight to file-level cuts across the full scope. |
| `both` | Default. Both granularities are wanted and every Pass 1 slice should expand. Most general-purpose runs. |
| `auto` | Most Pass 1 slices are already small; only the outliers (loose `shouldSubdivide` threshold or borderline) need Pass 2 expansion. Smaller artifact, faster run. |

## Default-thresholds rationale

`maxFiles: 3, maxLoc: 400` is the v2 default. A slice with ≤ 3 files OR ≤ 400 LoC is considered already-small; one above either threshold needs subdivision. The 20% borderline band (`maxFiles * 0.8 = 2.4`, `maxLoc * 0.8 = 320`) catches slices that read like one unit but are technically approaching the cap.

For projects with very different file sizes, override `DEFAULT_THRESHOLDS` via a future CLI flag — currently the thresholds are not exposed on the CLI surface; pass them via `MultiPassOptions` only in programmatic use.

## Stop condition

Subdivision stops at Pass 2 in v2. There is no Pass 3 in current production even though `PassNumber` allows `3` (`'sub-file'` is reserved). The `MultiPassOrchestrator.decompose` function only emits `passNumber: 1` and `passNumber: 2` entries.

If a Pass 2 slice is itself over threshold, the v2 envelope records it as-is — there is no recursive Pass 3. Consumers that need recursive subdivision must re-run with a project-local script against `MultiPassOrchestrator.decompose`.

## Field reference for the decision

```ts
export type Granularity = 'service' | 'file' | 'both' | 'auto';

export interface MultiPassOptions extends DecomposeOptions {
  readonly granularity?: Granularity;     // default 'both'
  readonly llmRunner?: LlmRunner;         // when present, crossPassEdges are computed
}
```

```ts
export const DEFAULT_THRESHOLDS: GranularityThresholds = {
  maxFiles: 3,
  maxLoc: 400
};
```