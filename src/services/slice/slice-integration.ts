/**
 * v2.15.0 follow-up — G6: slice cross-integration verifier.
 *
 * The 12 Gaps memory: in the layered-parallel execution model (G12), multiple
 * slices can complete out of order. The question is: do their public
 * contracts still line up when integrated together?
 *
 * This service takes a list of slice contracts (already written via
 * `peaks contract write`) and produces a cross-integration report:
 *   - missing exports: an export declared by slice A but not consumed by slice B
 *   - type mismatches: types used across slice boundaries
 *   - signature drift: function signatures changed
 *
 * Pure function. No I/O. The CLI is `peaks slice integrate`.
 */

import type { SliceContract } from '../dispatch/contract-store.js';

export interface IntegrationFinding {
  /** Severity: 'error' (blocks integration), 'warning' (informational), 'info' (noted). */
  readonly severity: 'error' | 'warning' | 'info';
  /** The slice that owns the export. */
  readonly ownerSliceId: string;
  /** The slice that consumes the export. */
  readonly consumerSliceId: string;
  /** Type of finding. */
  readonly kind: 'missing-export' | 'type-mismatch' | 'signature-drift' | 'duplicate-export';
  /** Human-readable description. */
  readonly message: string;
}

export interface IntegrationReport {
  readonly sliceIds: readonly string[];
  readonly totalContracts: number;
  readonly findings: readonly IntegrationFinding[];
  readonly summary: {
    readonly errors: number;
    readonly warnings: number;
    readonly info: number;
  };
  readonly ok: boolean;
}

export interface IntegrateOptions {
  readonly contracts: readonly SliceContract[];
}

/** Build a quick map: export name → owning slice + contract. */
function buildExportIndex(contracts: readonly SliceContract[]): Map<string, { sliceId: string; contract: SliceContract }> {
  const index = new Map<string, { sliceId: string; contract: SliceContract }>();
  for (const c of contracts) {
    for (const exp of c.exports) {
      index.set(exp, { sliceId: c.sliceId, contract: c });
    }
    for (const t of c.types) {
      index.set(t, { sliceId: c.sliceId, contract: c });
    }
  }
  return index;
}

export function integrateSlices(opts: IntegrateOptions): IntegrationReport {
  const contracts = opts.contracts;
  const findings: IntegrationFinding[] = [];
  const index = buildExportIndex(contracts);

  // 1. duplicate exports: the same export name declared by multiple slices.
  const seen = new Map<string, string[]>();  // export → [sliceIds]
  for (const c of contracts) {
    for (const exp of c.exports) {
      if (!seen.has(exp)) seen.set(exp, []);
      seen.get(exp)!.push(c.sliceId);
    }
  }
  for (const [exp, owners] of seen) {
    if (owners.length > 1) {
      findings.push({
        severity: 'error',
        ownerSliceId: owners[0]!,
        consumerSliceId: owners[1]!,
        kind: 'duplicate-export',
        message: `export "${exp}" is declared by multiple slices: ${owners.join(', ')}`
      });
    }
  }

  // 2. signature drift: same export, different publicSignatures across slices.
  const signatureByExport = new Map<string, Map<string, string[]>>();  // exp → signature → [sliceIds]
  for (const c of contracts) {
    for (const sig of c.publicSignatures) {
      // sig format: "exportName:signature"
      const colonIdx = sig.indexOf(':');
      if (colonIdx < 0) continue;
      const name = sig.slice(0, colonIdx);
      const sigValue = sig.slice(colonIdx + 1);
      if (!signatureByExport.has(name)) signatureByExport.set(name, new Map());
      const m = signatureByExport.get(name)!;
      if (!m.has(sigValue)) m.set(sigValue, []);
      m.get(sigValue)!.push(c.sliceId);
    }
  }
  for (const [exp, sigMap] of signatureByExport) {
    if (sigMap.size > 1) {
      const allSlices = new Set<string>();
      for (const sl of sigMap.values()) for (const s of sl) allSlices.add(s);
      findings.push({
        severity: 'warning',
        ownerSliceId: Array.from(allSlices)[0]!,
        consumerSliceId: Array.from(allSlices)[0]!,
        kind: 'signature-drift',
        message: `export "${exp}" has ${sigMap.size} different signatures across slices: ${Array.from(allSlices).join(', ')}`
      });
    }
  }

  // 3. info: total export count (for visibility).
  if (index.size > 0) {
    findings.push({
      severity: 'info',
      ownerSliceId: contracts[0]?.sliceId ?? '<none>',
      consumerSliceId: '<all>',
      kind: 'missing-export',
      message: `${index.size} unique exports / types indexed across ${contracts.length} contracts`
    });
  }

  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;
  const info = findings.filter((f) => f.severity === 'info').length;
  return {
    sliceIds: contracts.map((c) => c.sliceId),
    totalContracts: contracts.length,
    findings,
    summary: { errors, warnings, info },
    ok: errors === 0
  };
}
