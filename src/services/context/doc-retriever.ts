/**
 * Per spec §4.1 Step 2 — DocRetriever.
 *
 * HARD CONSTRAINTS:
 *   H1 (CLI enforces — not LLM): this module is the only place that decides
 *       which docs to fetch.
 *   H2 (locked version): returns ONLY docs whose version exactly matches
 *       the locked dep version. No fallback to "latest". If no doc exists
 *       at the locked version, record `version_unknown` and move on.
 *
 * The fetcher is injected so tests can pin responses deterministically
 * (cross-version isolation test relies on this).
 */
import type {
  DepInfo, DocRetrieverOutput, DocSection, FetchedDoc, SkippedDoc,
} from './types.js';

export interface DocFetcher {
  (dep: string, version: string): Promise<FetcherPayload | null>;
}

export interface FetcherPayload {
  readonly version: string;
  readonly excerpt: string;
}

export interface RetrieveOptions {
  readonly fetcher: DocFetcher;
  readonly now?: () => Date;
}

function makeSection(excerpt: string): DocSection {
  // Trivial section split — production slice would parse markdown headings.
  // For v1, single-section per dep is sufficient.
  return {
    title: 'API Summary',
    tokenEstimate: Math.ceil(excerpt.length / 4),
    excerpt,
  };
}

function hashContent(content: string): string {
  // Stable hash via Node crypto (deterministic for test pinning).
  // Production uses sha256 from node:crypto.
  // For v1, we accept that this returns a non-cryptographic digest.
  let h = 0;
  for (let i = 0; i < content.length; i += 1) {
    h = ((h << 5) - h + content.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(16).padStart(16, '0').slice(0, 16);
}

export async function retrieveDocs(
  deps: Readonly<Record<string, DepInfo>>,
  options: RetrieveOptions,
): Promise<DocRetrieverOutput> {
  const fetchedDocs: FetchedDoc[] = [];
  const skipped: SkippedDoc[] = [];
  const now = options.now ?? (() => new Date());

  for (const [dep, info] of Object.entries(deps)) {
    try {
      const payload = await options.fetcher(dep, info.version);
      if (payload === null) {
        skipped.push({ dep, reason: 'version_unknown' });
        continue;
      }
      // ★ Core isolation check — defense in depth even if the fetcher is wrong.
      if (payload.version !== info.version) {
        skipped.push({ dep, reason: 'version_unknown' });
        continue;
      }
      fetchedDocs.push({
        dep,
        version: info.version,
        source: 'remote-fetch',
        fetchedAt: now().toISOString(),
        contentHash: hashContent(payload.excerpt),
        sections: [makeSection(payload.excerpt)],
        stale: false,
      });
    } catch {
      skipped.push({ dep, reason: 'network_error' });
    }
  }

  return { fetchedDocs, skipped };
}
