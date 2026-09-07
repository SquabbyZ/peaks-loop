/**
 * Fresh-context dispatch block reader (slice 2026-09-07-search-first-preflight).
 *
 * Reads the orchestrator-synthesized `.peaks/_runtime/<sessionId>/fresh-context.md`
 * and returns its `## Fresh context` section for injection into the RD/PRD
 * dispatch system prompt. Fail-soft: a missing / unreadable file, or a file
 * without the `## Fresh context` heading, degrades to `null` so the dispatch
 * prompt stays byte-identical to the legacy shape.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FRESH_CONTEXT_HEADING = '## Fresh context';

/**
 * Extract the `## Fresh context` section from a markdown body. Returns the
 * substring from the heading to end-of-file (trimmed), or `null` when the
 * heading is absent or the section is empty.
 */
export function extractFreshContextBlock(content: string): string | null {
  const idx = content.indexOf(FRESH_CONTEXT_HEADING);
  if (idx < 0) return null;
  const block = content.slice(idx).trim();
  return block.length > 0 ? block : null;
}

/**
 * Read the fresh-context block for a session. Returns `null` on any read
 * failure (missing file, unreadable, or no `## Fresh context` heading) —
 * callers treat `null` as "no block", never a hard error.
 */
export function readFreshContextBlock(projectRoot: string, sessionId: string): string | null {
  const path = join(projectRoot, '.peaks', '_runtime', sessionId, 'fresh-context.md');
  let content: string;
  try {
    content = readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
  return extractFreshContextBlock(content);
}
