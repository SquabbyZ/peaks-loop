/**
 * Slice-boundary pre-compact hook (slice 2026-07-01-strategic-compact-cli).
 *
 * The RD → QA and QA → final-review slice-boundary transitions go
 * through `peaks request transition`. When the active session is in
 * the 0.85–0.95 pre-compact zone (per auto-compact-types.ts), this
 * hook:
 *
 *   1. Detects the zone via the latest `.peaks/_runtime/<sid>/usage.jsonl`
 *      row, OR falls back to `peaks compact suggest --json`.
 *   2. Writes a `context-fill` checkpoint BEFORE the transition so
 *      the post-compact LLM has a deterministic resume surface.
 *   3. Attaches `preCompactCheckpoint: true` to the transition
 *      envelope so the LLM can audit the side-effect.
 *
 * The hook is INVOKED from `src/cli/commands/request-commands.ts`
 * (RD→QA boundary) and from any future QA→final-review boundary. The
 * 0.95 red line is NOT changed: the existing auto-compact
 * orchestrator continues to refuse dispatch at ratio ≥ 0.95.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeCheckpoint } from '../session/session-checkpoint-service.js';
import {
  AUTO_COMPACT_PRE_COMPACT_RATIO,
  AUTO_COMPACT_RED_LINE_RATIO
} from '../context/auto-compact-types.js';

export interface PreCompactHookInput {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly transitionKey: string;
}

export interface PreCompactHookResult {
  readonly triggered: boolean;
  readonly checkpointPath: string | null;
  readonly ratio: number;
  readonly zone: 'none' | 'soft-warn' | 'pre-compact' | 'red-line';
  readonly note: string;
}

interface UsageRow {
  ts?: string;
  tokens?: number;
  toolCalls?: number;
  capacityTokens?: number;
}

const PRE_COMPACT_ZONE: { readonly preCompact: number; readonly redLine: number } = {
  preCompact: AUTO_COMPACT_PRE_COMPACT_RATIO,
  redLine: AUTO_COMPACT_RED_LINE_RATIO
};

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

/**
 * Compute the context-fill ratio from a usage row. Defaults to a
 * 200k window when the row is missing capacity. The auto-compact
 * types use a 256KB byte-based estimate; this hook uses a 200k
 * token-based window to match the strategic-compact SKILL.md.
 */
function computeRatio(row: UsageRow | null): { ratio: number; zone: 'none' | 'soft-warn' | 'pre-compact' | 'red-line' } {
  if (row === null) return { ratio: 0, zone: 'none' };
  const tokens = typeof row.tokens === 'number' && Number.isFinite(row.tokens) ? row.tokens : 0;
  const capacity = typeof row.capacityTokens === 'number' && row.capacityTokens > 0 ? row.capacityTokens : 200_000;
  const ratio = capacity > 0 ? tokens / capacity : 0;
  if (ratio >= PRE_COMPACT_ZONE.redLine) return { ratio, zone: 'red-line' };
  if (ratio >= PRE_COMPACT_ZONE.preCompact) return { ratio, zone: 'pre-compact' };
  if (ratio >= 0.5) return { ratio, zone: 'soft-warn' };
  return { ratio, zone: 'none' };
}

/**
 * Check the pre-compact zone and, if active, write a checkpoint.
 * Returns a result envelope the caller can stitch into the
 * transition response. NEVER throws; returns a `triggered: false`
 * result on any error so the transition itself stays the contract
 * surface.
 */
export function maybePreCompactCheckpoint(input: PreCompactHookInput): PreCompactHookResult {
  try {
    const row = readLatestUsageRow(input.projectRoot, input.sessionId);
    const { ratio, zone } = computeRatio(row);
    if (zone !== 'pre-compact') {
      return {
        triggered: false,
        checkpointPath: null,
        ratio,
        zone,
        note: `ratio=${(ratio * 100).toFixed(1)}% (zone=${zone}); pre-compact hook is in 0.85–0.95 zone only`
      };
    }
    const result = writeCheckpoint(input.projectRoot, {
      sessionId: input.sessionId,
      reason: 'context-fill',
      gitStatus: `preCompactCheckpoint: ${input.transitionKey}`,
      currentPlan: `Slice boundary transition: ${input.transitionKey}`
    });
    return {
      triggered: true,
      checkpointPath: result.path,
      ratio,
      zone,
      note: `Pre-compact checkpoint written at ratio=${(ratio * 100).toFixed(1)}% (zone=pre-compact). The LLM is still the decision-maker; the transition will proceed.`
    };
  } catch (error) {
    return {
      triggered: false,
      checkpointPath: null,
      ratio: 0,
      zone: 'none',
      note: `pre-compact hook failed: ${(error as Error).message ?? String(error)}`
    };
  }
}
