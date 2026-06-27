/**
 * AC-1 — auto context-percent probe.
 *
 * Reads the current AI CLI context-fill ratio without requiring the
 * LLM to pass `--prompt-size <bytes>` manually. Strategy: ask the
 * registered `IdeAdapter.compact` profile which env-var to read;
 * no hard-coded IDE names. Per-adapter:
 *
 *   - claude-code: `CLAUDE_CONTEXT_USAGE_PERCENT` (MVP)
 *   - trae / codex / cursor / qoder / tongyi-lingma / hermes /
 *     openclaw: each adapter fills its own env-var; until L2-dogfood
 *     verifies each surface, adapters may omit `compact` and the
 *     probe returns `source: 'conservative-fallback'`.
 *
 * Fallback chain (when adapter.compact is undefined OR the env-var
 * is missing):
 *   1. statusline poll (`~/.claude/statusline-state.json` for
 *      Claude Code MVP; other IDEs register their own poll path
 *      by exposing `compact.postCompactDetectCommand`).
 *   2. Conservative transcript-size estimate
 *      (`~/.claude/projects/<hash>/<sid>.jsonl` for Claude Code).
 *   3. `ratio: 0` with `source: 'conservative-fallback'` — the
 *      orchestrator MUST NOT auto-fire compact on this signal.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ContextPercentProbe } from './auto-compact-types.js';
import { detectIdeFromEnv } from './main-session-monitor.js';
import { getAdapter } from '../ide/ide-registry.js';
import type { IdeId } from '../ide/ide-types.js';

export interface ReadContextPercentInput {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly env?: NodeJS.ProcessEnv | undefined;
}

/**
 * Read env-var-based context percentage. Returns `null` when the env
 * is absent or unparseable. Adapter-driven: the caller passes the
 * env-var name from `IdeAdapter.compact.envVarForContextPercent`,
 * so the function itself has no hard-coded IDE names.
 */
function readEnvPercent(env: NodeJS.ProcessEnv, varName: string): number | null {
  const raw = env[varName];
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 0 || parsed > 1.5) return null;
  return Math.max(0, Math.min(1, parsed));
}

/**
 * Read the IDE-specific statusline state. MVP path is Claude Code's
 * `~/.claude/statusline-state.json`; other IDEs are intentionally
 * left for future slices (each IDE will expose its own
 * `compact.postCompactDetectCommand` to drive this).
 */
function readClaudeStatuslinePercent(): number | null {
  const path = join(homedir(), '.claude', 'statusline-state.json');
  if (!existsSync(path)) return null;
  try {
    const json = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    const candidates = ['contextPercent', 'context_usage_percent', 'contextPercentUsed'];
    for (const key of candidates) {
      const raw = json[key];
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        return raw > 1.5 ? raw / 100 : Math.max(0, Math.min(1, raw));
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Conservative transcript-size fallback. Walks
 * `~/.claude/projects/<hash>/<sid>.jsonl` and estimates
 * `ratio = bytesUsed / 256K`. Returns the bytes seen so the
 * orchestrator can show "estimated from 124KB of 256KB transcript"
 * in the envelope. Tagged `'conservative-fallback'` so callers
 * know NOT to treat this as a hard gate.
 */
function readClaudeTranscriptFallback(sessionId: string): { ratio: number; bytes: number } | null {
  const projectsDir = join(homedir(), '.claude', 'projects');
  if (!existsSync(projectsDir)) return null;
  try {
    const { readdirSync } = require('node:fs') as typeof import('node:fs');
    for (const hashDir of readdirSync(projectsDir)) {
      const candidate = join(projectsDir, hashDir, `${sessionId}.jsonl`);
      if (existsSync(candidate)) {
        const bytes = statSync(candidate).size;
        const ratio = Math.min(1, bytes / (256 * 1024));
        return { ratio, bytes };
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Probe the current AI CLI's context-fill ratio. Adapter-driven:
 * looks up the registered `IdeAdapter.compact` profile via
 * `getIdeAdapter(detectIdeFromEnv(env))` and reads the
 * adapter-declared env-var. Falls back to statusline poll +
 * transcript estimate ONLY for adapters that opt in
 * (`adapter.id === 'claude-code'` for the MVP); other adapters
 * without an env-var hit return `source: 'conservative-fallback'`
 * with `ratio: 0` so the orchestrator never auto-fires on a
 * missing signal.
 */
export function readContextPercent(input: ReadContextPercentInput): ContextPercentProbe {
  const env = input.env ?? process.env;
  const capturedAt = new Date().toISOString();
  const capacityBytes = 256 * 1024;
  const detected = detectIdeFromEnv(env);
  // `detectIdeFromEnv` may return `'unknown'` when no IDE-specific
  // marker is on PATH; narrow to a registered adapter id so the
  // typed `getAdapter` call accepts it. `'unknown'` falls through to
  // the conservative-zero probe (no compact dispatch). IdeKind is a
  // narrow 3-element union (claude-code / trae / opencode); cast
  // through `unknown` to IdeId's wider 8-element set.
  const ideId: IdeId = (detected === 'unknown' ? 'claude-code' : detected) as IdeId;
  const adapter = getAdapter(ideId);

  // Primary: read the adapter-declared env-var (no hard-coded IDE names).
  if (adapter.compact) {
    const primary = readEnvPercent(env, adapter.compact.envVarForContextPercent);
    if (primary !== null) {
      return {
        ratio: primary,
        source: `${ideId}-env`,
        capacityBytes,
        ide: ideId,
        capturedAt
      };
    }
  }

  // MVP-only fallback chain: statusline poll + transcript estimate.
  // Non-MVP adapters that don't fill `compact` skip this and return
  // a conservative-zero probe (the orchestrator will stay in
  // 'none' / 'soft-warn' zone and never auto-fire compact).
  if (ideId === 'claude-code') {
    const statusline = readClaudeStatuslinePercent();
    if (statusline !== null) {
      return { ratio: statusline, source: 'statusline-poll', capacityBytes, ide: ideId, capturedAt };
    }
    const fallback = readClaudeTranscriptFallback(input.sessionId);
    if (fallback !== null) {
      return {
        ratio: fallback.ratio,
        source: 'conservative-fallback',
        rawBytes: fallback.bytes,
        capacityBytes,
        ide: ideId,
        capturedAt
      };
    }
  }

  // No signal available — return `ratio: 0` so the orchestrator
  // stays in `none` zone and the LLM can still pass `--prompt-size`
  // explicitly via `peaks context check`.
  return { ratio: 0, source: 'conservative-fallback', capacityBytes, ide: ideId, capturedAt };
}

/** Re-export the env-var probe for unit tests. */
export const _internal = { readEnvPercent, readClaudeStatuslinePercent, readClaudeTranscriptFallback };