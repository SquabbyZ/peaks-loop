// Type declarations for verify-version-parity.mjs (companion .d.mts per the
// scripts/ convention; see release-pack.d.mts).

export interface ConstantReadImported {
  readonly ok: true;
  readonly value: string;
  readonly via: 'import';
}
export interface ConstantReadExtracted {
  readonly ok: true;
  readonly value: string;
  readonly via: 'extract';
}
export interface ConstantReadFailed {
  readonly ok: false;
  readonly reason: 'missing' | 'unparseable';
}
export type ConstantRead = ConstantReadImported | ConstantReadExtracted | ConstantReadFailed;

export interface GateResult {
  readonly ok: boolean;
  readonly lines: readonly string[];
}

/** Quote-tolerant literal reader; returns null when nothing parseable is there. */
export function extractConstant(source: string, constant: string): string | null;

/** Import-first value read with quote-tolerant extraction fallback. */
export function readConstantValue(file: string, constant: string): Promise<ConstantRead>;

/** Run one publish-gate profile ('shared-dist' | 'runtime-src' | 'shared-tarball'). */
export function runGate(
  name: string,
  opts?: { file?: string; expect?: string }
): Promise<GateResult>;
