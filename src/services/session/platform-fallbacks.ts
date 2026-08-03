/**
 * PLATFORM_FALLBACKS — DELETED in 4.0.8.
 *
 * Per the user-confirmed product decision (C1, 2026-08-03):
 *
 *   "Every caller resolution MUST go through the active IDE adapter.
 *    Anyone whose IDE is not detected by peaks adapter dispatch gets
 *    PEAKS_CALLER_NOT_RESOLVED. This is the desired product contract
 *    (vendor-neutral)."
 *
 * This file remains for one minor release as a no-op stub so legacy
 * imports keep type-checking. The named export is now an empty
 * readonly array; tests asserting `PLATFORM_FALLBACKS.length === 1`
 * (slice 020 A5) have been moved into the 4.0.8 deprecation bucket
 * (`tests/unit/services/session/caller-id-resolution.test.ts` will be
 * updated in a follow-up slice — out of scope for the 4.0.8 contract
 * freeze).
 *
 * New code MUST NOT import `PLATFORM_FALLBACKS`. The `resolveCallerId`
 * service now resolves via the active IDE adapter
 * (`getAdapter(ide).resolveCallerId(env)`), with `PEAKS_CALLER_ID` /
 * `--caller-id <id>` as the vendor-neutral short-circuits.
 *
 * See `.peaks/_runtime/2026-08-03-session-bee258/rd/requests/001-2026-08-03-presence-lease-graph-design.md`
 * for the slice 4.0.8 contract.
 */

export interface PlatformFallback {
  readonly envVar: string;
  readonly description: string;
  /** Semver this entry was added in (e.g. "1.3.7"). */
  readonly addedIn: string;
}

/**
 * @deprecated 4.0.8 — caller resolution is now adapter-owned. The
 * fallback table is empty; this constant remains as a stub for
 * back-compat only. The `resolveCallerId` service in
 * `src/services/session/resolve-caller-id.ts` no longer reads it.
 */
export const PLATFORM_FALLBACKS: ReadonlyArray<PlatformFallback> = [];
