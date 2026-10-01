// src/services/final-review/final-review-evidence-collect.ts
//
// The read phase (files only — no commands, no git) and the all-or-nothing
// budget allocator, hoisted from final-review-service.ts (C wave 7).
// evidenceSourcesFor stays in the service module (guard C pins it there)
// and is imported from it — a one-directional edge.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  GATE_SOURCE_FOR_DIMENSION,
  type CollectedEvidence,
  type EvidenceCandidate,
  type EvidenceSource,
  type EvidenceStatus
} from './final-review-evidence-sources.js';
import {
  MAX_EVIDENCE_BYTES_TOTAL,
  REQUIRED_DIMENSIONS,
  assertFloorReservationAffordable,
  sourceUnit
} from './final-review-evidence-budget.js';
import { evidenceSourcesFor } from './final-review-service.js';
import type { DimensionKind } from './final-review-types.js';

/**
 * ENOENT is "no such file"; every other errno is "the file is there and this
 * read failed". Only the first means the source does not exist for this run.
 */
function classifyReadFailure(error: unknown): 'missing' | 'unreadable' {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' ? 'missing' : 'unreadable';
}

/** Pure read: no commands, no git, no test execution — files only. */
export function readEvidence(
  projectRoot: string,
  sessionId: string,
  rid: string,
  prePostDiffAvailable: boolean
): readonly EvidenceCandidate[] {
  const runtimeRoot = join(projectRoot, '.peaks', '_runtime', sessionId);

  return evidenceSourcesFor(rid, prePostDiffAvailable).map((source) => {
    // The canonical location first; an older one is tried only when the
    // canonical file is genuinely ABSENT (see `legacySegments`). A file that
    // is present but unreadable stops the walk — falling through to an older
    // copy would silently swap the evidence this run reports.
    const attempts: ReadonlyArray<readonly string[]> = [
      source.segments,
      ...(source.legacySegments !== undefined ? [source.legacySegments] : [])
    ];
    // The path reported when nothing resolved stays the CANONICAL one, so the
    // operator is sent to where the artifact belongs, not to its old home.
    let resolved = source.segments;
    let raw: Buffer | null = null;
    let error = '';
    let read: 'ok' | 'missing' | 'unreadable' = 'missing';
    for (const segments of attempts) {
      try {
        raw = readFileSync(join(runtimeRoot, ...segments));
        read = 'ok';
        resolved = segments;
        break;
      } catch (err) {
        read = classifyReadFailure(err);
        error = err instanceof Error ? err.message : String(err);
        // A file that exists but cannot be read IS this source's file, so it
        // is also the path the report must name — walking on to an older copy
        // would silently swap the evidence this run reports.
        if (read === 'unreadable') {
          resolved = segments;
          break;
        }
      }
    }
    return {
      source,
      relativePath: ['.peaks', '_runtime', sessionId, ...resolved].join('/'),
      absolutePath: join(runtimeRoot, ...resolved),
      raw,
      read,
      error,
      blank: raw === null || raw.toString('utf8').trim().length === 0
    };
  });
}

/**
 * The one source per dimension that the budget promises to reach — the source
 * that dimension's DELIVERY GATE depends on where there is one, and otherwise
 * the first non-blank candidate that can supply it. A dimension with several
 * candidates needs exactly one of them to survive, so naming it costs the other
 * sources nothing they were not already losing.
 *
 * F1 — the gate sources used to be eligible for no reservation at all, because
 * they are last in the order and a later source can never be a "first mention".
 * Reserving for them is what makes the two gates' promises reachable rather
 * than merely correct: a gate that always fires because its source never fits
 * is noise, not a gate. A dimension with no gate entry keeps the old rule.
 *
 * A blank source is deliberately not a holder: a floor reserved for a file that
 * carries no evidence is a floor spent on nothing.
 */
function floorHolders(
  candidates: readonly EvidenceCandidate[]
): ReadonlyMap<number, DimensionKind> {
  const holders = new Map<number, DimensionKind>();
  const covered = new Set<DimensionKind>();
  const indexByKey = new Map<string, number>();

  candidates.forEach((candidate, index) => {
    if (candidate.blank) return;
    if (!indexByKey.has(candidate.source.key)) indexByKey.set(candidate.source.key, index);
  });

  // Pass 1 — the source each delivery gate depends on, whether or not it is the
  // first to mention its dimension.
  for (const dimension of REQUIRED_DIMENSIONS) {
    const gateKey = GATE_SOURCE_FOR_DIMENSION[dimension];
    if (gateKey === undefined) continue;
    const index = indexByKey.get(gateKey);
    // No such source this run (e.g. no baseline was computed): the dimension
    // falls back to the first-mention rule below.
    if (index === undefined) continue;
    covered.add(dimension);
    if (!holders.has(index)) holders.set(index, dimension);
  }

  // Pass 2 — every dimension without a gate: the first source that mentions it.
  candidates.forEach((candidate, index) => {
    if (candidate.blank) return;
    for (const dimension of candidate.source.supports) {
      if (covered.has(dimension)) continue;
      covered.add(dimension);
      if (!holders.has(index)) holders.set(index, dimension);
    }
  });

  return holders;
}

