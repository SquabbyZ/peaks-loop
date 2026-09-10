/**
 * Slice 2026-09-10-three-fixes (Slice 2) — proactive context-consumer hint.
 *
 * `peaks code context-audit` (Slice A, same day) already reports WHAT fills
 * the window, but only when someone remembers to run it. The Step 0.8
 * PreToolUse gate (`peaks code gate-step-08`) runs before every Bash call, so
 * it is the natural place to surface the single largest consumer — provided
 * that costs nothing measurable.
 *
 * Cost contract (the whole point of this module):
 *   - The ratio probe is the cheap, adapter-driven `readContextPercent`
 *     (env-var → statusline file read; the transcript fallback is a
 *     bounded backwards scan, never a whole-file read).
 *   - The expensive part — the transcript scan inside `auditContext` — runs
 *     at most ONCE per TTL window. Its result is cached under
 *     `.peaks/_runtime/<sid>/context-audit-hint.json`; a fresh entry
 *     short-circuits the scan entirely.
 *   - Every failure is fail-soft: a missing/corrupt cache, an unavailable
 *     transcript, an adapter that cannot locate one — all yield `null`
 *     (emit nothing). The gate never blocks and never gains more than ONE
 *     line.
 *
 * The cache deliberately records FAILED audits too (with `available:false`),
 * so a broken transcript cannot turn every Bash call back into a scan.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { atomicWriteJson } from '../ide/shared/atomic-json.js';
import { readContextPercent } from './auto-compact-reader.js';
import { auditContext, type ContextAuditInput, type ContextAuditResult } from './context-audit.js';

/** Only surface a hint once the window is this full. */
export const CONTEXT_HINT_RATIO_THRESHOLD = 0.7;
/** Minimum cache TTL — a fresh entry must skip the transcript scan. */
export const CONTEXT_HINT_CACHE_TTL_MS = 5 * 60 * 1000;
/** Per-session cache file name (under `.peaks/_runtime/<sid>/`). */
export const CONTEXT_HINT_CACHE_FILE_NAME = 'context-audit-hint.json';

/** Cached top-consumer snapshot — one audit result, no transcript content. */
export interface ContextHintCacheEntry {
  /** Epoch ms when the audit ran (TTL anchor). */
  readonly cachedAt: number;
  /** False when the audit could not read the transcript. */
  readonly available: boolean;
  /** Ratio observed when the audit ran (informational). */
  readonly ratio: number;
  readonly tool: string | null;
  readonly key: string | null;
  readonly bytes: number;
  readonly pctOfTotal: number;
  readonly count: number;
}

export interface ContextAuditHintInput {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly outerSessionId?: string | null | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  /** Clock override (test seam). */
  readonly nowMs?: number | undefined;
  /** Cache path override (test seam; default is per-session under `_runtime`). */
  readonly cachePath?: string | undefined;
  /** Ratio probe override (test seam). Returns null when unknown. */
  readonly probeRatio?: (() => number | null) | undefined;
  /** Audit runner override (test seam; lets a test count scans). */
  readonly runAudit?: ((input: ContextAuditInput) => ContextAuditResult) | undefined;
}

/**
 * `<projectRoot>/.peaks/_runtime/<sid>/context/context-audit-hint.json`
 * (gitignored). The `context/` bucket mirrors the existing `<sid>/txt/`
 * convention so session-id artifacts stay under `.peaks/_runtime/<sid>/`.
 */
export function contextHintCachePath(projectRoot: string, sessionId: string): string {
  const safeSessionId = sessionId.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  return join(
    projectRoot,
    '.peaks',
    '_runtime',
    safeSessionId.length > 0 ? safeSessionId : 'unknown',
    'context',
    CONTEXT_HINT_CACHE_FILE_NAME
  );
}

/**
 * The single line the gate may append. Names ONE consumer — the largest by
 * tool-result bytes — plus the share and call count that justify the number.
 */
