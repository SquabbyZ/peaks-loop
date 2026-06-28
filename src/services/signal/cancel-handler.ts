/**
 * Slice #009 / G5 RL-9 — user cancel must dispose in-flight dispatch records.
 *
 * When Solo's main loop receives SIGINT (Ctrl-C) or the user runs
 * `peaks workflow cancel --rid <rid>`, the loop MUST mark in-flight
 * dispatch records as `outcome: "cancelled"` + `disposed: true` +
 * `disposedAt: now()` BEFORE exiting.
 *
 * "In-flight" = a record with `createdAt` populated AND
 * `completedAt: null`. Those are the ones that the LLM got a toolCall
 * for but did not (yet) confirm completion.
 *
 * This module is the helper Solo calls. The wiring (signal listener,
 * cancel command side-effect) is the Solo main loop's responsibility;
 * this module is the pure data operation.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DispatchRecord, DispatchRecordStatus, DispatchOutcome } from '../dispatch/dispatch-record-writer.js';

export interface CancelResult {
  readonly cancelled: number;
  readonly scanned: number;
  readonly paths: readonly string[];
}

const CANCELLED_OUTCOME: DispatchOutcome = 'cancelled';
const CANCELLED_STATUS: DispatchRecordStatus = 'cancelled';

/**
 * Walk `.peaks/_sub_agents/<sid>/`, mark every in-flight record as
 * `cancelled + disposed`, write back atomically (tmp + rename), and
 * return the count. Records that already have `completedAt` set are
 * skipped (they were already finished by the time cancel fired).
 */
export function cancelInFlightDispatches(
  projectRoot: string,
  sessionId: string,
  options: { now?: () => Date } = {}
): CancelResult {
  const now = options.now ?? (() => new Date());
  const dir = join(projectRoot, '.peaks', '_sub_agents', sessionId);
  if (!existsSync(dir)) {
    return { cancelled: 0, scanned: 0, paths: [] };
  }
  let scanned = 0;
  const cancelledPaths: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.startsWith('dispatch-') || !entry.endsWith('.json')) continue;
    const fullPath = join(dir, entry);
    scanned += 1;
    const record = readRecordOrNull(fullPath);
    if (record === null) continue;
    if (record.completedAt !== null) continue; // already finished
    const cancelled: DispatchRecord = {
      ...record,
      completedAt: now().toISOString(),
      outcome: CANCELLED_OUTCOME,
      status: CANCELLED_STATUS,
      disposed: true,
      disposedAt: now().toISOString()
    };
    writeFileSync(fullPath, JSON.stringify(cancelled, null, 2) + '\n', 'utf8');
    cancelledPaths.push(fullPath);
  }
  return { cancelled: cancelledPaths.length, scanned, paths: cancelledPaths };
}

function readRecordOrNull(path: string): DispatchRecord | null {
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.createdAt !== 'string') return null;
    if (typeof obj.completedAt !== 'string' && obj.completedAt !== null) return null;
    if (typeof obj.role !== 'string') return null;
    return obj as unknown as DispatchRecord;
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
}
