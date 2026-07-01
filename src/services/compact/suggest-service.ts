/**
 * `peaks compact suggest` — strategic-compact service layer.
 *
 * Mirrors the ECC `suggest-compact.js` PreToolUse hook's two-signal
 * suggestion logic but as a deterministic, machine-enforced CLI
 * primitive. Two signals:
 *
 *   1. Context size (primary) — read latest usage row from
 *      `.peaks/_runtime/<sid>/usage.jsonl`. Suggest at
 *      COMPACT_CONTEXT_THRESHOLD (default 160k on 200k window, 250k
 *      on 1M window) and re-remind every COMPACT_CONTEXT_INTERVAL
 *      tokens (default 60k). A 1M window is detected when observed
 *      tokens exceed 200k AND the `modelKind: '1m'` marker is on
 *      the latest usage row, or when PEAKS_MODEL_KIND=1m is set.
 *
 *   2. Tool-call count (secondary) — read latest tool-call counter
 *      from the same usage.jsonl. Suggest at COMPACT_THRESHOLD
 *      (default 50) and re-remind every 25 calls.
 *
 * If usage.jsonl is absent (no peaks-loop session yet), fall back to
 * PEAKS_CONTEXT_TOKENS / PEAKS_TOOL_CALLS env vars. If neither signal
 * is available, the primitive returns `shouldSuggest: false` and a
 * `dataUnavailable: true` flag — never throws.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PHASE_TRANSITIONS,
  lookupPhaseTransition,
  buildSuggestedCompactMessage,
  SURVIVAL_TABLE,
  type Phase,
  type Severity
} from './decision-tables.js';

/** Snapshot of the survival table for the dry-run envelope. */
const SURVIVAL_TABLE_PERSISTS = SURVIVAL_TABLE.persists;
const SURVIVAL_TABLE_LOST = SURVIVAL_TABLE.lost;

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

interface UsageRow {
  ts?: string;
  tokens?: number;
  toolCalls?: number;
  modelKind?: '200k' | '1m';
}

function readLatestUsageRow(projectRoot: string, sessionId: string): UsageRow | null {
  const path = join(projectRoot, '.peaks', '_runtime', sessionId, 'usage.jsonl');
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf8');
    const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
    if (lines.length === 0) return null;
    const last = lines[lines.length - 1];
    if (last === undefined) return null;
    return JSON.parse(last) as UsageRow;
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
}

