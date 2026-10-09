// src/cli/commands/qa-context-prestep.ts
//
// Plan 1 / Task 9 — the peaks-context build that runs BEFORE a peaks-qa slice.
// Extracted from `qa-commands.ts`; the cache dir, the token budget and the
// never-block contract are unchanged.

import { buildContext } from '../../services/context/context-builder.js';
import { createDocCacheFetcher } from '../../services/context/doc-cache-fetcher.js';
import type { DocFetcher } from '../../services/context/doc-retriever.js';

function buildDocFetcher(sid: string): DocFetcher {
  return createDocCacheFetcher({
    cacheDir: `.peaks/_runtime/${sid}/doc-cache`
    // remoteFetcher wired in a future slice.
  });
}

export async function ensureContextForQa(
  goal: string,
  project: string,
  sid: string
): Promise<void> {
  const out = `.peaks/_runtime/${sid}/context.json`;
  try {
    await buildContext({
      goal,
      project,
      audience: 'peaks-qa',
      depsMode: 'locked',
      docBudgetTokens: 8000,
      out,
      fetcher: buildDocFetcher(sid)
    });
  } catch (error) {
    // Plan 1 / Task 9 — context is a pre-step, not a precondition.
    // Task 11 will upgrade this to a hard precondition once the qa
    // slice actually consumes context.json.
    const message = error instanceof Error ? error.message : 'unknown context build failure';
    process.stderr.write(`[peaks-context] qa pre-step skipped: ${message}\n`);
  }
}
