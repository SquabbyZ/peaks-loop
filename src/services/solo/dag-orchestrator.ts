/**
 * DAG orchestrator — 2.7.0 slice-dag-dispatcher MVP (slice 1.2.a).
 *
 * The pure planner. Given a `SliceDag`, the orchestrator decides which
 * slices to dispatch next (in topological order), drives the join barrier,
 * and rolls back on any leaf failure.
 *
 * Design:
 *  - **Pure dispatcher contract**: the orchestrator never calls an LLM
 *    directly; it returns `DispatchSpec[]` per topological level and lets
 *    the caller (the CLI / peaks-solo LLM) execute the per-IDE tool calls.
 *    This keeps the orchestrator testable end-to-end with mock sub-agents.
 *  - **Join barrier**: between levels, the orchestrator awaits the
 *    results of all dispatched leaves and refuses to advance if any
 *    leaf failed.
 *  - **Failure rollback**: a leaf failure cancels all other in-flight
 *    slices in the same level. The orchestrator surfaces a `DagRollback`
 *    event so the caller can re-plan.
 *  - **Contract broadcast**: when a slice finishes successfully, the
 *    orchestrator writes its public contract to disk via `writeContract`,
 *    and the next dispatch's prompt is built with `formatContractInjection`.
 *
 * Why this lives in `services/solo/`:
 *  `peaks-solo` is the natural caller. The CLI surface (`peaks sub-agent
 *  dispatch --from-dag`) consumes the planner's output but the planner
 *  itself is a library.
 */
import {
  hashDag,
  InvalidSliceDagError,
  topologicalLevels,
  validateDag,
  type SliceDag
} from '../dispatch/slice-dag.js';
import {
  formatContractInjection,
  writeContract,
  type SliceContract
} from '../dispatch/contract-store.js';
import { formatTestToolDetection } from '../dispatch/test-tool-detection.js';

export interface DispatchSpec {
  readonly sliceId: string;
  readonly role: string;
  readonly label: string | null;
  readonly prompt: string;
  /** Optional contract block to splice into the prompt. */
  readonly contractBlock: string;
}

export interface RunDagOptions {
  readonly projectRoot: string;
  readonly sessionId: string;
  /**
   * Reserved for slice 1.3 — when the per-IDE `awaitBatch` join barrier
   * moves into the orchestrator, this will cap how long `runDag` waits
   * for a single leaf before issuing `cancel`. Unused in 1.2 MVP
   * (per-IDE await is delegated to the LLM-side runner); declared here
   * so the public surface stays stable across the 1.2 → 1.3 transition.
   */
  readonly timeoutMs?: number;
  /** Test seam: replace the runner (default: a no-op that returns `done`). */
  readonly runSlice?: (spec: DispatchSpec) => Promise<SliceOutcome>;
  /** Test seam: replace the contract writer (default: `writeContract`). */
  readonly writeContractFn?: (
    sliceId: string,
    publicSurface: PublicSurface
  ) => SliceContract;
  /**
   * Pre-existing contracts from upstream slices (e.g. already completed in
   * a prior `peaks sub-agent dispatch --from-dag` invocation). The
   * orchestrator splices these into downstream dispatch prompts via
   * `formatContractInjection(ancestors)` — matching AC-4.c: "B / C / D
   * dispatch prompt 自动注入 A 契约".
   */
  readonly existingContracts?: readonly SliceContract[];
}

export type SliceOutcome =
  | { readonly status: 'done'; readonly publicSurface: PublicSurface }
  | { readonly status: 'failed'; readonly reason: string }
  | { readonly status: 'cancelled' };

export interface PublicSurface {
  readonly exports: readonly string[];
  readonly types: readonly string[];
  readonly publicSignatures: readonly string[];
  readonly broadcastTo?: readonly string[];
}

export interface DagRunResult {
  readonly dagHash: string;
  readonly completed: readonly string[];
  readonly failed: readonly { sliceId: string; reason: string }[];
  readonly cancelled: readonly string[];
  readonly contracts: readonly SliceContract[];
}

/** Thrown when the DAG has no feasible plan (validation error). */
export class DagPlanError extends Error {
  readonly code = 'DAG_PLAN_ERROR' as const;
  constructor(message: string) {
    super(message);
    this.name = 'DagPlanError';
  }
}

/** Default runner for tests / mocks. Returns `done` with an empty surface. */
const defaultRunner = async (_spec: DispatchSpec): Promise<SliceOutcome> => ({
  status: 'done',
  publicSurface: { exports: [], types: [], publicSignatures: [] }
});

const defaultWriter = (
  projectRoot: string,
  sessionId: string
) => (sliceId: string, publicSurface: PublicSurface): SliceContract => {
  const r = writeContract(projectRoot, sessionId, {
    sliceId,
    sessionId,
    exports: publicSurface.exports,
    types: publicSurface.types,
    publicSignatures: publicSurface.publicSignatures,
    ...(publicSurface.broadcastTo !== undefined ? { broadcastTo: publicSurface.broadcastTo } : {})
  });
  return r.contract;
};

/**
 * Build a single dispatch spec for `sliceId` given the current contract set.
 *
 * When `node.prompt` is set on the DAG node, that wins verbatim (the
 * caller controls per-slice prompt content). Otherwise we fall back to
 * `defaultPrompt`, then to a structured MVP prompt covering: the slice's
 * role + id + label, the injected ancestor-contract block (if any), the
 * MVP scope statement, and the explicit handoff protocol the LLM-side
 * runner must follow (write contract, then re-invoke for the next
 * topological level).
 */
