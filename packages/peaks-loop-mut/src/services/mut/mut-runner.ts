/**
 * Per spec §4.2 验收审计 — Stryker wrapper for TS mutation testing.
 *
 * Hard constraints:
 *   H6 (CLI裁决): invokeStryker is injected; production wires it to
 *       @stryker-mutator/core programmatic API.
 *   DRY: production implementation lives in this file; tests mock the
 *       invokeStryker injection point.
 *   KISS: keep the public surface narrow — input, invoker, output.
 *
 * The invoker input shape carries the mutation scope (`mutate`) so the
 * CLI can drive it (R4). Every field is optional except `project` and
 * `testFiles`, so the injected-invoker seam keeps working unchanged.
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

/** The input an invoker receives. */
export interface StrykerInvokerInput {
  /** Project root — the scope of the mutation run. */
  readonly project: string;
  /** Test files the mutation run must execute. */
  readonly testFiles: ReadonlyArray<string>;
  /** Source patterns to mutate. Empty means "let the project config decide". */
  readonly mutate?: ReadonlyArray<string>;
  readonly tsconfigFile?: string;
  readonly timeoutMs?: number;
  readonly concurrency?: number;
}

export type StrykerInvoker = (opts: StrykerInvokerInput) => Promise<StrykerRawResult>;

export interface RunMutationInput {
  readonly project: string;
  readonly testFiles: ReadonlyArray<string>;
  readonly mutate?: ReadonlyArray<string>;
  readonly tsconfigFile?: string;
  readonly timeoutMs?: number;
  readonly concurrency?: number;
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
      mutate: input.mutate,
      tsconfigFile: input.tsconfigFile,
      timeoutMs: input.timeoutMs,
      concurrency: input.concurrency
    });
  } catch (err: unknown) {
    throw wrapInvocationError(err);
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
        survived: f.survived
      }))
    }
  };
}

/**
 * Wrap an invoker failure while KEEPING its machine-readable `code`.
 * The production invoker raises named codes (`MUT_TOOLCHAIN_UNAVAILABLE`,
 * `MUT_NO_MUTANTS`, …) and the CLI envelope must surface them instead of
 * collapsing every failure into one anonymous message.
 */
function wrapInvocationError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  const wrapped = new Error(`Stryker invocation failed: ${message}`);
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string') {
      (wrapped as Error & { code?: string }).code = code;
    }
  }
  return wrapped;
}
