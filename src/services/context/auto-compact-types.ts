/**
 * Auto-compact shared types (v2.13.0 AC-1..AC-4).
 *
 * Two-tier threshold model — peaks-loop is project-aware and the LLM
 * is the decision-maker:
 *
 *   - 50%  soft warn          — log a one-line info row; continue.
 *   - 85%  pre-compact zone   — peaks-loop prepares the convergence
 *                                toolkit (checkpoint + convergence
 *                                plan + auto-decisions log +
 *                                IDE-compact dispatcher). The LLM
 *                                DECIDES when (or whether) to fire
 *                                compact during this zone. The
 *                                toolkit is "ready to use" so the
 *                                LLM doesn't lose context to a
 *                                last-second `/compact` panic.
 *   - 95%  RED LINE           — peaks-loop refuses to dispatch any
 *                                further sub-agent and synchronously
 *                                triggers IDE-side compact. At 95%+
 *                                the context window is too tight to
 *                                continue safely; the LLM cannot
 *                                opt out. This is the compact red
 *                                line that guarantees the LLM-runner
 *                                keeps working with context < 95%.
 *
 * Why 0.85 / 0.95 split: the LLM uses the 0.85–0.95 zone to do
 * intelligent convergence — wait for in-flight sub-agents, finish
 * the current todo row, persist a checkpoint, then compact. peaks-loop
 * provides the toolkit; the LLM picks the moment. At 0.95 the window
 * is gone and peaks-loop takes over synchronously to keep the runner
 * alive.
 */

export const AUTO_COMPACT_SOFT_WARN_RATIO = 0.5;
export const AUTO_COMPACT_PRE_COMPACT_RATIO = 0.85;
export const AUTO_COMPACT_RED_LINE_RATIO = 0.95;
export const AUTO_COMPACT_THRESHOLD_RATIO = AUTO_COMPACT_PRE_COMPACT_RATIO;

/** Single source of truth for "what should we do at ratio X?" */
export type CompactTrigger =
  | { kind: 'none' }
  | { kind: 'soft-warn'; ratio: number; message: string }
  /** Pre-compact zone (0.85 ≤ ratio < 0.95): toolkit ready; LLM picks the moment. */
  | { kind: 'pre-compact'; ratio: number; message: string; toolkitReady: true }
  /** Red line (ratio ≥ 0.95): peaks-loop forces synchronous compact; LLM cannot opt out. */
  | { kind: 'red-line'; ratio: number; message: string };

/** Caller-side info about sub-agent batches in flight (D6.e). */
export interface InFlightBatchProbe {
  readonly hasInFlightBatch: boolean;
  readonly sharedChannelEntries?: number;
  readonly batchId?: string;
}

/** What the post-compact LLM reads to resume exactly where it stopped. */
export interface ConvergencePlan {
  readonly schemaVersion: 1;
  readonly sessionId: string;
  readonly projectRoot: string;
  readonly createdAt: string;
  readonly ratio: number;
  readonly checkpointPath: string;
  readonly nextActions: readonly string[];
  readonly resumeHint: string;
}

/** Per-IDE compact pathway chosen by AC-3. */
export interface CompactDispatchResult {
  readonly ok: boolean;
  readonly ide: string;
  readonly pathway: 'ide-native' | 'llm-self-compress' | 'shell-exec' | 'noop';
  readonly message: string;
}

/** Final envelope returned by `runAutoCompact`. */
export type AutoCompactResult =
  | {
      readonly ok: false;
      readonly code: 'AUTO_COMPACT_NO_SESSION';
      readonly message: string;
      readonly nextActions: readonly string[];
    }
  | {
      readonly ok: true;
      readonly code: 'AUTO_COMPACT_SKIP' | 'AUTO_COMPACT_WAIT';
      readonly message: string;
      readonly data: {
        readonly sessionId: string;
        readonly ratio: number;
        readonly source: string;
        readonly decision: 'below-threshold' | 'in-flight-batch';
      };
    }
  | {
      readonly ok: boolean;
      readonly code: 'AUTO_COMPACT_DISPATCHED' | 'AUTO_COMPACT_DISPATCH_FAILED' | 'AUTO_COMPACT_RED_LINE';
      readonly message: string;
      readonly data: {
        readonly sessionId: string;
        readonly ratio: number;
        readonly source: string;
        readonly checkpointPath?: string;
        readonly convergencePlan?: ConvergencePlan;
        readonly dispatch?: CompactDispatchResult;
        /**
         * Slice 2026-06-28-code-mode-bypass-fix (defect #4): which
         * session the compact targeted. `'main'` (default) means the
         * main-session Claude Code window will fire `/compact` on its
         * next turn; `'sub-agent'` means the dispatcher shell-spawned
         * `/compact` in a child process (legacy behaviour).
         */
        readonly target?: 'main' | 'sub-agent';
        readonly redLineGated?: boolean;
      };
    };

/**
 * Probe shape returned by AC-1 (`readContextPercent`). The source
 * field tells callers how the ratio was obtained (env-var, statusline
 * poller, IDE hook, conservative fallback) so the CLI can show
 * "context % (source: statusline-poll)" and the LLM can trust it.
 */
export interface ContextPercentProbe {
  readonly ratio: number;
  /**
   * Adapter-driven source tag. Fixed values:
   *   - `${ideId}-env`            (e.g. `claude-code-env`)
   *   - `statusline-poll`         (Claude Code MVP fallback)
   *   - `conservative-fallback`   (transcript size estimate OR
   *                                no signal available — caller
   *                                MUST NOT treat as hard gate)
   * Future IDEs may add per-ide sources; the type accepts any
   * string to keep the schema forward-compatible.
   */
  readonly source: string;
  readonly rawBytes?: number;
  readonly capacityBytes?: number;
  readonly ide: string;
  readonly capturedAt: string;
}