export function buildDispatchSpec(
  dag: SliceDag,
  sliceId: string,
  contracts: readonly SliceContract[],
  defaultPrompt?: string
): DispatchSpec {
  const node = dag.nodes.find((n) => n.id === sliceId);
  if (!node) {
    throw new DagPlanError(`unknown slice id: ${sliceId}`);
  }
  const ancestors = contracts.filter((c) => c.broadcastTo?.includes(sliceId) ?? false);
  const contractBlock = formatContractInjection(ancestors);
  if (node.prompt !== undefined) {
    return {
      sliceId,
      role: node.role,
      label: node.label ?? null,
      prompt: `${formatTestToolDetection()}\n\n${node.prompt}`,
      contractBlock
    };
  }
  if (defaultPrompt !== undefined) {
    return {
      sliceId,
      role: node.role,
      label: node.label ?? null,
      prompt: defaultPrompt,
      contractBlock
    };
  }
  // MVP (1.2) structured fallback prompt. Slice 1.4 will land per-domain
  // prompt templates (one per role), but for the MVP dogfood we ship a
  // single structured prompt that:
  //   1. names the slice id + role + label (so the LLM knows what to do)
  //   2. states the MVP scope explicitly (avoid confusion with full prod)
  //   3. includes the ancestor contract injection (so downstream slices
  //      see their inputs)
  //   4. states the handoff protocol (write contract, re-invoke for next level)
  const labelFragment = node.label ? ` — ${node.label}` : '';
  const ancestorFragment = contractBlock
    ? `\n\n${contractBlock}`
    : '';
  const prompt = [
    formatTestToolDetection(),
    '',
    `[slice-dag-dispatcher MVP 1.2] execute slice "${sliceId}" (role=${node.role})${labelFragment}.`,
    '',
    'Scope: this is the 2.7.0 MVP dogfood of peaks-cli DAG-aware dispatch. You are one leaf in a multi-slice plan; the orchestrator has already validated the DAG, built a topological order, and injected your upstream contracts above.',
    '',
    'Handoff protocol (REQUIRED — orchestrator depends on this):',
    '  1. Execute the slice to completion.',
    `  2. Write your public contract via \`peaks contract write --project <root> --session-id <sid> --slice-id ${sliceId} --exports <...> --types <...> --signatures <...>\`. The orchestrator will pick it up on the next dispatch run.`,
    '  3. Do NOT re-invoke `peaks sub-agent dispatch --from-dag` yourself — the parent orchestrator (peaks-solo) drives level advancement.',
    '',
    `After your contract is on disk, the orchestrator will auto-advance to the next topological level (if any) by re-invoking \`peaks sub-agent dispatch --from-dag\` with the same batch-id. Your slice will appear in its ancestors via \`formatContractInjection\`.${ancestorFragment}`
  ].join('\n');
  return {
    sliceId,
    role: node.role,
    label: node.label ?? null,
    prompt,
    contractBlock
  };
}

/**
 * Run a slice DAG end-to-end. Returns a summary; throws `DagPlanError`
 * on validation failure; any leaf failure causes an in-flight cancel
 * signal but the function still resolves with the partial result so the
 * caller can re-plan.
 */
export async function runDag(dag: SliceDag, opts: RunDagOptions): Promise<DagRunResult> {
  try {
    validateDag(dag);
  } catch (err) {
    if (err instanceof InvalidSliceDagError) {
      throw new DagPlanError(err.message);
    }
    throw err;
  }
  const levels = topologicalLevels(dag);
  const dagHash = hashDag(dag);

  const runner = opts.runSlice ?? defaultRunner;
  const writer = opts.writeContractFn ?? defaultWriter(opts.projectRoot, opts.sessionId);

  const completed = new Set<string>();
  const contracts: SliceContract[] = [...(opts.existingContracts ?? [])];
  const failed: { sliceId: string; reason: string }[] = [];
  const cancelled: string[] = [];
  const inflight = new Set<string>();

  for (const level of levels) {
    const ready = level.filter((id) => !completed.has(id) && !failed.some((f) => f.sliceId === id));
    if (ready.length === 0) continue;

    for (const id of ready) inflight.add(id);

    const settled = await Promise.all(
      ready.map(async (sliceId) => {
        const spec = buildDispatchSpec(dag, sliceId, contracts);
        try {
          const outcome = await runner(spec);
          return { sliceId, outcome };
        } catch (err) {
          return {
            sliceId,
            outcome: { status: 'failed' as const, reason: (err as Error).message }
          };
        }
      })
    );

    let levelHasFailure = false;
    for (const { sliceId, outcome } of settled) {
      inflight.delete(sliceId);
      if (outcome.status === 'done') {
        completed.add(sliceId);
        const contract = writer(sliceId, outcome.publicSurface);
        contracts.push(contract);
      } else if (outcome.status === 'failed') {
        failed.push({ sliceId, reason: outcome.reason });
        levelHasFailure = true;
      } else {
        cancelled.push(sliceId);
        levelHasFailure = true;
      }
    }

    if (levelHasFailure) {
      for (const id of inflight) {
        cancelled.push(id);
        inflight.delete(id);
      }
      break;
    }
  }

  return {
    dagHash,
    completed: Array.from(completed).sort(),
    failed,
    cancelled: cancelled.sort(),
    contracts
  };
}
