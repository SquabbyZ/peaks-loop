/**
 * Per spec §4.2 验收审计 — Stryker wrapper for TS mutation testing.
 *
 * Hard constraints:
 *   H6 (CLI裁决): invokeStryker is injected; production wires it to
 *       @stryker-mutator/core programmatic API.
 *   DRY: production implementation lives in this file; tests mock the
 *       invokeStryker injection point.
 *   KISS: keep the public surface narrow — input, invoker, output.
 */
import type { MutationReport } from './types.js';

export interface StrykerRawResult {
  readonly mutantsTotal: number;
  readonly mutantsKilled: number;
  readonly mutantsSurvived: number;
  readonly mutantsTimeout: number;
  readonly perFile: ReadonlyArray<{
    readonly file: string;
    readonly killRate: number;
    readonly survived: ReadonlyArray<{ line: number; mutation: string; survivedBecause: string }>;
  }>;
}

export type StrykerInvoker = (opts: {
  project: string;
  testFiles: ReadonlyArray<string>;
}) => Promise<StrykerRawResult>;

export interface RunMutationInput {
  readonly project: string;
  readonly testFiles: ReadonlyArray<string>;
  readonly invokeStryker: StrykerInvoker;
}

export interface RunMutationOutput {
  readonly mutation: MutationReport;
}

export async function runMutation(input: RunMutationInput): Promise<RunMutationOutput> {
  let raw: StrykerRawResult;
  try {
    raw = await input.invokeStryker({
      project: input.project,
      testFiles: input.testFiles,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Stryker invocation failed: ${message}`);
  }
  const killRate = raw.mutantsTotal === 0 ? 0 : raw.mutantsKilled / raw.mutantsTotal;
  return {
    mutation: {
      tool: 'stryker',
      mutantsTotal: raw.mutantsTotal,
      mutantsKilled: raw.mutantsKilled,
      mutantsSurvived: raw.mutantsSurvived,
      mutantsTimeout: raw.mutantsTimeout,
      killRate,
      byFile: raw.perFile.map((f) => ({
        file: f.file,
        killRate: f.killRate,
        survived: f.survived,
      })),
    },
  };
}
