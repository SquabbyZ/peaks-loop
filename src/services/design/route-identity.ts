/**
 * Route identity: did the page we captured actually render the route we asked
 * for?
 *
 * The observation is exactly what designlang 13.4.1 exposes: the page title,
 * its headings, its button labels, its anatomy sample text and an input count.
 * BOTH directions traffic on page identity — the title and the headings. A
 * DECLARED marker is observed there, and a NEGATIVE marker is matched there.
 * Button labels and anatomy sample text are shared chrome: the pilot measured a
 * site-wide `Sign in` button in the global header of every route, and the
 * round-6 review measured a sidebar `channels` link satisfying a declared
 * `Channels` marker. Chrome can neither block nor satisfy a route judgment.
 *
 * The honest bound: without a declared route marker, a client-side redirect is
 * NOT detectable from this payload. The extractor echoes the requested URL,
 * never the URL after client navigation, and the pilot's SPA title is constant.
 * Such a route therefore stays INERT — the stage says it could not tell, and
 * never guesses. Stage A owns server redirects: it already refuses a response
 * whose final path differs from the requested one, before this stage exists.
 *
 * An input count alone NEVER blocks: a settings page legitimately renders
 * password inputs, so the count is a form-wall signal only on a route that
 * declared an expected marker and whose marker was not observed.
 *
 * Precedence, highest first:
 *
 * 1. the declared marker is observed in the title or a heading -> ok;
 * 2. a negative page-state label — a status code ("404 Not Found"), a not-found
 *    or sign-in state, or an access label ("Forbidden", "Access denied") —
 *    starts the title or a heading -> block `negative-marker`;
 * 3. a declared marker is unobserved and rendered inputs > 0 -> block
 *    `rendered-form`;
 * 4. a declared marker is unobserved -> block `marker-unobserved`;
 * 5. nothing declared -> inert, whatever text was observed.
 *
 * A declared marker wins over every negative heuristic: that is what keeps a
 * real settings page, whose copy says "Change password", from blocking.
 */
import { capDetail, evidenceSnippet, plainText } from './evidence-text.js';

/** The text surfaces and input count one captured page exposes. */
export type RouteObservation = {
  title?: string;
  headings?: string[];
  /**
   * Button/link copy. Recorded for the artifact, NEVER consulted: it is shared
   * chrome, so it can neither block nor satisfy a route judgment.
   */
  buttonPatterns?: string[];
  /** Anatomy sample text. Recorded for the artifact, NEVER consulted, as above. */
  sampleText?: string[];
  renderedInputs?: number;
};

/** Everything the route check is given; every observation field is optional. */
export type RouteIdentityInput = {
  /** The route under check, named in a block detail; never compared. */
  route: string;
  /** A marker `design/paved-road.json` declared for this route, when any. */
  expectedMarker?: string;
  observation: RouteObservation;
};

/** Why a page was judged to be a different route. */
export type RouteMismatchSignal = 'negative-marker' | 'rendered-form' | 'marker-unobserved';

/** An ok (possibly inert), or a block naming the measured signal. */
export type RouteIdentityVerdict =
  | { ok: true; inert?: boolean; marker?: 'declared-marker' }
  | { ok: false; code: 'DESIGN_ROUTE_MISMATCH'; signal: RouteMismatchSignal; detail: string };

/**
 * Negative markers, checked at the START of the title and of each heading.
 * Anchoring is deliberate: a real heading like "How to handle not found pages"
 * is content, while "Sign in", "Page Not Found" and "Unauthorized" are the
 * states this check blocks. A bare "error" is deliberately absent: once the
 * route stage ran first it blocked a real page titled "Error handling". The
 * access labels "forbidden" and "access denied" join the not-found and sign-in
 * states: a page that says access is denied is not the route we asked for. The
 * status-code label is one anchored pattern beside these, in
 * `STATUS_CODE_PATTERN`.
 */
export const NEGATIVE_ROUTE_MARKERS: readonly string[] = [
  'page not found',
  'not found',
  'sign in',
  'log in',
  'unauthorized',
  'forbidden',
  'access denied'
];

/**
 * One negative marker as an anchored pattern. The separator is OPTIONAL
 * (`[\s-]*`), because a login wall spells its state "Sign in", "Sign-in",
 * "Signin" or "Login"; requiring a separator let "Login" and "Signin" through
 * the route stage. The access label accepts the British spelling too
 * (`unauthori[sz]ed`), which the removed paint marker carried.
 */
function negativePattern(marker: string): RegExp {
  const spelled = marker === 'unauthorized' ? 'unauthori[sz]ed' : marker;
  return new RegExp(`^${spelled.split(' ').join('[\\s-]*')}\\b`, 'i');
}

