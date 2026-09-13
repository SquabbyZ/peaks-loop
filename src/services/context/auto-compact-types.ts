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
 *   - 95%  RED LINE           — peaks-loop asks the harness to
 *                                compact and says it is waiting.
 *                                Nothing is blocked: peaks-loop has
 *                                no executor for a running session,
 *                                so it cannot gate dispatch — and
 *                                claiming to was the deadlock. See
 *                                the correction note below.
 *
 * Why 0.85 / 0.95 split: the LLM uses the 0.85–0.95 zone to do
 * intelligent convergence — wait for in-flight sub-agents, finish
 * the current todo row, persist a checkpoint, then compact. peaks-loop
 * provides the toolkit; the LLM picks the moment. At 0.95 peaks-loop
 * requests the compact outright and says it is waiting.
 *
 * Slice 2026-09-13-auto-compact-trigger-ownership corrected two claims that
 * used to head this file: the red line does NOT "refuse to dispatch any
 * further sub-agent" (peaks-loop has no way to compact a running session, so
 * such a refusal gated nothing and deadlocked the runner), and the window
 * these ratios divide by is now the same one peaks-loop configures for the
 * harness — see `harness-window-config.ts`.
 */
import type { HarnessWindowSyncResult } from './harness-window-config.js';

export const AUTO_COMPACT_SOFT_WARN_RATIO = 0.5;
// Part 22: auto-fire threshold (was 0.85 pre-compact zone where
// the LLM had to decide; LLM misjudged 0.85–0.95 and only fired
// at 0.95, which let the LLM time the run anyway). Lowered to
// 0.80 so peaks-loop auto-fires compact without LLM involvement
// — the LLM keeps working, peaks-loop preempts when ratio crosses
// the new threshold.
export const AUTO_COMPACT_AUTO_FIRE_RATIO = 0.80;
export const AUTO_COMPACT_PRE_COMPACT_RATIO = 0.85;
export const AUTO_COMPACT_RED_LINE_RATIO = 0.95;
export const AUTO_COMPACT_THRESHOLD_RATIO = AUTO_COMPACT_AUTO_FIRE_RATIO;

/** Single source of truth for "what should we do at ratio X?" */
export type CompactTrigger =
  | { kind: 'none' }
  | { kind: 'soft-warn'; ratio: number; message: string }
  /**
   * Part 22: auto-fire zone (0.80 ≤ ratio < 0.85). peaks-loop
   * preempts and runs `peaks code auto-compact` itself
   * without LLM involvement. The LLM is not asked to "decide";
   * the toolkit is applied synchronously.
   */
  | { kind: 'auto-fire'; ratio: number; message: string }
  /**
   * Pre-compact zone (0.85 ≤ ratio < 0.95): LLM-runner can still
   * pre-empt the compact for one in-flight sub-agent or one
   * todo row, but peaks-loop flags this as the last safe
   * window. Kept for backward compat; in practice peaks-loop
   * auto-fired at 0.80 already.
   */
  | { kind: 'pre-compact'; ratio: number; message: string; toolkitReady: true }
  /**
   * Red line (ratio ≥ 0.95): peaks-loop asks the harness to compact and says
   * it is waiting. Dispatch is NOT blocked — see `redLineRequested`.
   */
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

/**
 * Old → new map of envelope fields that were renamed but are still emitted
 * under their old name as deprecated aliases.
 *
 * One definition, used both as the `deprecatedFields` value the envelopes
 * carry and as the registry the type's `@deprecated` tags describe, so the
 * alias and its record cannot drift apart into two lists.
 *
 * `redLineGated` → `redLineRequested` (slice
 * 2026-09-13-auto-compact-trigger-ownership): nothing was ever gated. See
 * `redLineGated` on the dispatch branches for why the alias is kept rather
 * than deleted.
 */
