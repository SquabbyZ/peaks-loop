/**
 * Page URL resolution for the G2 render matrix.
 *
 * Each page from `--pages` or `engine.json` is resolved against the base URL
 * and then re-checked against the trust boundary — `engine.json` is a tracked
 * file, so a page entry can name a credentialed, private-network or
 * cross-origin URL even when the base URL was trusted. The refusal text masks
 * any userinfo, because it is persisted into the check evidence.
 */
import { blockedMessage } from './acceptance.js';
import type { EngineContractFile } from './engine-contract.js';
import { evidenceSnippet } from './evidence-text.js';
import { isTrustedDesignUrl } from './url-trust.js';
import { redactUrl } from './url-redact.js';

export type PageUrlResult =
  { ok: true; urls: string[] } | { ok: false; code: 'DESIGN_URL_UNTRUSTED'; message: string };

function untrustedPage(page: string): PageUrlResult {
  return {
    ok: false,
    code: 'DESIGN_URL_UNTRUSTED',
    message: `${blockedMessage('DESIGN_URL_UNTRUSTED')} Offending page: ${evidenceSnippet(redactUrl(page))}.`
  };
}

/** Resolve every page against the base, then re-apply the trust boundary to each. */
export function resolvePageUrls(
  baseUrl: string,
  pages: readonly string[],
  engine: EngineContractFile
): PageUrlResult {
  const urls: string[] = [];
  for (const page of pages) {
    let url: string;
    try {
      url = new URL(page, baseUrl).toString();
    } catch {
      return untrustedPage(page);
    }
    if (!isTrustedDesignUrl(url, engine)) return untrustedPage(page);
    urls.push(url);
  }
  return { ok: true, urls };
}
