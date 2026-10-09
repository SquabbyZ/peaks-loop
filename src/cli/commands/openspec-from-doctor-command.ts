// src/cli/commands/openspec-from-doctor-command.ts
//
// `peaks openspec from-doctor` — draft a change proposal from a failing
// `peaks doctor` check. Extracted from `openspec-commands.ts`; the registered
// name, description, options and envelopes are unchanged.

import type { Command } from 'commander';
import {
  proposeFromDoctor,
  type DoctorFinding
} from '../../services/openspec/openspec-propose-from-doctor-service.js';
import { runDoctor } from '../../services/doctor/index.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { failOpenSpec } from './openspec-command-shared.js';

type FromDoctorOptions = {
  project: string;
  checkId: string;
  json?: boolean;
};

type DoctorReport = Awaited<ReturnType<typeof runDoctor>>;

/**
 * Resolve `--check-id` against the live doctor report. A missing id or an
 * already-passing check both print their own envelope and return null; the
 * caller stops without writing a draft.
 */
function draftFromDoctor(
  io: ProgramIO,
  report: DoctorReport,
  options: FromDoctorOptions
): DoctorFinding | null {
  const finding = report.checks.find((c) => c.id === options.checkId);
  if (finding === undefined) {
    printResult(
      io,
      fail(
        'openspec.from-doctor',
        'CHECK_NOT_FOUND',
        `No doctor check with id "${options.checkId}"`,
        { availableIds: report.checks.map((c) => c.id) },
        ['Run peaks doctor --json to list available check ids']
      ),
      options.json
    );
    process.exitCode = 1;
    return null;
  }
  if (finding.ok) {
    printResult(
      io,
      fail(
        'openspec.from-doctor',
        'CHECK_ALREADY_PASSING',
        `Doctor check "${options.checkId}" is already passing; nothing to draft`,
        { checkId: options.checkId },
        ['Pick a failing check from peaks doctor --json']
      ),
      options.json
    );
    process.exitCode = 1;
    return null;
  }
  return {
    id: finding.id,
    rule: (finding as unknown as { rule?: string }).rule ?? finding.id,
    detail: finding.message,
    severity: 'fail'
  };
}

export function registerOpenSpecFromDoctorCommand(openspec: Command, io: ProgramIO): void {
  // Slice L3.3: from-doctor — auto-generate an OpenSpec change record
  // (proposal.md) from a doctor finding. The LLM then reviews + edits
  // the draft before peaks openspec validate will accept it.
  addJsonOption(
    openspec
      .command('from-doctor')
      .description(
        'Slice L3.3: generate an OpenSpec change draft (proposal.md) from a peaks doctor finding'
      )
      .requiredOption('--project <path>', 'target project root')
      .requiredOption(
        '--check-id <id>',
        'the doctor check id to draft from (e.g. L3:l3-memory-health)'
      )
  ).action(async (options: FromDoctorOptions) => {
    try {
      const report = await runDoctor();
      const finding = draftFromDoctor(io, report, options);
      if (finding === null) {
        return;
      }
      const result = proposeFromDoctor({ projectRoot: options.project, finding });
      printResult(
        io,
        ok(
          'openspec.from-doctor',
          result,
          [],
          [
            `draft proposal written to ${result.proposalPath}`,
            'Review + edit the draft, then run `peaks openspec validate <id>`'
          ]
        ),
        options.json
      );
    } catch (error) {
      failOpenSpec(io, 'openspec.from-doctor', {
        code: 'OPENSPEC_FROM_DOCTOR_FAILED',
        error,
        data: { projectRoot: options.project, checkId: options.checkId },
        nextActions: ['Verify the project path and the check id'],
        json: options.json
      });
    }
  });
}
