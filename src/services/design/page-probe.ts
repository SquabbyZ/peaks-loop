/**
 * Is a page usable for a design check? Three stages, because one cannot decide.
 *
 * Stage A (HTTP) catches a refused server, a non-2xx answer, a redirect to a
 * different path (a sign-in wall), and a short sign-in form. It CANNOT tell a
 * rendered SPA route from a blank shell: both measured as 200, same URL, zero static text.
 *
 * Stage B runs one `designlang stats --as-json` per URL and blocks when no
 * rendered text element carries a font family. That catches a genuinely empty
 * shell, but on the pilot it PASSES the blank route (stats sees the global
 * stylesheet: fontFamilyCount 1, typeScale 7) because the DOM counts overlap.
 *
 * Stage C is the measured paint signal: one `designlang` capture that writes
 * `<session>/design/probe/<url>/screenshots/full-page.png`, decoded in-process
 * and quantised to 5 bits per channel. The spike measured a blank frame at
 * nonModalPct 0.00 / 1 colour / luminanceStd 0.00 and the smallest rendered
 * frame over seven captures at 3.03 % / 1296 / 13.77 — a ≥3× margin. A
 * near-uniform frame blocks, so does a capture/decode failure, and so does a
 * page whose title or a rendered heading starts with an unusable marker
 * (sign-in / not-found / HTTP error); the route-identity limit is documented
 * in `page-paint.ts`.
 *
 * Every failure is `blocked(DESIGN_PAGE_UNUSABLE)` carrying the measured
 * fields — never a score, and never a fail. The paint block carries
 * `status`, `finalUrl`, `nonModalPct`, `quantisedColours` and `luminanceStd`;
 * the earlier stages carry `fontFamilyCount`. An artwork-only page still
 * blocks at Stage B (no text element carries a font family), as the plan
 * recorded; Stage C's paint signal is only reached by pages Stage B passes.
 */
import type { DesignlangRunResult } from './designlang.js';
import { parseJsonObject } from './designlang-evidence.js';
import { capturePaint, paintRefusal } from './page-paint.js';
import { fetchPageHttp, type PageHttpObservation } from './page-probe-http.js';
import type { PaintMetric } from './paint-metric.js';
import { redactUrl } from './url-redact.js';

/** Stage A's observation, the real fetch, and its text counter live in page-probe-http. */
export { fetchPageHttp, visibleChars, type PageHttpObservation } from './page-probe-http.js';

/** The code every unusable page reports; the caller blocks on it, never fails. */
export const DESIGN_PAGE_UNUSABLE = 'DESIGN_PAGE_UNUSABLE';

/** Visible characters below which a password field means a sign-in wall. */
export const MIN_SIGNIN_BODY_CHARS = 300;

const HTTP_OK_MIN = 200;
const HTTP_OK_MAX = 299;

/** What Stage B measured from `designlang stats --as-json`. */
export type PageStatsObservation = {
  /** Font families on rendered TEXT elements; 0 means nothing was rendered. */
  fontFamilyCount: number | null;
  /** Corroborating signal: 1 for a blank shell, 2..9 for a rendered page. */
  typeScale: number | null;
};

/** What Stage C measured from the captured viewport PNG. */
export type PagePaintObservation = {
  paint: PaintMetric;
  pageTitle: string | null;
  /** Rendered headings the capture reported; empty when none were collected. */
  pageHeadings: string[];
};

export type PageProbeObservation = PageHttpObservation &
  PageStatsObservation &
  PagePaintObservation & {
    /** Wall time this URL's probe spent, so a slow page or a hang is visible. */
    elapsedMs: number;
  };

export type PageProbeCode = typeof DESIGN_PAGE_UNUSABLE | 'DESIGN_ENGINE_UNAVAILABLE';

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
  /** Spawns `designlang stats <url> --as-json`; injected so tests stay hermetic. */
  runStats: (url: string) => Promise<DesignlangRunResult>;
  /** Spawns the probed capture vector; injected so no unit test launches a browser. */
  runCapture: (url: string, outDir: string) => Promise<DesignlangRunResult>;
  /** Where the capture writes; `<session>/design/probe/<slug>` in production. */
  outDir: string;
  readCaptureBytes?: (path: string) => Promise<Uint8Array>;
  /** Defaults to `fetchPageHttp`; injected tests replay a measured page. */
  fetchPage?: (url: string) => Promise<PageHttpObservation>;
};

/** A finite number, or null for anything else (including `NaN`/`Infinity`). */
function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function shown(value: string | number | null, fallback: string): string {
  return value === null ? fallback : String(value);
}

/** The measured fields every block message must carry, and no score. */
function measured(url: string, observed: Partial<PageProbeObservation>): string {
  const status = observed.status ?? null;
  const finalUrl = observed.finalUrl ?? null;
  const fontFamilyCount = observed.fontFamilyCount ?? null;
  const elapsedMs = observed.elapsedMs ?? null;
  // A redirect's finalUrl is chosen by the tested page, so it can carry
  // userinfo; both spellings go through redactUrl before they are persisted.
  const shownUrl = finalUrl === null ? redactUrl(url) : redactUrl(finalUrl);
  return `status ${shown(status, 'no response')}, finalUrl ${shownUrl}, fontFamilyCount ${shown(fontFamilyCount, 'unknown')}, elapsedMs ${shown(elapsedMs, 'unknown')}`;
}

