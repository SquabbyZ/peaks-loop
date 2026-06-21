/**
 * Temporary fetcher used until Task 10 (headroomFetcher) lands.
 *
 * Returns `null` for every (dep, version) so DocRetriever records
 * `version_unknown` for each dep. Task 10 replaces this via a one-line
 * import swap in rd-service.ts (or wherever the fetcher is wired in).
 */
import type { DocFetcher } from './doc-retriever.js';

export const mockFetcher: DocFetcher = async (_dep, _version) => {
  return null;
};
