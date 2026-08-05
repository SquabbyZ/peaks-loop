/**
 * Slice 2026-08-05-orchestrator-can-do-probe — CLI shim for
 * `peaks code orchestrator-can-do`.
 *
 * Thin entry point that wires the `orchestrator-can-do` subcommand
 * to the parent `code` command. The actual probe logic lives in
 * `../../services/code/orchestrator-can-do.ts`.
 *
 * Encodes the 2026-08-05 lesson (`.peaks/memory/2026-08-05-peaks-code-
 * orchestrator-capability-misjudgment.md`) — the peaks-code orchestrator
 * MUST delegate source-code changes via sub-agent dispatch, not via
 * direct Edit/Write. The probe returns a structured verdict so the LLM
 * does not need to vibes-call "can this slice run in the current session".
 */

import type { Command } from 'commander';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import {
  evaluateOrchestratorCanDo,
  OrchestratorCanDoError,
  ORCHESTRATOR_PRECOMPACT_RATIO,
  ORCHESTRATOR_REDLINE_RATIO,
} from '../../services/code/orchestrator-can-do.js';
import { findProjectRoot } from '../../services/config/config-safety.js';

export function registerCodeOrchestratorCanDoCommand(code: Command, io: ProgramIO): void {
  addJsonOption(
    code
      .command('orchestrator-can-do')
      .description(
        '2026-08-05 lesson: probe whether the LLM orchestrator can execute a slice in the ' +
          'current session. Evaluates 4 boundary questions (source-code touched? sub-agent ' +
          'available? requires user decision? context sustainable?) and returns a structured ' +
          'verdict with canDoInSession, blockers, warnings, and concrete next-action ' +
          'suggestions. Default to canDoInSession=true unless hard blockers are present; ' +
          'sub-agent dispatch (`peaks sub-agent dispatch rd`) is the canonical delegation path ' +
          'for source-code changes.'
      )
      .requiredOption('--slice-spec <text>', 'short description of the slice (e.g. "modify src/services/foo.ts")')
      .option('--project <path>', 'target project root (default: findProjectRoot(cwd))')
      .option('--peaks-bin <path>', 'peaks binary path (test seam; default: peaks on PATH)')
  ).action(
    async (opts: { sliceSpec: string; project?: string; peaksBin?: string; json?: boolean }) => {
      try {
        const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
        const peaksBin = opts.peaksBin ?? 'peaks';
        const result = await evaluateOrchestratorCanDo({
          sliceSpec: opts.sliceSpec,
          projectRoot,
          probeSubAgentAvailable: () => probeSubAgentAvailableWithBin(projectRoot, peaksBin),
          probeContextRatio: () => probeContextRatioWithBin(projectRoot, peaksBin),
        });
        printResult(
          io,
          ok(
            'code.orchestrator-can-do',
            result,
            [...result.warnings],
            [...result.suggestions, ...summaryLines(result)]
          ),
          opts.json
        );
        if (!result.canDoInSession) process.exitCode = 1;
      } catch (err) {
        if (err instanceof OrchestratorCanDoError) {
          printResult(
            io,
            fail('code.orchestrator-can-do', err.code, err.message, null, [
              'Pass --slice-spec <text> describing what the slice should change',
            ]),
            opts.json
          );
          process.exitCode = 1;
          return;
        }
        printResult(
          io,
          fail('code.orchestrator-can-do', 'PROBE_FAILED', getErrorMessage(err), null, [
            'Verify --slice-spec is non-empty and --project is a valid path',
          ]),
          opts.json
        );
        process.exitCode = 1;
      }
    }
  );
}

function summaryLines(result: { canDoInSession: boolean; q1SourceCodeTouched: boolean; q2SubAgentAvailable: boolean; q3RequiresUserDecision: boolean; contextRatio: number }): string[] {
  const lines: string[] = [];
  lines.push(
    `verdict: ${result.canDoInSession ? 'canDoInSession=true' : 'canDoInSession=false (blockers present)'}; ` +
      `q1=src[${result.q1SourceCodeTouched ? 'Y' : 'N'}] q2=subagent[${result.q2SubAgentAvailable ? 'Y' : 'N'}] ` +
      `q3=user-decision[${result.q3RequiresUserDecision ? 'Y' : 'N'}] q4=ratio=${result.contextRatio.toFixed(2)} ` +
      `(red-line ${ORCHESTRATOR_REDLINE_RATIO} / pre-compact ${ORCHESTRATOR_PRECOMPACT_RATIO})`
  );
  return lines;
}

async function probeSubAgentAvailableWithBin(projectRoot: string, peaksBin: string): Promise<boolean> {
  const { probeSubAgentAvailable } = await import('../../services/code/orchestrator-can-do.js');
  return probeSubAgentAvailable(projectRoot, peaksBin);
}

async function probeContextRatioWithBin(projectRoot: string, peaksBin: string): Promise<{ ratio: number; source: string }> {
  const { probeContextRatio } = await import('../../services/code/orchestrator-can-do.js');
  return probeContextRatio(projectRoot, peaksBin);
}