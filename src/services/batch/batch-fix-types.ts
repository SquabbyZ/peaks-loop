// src/services/batch/batch-fix-types.ts
//
// The vocabulary of the batch's fix phase: what a diagnosis says, what a fix
// agent is dispatched with, what it reports, and what the scoped test
// answers.
//
// WHY A SEPARATE MODULE. The fix phase touches the filesystem (the batch
// record) and the names here are the pure data the phase trades. Keeping the
// names here means the contract can be read — and typed — without importing
// any I/O, which is the same split the batch progress record already makes.

import type { BatchItem, BatchItemStatus } from './batch-progress-types.js';

/** What one diagnostician reported about one item. */
export interface BatchFixDiagnosis {
  /** Why the reported symptom happens. */
  readonly rootCause: string;
  /** The repo-relative paths the fix is expected to touch. */
  readonly files: readonly string[];
  /** The risk surface number the diagnosis hit, when one was reported. */
  readonly riskSurface?: number;
  /** What the fix would look like. */
  readonly fixSketch: string;
}

/** The descriptor one fix sub-agent is dispatched with. */
export interface BatchFixAgentSpec {
  /** The request id this agent owns. Distinct per item, so worktrees do not collide. */
  readonly rid: string;
  readonly role: string;
  readonly itemId: string;
  readonly waveIndex: number;
  /**
   * The text `peaks worktree spawn --purpose` names this agent's worktree by.
   *
   * It is in the spec because the plan's isolation rule is one spawn per
   * agent, and the spawn takes exactly these three values.
   */
  readonly purpose: string;
  /** The full dispatch prompt, governance prefix included. */
  readonly prompt: string;
}

/** What one fix sub-agent reported back. */
export interface BatchFixAgentOutcome {
  readonly ok: boolean;
  readonly summary: string;
  /** The test file the fix is scoped to, when the agent named one. */
  readonly scopedTestPath?: string;
}

/** The verdict of one item's scoped test. */
export interface BatchFixScopedTest {
  readonly ok: boolean;
  /** The command that was run, for the report and for the failure text. */
  readonly command: string;
  readonly detail?: string;
}

/** What the scoped test is run against. */
export interface BatchFixScopedTestInput {
  readonly item: BatchItem;
  readonly outcome: BatchFixAgentOutcome;
}

/** The two effects the caller wires in. */
export interface BatchFixDependencies {
  /** Dispatch one fix sub-agent and resolve with what it reported. */
  readonly dispatchFixAgent: (
    spec: BatchFixAgentSpec
  ) => Promise<BatchFixAgentOutcome> | BatchFixAgentOutcome;
  /** Run one item's scoped test and resolve with its verdict. */
  readonly runScopedTest: (
    input: BatchFixScopedTestInput
  ) => Promise<BatchFixScopedTest> | BatchFixScopedTest;
}

/** What the fix phase needs to know. */
export interface BatchFixOptions {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly batchId: string;
  /** The batch's request id; every agent's rid is derived from it. */
  readonly rid: string;
  /** The batch's items. Only the `diagnosed` ones are fixed. */
  readonly items: readonly BatchItem[];
  /** Each item's diagnosis, keyed by item id. */
  readonly diagnoses: Readonly<Record<string, BatchFixDiagnosis>>;
  /** The rules that apply to the files being fixed (the pre-read's output). */
  readonly rules: readonly string[];
}

/** What one item's fix produced. */
export interface BatchFixItemResult {
  readonly itemId: string;
  readonly waveIndex: number;
  readonly rid: string;
  /** `fixed` only when the fix and its scoped test both succeeded. */
  readonly status: BatchItemStatus;
  readonly fix: BatchFixAgentOutcome;
  readonly scopedTest: BatchFixScopedTest;
}

/** What the fix phase produced. */
export interface BatchFixResult {
  readonly results: readonly BatchFixItemResult[];
  /** Items with no recorded diagnosis, so no fix agent could be dispatched. */
  readonly undiagnosable: readonly string[];
}
