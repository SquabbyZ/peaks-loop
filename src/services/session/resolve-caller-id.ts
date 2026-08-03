/**
 * Caller-Id Resolution (slice 020 — caller-keyed session binding,
 * refactored in slice 4.0.8 to be adapter-owned per RD §5 + C1).
 *
 * As of 4.0.8 the per-platform `PLATFORM_FALLBACKS` table is DELETED.
 * Per the user-confirmed product decision (2026-08-03, C1):
 *
 *   "Every caller resolution MUST go through the active IDE adapter.
 *    Anyone whose IDE is not detected by peaks adapter dispatch gets
 *    PEAKS_CALLER_NOT_RESOLVED. This is the desired product contract
 *    (vendor-neutral)."
 *
 * Resolution order (4.0.8):
 *   1. `opts.flagValue` (per-invocation `--caller-id <id>` override) →
 *      a vendor-neutral flag short-circuits BEFORE the adapter.
 *   2. `opts.envOverride ?? process.env.PEAKS_CALLER_ID` (vendor-neutral
 *      env override) → also short-circuits BEFORE the adapter, so CI
 *      / scripted usage can still pin a caller id without an adapter.
 *      The trimmed value MUST match `CALLER_ID_REGEX` or we throw.
 *   3. The active IDE adapter's `resolveCallerId(env)` method. The
 *      adapter owns its priority rules; vendor signal lives ONLY in
 *      the adapter. The adapter throws `PEAKS_CALLER_NOT_RESOLVED`
 *      (via `(err as { code: string }).code`) on unsupported / missing
 *      resolution. We surface the same code on the boundary.
 *   4. → **D2 fires**: throw `CallerIdError(EX_USAGE, 'none', ...)`
 *      after surfacing `PEAKS_CALLER_NOT_RESOLVED` upstream.
 *
 * The function is synchronous and pure. It does NOT touch the
 * filesystem, does NOT read any caller binding file, and does NOT
 * mutate state. The caller (a CLI command, a service, a test) decides
 * what to do with the resolved id.
 *
 * See `.peaks/_runtime/2026-08-03-session-bee258/rd/requests/001-2026-08-03-presence-lease-graph-design.md`
 * for the slice 4.0.8 contract.
 */

import {
  CALLER_ID_REGEX,
  CallerIdError,
  type CallerIdSource,
  type CallerProjection,
  type CallerProjectionSource,
} from './caller-id-types.js';
import { getAdapter } from '../ide/ide-registry.js';
import { detectInstalledIde } from '../ide/ide-detector.js';

// Re-export for CLI consumers (avoids a second import line).
export { CallerIdError };
export type { CallerProjection, CallerProjectionSource };

export interface ResolveCallerIdOptions {
  /**
   * The `--caller-id <id>` flag value (per-invocation override).
   * Priority level 1: flag wins. Validated against CALLER_ID_REGEX.
   */
  flagValue?: string;
  /**
   * Override for the `PEAKS_CALLER_ID` environment variable. Priority
   * level 2: env wins. Defaults to `process.env.PEAKS_CALLER_ID`. The
   * override exists so tests can run without mutating process.env.
   */
  envOverride?: string;
  /**
   * The env object to read. Defaults to `process.env`. Exists so
   * tests can drive Level 3 (adapter) without mutating process.env.
   */
  env?: NodeJS.ProcessEnv;
  /**
   * The IDE id to use for adapter-driven resolution. Defaults to
   * `detectInstalledIde(process.cwd())` or `'claude-code'` when no IDE
   * is detected. Tests can pin the adapter via this option.
   */
  ideId?: string;
  /**
   * The project root for IDE auto-detection. Defaults to
   * `process.cwd()`. Passed through to `detectInstalledIde`.
   */
  projectRoot?: string;
}

/**
 * Check whether `value` looks like a callerId (non-empty, matches D1).
 * Returns the trimmed value if so, undefined otherwise. Does not throw.
 */
function isNonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Validate `value` against D1's regex. Returns the value on success,
 * throws `CallerIdError` (EX_DATAERR, exit 65) on failure. The
 * `PEAKS_CALLER_NOT_RESOLVED` code is reserved for the "no signal"
 * case; this function only fires for shape mismatch.
 */
function validateCallerId(value: string, source: CallerIdSource): string {
  if (!CALLER_ID_REGEX.test(value)) {
    throw new CallerIdError(
      'EX_DATAERR',
      source,
      `Invalid caller id "${value}" (source: ${source}). callerId must match ^[a-zA-Z0-9._-]{1,200}$.`,
      value
    );
  }
  return value;
}

