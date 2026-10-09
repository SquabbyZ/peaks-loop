/**
 * Dispatch-record path helpers shared by `peaks sub-agent await` (which scans a
 * session directory for a batch's records) and `peaks sub-agent finalize`
 * (which canonicalizes a record path before reporting it). Extracted from
 * `share-commands.ts` so that file stays under the line cap; every helper here
 * is pure — it takes its inputs and returns a value.
 */
import { existsSync, readdirSync, realpathSync as realpathSyncNative } from 'node:fs';
import { join, resolve } from 'node:path';

import type { DispatchRecord } from '../../services/dispatch/dispatch-record-writer.js';

/**
 * Resolve a record's on-disk path through `realpathSync` so the value returned
 * here matches the value `writeInitialDispatchRecord` produces — which itself
 * passes through `assertSafeDispatchRecordPath` and ends up canonicalized. On
 * macOS, `mkdtempSync(join(tmpdir(), prefix))` returns `/var/folders/...`
 * while `process.cwd()` after `chdir` returns `/private/var/folders/...`;
 * without this helper the test fixture's `queuedPath` (canonical) and the
 * envelope's `finalized[].recordPath` (raw) never compare equal. Falls back
 * to the lexical path when the file is missing (race between scan and write).
 */
export function safeRecordPath(p: string): string {
  try {
    return realpathSyncNative(p);
  } catch {
    return p;
  }
}

/**
 * Resolve the dispatch records belonging to a batch.
 *
 * Reuses the conventions already in the repo instead of inventing a new one:
 *   - records live at `.peaks/_sub_agents/<sid>/dispatch-<rid>-<ts>.json`
 *     (`dispatchRecordPath`, src/services/security/safe-settings-path.ts);
 *   - a record's batch is its own `batchId` field, written by
 *     `writeInitialDispatchRecord`. The `--batch` branch of `finalize` and
 *     `findBatchRecords` in heartbeat-watch-command.ts resolve a batch the
 *     same way: scan the session dir, filter `dispatch-*.json`, compare field.
 *
 * `unreadable` lists the `dispatch-*.json` candidates whose batch could NOT be
 * determined. The caller must not fold them into "no such batch": a record it
 * cannot read is not evidence that the batch is empty.
 */
export function resolveBatchRecords(input: {
  projectRoot: string;
  sessionId: string;
  batchId: string;
  readOne: (recordPath: string) => DispatchRecord;
}): { sessionDir: string; recordPaths: string[]; unreadable: string[] } {
  const sessionDir = resolve(input.projectRoot, '.peaks', '_sub_agents', input.sessionId);
  const recordPaths: string[] = [];
  const unreadable: string[] = [];
  if (!existsSync(sessionDir)) return { sessionDir, recordPaths, unreadable };
  for (const name of readdirSync(sessionDir)) {
    // `active-dispatches.json` (the index) and `batch-<uuid>.counter.json` are
    // not records; neither carries a `version`, so `readRecord` would reject
    // them as "version mismatch". Same filter as the `--batch` branch below.
    if (!name.startsWith('dispatch-') || !name.endsWith('.json')) continue;
    const recordPath = safeRecordPath(join(sessionDir, name));
    let batchId: string;
    try {
      batchId = input.readOne(recordPath).batchId;
    } catch {
      unreadable.push(recordPath);
      continue;
    }
    if (batchId === input.batchId) recordPaths.push(recordPath);
  }
  return { sessionDir, recordPaths, unreadable };
}