function parseIntEnv(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (typeof raw !== 'string' || raw.length === 0) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function detectWindowKind(env: NodeJS.ProcessEnv, observedTokens: number, rowModelKind: string | undefined): WindowKind {
  if (rowModelKind === '1m') return '1m';
  if (env['PEAKS_MODEL_KIND'] === '1m') return '1m';
  // Heuristic from SKILL.md: a `[1m]` model marker OR observed tokens
  // already exceed the 200k window. We use observed as the second
  // signal only.
  if (observedTokens > DEFAULT_CONTEXT_THRESHOLD_200K) return '1m';
  return '200k';
}

export function suggestCompact(options: SuggestOptions): SuggestResult {
  const env = options.env ?? process.env;
  const contextThreshold = parseIntEnv(env, 'COMPACT_CONTEXT_THRESHOLD', 0);
  const contextInterval = parseIntEnv(env, 'COMPACT_CONTEXT_INTERVAL', DEFAULT_CONTEXT_INTERVAL);
  const toolCallThreshold = parseIntEnv(env, 'COMPACT_THRESHOLD', DEFAULT_TOOL_CALL_THRESHOLD);

  let tokensUsed = 0;
  let toolCalls = 0;
  let modelKind: string | undefined;
  let source: 'usage-jsonl' | 'env-vars' | 'none' = 'none';

  if (options.sessionId !== null) {
    const row = readLatestUsageRow(options.projectRoot, options.sessionId);
    if (row !== null) {
      if (typeof row.tokens === 'number' && Number.isFinite(row.tokens)) tokensUsed = row.tokens;
      if (typeof row.toolCalls === 'number' && Number.isFinite(row.toolCalls)) toolCalls = row.toolCalls;
      if (typeof row.modelKind === 'string') modelKind = row.modelKind;
      source = 'usage-jsonl';
    }
  }

  if (source === 'none') {
    const envTokens = env['PEAKS_CONTEXT_TOKENS'];
    if (typeof envTokens === 'string' && envTokens.length > 0) {
      const parsed = Number.parseInt(envTokens, 10);
      if (Number.isFinite(parsed) && parsed >= 0) {
        tokensUsed = parsed;
        source = 'env-vars';
      }
    }
    const envCalls = env['PEAKS_TOOL_CALLS'];
    if (typeof envCalls === 'string' && envCalls.length > 0) {
      const parsed = Number.parseInt(envCalls, 10);
      if (Number.isFinite(parsed) && parsed >= 0) {
        toolCalls = parsed;
        source = 'env-vars';
      }
    }
  }

  const windowKind = detectWindowKind(env, tokensUsed, modelKind);
  const windowCapacity = windowKind === '1m' ? 1_000_000 : 200_000;
  const effectiveContextThreshold = contextThreshold > 0
    ? contextThreshold
    : (windowKind === '1m' ? DEFAULT_CONTEXT_THRESHOLD_1M : DEFAULT_CONTEXT_THRESHOLD_200K);
  const ratio = windowCapacity > 0 ? tokensUsed / windowCapacity : 0;

  const dataUnavailable = tokensUsed === 0 && toolCalls === 0;

  // Two-signal suggestion. The context signal is primary: the LLM
  // gets a real "/compact" recommendation only when context-size OR
  // tool-count crosses the threshold AND we have non-zero data.
  let shouldSuggest = false;
  let reason = 'below-threshold';
  if (!dataUnavailable) {
    if (contextThreshold !== 0 && tokensUsed >= effectiveContextThreshold) {
      shouldSuggest = true;
      const overBy = tokensUsed - effectiveContextThreshold;
      reason = `context >= ${effectiveContextThreshold} on ${windowKind} window (over by ${overBy} tokens)`;
    } else if (toolCalls >= toolCallThreshold) {
      shouldSuggest = true;
      reason = `tool-calls >= ${toolCallThreshold} (count=${toolCalls})`;
    }
  }

  return {
    shouldSuggest,
    reason,
    ratio,
    windowKind,
    tokensUsed,
    toolCalls,
    thresholds: {
      contextTokens: effectiveContextThreshold,
      contextInterval,
      toolCalls: toolCallThreshold
    },
    dataUnavailable,
    source
  };
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

export function dryRunCompact(options: DryRunOptions): DryRunResult {
  const suggest = suggestCompact({
    projectRoot: options.projectRoot,
    sessionId: options.sessionId,
    ...(options.env !== undefined ? { env: options.env } : {})
  });
  const hasPhase = options.from !== undefined && options.to !== undefined;
  const recommend = hasPhase
    ? buildRecommendEnvelope(options.from as Phase, options.to as Phase)
    : {
        from: null,
        to: null,
        shouldCompact: false,
        severity: null,
        rationale: null,
        suggestedMessage: null
      };
  // Action threshold: either suggest-signal OR recommend=yes. The LLM
  // is the final arbiter; the primitive just surfaces the composite
  // signal.
  const action: 'compact' | 'skip' =
    suggest.shouldSuggest || recommend.shouldCompact ? 'compact' : 'skip';
  return {
    action,
    suggest,
    recommend,
    survival: { persists: SURVIVAL_TABLE_PERSISTS, lost: SURVIVAL_TABLE_LOST }
  };
}

function buildRecommendEnvelope(from: Phase, to: Phase): {
  from: Phase;
  to: Phase;
  shouldCompact: boolean;
  severity: Severity;
  rationale: string;
  suggestedMessage: string;
} {
  const lookup = lookupPhaseTransition(from, to);
  const shouldCompact = lookup.severity === 'yes' || lookup.severity === 'maybe';
  return {
    from,
    to,
    shouldCompact,
    severity: lookup.severity,
    rationale: lookup.rationale,
    suggestedMessage: buildSuggestedCompactMessage(from, to, lookup.severity)
  };
}

export function buildRecommendEnvelopePure(from: Phase, to: Phase): {
  from: Phase;
  to: Phase;
  shouldCompact: boolean;
  severity: Severity;
  rationale: string;
  suggestedMessage: string;
} {
  return buildRecommendEnvelope(from, to);
}

// Re-export phase primitives for callers that don't want to traverse
// decision-tables. The CLI command file imports `isPhase` from here
// to keep the validation path co-located with the recommend envelope
// builder.
export {
  PHASE_TRANSITIONS,
  lookupPhaseTransition,
  buildSuggestedCompactMessage,
  PHASES,
  isPhase,
  SURVIVAL_TABLE
} from './decision-tables.js';
export type { Phase, Severity } from './decision-tables.js';