interface EvidenceBase {
  readonly source: EvidenceSource;
  readonly relativePath: string;
  readonly absolutePath: string;
}

function readFailureEvidence(base: EvidenceBase, candidate: EvidenceCandidate): CollectedEvidence {
  // `read` is never `'ok'` here (it is set exactly when the read failed),
  // and `'ok'` is not a status — the branch is what says which of the two
  // failure facts this is.
  const status: EvidenceStatus = candidate.read === 'unreadable' ? 'unreadable' : 'missing';
  return {
    ...base,
    status,
    totalBytes: 0,
    includedBytes: 0,
    content: '',
    reason:
      candidate.read === 'missing'
        ? candidate.error
        : `the file exists but could not be read (${candidate.error})`
  };
}

function blankEvidence(base: EvidenceBase, raw: Buffer): CollectedEvidence {
  return {
    ...base,
    status: 'empty',
    totalBytes: raw.byteLength,
    includedBytes: 0,
    content: '',
    reason: `file exists but contains no reviewable content (${raw.byteLength} bytes)`
  };
}

interface OmissionContext {
  readonly budgetLeft: number;
  readonly allowance: number;
  readonly holders: ReadonlyMap<number, DimensionKind>;
  readonly pending: Set<number>;
  readonly reservedElsewhere: number;
  readonly unit: number;
  readonly candidates: readonly EvidenceCandidate[];
  readonly index: number;
}

function omittedEvidence(base: EvidenceBase, raw: Buffer, ctx: OmissionContext): CollectedEvidence {
  const { allowance, budgetLeft, candidates, holders, pending, reservedElsewhere, unit, index } =
    ctx;
  const waiting = [...pending]
    .filter((holder) => holder !== index)
    .map((holder) => `${holders.get(holder)} (source ${candidates[holder]?.source.key ?? '?'})`);
  return {
    ...base,
    status: 'omitted',
    totalBytes: raw.byteLength,
    includedBytes: 0,
    content: '',
    reason:
      reservedElsewhere > 0
        ? `${reservedElsewhere} bytes of the budget are reserved for dimension(s) ${waiting.join(', ')} — their only remaining evidence comes later in the source order; this source is inlined WHOLE or not at all and needs ${unit} bytes, while ${budgetLeft} were left (${allowance} after the reservation)`
        : `total evidence budget (${MAX_EVIDENCE_BYTES_TOTAL} bytes) is exhausted — this source is inlined WHOLE or not at all and needs ${unit} bytes, ${budgetLeft} were left`
  };
}

function reservedForPending(pending: Set<number>, units: number[], index: number): number {
  return [...pending]
    .filter((holder) => holder !== index)
    .reduce((sum, holder) => sum + (units[holder] ?? 0), 0);
}

function foundEvidence(
  base: EvidenceBase,
  raw: Buffer,
  unit: number,
  content: string
): CollectedEvidence {
  return {
    ...base,
    status: 'found',
    totalBytes: raw.byteLength,
    includedBytes: unit,
    content,
    reason: ''
  };
}

export function collectEvidence(
  projectRoot: string,
  sessionId: string,
  rid: string,
  prePostDiffAvailable: boolean
): readonly CollectedEvidence[] {
  assertFloorReservationAffordable();
  const candidates = readEvidence(projectRoot, sessionId, rid, prePostDiffAvailable);
  const holders = floorHolders(candidates);
  /** Every source's all-or-nothing unit, computed before any byte is spent. */
  const units = candidates.map((candidate) => sourceUnit(candidate));
  /** Holders that have not been served yet — the floors still owed. */
  const pending = new Set<number>(holders.keys());
  const collected: CollectedEvidence[] = [];
  let budgetLeft = MAX_EVIDENCE_BYTES_TOTAL;

  for (const [index, candidate] of candidates.entries()) {
    const { source, relativePath, absolutePath, raw } = candidate;
    const base = { source, relativePath, absolutePath };

    if (raw === null) {
      collected.push(readFailureEvidence(base, candidate));
      continue;
    }

    if (candidate.blank) {
      collected.push(blankEvidence(base, raw));
      continue;
    }

    const unit = units[index] ?? 0;
    // The floors still owed to dimensions whose holder has not been served are
    // spent only on those holders: a source that needs no help cannot eat the
    // last dimension's only chance at being reviewed. Reserved at the holder's
    // own unit, because under all-or-nothing a partial slice serves nothing.
    const reservedElsewhere = reservedForPending(pending, units, index);
    const allowance = budgetLeft - reservedElsewhere;

    // ALL-OR-NOTHING: this source is inlined as its whole unit or it is
    // reported omitted. There is deliberately no third outcome — a partial
    // slice would re-create the continuum F-BLOCK-1BYTE was found in.
    if (allowance < unit) {
      collected.push(
        omittedEvidence(base, raw, {
          allowance,
          budgetLeft,
          candidates,
          holders,
          pending,
          reservedElsewhere,
          unit,
          index
        })
      );
      continue;
    }

    const content = raw.subarray(0, unit).toString('utf8');
    budgetLeft -= unit;
    pending.delete(index);
    collected.push(foundEvidence(base, raw, unit, content));
  }

  return collected;
}
