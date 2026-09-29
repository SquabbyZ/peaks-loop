/**
 * `src/services/compact/suggest-types.ts`
 *
 * Type declarations and default-threshold constants extracted verbatim
 * from `suggest-service.ts` (wave 2, file-size cap campaign) so the
 * service stays under the 300 raw-line cap. Mechanical move only —
 * `suggest-service.ts` re-exports every public name from this module.
 */
import type { Phase, Severity } from './decision-tables.js';

/** Token window sizes supported by the suggest service. */
export type WindowKind = '200k' | '1m';

export interface SuggestOptions {
  readonly projectRoot: string;
  readonly sessionId: string | null;
  readonly env?: NodeJS.ProcessEnv;
}

export interface SuggestResult {
  readonly shouldSuggest: boolean;
  readonly reason: string;
  readonly ratio: number;
  readonly windowKind: WindowKind;
  readonly tokensUsed: number;
  readonly toolCalls: number;
  readonly thresholds: {
    readonly contextTokens: number;
    readonly contextInterval: number;
    readonly toolCalls: number;
  };
  readonly dataUnavailable: boolean;
  readonly source: 'usage-jsonl' | 'env-vars' | 'none';
}

/** Default tool-call threshold before first suggestion. */
export const DEFAULT_TOOL_CALL_THRESHOLD = 50;
/** Default additional tool calls before the suggestion repeats. */
export const TOOL_CALL_REMIND_STEP = 25;
/** Default context-size threshold on a 200k window. */
export const DEFAULT_CONTEXT_THRESHOLD_200K = 160_000;
/** Default context-size threshold on a 1M window. */
export const DEFAULT_CONTEXT_THRESHOLD_1M = 250_000;
/** Default re-remind interval for context size. */
export const DEFAULT_CONTEXT_INTERVAL = 60_000;

export interface UsageRow {
  ts?: string;
  tokens?: number;
  toolCalls?: number;
  modelKind?: '200k' | '1m';
}

/**
 * `peaks compact dry-run` envelope — composed of (a) suggest, (b)
 * recommend, (c) survival. Pure composition over the helpers; no
 * additional I/O. The CLI emits this so the LLM can decide in one
 * tool-call whether to act.
 */
export interface DryRunOptions {
  readonly projectRoot: string;
  readonly sessionId: string | null;
  readonly from?: Phase;
  readonly to?: Phase;
  readonly env?: NodeJS.ProcessEnv;
}

export interface DryRunResult {
  readonly action: 'compact' | 'skip';
  readonly suggest: SuggestResult;
  readonly recommend: {
    readonly from: Phase | null;
    readonly to: Phase | null;
    readonly shouldCompact: boolean;
    readonly severity: Severity | null;
    readonly rationale: string | null;
    readonly suggestedMessage: string | null;
  };
  readonly survival: {
    readonly persists: readonly string[];
    readonly lost: readonly string[];
  };
}