function unusable(
  url: string,
  detail: string,
  observed: Partial<PageProbeObservation> = {}
): PageProbeResult {
  return {
    ok: false,
    code: DESIGN_PAGE_UNUSABLE,
    message:
      `The page ${redactUrl(url)} cannot be judged: ${detail} (${measured(url, observed)}). ` +
      'An unusable page is blocked, never turned into a render verdict.'
  };
}

/** The path of a URL, or null when it cannot be parsed. */
function pathOf(value: string | null): string | null {
  if (value === null || !URL.canParse(value)) return null;
  return new URL(value).pathname;
}

/** Why a 2xx answer's final path differs from the requested one, or null. */
function redirectRefusal(url: string, http: PageHttpObservation): string | null {
  const requested = pathOf(url);
  const final = pathOf(http.finalUrl);
  if (requested !== null && final !== null && requested !== final) {
    return `the URL redirected to a different path (${redactUrl(http.finalUrl ?? url)}), which is a sign-in wall`;
  }
  return null;
}

/** Why Stage A refuses this answer, or null when it may proceed to Stage B. */
function httpRefusal(url: string, http: PageHttpObservation): string | null {
  // The untrusted hop is reported before the status bucket: a refused 302 is
  // not the page "answering HTTP 302", it is a redirect this probe would not make.
  if (http.untrustedRedirect !== null && http.untrustedRedirect !== undefined) {
    return `the URL redirected to an untrusted host (${redactUrl(http.untrustedRedirect)})`;
  }
  if (http.status === null) {
    return 'the URL did not answer (a refused connection, DNS failure, or timeout)';
  }
  if (http.status < HTTP_OK_MIN || http.status > HTTP_OK_MAX) {
    return `the URL answered HTTP ${String(http.status)}`;
  }
  const redirected = redirectRefusal(url, http);
  if (redirected !== null) return redirected;
  if (http.hasPasswordField && http.textChars < MIN_SIGNIN_BODY_CHARS) {
    return `the page carries a password field and only ${String(http.textChars)} visible characters`;
  }
  return null;
}

type StatsRead = { ok: true; observation: PageStatsObservation } | { ok: false; detail: string };

/** Stage B: one stats run; a failed or shapeless run blocks, never passes. */
async function readStats(runStats: PageProbeInput['runStats'], url: string): Promise<StatsRead> {
  let result: DesignlangRunResult;
  try {
    result = await runStats(url);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, detail: `designlang stats threw before printing: ${detail}` };
  }
  const parsed = parseJsonObject(result.stdout);
  if (parsed === null) {
    return {
      ok: false,
      detail: `designlang stats exited ${String(result.exitCode)} without a JSON document`
    };
  }
  const fontFamilyCount = finiteNumber(parsed.fontFamilyCount);
  if (fontFamilyCount === null) {
    return {
      ok: false,
      detail: `designlang stats exited ${String(result.exitCode)} without a fontFamilyCount`
    };
  }
  return { ok: true, observation: { fontFamilyCount, typeScale: finiteNumber(parsed.typeScale) } };
}

type PaintRead = { ok: true; observation: PagePaintObservation } | { ok: false; detail: string };

/** Stage C: one capture, its PNG decoded and measured; any failure blocks. */
async function readPaint(input: PageProbeInput): Promise<PaintRead> {
  const measured = await capturePaint({
    url: input.url,
    outDir: input.outDir,
    runCapture: input.runCapture,
    ...(input.readCaptureBytes === undefined ? {} : { readBytes: input.readCaptureBytes })
  });
  if (!measured.ok) return { ok: false, detail: measured.reason };
  return {
    ok: true,
    observation: {
      paint: measured.metric,
      pageTitle: measured.document.title,
      pageHeadings: measured.document.headings
    }
  };
}

/** Probe one URL; `ok` means a rendered page was measured, anything else blocks. */
export async function probePageUsable(input: PageProbeInput): Promise<PageProbeResult> {
  const startedAt = Date.now();
  const elapsed = (): number => Date.now() - startedAt;
  const fetchPage = input.fetchPage ?? fetchPageHttp;
  let http: PageHttpObservation;
  try {
    http = await fetchPage(input.url);
  } catch {
    http = { status: null, finalUrl: null, textChars: 0, hasPasswordField: false };
  }
  const httpDetail = httpRefusal(input.url, http);
  if (httpDetail !== null)
    return unusable(input.url, httpDetail, { ...http, elapsedMs: elapsed() });
  const stats = await readStats(input.runStats, input.url);
  if (!stats.ok) return unusable(input.url, stats.detail, { ...http, elapsedMs: elapsed() });
  const statsObservation: PageHttpObservation & PageStatsObservation = {
    ...http,
    ...stats.observation
  };
  const { fontFamilyCount, typeScale } = statsObservation;
  if (fontFamilyCount === 0 && (typeScale === null || typeScale <= 1)) {
    return unusable(
      input.url,
      'no rendered text element carries a font family, so the page is blank or artwork-only',
      { ...statsObservation, elapsedMs: elapsed() }
    );
  }
  const paint = await readPaint(input);
  if (!paint.ok) {
    return unusable(input.url, `the viewport capture could not be measured: ${paint.detail}`, {
      ...statsObservation,
      elapsedMs: elapsed()
    });
  }
  const full: PageProbeObservation = {
    ...statsObservation,
    ...paint.observation,
    elapsedMs: elapsed()
  };
  const refusal = paintRefusal(full);
  if (refusal !== null) return unusable(input.url, refusal, full);
  return { ok: true, observation: full };
}
