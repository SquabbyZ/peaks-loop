/**
 * The `DESIGN_PAGE_UNUSABLE` block messages for the page-usability probe.
 *
 * Every refusal names the fields it measured — status, final URL, font count
 * and the timings it has — and never a score. Kept out of `page-probe.ts` so
 * the four-stage orchestration stays inside the file-size ceiling; the types
 * it returns are the probe's own and are imported type-only.
 */
import { evidenceSnippet } from './evidence-text.js';
import type { PageProbeObservation, PageProbeResult } from './page-probe.js';
import { redactUrl } from './url-redact.js';

/** The code every unusable page reports; the caller blocks on it, never fails. */
export const DESIGN_PAGE_UNUSABLE = 'DESIGN_PAGE_UNUSABLE';

function shown(value: string | number | null, fallback: string): string {
  return value === null ? fallback : String(value);
}

/** The measured fields every block message must carry, and no score. */
export function measured(url: string, observed: Partial<PageProbeObservation>): string {
  const status = observed.status ?? null;
  const finalUrl = observed.finalUrl ?? null;
  const fontFamilyCount = observed.fontFamilyCount ?? null;
  const elapsedMs = observed.elapsedMs ?? null;
  const identityElapsedMs = observed.identityElapsedMs ?? null;
  const captureElapsedMs = observed.captureElapsedMs ?? null;
  // A redirect's finalUrl is chosen by the tested page, so it can carry
  // userinfo AND control bytes; both spellings are redacted and sanitised
  // before they are persisted, exactly as describePaint does.
  const shownUrl =
    finalUrl === null ? evidenceSnippet(redactUrl(url)) : evidenceSnippet(redactUrl(finalUrl));
  // Only the halves that actually ran are reported: a route refusal happens
  // before the screenshot, so it must not claim a capture time it never spent.
  const timing =
    (identityElapsedMs === null ? '' : `, identityElapsedMs ${String(identityElapsedMs)}`) +
    (captureElapsedMs === null ? '' : `, captureElapsedMs ${String(captureElapsedMs)}`);
  return `status ${shown(status, 'no response')}, finalUrl ${shownUrl}, fontFamilyCount ${shown(fontFamilyCount, 'unknown')}, elapsedMs ${shown(elapsedMs, 'unknown')}${timing}`;
}

/** One unusable-page block carrying the fields the stages measured so far. */
export function unusable(
  url: string,
  detail: string,
  observed: Partial<PageProbeObservation> = {}
): PageProbeResult {
  const page = evidenceSnippet(redactUrl(url));
  return {
    ok: false,
    code: DESIGN_PAGE_UNUSABLE,
    message:
      `The page ${page} cannot be judged: ${detail} (${measured(url, observed)}). ` +
      'An unusable page is blocked, never turned into a render verdict.'
  };
}