/** The anchored, separator-tolerant pattern for every negative marker. */
const NEGATIVE_PATTERNS: readonly { marker: string; pattern: RegExp }[] =
  NEGATIVE_ROUTE_MARKERS.map((marker) => ({ marker, pattern: negativePattern(marker) }));

/**
 * The status-code page label — "404 Not Found", "403 — You do not have access"
 * — as ONE anchored pattern beside the string-derived ones. The code list is
 * closed on purpose: a general `^\d{3}` rule would also block "100 days" or
 * "2024 Roadmap". The matched code names the marker ("HTTP 404") so a block
 * detail says which label fired.
 */
const STATUS_CODE_PATTERN = /^(400|401|403|404|405|500|502|503)\b/;

/** One page-identity text, with the surface it came from, told to a human. */
type SurfaceText = { readonly where: string; readonly text: string };

/** The title and the headings — the only surfaces page identity reads. */
function surfaceTexts(observation: RouteObservation): SurfaceText[] {
  const out: SurfaceText[] = [];
  const add = (where: string, values: readonly (string | undefined)[]): void => {
    for (const raw of values) {
      if (typeof raw !== 'string') continue;
      const text = plainText(raw);
      if (text !== '') out.push({ where, text });
    }
  };
  add('the page title', [observation.title]);
  add('a heading', observation.headings ?? []);
  return out;
}

/**
 * The declared marker as a single-spaced string, or null when there is none.
 * A marker whose SANITISED form is empty (only control bytes, only whitespace)
 * is not a declaration: `includes('')` would otherwise satisfy every page and
 * turn the route stage into an unconditional pass.
 */
function declaredMarkerOf(input: RouteIdentityInput): string | null {
  const marker = input.expectedMarker;
  if (typeof marker !== 'string') return null;
  const declared = plainText(marker);
  return declared === '' ? null : declared;
}

/** True when the declared marker appears as a case-insensitive substring. */
function markerObserved(marker: string, surfaces: readonly SurfaceText[]): boolean {
  const needle = marker.toLowerCase();
  return surfaces.some((surface) => surface.text.toLowerCase().includes(needle));
}

function negativeMatch(
  surfaces: readonly SurfaceText[]
): { marker: string; surface: SurfaceText } | null {
  for (const surface of surfaces) {
    const statusCode = STATUS_CODE_PATTERN.exec(surface.text)?.[1];
    if (statusCode !== undefined) return { marker: `HTTP ${statusCode}`, surface };
    for (const candidate of NEGATIVE_PATTERNS) {
      if (candidate.pattern.test(surface.text)) return { marker: candidate.marker, surface };
    }
  }
  return null;
}

/** A positive rendered-input count, or 0 when the field is absent or unusable. */
function inputCount(observation: RouteObservation): number {
  const count = observation.renderedInputs;
  return typeof count === 'number' && Number.isFinite(count) && count > 0 ? count : 0;
}

/** The route label as it may be echoed, bounded and free of control bytes. */
function routeLabel(route: string): string {
  return evidenceSnippet(route);
}

function block(signal: RouteMismatchSignal, detail: string): RouteIdentityVerdict {
  return { ok: false, code: 'DESIGN_ROUTE_MISMATCH', signal, detail: capDetail(detail) };
}

/** Judge one captured observation against the route it was requested for. */
export function evaluateRouteIdentity(input: RouteIdentityInput): RouteIdentityVerdict {
  const surfaces = surfaceTexts(input.observation);
  const declared = declaredMarkerOf(input);

  if (declared !== null && markerObserved(declared, surfaces)) {
    return { ok: true, marker: 'declared-marker' };
  }

  const negative = negativeMatch(surfaces);
  if (negative !== null) {
    return block(
      'negative-marker',
      `it rendered a negative marker ("${evidenceSnippet(negative.surface.text)}", ` +
        `matching "${negative.marker}") in ${negative.surface.where}, ` +
        `not the route ${routeLabel(input.route)}`
    );
  }

  if (declared === null) return { ok: true, inert: true };
  const shown = evidenceSnippet(declared);

  const inputs = inputCount(input.observation);
  if (inputs > 0) {
    return block(
      'rendered-form',
      `it rendered ${String(inputs)} form input(s) while the declared marker "${shown}" ` +
        `was not observed on ${routeLabel(input.route)}`
    );
  }

  return block(
    'marker-unobserved',
    `the declared marker "${shown}" was not observed in the page title or a heading ` +
      `of ${routeLabel(input.route)}`
  );
}
