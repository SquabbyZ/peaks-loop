/**
 * The paint half of the page-usability probe: the paint refusal that blocks a
 * page, never scores it, and the route-identity stage that judges the page's
 * identity before a screenshot is taken.
 *
 * Round 6 reordered the two. The screenshot-free identity extract answers "is
 * this the right route?" first, so a wrong page (a sign-in wall, a 404 card)
 * never pays for a capture it does not need. The paint refusal is now the paint
 * judge alone — a near-uniform frame, blank or still hydrating — because the
 * identity markers (sign-in / not-found / unauthorized) are decided by the
 * route stage, which runs before this one and reports `DESIGN_ROUTE_MISMATCH`.
 *
 * The route stage's honest bound: the identity extract exposes rendered text —
 * `meta.title` and `voice.sampleHeadings` (the text of headings inside semantic
 * sections). It is deliberately not a general identity check: on the measured
 * sign-in fixture the `<h1>` sits inside a `<form>`, which designlang does not
 * collect as a section, so `voice.sampleHeadings` was empty and `meta.title`
 * was the constant SPA title. A route whose marker text lives in a
 * non-semantic `<h1>` therefore reads as unobserved, and none is invented.
 *
 * The two bounded capture invocations live in `page-capture.ts`.
 */
import { capDetail, evidenceSnippet } from './evidence-text.js';
import { isNearUniform, type PaintMetric } from './paint-metric.js';
import {
  evaluateRouteIdentity,
  type RouteMismatchSignal,
  type RouteObservation
} from './route-identity.js';
import { redactUrl } from './url-redact.js';

/** The measured paint fields a block message carries, and never a score. */
export function describePaint(
  page: { readonly status: number | null; readonly finalUrl: string | null },
  metric: PaintMetric
): string {
  const status = page.status === null ? 'no response' : String(page.status);
  // A redirect's final URL is page-controlled: it may carry userinfo and it may
  // carry control bytes, so it is redacted AND sanitised before it is echoed.
  const finalUrl =
    page.finalUrl === null ? 'no response' : evidenceSnippet(redactUrl(page.finalUrl));
  return `status ${status}, finalUrl ${finalUrl}, nonModalPct ${metric.nonModalPct.toFixed(2)}, quantisedColours ${String(metric.quantisedColours)}, luminanceStd ${metric.luminanceStd.toFixed(2)}`;
}

export type PaintPage = {
  status: number | null;
  finalUrl: string | null;
  paint: PaintMetric;
};

/**
 * Why the capture makes this page unusable, or null when it may proceed. Only
 * the paint is judged here: page identity was already decided by the route
 * stage, so a sign-in or not-found page never reaches this function.
 */
export function paintRefusal(page: PaintPage): string | null {
  if (!isNearUniform(page.paint)) return null;
  return capDetail(
    'its viewport capture is near-uniform, so the page was blank or still hydrating ' +
      `(${describePaint(page, page.paint)})`
  );
}

/** The identity payload plus the declared marker Stage A never supplies. */
export type RouteStagePage = {
  /** The URL requested; its pathname names the route under test. */
  url: string;
  /** A declared marker from `design/paved-road.json` `routeMarkers`, when any. */
  expectedMarker?: string;
  observation: RouteObservation;
};

/** What the route stage could tell when it did not block. */
export type RouteJudgment = { kind: 'inert' | 'declared-marker' };

export type RouteStageVerdict =
  | { ok: true; judgment: RouteJudgment }
  | { ok: false; signal: RouteMismatchSignal; detail: string };

/** The route under check as a pathname, so no host or userinfo is echoed. */
function routeLabel(url: string): string {
  return URL.canParse(url) ? new URL(url).pathname : url;
}

/**
 * One evidence line naming what the route stage could tell. Inertness is not a
 * pass: the line says the route declared no marker, so a client-side redirect
 * could not be told apart. Without it the skill's "never read inertness as a
 * pass" would have nothing to read.
 */
export function routeJudgmentLine(url: string, judgment: RouteJudgment): string {
  return judgment.kind === 'inert'
    ? `route ${routeLabel(url)}: inert (no routeMarkers entry)`
    : `route ${routeLabel(url)}: declared marker observed`;
}

/**
 * The route-identity stage that runs BEFORE the screenshot. It judges the
 * rendered identity against the declared marker (when the paved road named one)
 * and the negative page-state markers — never `meta.url`, and never Stage A's
 * final URL, which Stage A already refuses on a changed path. An ok carries the
 * judgment so the caller can record it; a block names its measured signal,
 * never a score.
 */
export function judgeRoute(page: RouteStagePage): RouteStageVerdict {
  const verdict = evaluateRouteIdentity({
    route: routeLabel(page.url),
    ...(page.expectedMarker === undefined ? {} : { expectedMarker: page.expectedMarker }),
    observation: page.observation
  });
  if (!verdict.ok) return { ok: false, signal: verdict.signal, detail: verdict.detail };
  return { ok: true, judgment: { kind: verdict.inert === true ? 'inert' : 'declared-marker' } };
}
