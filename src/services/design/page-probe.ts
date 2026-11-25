/**
 * Is a page usable for a design check? Four stages, because one cannot decide.
 *
 * Stage A (HTTP) catches a refused server, a non-2xx answer, a redirect to a
 * different path (a sign-in wall), and a short sign-in form. It CANNOT tell a
 * rendered SPA route from a blank shell: both measured as 200, same URL, zero
 * static text. Its reader lives in `page-probe-stages.ts`.
 *
 * Stage B runs one `designlang stats --as-json` per URL and blocks when no
 * rendered text element carries a font family. It also passes the pilot's blank
 * route (the global stylesheet supplies the counts), so it is corroboration only.
 *
 * Stage C1 is the screenshot-free identity extract (title, headings, buttons,
 * anatomy sample text, input count). The ROUTE STAGE judges that document
 * BEFORE any screenshot runs: a sign-in wall or a 404 card is a
 * `DESIGN_ROUTE_MISMATCH` that names the identity elapsed time and never pays
 * its 7.6 s–60 s capture (round 6; round 4 measured >381 s on an auth page).
 *
 * Stage C2 is the screenshot-only extract, reached only when the route is
 * plausible. It writes `<session>/design/probe/<url>/screenshots/full-page.png`,
 * decoded in-process and quantised to 5 bits per channel. The spike measured a
 * blank frame at nonModalPct 0.00 / 1 colour / luminanceStd 0.00 and the
 * smallest rendered frame over seven captures at 3.03 % / 1296 / 13.77 — a ≥3×
 * margin. A near-uniform frame blocks, so does a capture/decode failure and a
 * capture timeout with its measured elapsedMs.
 *
 * Every failure is `blocked` carrying the measured fields — never a score, and
 * never a fail. The paint block carries `status`, `finalUrl`, `nonModalPct`,
 * `quantisedColours`, `luminanceStd` and both call timings; the earlier stages
 * carry `fontFamilyCount`.
 */
import type { DesignlangRunResult } from './designlang.js';
import { captureIdentity, captureScreenshot, type PaintFailureCause } from './page-capture.js';
import { judgeRoute, paintRefusal, type RouteJudgment } from './page-paint.js';
import { measured, unusable } from './page-probe-block.js';
import { fetchPageHttp, httpRefusal, type PageHttpObservation } from './page-probe-http.js';
import { readHttp, readStats, statsRefusal } from './page-probe-stages.js';
import type { PaintMetric } from './paint-metric.js';
import type { RouteObservation } from './route-identity.js';
import { redactUrl } from './url-redact.js';

/** Stage A's observation, the real fetch, and its text counter live in page-probe-http. */
export {
  fetchPageHttp,
  MIN_SIGNIN_BODY_CHARS,
  visibleChars,
  type PageHttpObservation
} from './page-probe-http.js';

/** The unusable-page block and its measured fields live in page-probe-block. */
export { DESIGN_PAGE_UNUSABLE } from './page-probe-block.js';

/** The route check's code: the page rendered a different route than requested. */
const DESIGN_ROUTE_MISMATCH = 'DESIGN_ROUTE_MISMATCH';

/** What Stage B measured from `designlang stats --as-json`. */
export type PageStatsObservation = {
  /** Font families on rendered TEXT elements; 0 means nothing was rendered. */
  fontFamilyCount: number | null;
  /** Corroborating signal: 1 for a blank shell, 2..9 for a rendered page. */
  typeScale: number | null;
};

/** What Stage C measured from the identity document and the viewport PNG. */
export type PagePaintObservation = {
  paint: PaintMetric;
  /** What the route stage could tell: inert, or a declared marker observed. */
  route: RouteJudgment;
};

export type PageProbeObservation = PageHttpObservation &
  PageStatsObservation &
  PagePaintObservation & {
    /** Wall time the screenshot-free identity extract took. */
    identityElapsedMs: number;
    /** Wall time the screenshot-only capture took. */
    captureElapsedMs: number;
    /** Wall time this URL's probe spent, so a slow page or a hang is visible. */
    elapsedMs: number;
  };

export type PageProbeCode =
  'DESIGN_PAGE_UNUSABLE' | typeof DESIGN_ROUTE_MISMATCH | 'DESIGN_ENGINE_UNAVAILABLE';

/**
 * What the probe's disk hygiene did to stale captures for this URL. Carried on
 * a successful result so the caller can record it instead of dropping it.
 */
export type ProbePrune = { removed: readonly string[]; failed: number };

export type PageProbeResult =
  | { ok: true; observation: PageProbeObservation; pruned?: ProbePrune }
  | { ok: false; code: PageProbeCode; message: string };

export type PageProbeInput = {
  url: string;
  /** A declared marker from `design/paved-road.json`; absent means none. */
  expectedMarker?: string;
  /** Spawns `designlang stats <url> --as-json`; injected so tests stay hermetic. */
  runStats: (url: string) => Promise<DesignlangRunResult>;
  /** Spawns the screenshot-free identity extract; injected for hermetic tests. */
  runIdentity: (url: string) => Promise<DesignlangRunResult>;
  /** Spawns the screenshot-only extract; injected so no unit test launches a browser. */
  runScreenshot: (url: string, outDir: string) => Promise<DesignlangRunResult>;
  /** Where the capture writes; `<session>/design/probe/<slug>` in production. */
  outDir: string;
  readCaptureBytes?: (path: string) => Promise<Uint8Array>;
  /** Defaults to `fetchPageHttp`; injected tests replay a measured page. */
  fetchPage?: (url: string) => Promise<PageHttpObservation>;
};

