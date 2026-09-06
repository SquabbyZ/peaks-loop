/**
 * peaks evidence * CLI surface — mechanical per-slice evidence generation.
 *
 * `peaks evidence generate` writes the ~11 per-slice evidence artifacts under
 * `.peaks/_runtime/<sid>/` so the orchestrator no longer hand-writes them for
 * a mechanical file-split (or similar) slice. The body builders live in
 * `services/evidence/evidence-generator.ts`; this module only wires the
 * Commander surface + project/session resolution + JSON envelope.
 */
import type { Command } from 'commander';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { generateEvidence, parseFiles, parseLineCounts } from '../../services/evidence/evidence-generator.js';
import { getSessionId } from '../../services/session/session-manager.js';
import { findProjectRoot } from '../../services/config/config-safety.js';

type EvidenceGenerateCommandOptions = {
  rid?: string;
  title?: string;
  files?: string;
  lineCounts?: string;
  sessionId?: string;
  json?: boolean;
};

export function registerEvidenceCommands(program: Command, io: ProgramIO): void {
  const evidence = program.command('evidence').description('Generate per-slice evidence artifacts for mechanical slices');

  addJsonOption(
    evidence
      .command('generate')
      .description('Write the ~11 rd/qa/audit/prd evidence artifacts for a mechanical file-split slice under .peaks/_runtime/<sid>/')
      .requiredOption('--rid <rid>', 'request id (e.g. 2026-09-06-split-dispatch-commands)')
      .requiredOption('--title <title>', 'one-line description of the slice')
      .requiredOption('--files <list>', 'comma-separated changed file paths')
      .requiredOption('--line-counts <list>', 'semicolon-separated file=lines pairs (e.g. "f=120;g=300")')
      .option('--session-id <sid>', 'session id; defaults to the project-bound session')
  ).action(async (options: EvidenceGenerateCommandOptions) => {
    try {
      const projectRoot = findProjectRoot(process.cwd()) ?? process.cwd();
      const sessionId = options.sessionId ?? getSessionId(projectRoot);
      if (sessionId === null || sessionId === undefined || sessionId.length === 0) {
        printResult(
          io,
          fail(
            'evidence.generate',
            'SESSION_NOT_BOUND',
            'No --session-id was provided and no peaks session is bound for this project.',
            { projectRoot },
            ['Pass --session-id <sid>, or run `peaks workspace init` first so a session directory exists.']
          ),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      const files = parseFiles(options.files ?? '');
      const lineCounts = parseLineCounts(options.lineCounts ?? '');
      const result = await generateEvidence({
        projectRoot,
        rid: options.rid ?? '',
        title: options.title ?? '',
        files,
        lineCounts,
        sessionId
      });
      printResult(
        io,
        ok('evidence.generate', result, [], [
          `Wrote ${result.writtenFiles.length} evidence files under ${result.sessionRoot}`
        ]),
        options.json
      );
    } catch (error) {
      printResult(
        io,
        fail('evidence.generate', 'EVIDENCE_GENERATE_FAILED', getErrorMessage(error), {}, ['Verify the target project is writable.']),
        options.json
      );
      process.exitCode = 1;
    }
  });
}
