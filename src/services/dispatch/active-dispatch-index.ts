/**
 * The per-session active-dispatches index
 * (`.peaks/_sub_agents/<sid>/active-dispatches.json`): its path, its
 * `Map<recordPath, ActiveDispatchEntry>` shape, and its register / unregister /
 * read operations. The POLICY that bounds it lives in `./ledger-reaper.ts`.
 *
 * Split out of `./dispatch-record-writer.ts`, which was already over its
 * file-size cap: the writer keeps the on-disk RECORD format, this module owns
 * the INDEX — the hint the LLM-side runner and the status line read
 * (`readActiveLeaf` in `src/services/skills/skill-statusline-model.ts`). The
 * moved functions are byte-identical to their previous bodies apart from the
 * terminal-status chain, which became a lookup set; `dispatch-record-writer.ts`
 * re-exports the two public names so no importer changed.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Active-dispatches index. Per-session JSON file at
 * `.peaks/_sub_agents/<sid>/active-dispatches.json`. Map<recordPath,
 * ActiveDispatchEntry>. Updated on dispatch + completion.
 */
export interface ActiveDispatchEntry {
  readonly recordPath: string;
  readonly requestId: string;
  readonly role: string;
  readonly batchId: string;
  readonly createdAt: string;
  // terminal members from the startup-timeout service.
  readonly status:
    | 'queued'
    | 'running'
    | 'finalizing'
    | 'done'
    | 'failed'
    | 'cancelled'
    | 'stale'
    | 'no-execution'
    | 'never-started'
    | 'unreadable';
}

export function activeDispatchIndexPath(projectRoot: string, sessionId: string): string {
  return resolve(projectRoot, '.peaks', '_sub_agents', sessionId, 'active-dispatches.json');
}

/**
 * Read the index file into a plain map. A missing or corrupt file yields the
 * empty map: the on-disk record is the source of truth and a corrupt index is
 * rebuilt from the records rather than trusted.
 */
function readIndexMap(indexPath: string): Record<string, ActiveDispatchEntry> {
  const index: Record<string, ActiveDispatchEntry> = {};
  if (!existsSync(indexPath)) return index;
  try {
    const raw = readFileSync(indexPath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed === 'object' && parsed !== null) {
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'object' && v !== null && 'recordPath' in v) {
          index[k] = v as ActiveDispatchEntry;
        }
      }
    }
  } catch (error: unknown) {
    // Rebuilt from the empty map. `error` is held so the block is not an empty
    // catch; the reason is that a corrupt index is not a fact worth reporting,
    // only a reason to re-read the records.
    void error;
  }
  return index;
}

export function registerActiveDispatch(input: {
  projectRoot: string;
  sessionId: string;
  recordPath: string;
  requestId: string;
  role: string;
  batchId: string;
  now: () => Date;
}): void {
  const indexPath = activeDispatchIndexPath(input.projectRoot, input.sessionId);
  const dir = dirname(indexPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const index = readIndexMap(indexPath);
  index[input.recordPath] = {
    recordPath: input.recordPath,
    requestId: input.requestId,
    role: input.role,
    batchId: input.batchId,
    createdAt: input.now().toISOString(),
    status: 'queued'
  };
  const tmp = `${indexPath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(index, null, 2) + '\n', 'utf8');
  renameSync(tmp, indexPath);
}

/**
 * Statuses that mean the dispatch is over. The startup-timeout service writes
 * the last two as terminal markers, and the finalize CLI writes the rest;
 * unregister must remove the row on all of them.
 *
 * A set rather than a six-way `||` chain: the chain cost the function five
 * branches for a lookup that is data, and pushed its complexity over the
 * eslint ceiling on the way into this module.
 */
const TERMINAL_INDEX_STATUSES: ReadonlySet<ActiveDispatchEntry['status']> = new Set([
  'done',
  'failed',
  'cancelled',
  'no-execution',
  'never-started',
  'unreadable'
]);

export function unregisterActiveDispatch(input: {
  projectRoot: string;
  sessionId: string;
  recordPath: string;
  status: ActiveDispatchEntry['status'];
}): void {
  const indexPath = activeDispatchIndexPath(input.projectRoot, input.sessionId);
  if (!existsSync(indexPath)) return;
  const index = readIndexMap(indexPath);
  const existing = index[input.recordPath];
  if (existing === undefined) return;
  if (TERMINAL_INDEX_STATUSES.has(input.status)) {
    delete index[input.recordPath];
  } else {
    index[input.recordPath] = { ...existing, status: input.status };
  }
  const tmp = `${indexPath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(index, null, 2) + '\n', 'utf8');
  renameSync(tmp, indexPath);
}

/**
 * for a session. Returns the current map<recordPath, entry>. Used
 * by the LLM-side runner to discover in-flight records on restart.
 * Returns an empty map when the index file is missing or corrupt
 * (the on-disk records directory is the next fallback).
 */
export function readActiveDispatchIndex(
  projectRoot: string,
  sessionId: string
): Record<string, ActiveDispatchEntry> {
  const indexPath = activeDispatchIndexPath(projectRoot, sessionId);
  const index = readIndexMap(indexPath);
  const out: Record<string, ActiveDispatchEntry> = {};
  for (const [k, v] of Object.entries(index)) {
    if ('role' in v) {
      out[k] = v;
    }
  }
  return out;
}
