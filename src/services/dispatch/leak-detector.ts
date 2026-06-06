/**
 * Slice #009 / G5 RL-7 — dispatch record leak detector.
 *
 * After peaks-solo's reducer consumes a batch, any dispatch record that
 * is still `disposed === false` AND was created more than `thresholdMs`
 * ago is a **leak**. This helper scans the on-disk records under
 * `.peaks/_sub_agents/<sid>/` and returns the leaked ones. The CLI or
 * the reducer's next-batch step emits a user-visible warning when the
 * list is non-empty.
 *
 * Threshold: 1h (configurable). Rationale: the longest empirical
 * peaks-rd / peaks-qa fan-out + reducer cycle is < 60s; the threshold
 * gives slow slices headroom without hiding leaks for the next session.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDispatchStatus, isOutcome, type DispatchRecord } from './dispatch-record-writer.js';

export const DEFAULT_LEAK_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

export interface LeakedRecord {
  readonly path: string;
  readonly record: DispatchRecord;
  readonly ageMs: number;
}

export function findLeakedDispatchRecords(
  projectRoot: string,
  sessionId: string,
  options: { now?: () => Date; thresholdMs?: number } = {}
): readonly LeakedRecord[] {
  const now = options.now ?? (() => new Date());
  const thresholdMs = options.thresholdMs ?? DEFAULT_LEAK_THRESHOLD_MS;
  const nowMs = now().getTime();

  const dir = join(projectRoot, '.peaks', '_sub_agents', sessionId);
  if (!existsSync(dir)) return [];

  const out: LeakedRecord[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.startsWith('dispatch-') || !entry.endsWith('.json')) continue;
    const fullPath = join(dir, entry);
    let raw: string;
    try {
      raw = readFileSync(fullPath, 'utf8');
    } catch {
      continue; // skip unreadable files
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue; // skip malformed files
    }
    if (!isRecordShape(parsed)) continue;
    if (parsed.disposed === true) continue;
    const createdMs = Date.parse(parsed.createdAt);
    if (Number.isNaN(createdMs)) continue;
    const ageMs = nowMs - createdMs;
    if (ageMs < thresholdMs) continue;
    out.push({ path: fullPath, record: parsed as DispatchRecord, ageMs });
  }
  return out;
}

function isRecordShape(v: unknown): v is DispatchRecord {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj.createdAt === 'string' &&
    typeof obj.role === 'string' &&
    typeof obj.requestId === 'string' &&
    typeof obj.sessionId === 'string' &&
    typeof obj.prompt === 'string' &&
    isOutcome(obj.outcome) &&
    isDispatchStatus(obj.status) &&
    typeof obj.disposed === 'boolean' &&
    Array.isArray(obj.artifactPaths)
  );
}
