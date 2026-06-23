# Fan-out opt-out (slice 2026-06-23-audit-p0)

> **Reference contract.** Slice 5 (`feat(solo): default to multi-sub-agent
> fan-out when DAG has >= 2 same-level leaves`) changed the default
> behavior. The audit (2026-06-23, today) flagged that the default
> change shipped without an opt-out — this reference is the escape hatch.

## When to opt out

The default rule ("≥ 2 leaves at the same topological level → fan-out")
is defined canonically in `references/swarm-dispatch-contract.md` §1–2
— see that file for the trigger logic, degradation table, and Swarm
gate. This reference is the **escape hatch** for that default: a small
set of callers benefit from forcing serial dispatch:

- **Deterministic per-slice logs** — every slice prints to stdout in
  sequence, no interleaving with concurrent sub-agents.
- **Single-sub-agent rate limits** — IDE / API rate limits that penalize
  concurrent dispatches in the same batch.
- **Replay harnesses** — need to re-run a single slice without rerunning
  siblings.
- **Step-by-step debugging** — when a single slice is misbehaving,
  running it in isolation surfaces the failure without orchestrator
  interference.

## How to opt out

Edit `.peaks/preferences.json` and add the `fanout` block:

```json
{
  "schema_version": "2.0.0",
  "fanout": {
    "defaultMode": "serial"
  }
}
```

The merge in `src/services/preferences/preferences-service.ts` is a
shallow `Object.fromEntries` — omitting `fanout` defaults it to
`{ defaultMode: 'fan-out' }` from `DEFAULT_PREFERENCES`, so legacy
files keep the slice-5 behavior. To restore the default, simply remove
the `fanout` block.

## What changes when `defaultMode = 'serial'`

- The LLM-side runner (peaks-solo SKILL) MUST dispatch each slice
  individually via `peaks sub-agent dispatch <role> --prompt ...`
  even if the DAG has ≥ 2 leaves at one topological level. The trigger
  logic itself is unchanged (see `swarm-dispatch-contract.md` §1) —
  only the LLM's decision flips from "use --from-dag" to "use N serial
  dispatches".
- The CLI surface (`peaks sub-agent dispatch --from-dag`) is unchanged —
  callers that invoke it directly still get fan-out; this opt-out only
  governs the LLM-side runner.
- `references/swarm-dispatch-contract.md` assumes `defaultMode = 'fan-out'`;
  the `serial` path bypasses the DAG codepath entirely.
- Wall-time is `sum` of per-slice dispatch latencies (not `max`).
- `dispatchCount === 1` per CLI invocation; N slices → N invocations.

## Schema reference

Defined in `src/services/preferences/preferences-types.ts`:

```typescript
export type FanoutMode = 'fan-out' | 'serial';

export interface FanoutPreference {
  /** Slice default mode. Default: 'fan-out' (matches the pre-slice behavior). */
  readonly defaultMode: FanoutMode;
}

// DEFAULT_PREFERENCES
fanout: { defaultMode: 'fan-out' }
```

## Tests

- `tests/unit/solo/skills-solo-fanout-opt-out.test.ts` — pins the
  SKILL.md mention, the schema reference, the merge fallback, and
  the explicit `serial` override.
- `tests/integration/solo/multi-sub-agent-fanout.test.ts` — already
  pins the default fan-out behavior; not affected by this opt-out.

## Rollout

The opt-out is backward compatible — no existing project sees any
behavior change unless they add the `fanout` key explicitly. To verify
your project's effective mode, read
`preferences.fanout.defaultMode` after `loadPreferences(projectRoot)`.
