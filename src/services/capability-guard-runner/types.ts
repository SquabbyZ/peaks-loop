import type { JourneyId } from '../capability-baseline/types.js';

export type ContractKind =
  | 'cli-envelope'
  | 'workflow-trace'
  | 'hook-assertion'
  | 'cli-output-golden'
  | 'asset-roundtrip'
  | 'concurrency-lease'
  | 'sop-register'
  | 'spec-coverage'
  | 'envelope-arg-shapes';

export interface GuardContract {
  readonly journeyId: JourneyId;
  readonly kind: ContractKind;
  readonly source: { readonly baselineRow: JourneyId; readonly invariant: string };
  readonly execute: (ctx: GuardContext) => Promise<GuardRunResult>;
  readonly evidence: { readonly kind: ContractKind; readonly artifact: string };
}

export interface GuardContext {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly contract: GuardContract;
  readonly baselineInvariant: string;
}

export type GuardStatus = 'pass' | 'fail' | 'skipped';

export interface GuardDiff {
  readonly before: string;
  readonly after: string;
  readonly reason: string;
}

export interface GuardRunResult {
  readonly journeyId: JourneyId;
  readonly contract: ContractKind;
  readonly status: GuardStatus;
  readonly diff?: GuardDiff;
  readonly artifactPath: string;
}

export type GuardErrorCode =
  | 'GUARD_CONTRACT_MISSING_BASELINE_REF'
  | 'GUARD_DIFF_DETECTED'
  | 'GUARD_TEST_FLAKY';

export interface GuardError { readonly code: GuardErrorCode; readonly message: string; }
