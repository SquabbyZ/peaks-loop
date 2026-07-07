# Fan-out is mandatory (slice 2026-06-24-audit-5th-p2)

> **Reference contract.** Slice 5 (`feat(code): default to multi-sub-agent
> fan-out when DAG has >= 2 same-level leaves`) shipped in 2.8.0 with
> `'fan-out'` as the default but kept `'serial'` as an opt-out. Slice
> 2026-06-24-audit-5th-p2 (this slice, 2.8.4) **removes the opt-out** by
> user direction: single-sub-agent dispatch is no longer permitted when
> the DAG has ≥ 2 leaves at one topological level. This file is the
> canonical rationale + migration contract for that breaking change.

## Why the opt-out was removed

The 2.8.3-era `'serial'` mode was originally added to support four
caller personas (deterministic logs, single-sub-agent rate limits,
replay harnesses, step-by-step debugging). After a multi-cycle audit
(2026-06-23 → 2026-06-24), the operator concluded:

- **Deterministic logs** — achievable via `peaks slice check --verbose
  --no-color` per-slice logs, no opt-out needed.
- **Rate limits** — handled at the LLM-side runner's batch budget, not
  by serializing the dispatch shape (fan-out's `dispatchCount === N`
  still gives the platform one batch to schedule concurrently).
- **Replay / step-debug** — already covered by `peaks contract write`
  + `peaks sub-agent dispatch --batch-id <existing>`; replay targets
  one slice by id, no need to disable fan-out at the orchestrator.
- **The opt-out masked a foot-gun**: a user setting `'serial'` got
  `dispatchCount === 1` per CLI invocation and silently turned the
  orchestrator into a serial runner — wall-time `sum`, not `max`.

The hard constraint is now: when the slice DAG has ≥ 2 leaves at the
same topological level, the orchestrator MUST use `--from-dag` and
emit N parallel `buildToolCall` envelopes in one batch. There is no
preference, env-var, or CLI flag that overrides this.

## Default rule (unchanged)

```text
topological-level leaf count ≥ 2
  → peaks sub-agent dispatch --from-dag <dag-file> --batch-id <id>
  → dispatchCount === N (parallel)
  → wall-time ≈ max(per-slice latency), not sum

topological-level leaf count === 1
  → peaks sub-agent dispatch <role> --prompt ...
  → dispatchCount === 1 (single dispatch is fine; only one slice exists)
```

`config | docs | chore` request types still skip Swarm (no DAG emitted).

## Migration: legacy `'serial'` preferences.json

A project that wrote `'serial'` into `.peaks/preferences.json` between
2.8.3 and 2.8.4 will see the following when it next runs `peaks`
(any CLI that calls `loadPreferences`):

```text
PREFERENCES_FANOUT_INVALID: fanout.defaultMode must be one of fan-out
  (got "serial") in .peaks/preferences.json. The 'serial' opt-out was
  removed in 2.8.4 — remove the fanout block to use the fan-out default.
```

**Recovery:** delete the `fanout` block from `.peaks/preferences.json`
(keeping the rest of the file intact), or run `peaks preferences
migrate --write` which rewrites `serial` → `fan-out` automatically
and surfaces a `changes[]` entry:

```text
fanout.defaultMode rewrote 'serial' → 'fan-out' (the 'serial' opt-out
  was removed in 2.8.4; single-sub-agent dispatch is no longer
  permitted when DAG has >= 2 leaves)
```

## Schema reference (locked)

Defined in `src/services/preferences/preferences-types.ts`:

```typescript
export type FanoutMode = 'fan-out';

export const FANOUT_MODES: readonly FanoutMode[] = ['fan-out'];

export interface FanoutPreference {
  /** Hard-coded mode. Slice 2026-06-24-audit-5th-p2 removed the serial opt-out. */
  readonly defaultMode: FanoutMode;
}

// DEFAULT_PREFERENCES
fanout: { defaultMode: 'fan-out' }
```

`FANOUT_MODES` is intentionally exported with a single element so the
type guard (`isFanoutMode`) can keep the same closed-set validation
shape it had pre-slice — the difference is that anything outside
`'fan-out'` now throws instead of being silently coerced to default.

## Tests

- `tests/unit/code/skills-code-fanout-mandatory.test.ts` — pins that
  SKILL.md still mentions `--from-dag`, does NOT mention `serial`
  opt-out, and references `references/fanout-mandatory.md`.
- `tests/integration/code/multi-sub-agent-fanout.test.ts` — pins the
  runtime fan-out behavior; not affected by this slice.

## Rollout

This is a **breaking change** for any project that opted into
`defaultMode = 'serial'`. The migration path is automatic on next
`peaks` run (silent coercion via `migratePreferences`); manual
recovery is `delete the fanout block from preferences.json`.