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
import { join } from 'node:path';
import type { ContextPercentProbe } from './auto-compact-types.js';
import { detectIdeFromEnv } from './ide-detect.js';
import { getAdapter } from '../ide/ide-registry.js';
import type { IdeId } from '../ide/ide-types.js';
import { readContextWindowTokensOverride } from '../config/config-service.js';
import {
  readHarnessWindow,
  syncHarnessWindow,
  type HarnessWindowLocation,
  type HarnessWindowReadResult,
  type HarnessWindowSyncResult
} from './harness-window-config.js';

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
 * Resolve WHERE the harness auto-compact window lives, for the IDE the
 * current env selects. Returns `null` when either half is undeclared:
 *   - the adapter exposes no `compact` profile, or
 *   - the adapter's `compact` profile declares no
 *     `autoCompactWindowEnvVar` (the IDE has no such knob), or
 *   - the adapter declares no machine-local settings layer.
 *
 * Both the path and the key name come from the adapter's OWN declarations,
 * so this module names no IDE and no settings literal — the vendor-neutrality
 * guard's shape-3 rule applies to every registry consumer, and this is one.
 *
 * Slice 2026-09-13-auto-compact-trigger-ownership.
 */
export function resolveHarnessWindowLocation(input: {
  readonly projectRoot: string;
  readonly env?: NodeJS.ProcessEnv | undefined;
}): HarnessWindowLocation | null {
  const env = input.env ?? process.env;
  const detected = detectIdeFromEnv(env);
  const ideId: IdeId = (detected === 'unknown' ? 'claude-code' : detected) as IdeId;
  const adapter = getAdapter(ideId);
  const envVar = adapter.compact?.autoCompactWindowEnvVar;
  const fileName = adapter.settings.localSettingsFileName ?? adapter.settings.settingsFileName;
  if (envVar === undefined || fileName === undefined) return null;
  return {
    settingsPath: join(input.projectRoot, adapter.settings.dirName, fileName),
    envVar,
    // Carried so the writer can refuse to target the user's own home directory
    // (`--project .` from a fresh terminal): the path alone cannot say which
    // root it came from, and this is the only place a location is built.
    projectRoot: input.projectRoot
  };
}

/**
 * Read the window peaks-loop last configured for the harness, plus whether
 * the user has opted out of peaks-loop managing it. Returns `null` when the
 * active adapter exposes no window knob at all.
 */
export function readHarnessWindowState(input: {
  readonly projectRoot: string;
  readonly env?: NodeJS.ProcessEnv | undefined;
}): HarnessWindowReadResult | null {
  const location = resolveHarnessWindowLocation(input);
  if (location === null) return null;
  return readHarnessWindow({ location, env: input.env ?? process.env });
}

/**
 * The RAW window peaks-loop's context ratio must divide by — T1's number.
 *
 * The SETTINGS FILE is the source of truth, so its value wins whenever it has
 * one; the env-first read is consulted only when the file is silent (no key
 * yet, or the IDE injects the value from an outer layer).
 *
 * Why not "whatever the read returned" (the round-2 shape): the process env is
 * a snapshot the harness froze at session start, so it is stale by exactly one
 * write. Trusting it over the file is what let a stale env revert a human's
 * hand-edited window (B1) and downgrade a 1M file to a 200K one (a second
 * session's frozen env), and it is also what made T1's consistency depend on
 * *rewriting the file* — the same unconditional write that destroyed the human's
 * value. Dividing by the file instead makes peaks-loop's ratio and the harness's
 * configured window one number BY CONSTRUCTION, with no write required. The
 * write is then free to be gated on provenance (see `syncHarnessWindow`).
 *
 * Falls back to `undefined` (no harness layer at all) when the adapter
 * declares no knob or neither side carries the key — the adapter then resolves
 * its own window exactly as it did before this slice.
 */
export function resolveHarnessRatioWindow(state: HarnessWindowReadResult | null): unknown {
  if (state === null) return undefined;
  return state.fileRaw !== undefined ? state.fileRaw : state.raw;
}

/**
 * Materialize a window into the harness's own settings, so the number
 * peaks-loop divides by and the number the harness compacts against are one
 * value rather than two resolutions (slice
 * 2026-09-13-auto-compact-trigger-ownership).
 *
 * The caller passes the denominator it JUST USED (`probe.capacityTokens`), not
 * a re-derived one — that is what makes the two sides structurally identical.
 * `tokens: null` (a percent-only probe carries no token window) is a
 * deliberate no-op: peaks-loop never invents a window it did not measure.
 *
 * Returns `null` when the active adapter declares no window knob at all.
 */
export function syncHarnessWindowForProject(input: {
  readonly projectRoot: string;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly tokens: number | null;
}): HarnessWindowSyncResult | null {
  const location = resolveHarnessWindowLocation(input);
  if (location === null) return null;
  return syncHarnessWindow({ location, tokens: input.tokens, env: input.env ?? process.env });
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
    // Slice 2026-09-13-auto-compact-trigger-ownership: the window peaks-loop
    // configured for the harness, read from the adapter's declared settings
    // path + key. `null` (no knob declared, or the key absent) leaves the
    // adapter's chain byte-identical to before this slice.
    //
    // The RAW value is handed over, not the parsed one: the adapter validates
    // it (`parseContextWindowOverride`) and warns on a bad hand-edited value,
    // so parsing here too would be a second, silently-disagreeing parser —
    // exactly the duplicated-resolution shape this slice exists to delete.
    const harnessWindowState = readHarnessWindowState({ projectRoot: input.projectRoot, env });
    const harnessWindowTokens = resolveHarnessRatioWindow(harnessWindowState);
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
    //
    // Slice 2026-09-09-context-window-override: the generic reader also
    // hands the adapter the raw `context.windowTokens` config override, so
    // the adapter's window resolver can prefer an explicit user value over
    // its model-name heuristics (the env override arrives via `env`).
    const fallback = adapter.compact.readContextPercentFallback?.({
      projectRoot: input.projectRoot,
      sessionId: input.sessionId,
      outerSessionId: input.outerSessionId,
      env,
      configWindowTokens: readContextWindowTokensOverride(input.projectRoot),
      // Slice 2026-09-13-auto-compact-trigger-ownership: hand the adapter the
      // window peaks-loop configured for the harness, so the ratio it reports
      // divides by the very number the harness compacts against — plus whether
      // peaks-loop is the one that wrote it, so the adapter may self-correct
      // its own earlier resolution without ever overruling a human's pin.
      ...(harnessWindowTokens !== undefined
        ? { harnessWindowTokens, harnessWindowPeakWritten: harnessWindowState?.peakWritten === true }
        : {})
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
