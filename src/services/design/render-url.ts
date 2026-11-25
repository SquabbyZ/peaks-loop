/**
 * Render URL resolution and reachability probing for `peaks design check`.
 *
 * The resolver is a precedence ladder: `--url` > `PEAKS_DESIGN_URL` >
 * `design/engine.json` `render.url` > a derived `http://127.0.0.1:<port><path>`.
 * Every candidate goes through `isTrustedDesignUrl`, so a private-network
 * address, a `localhost.evil.com` lookalike, a credentialed URL, or a non-HTTP
 * scheme is REFUSED rather than silently replaced by the next candidate — the
 * plan's rule is "untrusted blocks", never "untrusted falls back".
 *
 * `env` is an injected snapshot, not an implicit read of `process.env`: the CLI
 * passes `process.env`, tests pass a fixed record, and leaving it out means
 * "no environment candidate".
 */
import type { EngineContractFile } from './engine-contract.js';
import { evidenceSnippet } from './evidence-text.js';
import { isTrustedDesignUrl } from './url-trust.js';
import { redactUrl } from './url-redact.js';

/** The environment variable a project can set to pin the render URL. */
export const DESIGN_URL_ENV_KEY = 'PEAKS_DESIGN_URL';

/** The highest port a URL can name. */
const MAX_PORT = 65_535;

/** Per-attempt probe budget; a dev server may be slow to answer its first request. */
const DEFAULT_PROBE_TIMEOUT_MS = 2_000;

export type RenderUrlSource = 'flag' | 'env' | 'engine' | 'derived';

export type RenderUrlResult =
  | { ok: true; url: string; source: RenderUrlSource }
  | { ok: false; code: 'DESIGN_RENDER_URL_MISSING' | 'DESIGN_URL_UNTRUSTED'; message: string };

export type ResolveRenderUrlInput = {
  /** `--url <value>`; an empty string counts as absent. */
  explicitUrl?: string | null;
  /** Environment snapshot; when omitted, no env candidate is considered. */
  env?: Readonly<Record<string, string | undefined>>;
  engine: Pick<EngineContractFile, 'render'>;
};

/** Trimmed value, or null for undefined / null / whitespace-only. */
function present(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * The loopback URL a `render.port` implies. A port of 0 means "the OS picks
 * one", which cannot be addressed before the server starts, so it yields null.
 */
function derivedUrl(render: EngineContractFile['render']): string | null {
  const port = render.port;
  if (!Number.isInteger(port) || port <= 0 || port > MAX_PORT) return null;
  const path = render.path.startsWith('/') ? render.path : `/${render.path}`;
  return `http://127.0.0.1:${port}${path}`;
}

function refuseUntrusted(url: string, source: RenderUrlSource): RenderUrlResult {
  // A `--url` flag or a tracked engine.json can carry control bytes; redaction
  // masks credentials and sanitising removes the bytes before this is persisted.
  const shown = evidenceSnippet(redactUrl(url));
  return {
    ok: false,
    code: 'DESIGN_URL_UNTRUSTED',
    message:
      `Refusing untrusted render URL ${shown} (from ${source}): use a loopback host ` +
      'or record this exact URL as render.url in design/engine.json.'
  };
}

function refuseMissing(): RenderUrlResult {
  return {
    ok: false,
    code: 'DESIGN_RENDER_URL_MISSING',
    message:
      'No render URL is configured: pass --url, set PEAKS_DESIGN_URL, record render.url ' +
      'in design/engine.json, or set render.port to derive a loopback URL.'
  };
}

/** Resolve the URL `peaks design check` should render, with its provenance. */
export function resolveRenderUrl(input: ResolveRenderUrlInput): RenderUrlResult {
  const candidates: Array<{ url: string; source: RenderUrlSource }> = [];
  const flag = present(input.explicitUrl);
  if (flag !== null) candidates.push({ url: flag, source: 'flag' });
  const env = present(input.env?.[DESIGN_URL_ENV_KEY]);
  if (env !== null) candidates.push({ url: env, source: 'env' });
  const recorded = present(input.engine.render.url);
  if (recorded !== null) candidates.push({ url: recorded, source: 'engine' });

  const chosen = candidates[0];
  if (chosen !== undefined) {
    if (!isTrustedDesignUrl(chosen.url, input.engine)) {
      return refuseUntrusted(chosen.url, chosen.source);
    }
    return { ok: true, url: chosen.url, source: chosen.source };
  }

  const derived = derivedUrl(input.engine.render);
  if (derived === null) return refuseMissing();
  if (!isTrustedDesignUrl(derived, input.engine)) return refuseUntrusted(derived, 'derived');
  return { ok: true, url: derived, source: 'derived' };
}

/**
 * True when the URL answers with ANY HTTP response (including 4xx / 5xx — the
 * dev server is up). A refused connection, DNS failure, or timeout is false.
 * Redirects are not followed: reachability is judged on the target itself.
 */
export async function probeRenderUrl(
  url: string,
  timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal
    });
    // Release the socket without waiting for the page body. The response has
    // already answered, so a cancelled/aborted body must not turn this false.
    const cancelled = response.body?.cancel();
    if (cancelled !== undefined) await cancelled.catch(() => undefined);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
