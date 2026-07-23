/**
 * Compact conformance types — Phase 3 Task 3.3.
 *
 * Reusable evidence model. Each scenario produces a `CompactConformanceCaseResult`
 * with an `evidence` array of `EvidencePointer` items (digest + relative path +
 * summary), never raw sensitive content. The core never branches on the
 * scenario id; it only consumes the result shape.
 */

export interface EvidencePointer {
  /** Stable identifier inside the test (e.g. `recovery-tx-id`). */
  readonly key: string;
  /** POSIX-style relative path under the test root, no absolute segments. */
  readonly path: string;
  /** 64-hex SHA-256 digest of the file's bytes. */
  readonly sha256: string;
  /** Short, human-readable summary. No raw tokens, no raw transcripts. */
  readonly summary: string;
}

export type ConformanceCaseStatus = 'passed' | 'failed' | 'skipped';

export interface CompactConformanceCaseResult {
  readonly caseId: string;
  readonly status: ConformanceCaseStatus;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly evidence: readonly EvidencePointer[];
  readonly failureCode?: string;
  readonly failureMessage?: string;
}

export interface CompactConformanceReport {
  readonly contractVersion: 1;
  readonly generatedAt: string;
  readonly cases: readonly CompactConformanceCaseResult[];
  /** Optional digest of the canonicalized cases for tamper detection. */
  readonly reportDigest?: string;
}
