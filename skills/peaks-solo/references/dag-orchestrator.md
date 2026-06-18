# DAG-aware sub-agent dispatch (2.7.0)

Solo delegates layer-by-layer fan-out + join-barrier + cancel-on-fail
to **`runDag(dag, opts)`** in `src/services/solo/dag-orchestrator.ts`
when a slice's dependency surface is a DAG. Solo MUST NOT re-implement
these mechanics inline.

## When to use `runDag`

Use `runDag` when **any** of these is true:

- The slice has 2+ independent parallel leaves with per-layer rollback.
- The slice has 1+ upstream contracts to inject into downstream
  dispatch prompts (`formatContractInjection` reads
  `.peaks/_runtime/<sessionId>/dispatch/contracts/`).
- The slice has 2+ topological levels (orchestrator-driven re-invoke,
  not manual "next-level" CLI calls).

Use single-role `peaks sub-agent dispatch <role>` for everything else.

## Contract

```ts
import { runDag } from '../services/solo/dag-orchestrator.js';
const result = await runDag(dag, {
  projectRoot, sessionId, requestId, role, ide,
  dispatch: async (spec) => { /* LLM-side runner executes SubAgentDispatcher.buildToolCall(spec) */ },
  await:    async (batchId, timeoutMs) => { /* SubAgentDispatcher.awaitBatch(...) */ },
  writer:   writeContract,
});
// result.contracts: readonly SliceContract[] — written + ready for injection
```

## Failure handling

Any leaf failure → orchestrator sends `cancel` to in-flight siblings;
Solo gets partial `DagRunResult`, treats slice as `return-to-rd`,
re-enters at the failed layer on next repair cycle. Per-IDE timeout:
trae / trae-cn / cursor 30s, codex 45s, claude-code 60s; uniform
120_000ms clamp ceiling.

## Source-of-truth pointers

- Orchestrator: `src/services/solo/dag-orchestrator.ts` (`runDag` +
  `buildDispatchSpec` + `formatContractInjection`)
- DAG model: `src/services/dispatch/slice-dag.ts`
  (`validateDag` / `topologicalLevels` / `sliceReadyToRun` / `hashDag`)
- Per-IDE await: `src/services/dispatch/sub-agent-dispatcher.ts`
  (`SubAgentDispatcher.awaitBatch` — real impl on all 5 IDEs)
- Contract store: `src/services/dispatch/contract-store.ts`
- CLI surface: `peaks sub-agent dispatch --from-dag <file> --batch-id <id>`
  and `peaks sub-agent await --batch <id> [--timeout <ms>]`
- Tests: `tests/unit/solo/dag-orchestrator.test.ts` (cancel-on-fail),
  `tests/unit/dispatch/run-dag-dogfood-mvp.test.ts` (MVP dogfood),
  `tests/unit/dispatch/slice-dag-dispatcher-5ide-dogfood.test.ts`
  (5 IDE end-to-end).