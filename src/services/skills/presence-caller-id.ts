/**
 * The presence write side's caller-id gate.
 *
 * Outside Claude Code the IDE adapter cannot resolve a callerId, so
 * `presence:set` was fail-closed with no way out and the lease could never be
 * built. This module adds the vendor-neutral escape hatch the rest of the
 * CLI already has (`peaks request init`): an explicit `--caller-id` flag and
 * the `PEAKS_CALLER_ID` environment variable, both short-circuiting BEFORE
 * the adapter.
 *
 * The priority chain lives in `resolve-caller-id.ts` and is NOT restated
 * here: flag > `PEAKS_CALLER_ID` env > active IDE adapter. This module only
 * turns the resolver's typed failures into a discriminated result the CLI
 * can render without knowing the resolver's error taxonomy.
 *
 * Pure: no filesystem access, no state. The caller decides what to do with
 * the resolved id.
 */

import {
  CallerIdError,
  resolveCallerProjection,
  type CallerProjectionSource
} from '../session/resolve-caller-id.js';

export type PresenceCallerIdResult =
  | {
      readonly ok: true;
      readonly callerId: string;
      readonly source: CallerProjectionSource;
    }
  | {
      readonly ok: false;
      /**
       * `CALLER_ID_INVALID` — a value WAS supplied but it does not match
       * the D1 regex (`^[a-zA-Z0-9._-]{1,200}$`).
       * `PEAKS_CALLER_NOT_RESOLVED` — nothing could be resolved at all.
       */
      readonly code: 'CALLER_ID_INVALID' | 'PEAKS_CALLER_NOT_RESOLVED';
      readonly message: string;
    };

export interface ResolvePresenceCallerIdOptions {
  /** The project root the caller id is resolved against. */
  readonly projectRoot: string;
  /**
   * The `--caller-id <id>` flag value. Priority level 1 — it wins over the
   * env var and short-circuits the adapter, so a host that is not Claude
   * Code can still build a lease.
   */
  readonly flagValue?: string | undefined;
}

/**
 * Resolve the caller id for a presence write.
 *
 * Never throws: a shape mismatch (`CALLER_ID_INVALID`) and an unresolvable
 * caller (`PEAKS_CALLER_NOT_RESOLVED`) both come back as a refusal so the
 * CLI can print one readable envelope for each.
 */
export function resolvePresenceCallerId(
  opts: ResolvePresenceCallerIdOptions
): PresenceCallerIdResult {
  try {
    const projection = resolveCallerProjection({
      projectRoot: opts.projectRoot,
      ...(opts.flagValue !== undefined ? { flagValue: opts.flagValue } : {})
    });
    return { ok: true, callerId: projection.callerId, source: projection.source };
  } catch (err) {
    const invalid = err instanceof CallerIdError && err.code === 'EX_DATAERR';
    return {
      ok: false,
      code: invalid ? 'CALLER_ID_INVALID' : 'PEAKS_CALLER_NOT_RESOLVED',
      message: err instanceof Error ? err.message : String(err)
    };
  }
}
