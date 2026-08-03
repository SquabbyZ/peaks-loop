// src/services/capability-baseline/validator.ts
import { P0_JOURNEY_IDS, type BaselineError, type CapabilityBaselineFile, type CapabilityBaselineRow } from './types.js';

export function validateRowShape(row: CapabilityBaselineRow): { readonly ok: true } | { readonly ok: false; readonly error: BaselineError } {
  if (row.intent.trim().length === 0) return { ok: false, error: { code: 'BASELINE_ROW_SHAPE_INVALID', message: `row ${row.journeyId} has empty intent` } };
  if (row.invariants.length === 0)     return { ok: false, error: { code: 'BASELINE_ROW_SHAPE_INVALID', message: `row ${row.journeyId} has no invariants` } };
  if (row.forbiddenChanges.length === 0) return { ok: false, error: { code: 'BASELINE_ROW_SHAPE_INVALID', message: `row ${row.journeyId} has no forbiddenChanges` } };
  if (row.sourceFiles.length === 0)     return { ok: false, error: { code: 'BASELINE_ROW_SHAPE_INVALID', message: `row ${row.journeyId} has no sourceFiles` } };
  return { ok: true };
}

export function validateBaselineFile(file: CapabilityBaselineFile): { readonly ok: true } | { readonly ok: false; readonly error: BaselineError } {
  if (file.schemaVersion !== '2026-08-03') {
    return { ok: false, error: { code: 'BASELINE_ROW_SHAPE_INVALID', message: `unsupported schemaVersion ${file.schemaVersion}` } };
  }
  const signed = assertSignedBySquabbyZ(file);
  if (!signed.ok) return signed;
  for (const r of file.rows) {
    const v = validateRowShape(r);
    if (!v.ok) return v;
  }
  const present = new Set(file.rows.map((r) => r.journeyId));
  const missing = P0_JOURNEY_IDS.filter((j) => !present.has(j));
  if (missing.length > 0) {
    return { ok: false, error: { code: 'BASELINE_INCOMPLETE', message: `missing journeys: ${missing.join(',')}` } };
  }
  return { ok: true };
}

export function assertSignedBySquabbyZ(file: CapabilityBaselineFile): { readonly ok: true } | { readonly ok: false; readonly error: BaselineError } {
  if (file.signedBy !== 'SquabbyZ') {
    return { ok: false, error: { code: 'BASELINE_NOT_SIGNED', message: 'baseline not signed by SquabbyZ' } };
  }
  return { ok: true };
}
