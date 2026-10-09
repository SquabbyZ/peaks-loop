/**
 * The orchestrator’s input and run-context types.
 *
 * Split out of `auto-compact-orchestrator.ts` (file-size cap campaign). The
 * orchestrator re-exports every name declared here, so existing importers keep
 * using `./auto-compact-orchestrator.js` unchanged.
 */
import type { AutoCompactMode } from './auto-compact-modes.js';
import type { CompactTarget } from '../context/auto-compact-dispatcher.js';
import type { ContextPercentProbe, InFlightBatchProbe } from '../context/auto-compact-types.js';
import type { HarnessWindowSyncResult } from '../context/harness-window-config.js';
import type {
  CompactLifecycleRecord,
  CompactLifecycleStage
} from '../compact-statusline/compact-lifecycle-store.js';
import type { evaluateAutoCompactDecision } from './auto-compact-decision.js';

export interface AutoCompactInput {
  /** Project root for context (default cwd). */
  readonly projectRoot: string;
  /**
   * Caller-provided in-flight batch probe (default false). Slice
   * 4.0.8 (D4d): production callers should pass a `probeInflightBatch`
   * function (see below). The legacy `inFlightBatch` boolean
   * remains as a TEST-ONLY seam — the CLI gates it behind
   * `process.env.PEAKS_TEST_SEAM === '1'` so a production run
   * never consults the boolean as truth.
   */
  readonly inFlightBatch?: InFlightBatchProbe | undefined;
  /**
   * Slice 4.0.8 (D4d): graph-only in-flight probe. When supplied,
   * the orchestrator calls this function and uses the boolean
   * result as the production `inFlightBatch` signal. The legacy
   * boolean parameter is suppressed in production callers — the
   * CLI's `--in-flight-batch` flag is gated behind
   * `PEAKS_TEST_SEAM === '1'`. The pure decision function
   * `evaluateAutoCompactDecision` retains the boolean signature
   * for the test seam + the red-line override.
   */
  readonly probeInflightBatch?: (() => boolean) | undefined;
  /**
   * Force execute even when ratio < threshold (test seam). In
   * production this is always `false` — peaks-loop drives compact
   * autonomously at 0.85+ with zero human / zero LLM intervention.
   */
  readonly force?: boolean | undefined;
  /**
   * INERT — nothing reads this. It is threaded from the CLI's
   * `--bypass-red-line` (a published flag, kept for backward compatibility;
   * see the option's own note) down to `evaluateAutoCompactDecision`, where the
   * red-line branch ignores it.
   *
   * Why nothing reads it any more: it used to skip a gate that refused to
   * dispatch below 0.85. That gate was removed (slice
   * compact a running session, so the refusal could not shorten the wait it
   * was waiting for, and it deadlocked the runner at the worst moment. With the
   * gate gone, the red line still ASKS the harness to compact (when it always
   * did) and no longer needs a bypass. Kept as a field so the published
   * signature does not change under callers that pass it.
   */
  readonly bypassRedLine?: boolean | undefined;
  /** Current session id (default = resolve via session-id-service). */
  readonly sessionId?: string | undefined;
  /** Injectable env for IDE detection (test seam). */
  readonly env?: NodeJS.ProcessEnv | undefined;
  /** Injectable clock for mtime checks (test seam). */
  readonly now?: Date | undefined;
  /**
   * the compact should target. Default `'main'` — the orchestrator
   * (peaks-code body) runs in the main-session Claude Code window and
   * wants to compress *its* context. Sub-agent shells pass
   * `'sub-agent'` to preserve the legacy shell-spawn behaviour.
   */
  readonly target?: CompactTarget | undefined;
  /**
   * `'standard'` (v2.13.0 zero-pause contract, 0.85/0.95). `'partial'`
   * fires earlier (0.70/0.85) for 24h long-run scenarios. CLI flag
   * `--mode <mode>` overrides the 24h-mode auto-detection.
   */
  readonly mode?: AutoCompactMode | undefined;
  /**
   * every lifecycle stage this process actually proved. Telemetry
   * only — it can neither change the threshold decision nor the
   * dispatch outcome, and a throwing observer is swallowed.
   */
  readonly onLifecycleStage?:
    ((stage: CompactLifecycleStage, record: CompactLifecycleRecord) => void) | undefined;
  /**
   * Test-only injection seams for lifecycle failure paths. NEVER set in
   * production — these exist so the unit suite can drive the `failed`
   * transition and the store-outage branch without mocking the SUT.
   * Each flag toggles a single, well-scoped throw at a documented point:
   *   - `failPreparing`: throw inside the checkpoint/plan/recovery phase
   *     (so the record rests at `failedAt: 'preparing'`)
   *   - `failCompacting`: throw inside the IDE-dispatch phase
   *     (so the record rests at `failedAt: 'compacting'`)
   *   - `failLifecycleWrite`: make every lifecycle-store write throw
   *     (so the compact envelope is proven independent of telemetry)
   */
  readonly testHooks?: AutoCompactTestHooks | undefined;
}

/**
 * Test-only injection seams. The `boolean` shape (vs. an injected error)
 * is deliberate: tests assert the *transition*, not the thrown value —
 * the value would just be a brittle fingerprint. The real error path
 * is still exercised by `summarizeLifecycleError`'s tests.
 */
export interface AutoCompactTestHooks {
  readonly failPreparing?: boolean | undefined;
  readonly failCompacting?: boolean | undefined;
  readonly failLifecycleWrite?: boolean | undefined;
}

/** The decision shape `evaluateAutoCompactDecision` returns. */
export type AutoCompactDecision = ReturnType<typeof evaluateAutoCompactDecision>;

/**
 * One probe's worth of resolved state, threaded through the whole run so each
 * phase takes the same object rather than a widening parameter list.
 */
export type CompactRun = {
  readonly input: AutoCompactInput;
  readonly sessionId: string;
  readonly mode: AutoCompactMode;
  readonly probe: ContextPercentProbe;
  readonly harnessWindow: HarnessWindowSyncResult | null;
  readonly decision: AutoCompactDecision;
  readonly isRedLine: boolean;
  readonly now: Date;
};
