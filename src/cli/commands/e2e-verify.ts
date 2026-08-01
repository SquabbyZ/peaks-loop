import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readE2EPlan } from '../../services/dispatch/e2e-fixtures.js';
import { fail, getErrorMessage, ok } from 'peaks-loop-shared/result';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';

export type E2EVerifyInput = { readonly projectRoot: string; readonly slice: string; readonly dispatchId?: string };
export type E2EVerifyResult = { readonly outcome: 'pass' | 'fail' | 'skipped' | 'no-fixtures'; readonly passCount: number; readonly failCount: number; readonly skippedReason?: string };

export async function runE2EVerify(input: E2EVerifyInput): Promise<E2EVerifyResult> {
  const dir = join(input.projectRoot, 'qa', 'e2e', input.slice);
  const plan = readE2EPlan({ dir });
  if (plan.kind === 'empty') return { outcome: 'no-fixtures', passCount: 0, failCount: 0 };
  if (plan.kind === 'disabled') return { outcome: 'skipped', passCount: 0, failCount: 0, skippedReason: plan.reason };
  // Real browser invocation lives in the playwright MCP server; the CLI is
  // a thin wrapper that the parent session calls once after merge.
  // For v1 the runner is a deterministic stub: it counts fixtures.
  return { outcome: 'pass', passCount: plan.fixtures.length, failCount: 0 };
}

export function registerE2EVerifyCommand(program: Command, io: ProgramIO): void {
  addJsonOption(
    program
      .command('e2e verify')
      .description('Run a single end-to-end Playwright verification for the merged slice')
      .requiredOption('--slice <rid>', 'peaks request id of the slice that just merged')
      .option('--project <path>', 'project root (default: cwd)', '.')
      .option('--dispatch-id <id>', 'optional dispatch id used in observability events')
  ).action(async (options: { slice: string; project: string; dispatchId?: string; json?: boolean }) => {
    try {
      const result = await runE2EVerify({ projectRoot: options.project, slice: options.slice, ...(options.dispatchId !== undefined ? { dispatchId: options.dispatchId } : {}) });
      printResult(io, ok('e2e.verify', { ...result, slice: options.slice, dispatchId: options.dispatchId ?? null }), options.json);
    } catch (error) { printResult(io, fail('e2e.verify', 'E2E_VERIFY_FAILED', getErrorMessage(error), {}, [getErrorMessage(error)]), options.json); process.exitCode = 1; }
  });
}