export const DEPRECATED_ENVELOPE_FIELDS: Readonly<Record<string, string>> = {
  redLineGated: 'redLineRequested'
};

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
        /**
         * Slice 2026-09-13-auto-compact-trigger-ownership: what syncing the
         * harness auto-compact window did on this probe. `null` = the active
         * adapter declares no such knob. Present so the write is VISIBLE —
         * the harness reports an override silently, so peaks-loop must not.
         */
        readonly harnessWindow?: HarnessWindowSyncResult | null;
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
        /**
         * Slice 2026-07-28 (rid-027): which mode's threshold table
         * was used. Defaults to `'standard'` (0.85/0.95). `'partial'`
         * (0.70/0.85) is selected when 24h mode is active or the
         * caller passes `--mode partial`.
         */
        readonly mode?: 'standard' | 'partial';
        /**
         * True when the ratio had crossed the red line and peaks-loop asked
         * the harness to compact.
         *
         * Renamed from `redLineGated` in slice
         * 2026-09-13-auto-compact-trigger-ownership: nothing is gated. The
         * old name asserted a block peaks-loop cannot enforce (it has no
         * executor for a running session), and acting on that assertion is
         * what deadlocked the runner.
         */
        readonly redLineRequested?: boolean;
        /**
         * Deprecated alias of `redLineRequested` — same value, written by the
         * same statement, so the two can never disagree.
         *
         * Kept because the old name SHIPPED: `redLineGated` is in every release
         * from 2.13.0 through 4.0.46, so a script outside this repo that reads
         * it exists in the wild. Dropping the key would hand that script
         * `undefined` instead of the boolean it branches on — no error, no log,
         * just a silently different branch. This is the same call this slice
         * already made for `--bypass-red-line`: stop advertising a
         * wrong-named surface, do not delete it out from under a published
         * caller. That flag is likewise kept with nothing reading it.
         *
         * There is deliberately NO removal date here. A date would be a promise
         * with no mechanism behind it; removing a published field is a MAJOR
         * decision to be taken on purpose, not one this comment can schedule.
         *
         * `deprecatedFields` (below) is the part a runtime consumer can
         * actually see — a `@deprecated` tag is not.
         */
        readonly redLineGated?: boolean;
        /**
         * Old → new map of the envelope fields still emitted as deprecated
         * aliases, so a consumer that parses JSON can discover the rename
         * without reading this file.
         *
         * Why it has to exist: the consumers a rename breaks are precisely the
         * ones that never read `auto-compact-types.ts`. A type comment reaches
         * the compiler and the next editor, not a script parsing a CLI
         * envelope, which is what made the rename silent in the first place.
         * This puts the fact in the envelope they already read.
         *
         * Absent on the branches that carry no renamed field.
         */
        readonly deprecatedFields?: Readonly<Record<string, string>>;
        /** See the `AUTO_COMPACT_SKIP` data shape above. */
        readonly harnessWindow?: HarnessWindowSyncResult | null;
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
   *   - `user-overridden`         (v2.14.0 rid-002: explicit `--prompt-size
   *                                <bytes>` from the CLI / hook wrapper —
   *                                takes priority P0 over EVERY other source.
   *                                Mac escape hatch.)
   *   - `${ideId}-env`            (e.g. `claude-code-env`)
   *   - `statusline-poll`         (Claude Code MVP fallback)
   *   - `transcript-estimate`     (v2.14.0 Mac-aware: recursive
   *                                readdir under ~/.claude/projects/
   *                                finds <sid>.jsonl and reports
   *                                contextTokens / contextWindowTokens
   *                                from the LATEST message.usage entry —
   *                                token-based + model-aware; a real
   *                                signal, NOT a hard gate)
   *   - `conservative-fallback`   (no signal available — caller
   *                                MUST NOT treat as hard gate)
   * Future IDEs may add per-ide sources; the type accepts any
   * string to keep the schema forward-compatible.
   */
  readonly source: string;
  readonly rawBytes?: number;
  readonly capacityBytes?: number;
  /**
   * Token-based numerator for `transcript-estimate`: the observed
   * `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`
   * from the LATEST transcript `message.usage` entry. Undefined for byte /
   * percent sources (`user-overridden`, `${ideId}-env`, `statusline-poll`).
   */
  readonly rawTokens?: number;
  /**
   * Token-based denominator for `transcript-estimate`: the model's context
   * window in tokens (`modelContextWindowTokens`). Undefined for byte /
   * percent sources.
   */
  readonly capacityTokens?: number;
  /**
   * Which layer produced `capacityTokens` (token-based sources only):
   *   - `env-override`    — `PEAKS_CONTEXT_WINDOW_TOKENS`
   *   - `config`          — `context.windowTokens` (`peaks config set`)
   *   - `model-heuristic` — `[1M]` suffix / known-1M model allowlist
   *   - `default`         — 200K safe default
   * Undefined for byte / percent sources (`user-overridden`, `${ideId}-env`,
   * `statusline-poll`), which have no token window. Slice
   * 2026-09-09-context-window-override: lets a wrong window be diagnosed in
   * one read instead of guessing which heuristic fired.
   */
  readonly capacitySource?: string;
  readonly ide: string;
  readonly capturedAt: string;
}