type IdentityRead =
  | { ok: true; observation: RouteObservation; elapsedMs: number }
  | { ok: false; detail: string; cause: PaintFailureCause; elapsedMs: number };

/** Stage C1: the screenshot-free identity extract; any failure blocks. */
async function readIdentity(input: PageProbeInput): Promise<IdentityRead> {
  const read = await captureIdentity({
    url: input.url,
    runIdentity: input.runIdentity
  });
  if (!read.ok) {
    return {
      ok: false,
      detail: read.reason,
      cause: read.cause,
      elapsedMs: read.elapsedMs
    };
  }
  return { ok: true, observation: read.document.observation, elapsedMs: read.elapsedMs };
}

type CaptureRead =
  | { ok: true; paint: PaintMetric; elapsedMs: number }
  | { ok: false; detail: string; cause: PaintFailureCause; elapsedMs: number };

/** Stage C2: the screenshot extract and the fixed-path decode; any failure blocks. */
async function readCapture(input: PageProbeInput): Promise<CaptureRead> {
  const read = await captureScreenshot({
    url: input.url,
    outDir: input.outDir,
    runScreenshot: input.runScreenshot,
    ...(input.readCaptureBytes === undefined ? {} : { readBytes: input.readCaptureBytes })
  });
  if (!read.ok) {
    return { ok: false, detail: read.reason, cause: read.cause, elapsedMs: read.elapsedMs };
  }
  return { ok: true, paint: read.metric, elapsedMs: read.elapsedMs };
}

type RouteStageRead =
  { ok: true; judgment: RouteJudgment } | { ok: false; result: PageProbeResult };

/**
 * The route stage, run BETWEEN the identity extract and the screenshot: a
 * declared marker that was not observed, a negative marker in the title or a
 * heading, or an unobserved marker beside rendered inputs. An ok carries the
 * judgment (inert or declared marker observed) so the caller can record it.
 */
function routeStage(
  input: PageProbeInput,
  observed: Partial<PageProbeObservation>,
  identity: Extract<IdentityRead, { ok: true }>
): RouteStageRead {
  const verdict = judgeRoute({
    url: input.url,
    ...(input.expectedMarker === undefined ? {} : { expectedMarker: input.expectedMarker }),
    observation: identity.observation
  });
  if (verdict.ok) return { ok: true, judgment: verdict.judgment };
  return {
    ok: false,
    result: {
      ok: false,
      code: DESIGN_ROUTE_MISMATCH,
      message:
        `The page ${redactUrl(input.url)} cannot be judged: ${verdict.detail} ` +
        `(signal ${verdict.signal}; ${measured(input.url, observed)}). ` +
        'A route mismatch is blocked, never turned into a render verdict.'
    }
  };
}

/** Stage B through Stage C2, once Stage A and the stats run have passed. */
async function probeRendered(
  input: PageProbeInput,
  statsObservation: PageHttpObservation & PageStatsObservation,
  elapsed: () => number
): Promise<PageProbeResult> {
  const identity = await readIdentity(input);
  if (!identity.ok) {
    // The identity extract is the page's own rendered text; without it nothing
    // can be judged, and the cause names which half of the capture failed.
    return unusable(
      input.url,
      `the page identity could not be read: ${identity.detail} (cause ${identity.cause})`,
      { ...statsObservation, identityElapsedMs: identity.elapsedMs, elapsedMs: elapsed() }
    );
  }
  const routeObserved = { ...statsObservation, identityElapsedMs: identity.elapsedMs };
  const routeRead = routeStage(input, { ...routeObserved, elapsedMs: elapsed() }, identity);
  if (!routeRead.ok) return routeRead.result;
  const capture = await readCapture(input);
  if (!capture.ok) {
    // A capture timeout names its own half and the measured elapsedMs, so the
    // block can never be mistaken for a score or for a page that was measured.
    return unusable(
      input.url,
      `the viewport capture could not be measured: ${capture.detail} (cause ${capture.cause})`,
      { ...routeObserved, captureElapsedMs: capture.elapsedMs, elapsedMs: elapsed() }
    );
  }
  const full: PageProbeObservation = {
    ...routeObserved,
    paint: capture.paint,
    route: routeRead.judgment,
    captureElapsedMs: capture.elapsedMs,
    elapsedMs: elapsed()
  };
  const refusal = paintRefusal(full);
  if (refusal !== null) return unusable(input.url, refusal, full);
  return { ok: true, observation: full };
}

/** Probe one URL; `ok` means a rendered page was measured, anything else blocks. */
export async function probePageUsable(input: PageProbeInput): Promise<PageProbeResult> {
  const startedAt = Date.now();
  const elapsed = (): number => Date.now() - startedAt;
  const http = await readHttp(input.url, input.fetchPage ?? fetchPageHttp);
  const httpDetail = httpRefusal(input.url, http);
  if (httpDetail !== null)
    return unusable(input.url, httpDetail, { ...http, elapsedMs: elapsed() });
  const stats = await readStats(input.runStats, input.url);
  if (!stats.ok) return unusable(input.url, stats.detail, { ...http, elapsedMs: elapsed() });
  const statsObservation: PageHttpObservation & PageStatsObservation = {
    ...http,
    ...stats.observation
  };
  const statsDetail = statsRefusal(stats.observation);
  if (statsDetail !== null) {
    return unusable(input.url, statsDetail, { ...statsObservation, elapsedMs: elapsed() });
  }
  return probeRendered(input, statsObservation, elapsed);
}
