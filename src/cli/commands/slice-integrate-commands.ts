/**
 * v2.15.0 follow-up — G6: peaks slice integrate CLI.
 *
 *   - `peaks slice integrate --slices <id1,id2,...> --project <path>`
 *     Verifies that the public contracts of multiple completed slices
 *     integrate cleanly (no duplicate exports, no signature drift).
 *     Pure read of .peaks/_runtime/<sid>/dispatch/contracts/.
 */

import type { Command } from 'commander';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getCurrentSessionId } from '../../services/skills/skill-presence-service.js';
import { integrateSlices } from '../../services/slice/slice-integration.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import type { SliceContract } from '../../services/dispatch/contract-store.js';

function loadContractsForSlices(projectRoot: string, sessionId: string, sliceIds: readonly string[]): SliceContract[] {
  const dir = resolve(projectRoot, '.peaks', '_runtime', sessionId, 'dispatch', 'contracts');
  if (!existsSync(dir)) return [];
  const result: SliceContract[] = [];
  for (const sliceId of sliceIds) {
    const file = join(dir, `${sliceId}.json`);
    if (!existsSync(file)) continue;
    try {
      const raw = readFileSync(file, 'utf8');
      result.push(JSON.parse(raw) as SliceContract);
    } catch {
      // skip malformed contracts
    }
  }
  return result;
}

export function registerSliceIntegrateCommands(program: Command, io: ProgramIO): void {
  addJsonOption(
    program
      .command('slice-integrate')
      .description(
        'v2.15.0 follow-up G6: verify that multiple completed slice contracts integrate cleanly. ' +
          'Reads the contracts of the given slice ids (from .peaks/_runtime/<sid>/dispatch/contracts/) ' +
          'and reports duplicate exports / signature drift. The 12 Gaps memory: in the layered-parallel ' +
          'execution model (G12), slices complete out of order — this catches the integration breaks ' +
          'before downstream consumers see them.'
      )
      .requiredOption('--slices <list>', 'comma-separated slice ids to integrate-verify')
      .option('--session-id <sid>', 'session id (default: read from .peaks/_runtime/session.json)')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((opts: { slices: string; sessionId?: string; project?: string; json?: boolean }) => {
    const projectRoot = opts.project ?? resolve(process.cwd());
    const sessionId = opts.sessionId ?? getCurrentSessionId(projectRoot) ?? 'unknown-sid';
    const sliceIds = opts.slices.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    if (sliceIds.length < 2) {
      printResult(io, fail('slice-integrate', 'TOO_FEW_SLICES', 'need at least 2 slice ids to verify integration', { projectRoot, sessionId, sliceIds }, [
        'Pass --slices id1,id2,id3 (at least 2).'
      ]), opts.json ?? false);
      process.exitCode = 1;
      return;
    }
    const contracts = loadContractsForSlices(projectRoot, sessionId, sliceIds);
    if (contracts.length === 0) {
      printResult(io, fail('slice-integrate', 'NO_CONTRACTS', `no contracts found for the given slice ids under session ${sessionId}`, { projectRoot, sessionId, sliceIds }, [
        'Run `peaks contract write` first, or check --session-id.'
      ]), opts.json ?? false);
      process.exitCode = 1;
      return;
    }
    const report = integrateSlices({ contracts });
    printResult(io, ok('slice-integrate', { projectRoot, sessionId, report }, [], report.ok
      ? []
      : [
        `${report.summary.errors} integration error(s) found.`,
        'Address duplicate exports / signature drift before merging slices.'
      ]), opts.json ?? false);
    if (!report.ok) process.exitCode = 1;
  });
}