export function formatContextHintLine(entry: ContextHintCacheEntry): string {
  const ratioPct = (entry.ratio * 100).toFixed(1);
  const sharePct = entry.pctOfTotal.toFixed(1);
  const calls = entry.count === 1 ? '1 call' : `${entry.count} calls`;
  return `Context ${ratioPct}% used — top consumer: ${entry.tool} \`${entry.key}\` (${sharePct}% of tool-result bytes, ${calls}). Run \`peaks code context-audit\` for the full breakdown.`;
}

function readCache(cachePath: string): ContextHintCacheEntry | null {
  if (!existsSync(cachePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(cachePath, 'utf8')) as Partial<ContextHintCacheEntry>;
    if (typeof parsed.cachedAt !== 'number' || !Number.isFinite(parsed.cachedAt)) return null;
    if (typeof parsed.available !== 'boolean') return null;
    return {
      cachedAt: parsed.cachedAt,
      available: parsed.available,
      ratio: typeof parsed.ratio === 'number' && Number.isFinite(parsed.ratio) ? parsed.ratio : 0,
      tool: typeof parsed.tool === 'string' ? parsed.tool : null,
      key: typeof parsed.key === 'string' ? parsed.key : null,
      bytes: typeof parsed.bytes === 'number' && Number.isFinite(parsed.bytes) ? parsed.bytes : 0,
      pctOfTotal: typeof parsed.pctOfTotal === 'number' && Number.isFinite(parsed.pctOfTotal) ? parsed.pctOfTotal : 0,
      count: typeof parsed.count === 'number' && Number.isFinite(parsed.count) ? parsed.count : 0,
    };
  } catch {
    return null;
  }
}

/** Never throws: an unavailable ratio probe degrades to "no hint". */
function probeRatioSafe(input: ContextAuditHintInput): number | null {
  if (input.probeRatio !== undefined) {
    try {
      const value = input.probeRatio();
      return typeof value === 'number' && Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  }
  try {
    const probe = readContextPercent({
      projectRoot: input.projectRoot,
      sessionId: input.sessionId,
      outerSessionId: input.outerSessionId ?? undefined,
      env: input.env ?? process.env,
    });
    return Number.isFinite(probe.ratio) ? probe.ratio : null;
  } catch {
    return null;
  }
}

/**
 * Build the ONE optional hint line for the Step 0.8 gate.
 *
 * Returns `null` when: the ratio is unknown or below 0.70, the cache (fresh)
 * says the audit was unavailable, the fresh audit found no groups, or
 * anything throws. Never throws, never blocks.
 */
export function buildContextAuditHint(input: ContextAuditHintInput): string | null {
  try {
    const nowMs = input.nowMs ?? Date.now();
    const ratio = probeRatioSafe(input);
    if (ratio === null || ratio < CONTEXT_HINT_RATIO_THRESHOLD) return null;

    const cachePath = input.cachePath ?? contextHintCachePath(input.projectRoot, input.sessionId);
    const cached = readCache(cachePath);
    // Fresh entry → the transcript scan is skipped entirely (cost guard).
    if (cached !== null && nowMs - cached.cachedAt < CONTEXT_HINT_CACHE_TTL_MS) {
      return cached.available && cached.tool !== null ? formatContextHintLine(cached) : null;
    }

    // Cache miss / stale → at most one scan per TTL window.
    const result = (input.runAudit ?? auditContext)({
      outerSessionId: input.outerSessionId ?? null,
      topN: 1,
    });
    const top = result.available ? (result.entries[0] ?? null) : null;
    const entry: ContextHintCacheEntry = {
      cachedAt: nowMs,
      available: result.available,
      ratio,
      tool: top?.tool ?? null,
      key: top?.key ?? null,
      bytes: top?.bytes ?? 0,
      pctOfTotal: top?.pctOfTotal ?? 0,
      count: top?.count ?? 0,
    };
    try {
      atomicWriteJson(cachePath, entry);
    } catch {
      // Fail-soft: an unwritable cache must not lose this turn's hint.
    }
    return top !== null ? formatContextHintLine(entry) : null;
  } catch {
    return null;
  }
}
