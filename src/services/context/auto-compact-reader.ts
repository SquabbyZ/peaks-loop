/**
 * AC-1 — auto context-percent probe.
 *
 * Reads the current AI CLI context-fill ratio without requiring the
 * LLM to pass `--prompt-size <bytes>` manually. Strategy: ask the
 * registered `IdeAdapter.compact` profile which env-var to read and,
 * when that misses, ask the adapter for a vendor-specific fallback —
 * no hard-coded IDE names. Per-adapter:
 *
 *   - claude-code: its adapter-declared env-var (MVP) + a
 *     `readContextPercentFallback` that polls the statusline /
 *     transcript (see claude-code-adapter.ts).
 *   - trae / codex / cursor / qoder / tongyi-lingma / hermes /
 *     openclaw / zcode: each adapter fills its own env-var; until
 *     L2-dogfood verifies each surface, adapters may omit `compact`
 *     and the probe returns `source: 'conservative-fallback'`.
 *
 * Resolution order (user-overridden → env-var → adapter fallback →
 * conservative-fallback):
 *   1. `promptSizeBytes` (P0 `--prompt-size <bytes>` escape hatch) →
 *      `source: 'user-overridden'`.
 *   2. `adapter.compact.envVarForContextPercent` env-var →
 *      `source: '<ideId>-env'`.
 *   3. `adapter.compact.readContextPercentFallback?.(input)` — the
 *      adapter owns any vendor-specific statusline / transcript probe.
 *   4. `ratio: 0` with `source: 'conservative-fallback'` — the
 *      orchestrator MUST NOT auto-fire compact on this signal.
 */
import type { ContextPercentProbe } from './auto-compact-types.js';
import { detectIdeFromEnv } from './ide-detect.js';
import { getAdapter } from '../ide/ide-registry.js';
import type { IdeId } from '../ide/ide-types.js';

export interface ReadContextPercentInput {
  readonly projectRoot: string;
  readonly sessionId: string;
  /**
   * Outer (harness / IDE) session id — the id the IDE uses to name its
   * transcript / session files. Resolved by the caller (env signal → bound
   * session meta) and passed through to the adapter's
   * `readContextPercentFallback`. Optional: when unresolved, the adapter
   * fallback returns null → conservative-fallback.
   */
  readonly outerSessionId?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  /**
   * Slice 2026-07-31-rid-002: explicit byte count from `--prompt-size <bytes>`.
   * When set to a finite non-negative number, short-circuits the entire
   * env / statusline / transcript chain with `source: 'user-overridden'`.
   * Mac escape hatch — some IDEs (e.g. Claude Code on macOS) do NOT
   * inject their context-percent env-var into PreToolUse sub-shells, so the
   * user (or a hook wrapper) can inject the bytes they observed themselves.
   * Priority P0 — above everything else.
   */
  readonly promptSizeBytes?: number | undefined;
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
 * Probe the current AI CLI's context-fill ratio. Adapter-driven:
 * looks up the registered `IdeAdapter.compact` profile via
 * `getAdapter(detectIdeFromEnv(env))` and reads the
 * adapter-declared env-var. When that misses, delegates to the
 * adapter's optional `readContextPercentFallback` (which owns any
 * vendor-specific statusline / transcript probe). Adapters without a
 * fallback (or a fallback that returns null) yield
 * `source: 'conservative-fallback'` with `ratio: 0` so the
 * orchestrator never auto-fires on a missing signal.
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

  // P0 user-overridden takes priority over env / fallback / transcript.
  // Mac escape hatch: when the CLI/helper passes `--prompt-size <bytes>`,
  // honor that number directly. Do NOT read env, statusline, or transcript
  // — user intent always wins. Negative / non-finite values are ignored
  // here (CLI layer validates >= 0); they fall through to the chain below.
  if (
    input.promptSizeBytes !== undefined &&
    Number.isFinite(input.promptSizeBytes) &&
    input.promptSizeBytes >= 0
  ) {
    const ratio = Math.min(1, input.promptSizeBytes / capacityBytes);
    return {
      ratio,
      source: 'user-overridden',
      rawBytes: input.promptSizeBytes,
      capacityBytes,
      ide: ideId,
      capturedAt
    };
  }

  if (adapter.compact) {
    // Primary: read the adapter-declared env-var (no hard-coded IDE names).
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

    // Fallback: the adapter owns any vendor-specific statusline /
    // transcript probe. When it returns a probe, honor it; otherwise
    // fall through to conservative-fallback.
    const fallback = adapter.compact.readContextPercentFallback?.({
      projectRoot: input.projectRoot,
      sessionId: input.sessionId,
      outerSessionId: input.outerSessionId,
      env
    });
    if (fallback) return fallback;
  }

  // No signal available — return `ratio: 0` so the orchestrator
  // stays in `none` zone and the LLM can still pass `--prompt-size`
  // explicitly via `peaks context check`.
  return { ratio: 0, source: 'conservative-fallback', capacityBytes, ide: ideId, capturedAt };
}

/** Re-export the env-var probe for unit tests. */
export const _internal = { readEnvPercent };
