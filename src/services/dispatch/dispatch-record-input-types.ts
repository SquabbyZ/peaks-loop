/**
 * Slice `b1-filesplit-campaign` (wave 3) — verbatim extraction of the dispatch
 * *write* input declarations from `./dispatch-record-types.ts` so that module
 * clears the 300 raw-line cap. No field, no type, no comment changed; the
 * original module re-exports this name from its own path, so importers are
 * untouched.
 */
import type { SubAgentToolCall } from './sub-agent-dispatcher.js';

/** Input for the initial write. */
export type WriteInitialDispatchInput = {
  projectRoot: string;
  sessionId: string;
  requestId: string;
  role: string;
  prompt: string;
  toolCall: SubAgentToolCall;
  batchId: string;
  /** Override the timestamp (testing). */
  now?: () => Date;
  /**
   * Slice 2026-07-29-worktree-l2-extended Part 3.A: the worktree
   * lease id this dispatch owns (set by `peaks sub-agent dispatch
   * --isolation worktree`). Persisted so the finalize-time release
   * hook in `markCompleted` can fire even after the dispatch
   * process exits. Optional; absent when the dispatch did not
   * request isolation.
   */
  leaseId?: string | null;
  /**
   * Slice 2026-07-29-worktree-l2-extended Part 7: ISO timestamp
   * when the isolation mode was set up. Optional on the input
   * (defaults to `null`); dispatch-commands.ts passes the spawn
   * time when `--isolation` is requested.
   */
  isolationStartedAt?: string | null;
  /**
   * Slice 4.0.8: workflow graph binding for the dispatch. Defaults
   * to `null` so a non-graph dispatch (legacy CLI flow, ad-hoc
   * dispatch) still writes a v4.0.0 record.
   */
  workflowId?: string | null;
  graphNodeId?: string | null;
  graphRef?: string | null;
  /**
   * Phase A Task 8: dispatch execution mode. Default `'in-process'`
   * preserves the current LLM-side runner behavior. `'detached'`
   * triggers the new real-OS-process path via
   * `peaks sub-agent dispatch --mode detached`.
   */
  mode?: 'in-process' | 'detached';
  /**
   * Phase A Task 8: vendor id when `mode='detached'`. Required by
   * the adapter layer to know which CLI / runtime to spawn. The
   * schema accepts the three vendors peaks-loop has adapters for
   * (claude / codex / copilot). Ignored when `mode='in-process'`.
   */
  vendor?: 'claude' | 'codex' | 'copilot';
  /**
   * Phase A Task 8: G8 autoCompact events accumulated by the child
   * LLM. Optional on input — most dispatches start with an empty
   * array and the detached runner appends events as they fire.
   */
  autoCompactEvents?: Array<{
    at: number;
    threshold: '0.85' | '0.95';
    tokensBefore: number;
    tokensAfter: number;
    scratchFile?: string;
  }>;
  /**
   * Phase A Task 8: G8 token-usage accounting. Detached runs
   * record spend for audit (unlimited, but persisted). Optional
   * on input; the detached runner fills this in as it streams
   * usage from the vendor API.
   */
  tokenUsage?: { promptTokens: number; completionTokens: number; totalCostUsd?: number };
};
