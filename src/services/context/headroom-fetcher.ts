/**
 * Production DocFetcher. Uses existing headroom-ai dependency for remote
 * fetch; local cache (per-session, per-dep markdown) preferred when version matches.
 *
 * Hard constraint H2 (locked version): never returns a doc whose version
 * differs from the requested locked version.
 *
 * Cache path (per pre-flight fix #2): .peaks/_runtime/<sid>/doc-cache/<dep>@<version>.md
 *   - Per-session (NOT cross-session shared at ~/.peaks/cache/docs/)
 *   - Reason: spec §4.1 keeps everything under _runtime which is gitignored
 *     and ephemeral; cross-session caching is a future-slice optimization.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DocFetcher, FetcherPayload } from './doc-retriever.js';

export interface HeadroomFetcherOptions {
  readonly cacheDir: string;
  readonly remoteFetcher?: DocFetcher;
}

export function createHeadroomFetcher(opts: HeadroomFetcherOptions): DocFetcher {
  return async (dep, version) => {
    const cachePath = join(opts.cacheDir, `${dep}@${version}.md`);
    try {
      const content = await readFile(cachePath, 'utf8');
      return { version, excerpt: content };
    } catch {
      if (!opts.remoteFetcher) return null;
      return opts.remoteFetcher(dep, version);
    }
  };
}
