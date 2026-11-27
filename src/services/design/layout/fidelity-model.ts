/**
 * The fidelity oracle's vocabulary and result shape. The pairing and scoring
 * live in `fidelity-pair.ts` / `fidelity-score.ts`; this module holds the
 * constants, the artifact schema and the two verdicts a caller constructs
 * before any capture runs.
 *
 * The verdict inputs are exactly the brief's: zero missing and zero extra
 * objects, anchor match at least `FIDELITY_ANCHOR_THRESHOLD`, token match at
 * least `FIDELITY_TOKEN_THRESHOLD`. Both thresholds are code constants and no
 * flag can move them. The role assertion is reported (and named) but is not a
 * verdict input, because the formula enumerates the inputs it grades.
 */
import type { LayoutGeometry, Viewport } from './layout-geometry.js';

/** The artifact schema this result is written under. */
export const FIDELITY_SCHEMA_VERSION = 1;
/** A viewport needs this share of paired elements to agree on their anchors. */
export const FIDELITY_ANCHOR_THRESHOLD = 0.95;
/** A viewport needs this share of paired elements to agree on their token names. */
export const FIDELITY_TOKEN_THRESHOLD = 0.95;
/** Two boxes share an edge when the edge coordinates differ by at most this. */
export const FIDELITY_ANCHOR_TOLERANCE_PX = 1;

export type FidelityMode = 'prod' | 'dev';
export type FidelityVerdict = 'pass' | 'fail' | 'blocked' | 'not-applicable';

export type FidelityFailureClass =
  | 'missing-object'
  | 'extra-object'
  | 'duplicate-object'
  | 'anchor-mismatch'
  | 'token-mismatch'
  | 'role-mismatch';

/** One named failure: the element, the property, and expected versus measured. */
export type FidelityFailure = {
  viewport: string;
  failureClass: FidelityFailureClass;
  objectId: string;
  property: string;
  expected: string;
  actual: string;
};

export type ViewportScore = {
  viewport: string;
  verdict: 'pass' | 'fail';
  paired: number;
  missing: number;
  extra: number;
  duplicate: number;
  anchorMatches: number;
  tokenMatches: number;
  roleMatches: number;
  anchorScore: number;
  tokenScore: number;
  roleScore: number;
  /** Headline share: anchor and token for the same pairs, equally weighted. */
  score: number;
  /** Gating failures only; role mismatches live in `roleMismatches`. */
  failures: FidelityFailure[];
  roleMismatches: FidelityFailure[];
};

export type FidelityPrototype = {
  kind: 'file' | 'url';
  /** The path or URL the caller named, verbatim enough to re-open. */
  ref: string;
  sha256: string;
  /** Present only when this run's loopback static server served a local file. */
  served: { url: string; loopback: true } | null;
};

export type FidelityResult = {
  schemaVersion: number;
  route: string;
  mode: FidelityMode;
  verdict: FidelityVerdict;
  /**
   * Why a blocked or not-applicable verdict was reached, or why an earlier
   * run's recorded binding could not be used; null when there is nothing to say.
   */
  reason: string | null;
  prototype: FidelityPrototype | null;
  implementation: { url: string } | null;
  viewports: ViewportScore[];
  failures: FidelityFailure[];
  roleMismatches: FidelityFailure[];
};

export function viewportText(viewport: Viewport): string {
  return `${String(viewport.width)}x${String(viewport.height)}`;
}

/** The number of elements that declare a stable object identity. */
export function objectMarkers(geometry: LayoutGeometry): number {
  return geometry.elements.filter((element) => element.peaks?.object !== undefined).length;
}

export function notApplicableFidelity(route: string, mode: FidelityMode): FidelityResult {
  return {
    schemaVersion: FIDELITY_SCHEMA_VERSION,
    route,
    mode,
    verdict: 'not-applicable',
    reason: 'no --prototype was supplied, so the route has no prototype to compare',
    prototype: null,
    implementation: null,
    viewports: [],
    failures: [],
    roleMismatches: []
  };
}

export function blockedFidelity(route: string, mode: FidelityMode, reason: string): FidelityResult {
  return {
    schemaVersion: FIDELITY_SCHEMA_VERSION,
    route,
    mode,
    verdict: 'blocked',
    reason,
    prototype: null,
    implementation: null,
    viewports: [],
    failures: [],
    roleMismatches: []
  };
}
