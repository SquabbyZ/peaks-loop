/**
 * Stage A of the page-usability probe: one bounded HTTP GET.
 *
 * Three bounds keep this untrusted-input path finite. The request is capped by
 * an AbortController timeout; the body is read through a byte budget (256 KB is
 * ample for the visible-text count and the sign-in-field signal, and stops a
 * streaming page from filling memory before the abort); and a redirect that
 * crosses to a host which is not loopback is refused BEFORE the body is read.
 *
 * The redirect check matters because `response.url` is chosen by the tested
 * page's own `Location` header, not by the caller. A loopback dev server that
 * answers 302 can otherwise make this process GET an arbitrary address. A
 * same-host redirect stays inside the trust boundary the caller already
 * applied, and a loopback-to-loopback hop (a dev server moving ports) is still
 * the developer's own machine; anything else is refused as untrusted.
 */
import { TextDecoder } from 'node:util';

import { redactUrl } from './url-redact.js';
import { isLoopbackUrl } from './url-trust.js';

/** The Stage A budget; a timeout is `status: null`, which blocks. */
export const PROBE_TIMEOUT_MS = 5_000;
/**
 * Enough of a page to count visible text and spot a password field (256 KB).
 * A bare number rather than 256*1024 because the literals are not offsets.
 */
export const MAX_STAGE_A_BODY_BYTES = 262_144;

const PASSWORD_FIELD = /<input\b[^>]*\btype\s*=\s*["']?password/i;

/** Visible characters below which a password field means a sign-in wall. */
export const MIN_SIGNIN_BODY_CHARS = 300;

const HTTP_OK_MIN = 200;
const HTTP_OK_MAX = 299;

/** What Stage A measured from the HTTP answer. */
export type PageHttpObservation = {
  /** The final status, or null when the URL did not answer at all. */
  status: number | null;
  /** The URL after any redirects; null when it did not answer. */
  finalUrl: string | null;
  /** Non-whitespace visible characters in the returned HTML. */
  textChars: number;
  hasPasswordField: boolean;
  /** The final URL when a redirect crossed to a host that is not loopback. */
  untrustedRedirect?: string | null;
};

/** Visible character count: scripts, styles, tags and entities removed. */
export function visibleChars(html: string): number {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z0-9#]+;/gi, ' ')
    .replace(/\s+/g, '').length;
}

/**
 * The final URL when a redirect crossed to a host that is not loopback, or
 * null when the hop stayed trusted. A cross-HOST change on loopback (a dev
 * server moving ports) is allowed; a cross-host change anywhere else is not.
 * An unparsable address is never invented into a refusal.
 */
export function untrustedRedirectTarget(requested: string, final: string | null): string | null {
  if (final === null || !URL.canParse(requested) || !URL.canParse(final)) return null;
  const from = new URL(requested);
  const to = new URL(final);
  if (to.hostname === from.hostname) return null;
  return isLoopbackUrl(final) ? null : final;
}

/** The subset of the web-stream reader this module uses, typed locally. */
type ByteReader = {
  read: () => Promise<{ done: boolean; value?: Uint8Array }>;
  cancel: () => Promise<void>;
};

/** Read at most `limit` bytes of a response body as text, then cancel it. */
async function boundedText(response: Response, limit: number): Promise<string> {
  const body = response.body as unknown as { getReader: () => ByteReader } | null;
  if (body === null) return '';
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let read = 0;
  try {
    while (read < limit) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      const chunk = value ?? new Uint8Array(0);
      const take = chunk.length > limit - read ? chunk.subarray(0, limit - read) : chunk;
      text += decoder.decode(take, { stream: true });
      read += take.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return text + decoder.decode();
}

/** Release a body a refused redirect will not read, so the socket is freed. */
async function cancelBody(response: Response): Promise<void> {
  const body = response.body as unknown as { cancel: () => Promise<void> } | null;
  await body?.cancel().catch(() => undefined);
}

/**
 * Stage A: one GET, redirects followed, so `finalUrl` names where the page
 * really landed. A refused connection, DNS failure, or timeout is
 * `status: null`, which blocks the same way a non-2xx answer does.
 */
/** Redirect statuses whose Location becomes the next request. */
// eslint-disable-next-line no-magic-numbers -- HTTP redirect status codes are format constants.
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
/** At most this many hops; a response past it is the final answer. */
const MAX_REDIRECT_HOPS = 3;

/** The bounded observation of one final (non-redirect) response. */
async function finalObservation(response: Response): Promise<PageHttpObservation> {
  const html = await boundedText(response, MAX_STAGE_A_BODY_BYTES);
  return {
    status: response.status,
    finalUrl: response.url,
    textChars: visibleChars(html),
    hasPasswordField: PASSWORD_FIELD.test(html)
  };
}

/** The absolute URL a redirect answers with, or null when the answer is final. */
function nextHop(current: string, response: Response): string | null {
  if (!REDIRECT_STATUS.has(response.status)) return null;
  const location = response.headers.get('location');
  return location !== null && URL.canParse(location, current)
    ? new URL(location, current).href
    : null;
}

/**
 * Stage A: one GET, following redirects MANUALLY so each `Location` is checked
 * against the trust boundary BEFORE the next request is issued. `redirect:
 * 'follow'` would fetch a cross-host target first and refuse it after, which is
 * the SSRF-adjacent request the check exists to prevent. A refused connection,
 * DNS failure, or timeout is `status: null`, which blocks.
 */
export async function fetchPageHttp(
  url: string,
  timeoutMs: number = PROBE_TIMEOUT_MS
): Promise<PageHttpObservation> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    let current = url;
    for (let hop = 0; ; hop += 1) {
      const response = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal
      });
      const next = nextHop(current, response);
      if (next === null) return await finalObservation(response);
      await cancelBody(response);
      const untrusted = untrustedRedirectTarget(current, next);
      if (untrusted !== null) {
        return {
          status: response.status,
          finalUrl: next,
          textChars: 0,
          hasPasswordField: false,
          untrustedRedirect: untrusted
        };
      }
      if (hop >= MAX_REDIRECT_HOPS) {
        return {
          status: response.status,
          finalUrl: current,
          textChars: 0,
          hasPasswordField: false
        };
      }
      current = next;
    }
  } catch {
    return { status: null, finalUrl: null, textChars: 0, hasPasswordField: false };
  } finally {
    clearTimeout(timer);
  }
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
export function httpRefusal(url: string, http: PageHttpObservation): string | null {
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
