// src/services/ide/adapters/claude-code-local-state.ts
//
// The readers for Claude Code's OWN on-disk state — its statusline state file and
// its transcript directory layout. Split out of `claude-code-adapter.ts`,
// verbatim and with one import apiece, because that file sits far past the
// 300-line cap and the repo's size ratchet only ever goes down: the adapter
// needs room for new declared surface, and a self-contained reader leaving is
// how a file earns that room instead of raising the ceiling.
//
// Nothing here is peaks-loop state. Every path below belongs to the harness, and
// every function tolerates its absence by answering `null` — a machine without a
// statusline file is not a broken machine.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Above this, a stored value is a percentage rather than a 0–1 fraction. Both
 * spellings occur in the wild, and nothing needs to know which one the harness
 * picked.
 */
const PERCENT_VERSUS_FRACTION = 1.5;

/**
 * Read Claude Code's statusline state file
 * (`~/.claude/statusline-state.json`) and parse a context-percent key.
 * Moved from the generic reader in slice
 * only in the Claude Code adapter.
 */
export function readClaudeStatuslinePercent(): number | null {
  const path = join(homedir(), '.claude', 'statusline-state.json');
  if (!existsSync(path)) return null;
  try {
    const json = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    const candidates = ['contextPercent', 'context_usage_percent', 'contextPercentUsed'];
    for (const key of candidates) {
      const raw = json[key];
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        return raw > PERCENT_VERSUS_FRACTION ? raw / 100 : Math.max(0, Math.min(1, raw));
      }
    }
  } catch (err) {
    // TODO(g2): legacy silent catch — now narrows to IO errors only (grace: 1 minor release, v2.14.0)
    if (err instanceof ReferenceError) throw err; // surface module-load bugs
    if (err instanceof SyntaxError) throw err; // surface parse bugs (e.g. broken statusline JSON)
    return null; // only swallow IO errors
  }
  return null;
}

/** One directory's worth of the walk: recurse into directories, return a matching file. */
function scanForFile(dir: string, fileName: string, pending: string[]): string | null {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      pending.push(full);
    } else if (entry.isFile() && entry.name === fileName) {
      return full;
    }
  }
  return null;
}

/**
 * Recursive search for `<outerSessionId>.jsonl` under `projectsDir`. The
 * Mac layout encodes the cwd as a single hash directory; on Mac Claude Code
 * nests the transcript under that hash with an extra level of subdirectory we
 * cannot predict ahead of time. A flat readdir misses that branch and returns
 * null — the silent-failure mode this recursion closes.
 *
 * Moved from the generic reader in slice
 * session id (Claude Code names its transcript by the outer session UUID),
 * NOT the peaks session id.
 */
export function findTranscriptJsonl(projectsDir: string, outerSessionId: string): string | null {
  if (!existsSync(projectsDir)) return null;
  const pending: string[] = [projectsDir];
  try {
    while (pending.length > 0) {
      const dir = pending.pop();
      if (dir === undefined) continue;
      const found = scanForFile(dir, `${outerSessionId}.jsonl`, pending);
      if (found !== null) return found;
    }
  } catch (err) {
    // TODO(g2): legacy silent catch — now narrows to IO errors only (grace: 1 minor release, v2.14.0)
    if (err instanceof ReferenceError) throw err; // surface module-load bugs
    if (err instanceof SyntaxError) throw err; // surface parse bugs
    return null; // only swallow IO errors
  }
  return null;
}

/**
 * Resolve the absolute path of a Claude Code transcript jsonl by OUTER
 * session id, searching `~/.claude/projects/**` recursively.
 *
 * `peaks code context-audit` reuses THIS locator instead of re-implementing
 * the recursive find. Returns `null` when the transcript does not exist —
 * callers MUST treat that as "unavailable", never as an error.
 */
export function resolveClaudeTranscriptPath(
  outerSessionId: string,
  projectsDir: string = join(homedir(), '.claude', 'projects')
): string | null {
  if (typeof outerSessionId !== 'string' || outerSessionId.length === 0) return null;
  return findTranscriptJsonl(projectsDir, outerSessionId);
}
