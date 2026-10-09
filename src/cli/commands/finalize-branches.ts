/**
 * The three finalize sweep branches — `--all-stale`, `--request-id` and
 * `--batch` — split out of `finalize-runners.ts` to keep each module under the
 * line cap. Each branch reads records, decides which to act on, and records
 * the outcome in the shared accumulator; the runner owns the envelope.
 */
import { fail, getErrorMessage } from 'peaks-loop-shared/result';

import { printResult, type ProgramIO } from '../cli-helpers.js';
import type {
  ActiveDispatchEntry,
  DispatchRecord
} from '../../services/dispatch/dispatch-record-writer.js';
import {
  FINALIZE_SELECTION_RULE,
  describeFinalizeRejection,
  selectFinalizeTarget,
  type FinalizeCandidate,
  type FinalizeSelection
} from './finalize-selection.js';
import { safeRecordPath } from './share-record-paths.js';
import type { FinalizeAccumulator } from './finalize-accumulator.js';

export function finalizeAllStale(input: {
  readActiveDispatchIndex: (
    projectRoot: string,
    sessionId: string
  ) => Record<string, ActiveDispatchEntry>;
  projectRoot: string;
  sessionId: string;
  apply: (recordPath: string, rid: string) => void;
  acc: FinalizeAccumulator;
}): void {
  const index = input.readActiveDispatchIndex(input.projectRoot, input.sessionId);
  for (const [recordPath, entry] of Object.entries(index)) {
    if (entry.status !== 'queued') {
      input.acc.skipped.push({ recordPath, reason: 'status is ' + entry.status });
      continue;
    }
    try {
      input.apply(recordPath, entry.requestId);
    } catch (e: unknown) {
      input.acc.errors.push({ recordPath, error: getErrorMessage(e) });
    }
  }
}

export async function finalizeByRequestId(input: {
  projectRoot: string;
  sessionId: string;
  requestId: string;
  io: ProgramIO;
  asJson: boolean;
  readOne: (recordPath: string) => DispatchRecord | null;
  apply: (recordPath: string, rid: string) => void;
  acc: FinalizeAccumulator;
}): Promise<{ kind: 'not-found' } | { kind: 'ok'; selection: FinalizeSelection }> {
  const candidates = await collectRequestIdCandidates(input);
  if (candidates.length === 0) {
    printResult(
      input.io,
      fail(
        'sub-agent.finalize',
        'RECORD_NOT_FOUND',
        'No dispatch record for requestId=' + input.requestId,
        { ok: false } as never,
        ['Check --request-id matches the dispatch envelope.']
      ),
      input.asJson
    );
    process.exitCode = 1;
    return { kind: 'not-found' };
  }
  // N3: same rule as `--batch` — see `selectFinalizeTarget`.
  const { selection, chosen } = buildRequestIdSelection(candidates, input.requestId);
  for (const rejected of selection.rejected) {
    input.acc.skipped.push({ recordPath: rejected.recordPath, reason: rejected.reason });
  }
  if (chosen !== null) {
    try {
      input.apply(chosen.recordPath, chosen.requestId);
    } catch (e: unknown) {
      input.acc.errors.push({ recordPath: chosen.recordPath, error: getErrorMessage(e) });
    }
  }
  return { kind: 'ok', selection };
}

async function collectRequestIdCandidates(input: {
  projectRoot: string;
  sessionId: string;
  requestId: string;
  readOne: (recordPath: string) => DispatchRecord | null;
}): Promise<FinalizeCandidate[]> {
  const fs2 = await import('node:fs');
  const path2 = await import('node:path');
  const dir = path2.resolve(input.projectRoot, '.peaks', '_sub_agents', input.sessionId);
  const candidates: FinalizeCandidate[] = [];
  if (fs2.existsSync(dir)) {
    for (const f of fs2.readdirSync(dir)) {
      // Only dispatch records are readable records. The session directory also
      // holds `active-dispatches.json` (an index) and `batch-<uuid>.counter.json`
      // (batch counters); neither carries a `version` field, so `readRecord` on
      // them throws `Dispatch record version mismatch ... got undefined`. The
      // `--batch` branch below has always used this same filter.
      if (!f.startsWith('dispatch-') || !f.endsWith('.json')) continue;
      const p = safeRecordPath(path2.join(dir, f));
      const r = input.readOne(p);
      if (r === null || r.requestId !== input.requestId) continue;
      candidates.push({
        recordPath: p,
        requestId: r.requestId,
        status: r.status,
        createdAt: r.createdAt
      });
    }
  }
  return candidates;
}

function buildRequestIdSelection(
  candidates: readonly FinalizeCandidate[],
  requestId: string
): { selection: FinalizeSelection; chosen: FinalizeCandidate | null } {
  const chosen = selectFinalizeTarget(candidates);
  const selection: FinalizeSelection = {
    requestId,
    rule: FINALIZE_SELECTION_RULE,
    matched: candidates.length,
    chosen: chosen?.recordPath ?? null,
    rejected: candidates
      .filter((candidate) => candidate !== chosen)
      .map((candidate) => ({
        recordPath: candidate.recordPath,
        status: candidate.status,
        reason: describeFinalizeRejection(candidate, chosen)
      }))
  };
  return { selection, chosen };
}

export async function finalizeByBatch(input: {
  projectRoot: string;
  sessionId: string;
  batchId: string | undefined;
  readOne: (recordPath: string) => DispatchRecord | null;
  apply: (recordPath: string, rid: string) => void;
  acc: FinalizeAccumulator;
}): Promise<void> {
  const fs2 = await import('node:fs');
  const path2 = await import('node:path');
  const dir = path2.resolve(input.projectRoot, '.peaks', '_sub_agents', input.sessionId);
  if (!fs2.existsSync(dir)) return;
  for (const f of fs2.readdirSync(dir)) {
    if (!f.startsWith('dispatch-') || !f.endsWith('.json')) continue;
    const p = safeRecordPath(path2.join(dir, f));
    const r = input.readOne(p);
    if (r === null) continue;
    if (r.batchId !== input.batchId) continue;
    if (r.status !== 'queued') {
      input.acc.skipped.push({ recordPath: p, reason: 'status is ' + r.status });
      continue;
    }
    try {
      input.apply(p, r.requestId);
    } catch (e: unknown) {
      input.acc.errors.push({ recordPath: p, error: getErrorMessage(e) });
    }
  }
}