/**
 * Resolve the calling process's callerId per the 4.0.8 adapter-owned
 * contract. See file header for the full priority table. On failure
 * (no flag, no env, adapter threw PEAKS_CALLER_NOT_RESOLVED), throws
 * a `CallerIdError(EX_USAGE, 'none', ...)`.
 *
 * @example
 *   resolveCallerId({ flagValue: 'foo-bar' })           // → 'foo-bar'
 *   resolveCallerId({ envOverride: 'baz' })             // → 'baz'
 *   resolveCallerId({ env: { CLAUDE_CODE_SESSION_ID: 'sid-123' } })
 *                                                          // → 'sid-123'
 *   resolveCallerId()                                   // → throws CallerIdError (EX_USAGE)
 */
export function resolveCallerId(opts: ResolveCallerIdOptions = {}): string {
  // Priority level 1: flag value.
  if (isNonEmpty(opts.flagValue)) {
    return validateCallerId(opts.flagValue, 'flag');
  }

  // Priority level 2: env var (vendor-neutral override).
  const envValue = isNonEmpty(opts.envOverride) ? opts.envOverride : opts.env?.PEAKS_CALLER_ID ?? process.env.PEAKS_CALLER_ID;
  if (isNonEmpty(envValue)) {
    return validateCallerId(envValue, 'env');
  }

  // Priority level 3: active IDE adapter. The adapter owns its own
  // priority rules and throws `PEAKS_CALLER_NOT_RESOLVED` when no
  // vendor signal is present (or when the vendor signal is reserved /
  // unverified). We re-throw on the boundary as CallerIdError(EX_USAGE)
  // so legacy CLI consumers keep their exit-code contract.
  const env = opts.env ?? process.env;
  const projectRoot = opts.projectRoot ?? process.cwd();
  const ideId = opts.ideId ?? detectInstalledIde(projectRoot) ?? 'claude-code';
  const adapter = getAdapter(ideId as Parameters<typeof getAdapter>[0]);
  try {
    return adapter.resolveCallerId(env);
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (code !== 'PEAKS_CALLER_NOT_RESOLVED') throw err;
    throw new CallerIdError(
      'EX_USAGE',
      'none',
      `No caller id available from IDE adapter "${ideId}" (PEAKS_CALLER_NOT_RESOLVED). ` +
        'Set PEAKS_CALLER_ID or pass --caller-id, or ensure the active IDE is detected.'
    );
  }
}

/**
 * Projected resolution for the 4.0.8 contract. Returns a typed
 * `CallerProjection` envelope so consumers can read the adapter id +
 * callerId + (optional) workflowId / graphRef in one call.
 *
 * Pure: does not touch the filesystem, does not consult the lease or
 * the index. The `workflowId` / `graphRef` fields stay `null` here;
 * callers that need the full binding should resolve the lease via
 * `presence-lease-service` after the caller id is in hand.
 */
export function resolveCallerProjection(opts: ResolveCallerIdOptions = {}): CallerProjection {
  const env = opts.env ?? process.env;
  const projectRoot = opts.projectRoot ?? process.cwd();
  const ideId = opts.ideId ?? detectInstalledIde(projectRoot) ?? 'claude-code';

  // 1. Flag — caller supplied --caller-id <id>.
  if (isNonEmpty(opts.flagValue)) {
    const validated = validateCallerId(opts.flagValue, 'flag');
    return {
      adapterId: ideId,
      callerId: validated,
      workflowId: null,
      graphRef: null,
      source: 'env-flag',
    };
  }

  // 2. Env-flag — PEAKS_CALLER_ID override.
  const envValue = isNonEmpty(opts.envOverride) ? opts.envOverride : env.PEAKS_CALLER_ID;
  if (isNonEmpty(envValue)) {
    const validated = validateCallerId(envValue, 'env');
    return {
      adapterId: ideId,
      callerId: validated,
      workflowId: null,
      graphRef: null,
      source: 'env-flag',
    };
  }

  // 3. Adapter — the active IDE owns its priority rules.
  const adapter = getAdapter(ideId as Parameters<typeof getAdapter>[0]);
  try {
    const callerId = adapter.resolveCallerId(env);
    return {
      adapterId: ideId,
      callerId,
      workflowId: null,
      graphRef: null,
      source: 'adapter',
    };
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (code !== 'PEAKS_CALLER_NOT_RESOLVED') throw err;
    // Caller not resolved: throw the canonical error so CLI boundaries
    // can map exit codes deterministically. The CallerProjection form
    // is for success paths; failure surfaces as CallerIdError.
    throw new CallerIdError(
      'EX_USAGE',
      'none',
      `No caller id available from IDE adapter "${ideId}" (PEAKS_CALLER_NOT_RESOLVED). ` +
        'Set PEAKS_CALLER_ID or pass --caller-id, or ensure the active IDE is detected.'
    );
  }
}
