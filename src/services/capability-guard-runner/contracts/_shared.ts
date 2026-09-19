// src/services/capability-guard-runner/contracts/_shared.ts
//
// Helpers shared by the J01–J15 guard contracts.
//
// The point of these contracts is to answer "is this journey's behaviour still
// right?", not "does some file still contain some word?". The helpers here
// keep that honest and cheap:
//   - the file list comes from the FROZEN BASELINE ROW, never from a
//     hand-written candidate list inside the contract (so a baseline/source
//     drift is visible instead of being papered over by a fallback path);
//   - a missing source file is a contract failure, not a silently narrower
//     check.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readBaselineFile } from '../../capability-baseline/store.js';
import type { CapabilityBaselineRow } from '../../capability-baseline/types.js';
import type { GuardContext, GuardRunResult } from '../types.js';

/**
 * The frozen baseline row this contract is bound to. Throws when the baseline
 * is unreadable or the row is absent — a contract with no baseline behind it
 * must not be able to report green.
 */
export function requireBaselineRow(ctx: GuardContext): CapabilityBaselineRow {
  const journeyId = ctx.contract.source.baselineRow;
  const r = readBaselineFile(ctx.projectRoot);
  if (!r.ok) {
    throw new Error(
      `baseline unreadable at ${ctx.projectRoot} (${r.error.code}: ${r.error.message})`
    );
  }
  const row = r.file.rows.find((x) => x.journeyId === journeyId);
  if (!row) {
    throw new Error(`baseline row ${journeyId} is not in the frozen baseline`);
  }
  return row;
}

/**
 * Every `sourceFiles` entry of the row must still exist. The baseline names the
 * files that carry the journey; a vanished file is drift, so this returns the
 * missing ones rather than filtering them out.
 */
export function missingSourceFiles(
  ctx: GuardContext,
  row: CapabilityBaselineRow
): ReadonlyArray<string> {
  return row.sourceFiles.filter((f) => !existsSync(join(ctx.projectRoot, f)));
}

export function pass(ctx: GuardContext, artifactPath: string): GuardRunResult {
  return {
    journeyId: ctx.contract.journeyId,
    contract: ctx.contract.kind,
    status: 'pass',
    artifactPath
  };
}

export function fail(
  ctx: GuardContext,
  artifactPath: string,
  before: string,
  after: string,
  reason: string
): GuardRunResult {
  return {
    journeyId: ctx.contract.journeyId,
    contract: ctx.contract.kind,
    status: 'fail',
    diff: { before, after, reason },
    artifactPath
  };
}

/** Result of a source-level probe; `ok` drives pass/fail, `detail` the diff. */
export interface Probe {
  readonly ok: boolean;
  readonly detail: string;
}

export function combineProbes(probes: ReadonlyArray<Probe>): Probe {
  const bad = probes.filter((p) => !p.ok);
  if (bad.length === 0) return { ok: true, detail: probes.map((p) => p.detail).join('; ') };
  return { ok: false, detail: bad.map((p) => p.detail).join('; ') };
}

/** Convenience: build a probe whose ok-ness is a boolean and a label. */
export function probe(ok: boolean, detail: string): Probe {
  return { ok, detail };
}
