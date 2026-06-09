/**
 * Caller-Id Resolution (slice 020 — caller-keyed session binding).
 *
 * `resolveCallerId` is the single source of truth for "who is calling
 * the CLI". The resolver applies D4 priority (flag > env > platform
 * fallback > reject) and validates the winner against D1's regex;
 * failures throw `CallerIdError` (D2 → exit 64, D5 → exit 65).
 *
 * The function is synchronous and pure. It does NOT touch the
 * filesystem, does NOT read any caller binding file, and does NOT
 * mutate state. The caller (a CLI command, a service, a test) decides
 * what to do with the resolved id.
 *
 * See `.peaks/_runtime/2026-06-09-session-8bfe7d/prd/source/caller-id-contract.md`
 * for the freeze-in contract (D1-D7).
 */

import { CALLER_ID_REGEX, CallerIdError, type CallerIdSource } from './caller-id-types.js';
import { PLATFORM_FALLBACKS } from './platform-fallbacks.js';

// Re-export for CLI consumers (avoids a second import line).
export { CallerIdError };

export interface ResolveCallerIdOptions {
  /**
   * The `--caller-id <id>` flag value (per-invocation override).
   * D4 priority level 1: flag wins.
   */
  flagValue?: string;
  /**
   * Override for the `PEAKS_CALLER_ID` environment variable. D4
   * priority level 2: env wins. Defaults to `process.env.PEAKS_CALLER_ID`.
   * The override exists so tests can run without mutating process.env.
   */
  envOverride?: string;
  /**
   * The env object to read. Defaults to `process.env`. Exists so
   * tests can drive Level 3 (platform fallback) without mutating
   * process.env.
   */
  env?: NodeJS.ProcessEnv;
}

/**
 * Check whether `value` looks like a callerId (non-empty, matches D1).
 * Returns the trimmed value if so, undefined otherwise. Does not throw.
 */
function isNonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Read a single platform-fallback env var from `env`. Returns the
 * non-empty trimmed value or `undefined`. Logs nothing.
 */
function readPlatformFallback(env: NodeJS.ProcessEnv): { value: string; index: number } | undefined {
  for (let i = 0; i < PLATFORM_FALLBACKS.length; i++) {
    const candidate = env[PLATFORM_FALLBACKS[i]!.envVar];
    if (isNonEmpty(candidate)) {
      return { value: candidate, index: i };
    }
  }
  return undefined;
}

/**
 * Validate `value` against D1's regex. Returns the value on success,
 * throws `CallerIdError` (EX_DATAERR, exit 65) on failure.
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
 * Resolve the calling process's callerId per D1-D5.
 *
 * D4 priority (strict, no merge):
 *   1. `opts.flagValue` (per-invocation `--caller-id <id>` override)
 *   2. `opts.envOverride ?? process.env.PEAKS_CALLER_ID` (per-process declaration)
 *   3. First non-empty entry in `PLATFORM_FALLBACKS` (platform default)
 *   4. → **D2 fires**: throw `CallerIdError` (EX_USAGE, exit 64)
 *
 * On success: returns the resolved id (matches D1's regex, validated).
 * On D2 (nothing set): throws `CallerIdError` (EX_USAGE, exit 64).
 * On D5 (regex fail): throws `CallerIdError` (EX_DATAERR, exit 65).
 *
 * @example
 *   resolveCallerId({ flagValue: 'foo-bar' })  // → 'foo-bar'
 *   resolveCallerId({ envOverride: 'baz' })    // → 'baz'
 *   resolveCallerId({ env: { CLAUDE_CODE_SESSION_ID: 'sid-123' } })  // → 'sid-123'
 *   resolveCallerId()                          // → throws CallerIdError (EX_USAGE)
 */
export function resolveCallerId(opts: ResolveCallerIdOptions = {}): string {
  const env = opts.env ?? process.env;

  // D4 level 1: flag value
  if (isNonEmpty(opts.flagValue)) {
    return validateCallerId(opts.flagValue, 'flag');
  }

  // D4 level 2: env var
  const envValue = isNonEmpty(opts.envOverride) ? opts.envOverride : env.PEAKS_CALLER_ID;
  if (isNonEmpty(envValue)) {
    return validateCallerId(envValue, 'env');
  }

  // D4 level 3: PLATFORM_FALLBACKS table (top-to-bottom)
  const fallback = readPlatformFallback(env);
  if (fallback !== undefined) {
    return validateCallerId(fallback.value, 'fallback');
  }

  // D4 level 4: D2 fires — no callerId available
  throw new CallerIdError(
    'EX_USAGE',
    'none',
    'No caller id available. Set PEAKS_CALLER_ID or pass --caller-id.'
  );
}
