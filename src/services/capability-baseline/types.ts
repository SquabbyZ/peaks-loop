// Capability baseline types: locked P0 journey ids, baseline row shape, baseline lock, error codes.
export type JourneyId =
  | 'J01' | 'J02' | 'J03' | 'J04' | 'J05'
  | 'J06' | 'J07' | 'J08' | 'J09' | 'J10'
  | 'J11' | 'J12' | 'J13' | 'J14' | 'J15';

export const P0_JOURNEY_IDS: ReadonlyArray<JourneyId> = [
  'J01', 'J02', 'J03', 'J04', 'J05',
  'J06', 'J07', 'J08', 'J09', 'J10',
  'J11', 'J12', 'J13', 'J14', 'J15'
];

export interface InputCase  { readonly name: string; readonly shape: string; }
export interface OutputCase { readonly name: string; readonly shape: string; }
export interface ErrorCase  { readonly name: string; readonly code: string; }

export interface CapabilityBaselineRow {
  readonly journeyId: JourneyId;
  readonly intent: string;
  readonly observable: {
    readonly inputs:  ReadonlyArray<InputCase>;
    readonly outputs: ReadonlyArray<OutputCase>;
    readonly errors:  ReadonlyArray<ErrorCase>;
  };
  readonly invariants:       ReadonlyArray<string>;
  readonly forbiddenChanges: ReadonlyArray<string>;
  readonly sourceFiles:      ReadonlyArray<string>;
}

export interface CapabilityBaselineFile {
  readonly schemaVersion: '2026-08-03';
  readonly version: string;
  readonly signedBy: 'SquabbyZ';
  readonly signedAt: string;
  readonly rows: ReadonlyArray<CapabilityBaselineRow>;
}

export interface BaselineLock {
  readonly baselineHash: string;
  readonly signedBy: 'SquabbyZ';
  readonly signedAt: string;
  readonly version: string;
}

export type BaselineErrorCode =
  | 'BASELINE_NOT_FOUND'
  | 'BASELINE_HASH_MISMATCH'
  | 'BASELINE_NOT_SIGNED'
  | 'BASELINE_INCOMPLETE'
  | 'BASELINE_HISTORY_GAP'
  | 'BASELINE_ROW_SHAPE_INVALID'
  | 'BASELINE_FORBIDDEN_ALIAS';

export interface BaselineError {
  readonly code: BaselineErrorCode;
  readonly message: string;
  readonly detail?: string;
}
