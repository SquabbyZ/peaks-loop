/**
 * `peaks session resume` — slice 011.
 *
 * Reads a checkpoint JSON (written by `peaks session checkpoint`) and
 * emits a structured markdown "resume context" block the skill can
 * prepend to its own prompt. Default behavior writes the block to
 * stdout so the skill (LLM) can pick it up directly.
 */

import type { Command } from 'commander';
import { buildResumeContext } from '../../services/session/session-resume-service.js';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { getErrorMessage, type ProgramIO } from '../cli-helpers.js';

type SessionResumeOptions = {
  from?: string;
  project?: string;
  sessionId?: string;
  json?: boolean;
};

export function registerSessionResumeCommand(session: Command, _io: ProgramIO): void {
  session
    .command('resume')
    .description(
      'Read a checkpoint JSON and emit a markdown "resume context" block ' +
        '(LLM-friendly structured format). Wire to peaks session * namespace.'
    )
    .option('--from <path>', 'path to a checkpoint JSON file (required, or use --session-id for latest)')
    .option('--project <path>', 'project root (defaults to current directory)', process.cwd())
    .option('--session-id <sid>', 'use the latest checkpoint for this session id (alternative to --from)')
    .option('--json', 'emit a JSON envelope { ok, data: { markdown, ... } }')
    .action(async (opts: SessionResumeOptions) => {
      try {
        const projectRoot = resolveCanonicalProjectRoot(opts.project ?? process.cwd());
        let fromPath = opts.from;
        if (!fromPath && opts.sessionId) {
          const { latestCheckpointPath } = await import('../../services/session/session-checkpoint-service.js');
          const latest = latestCheckpointPath(projectRoot, opts.sessionId);
          if (!latest) {
            if (opts.json === true) {
              process.stdout.write(JSON.stringify({
                ok: false,
                error: `NO_CHECKPOINTS: no checkpoints found for session ${opts.sessionId}`
              }) + '\n');
            } else {
              process.stderr.write(`NO_CHECKPOINTS: no checkpoints found for session ${opts.sessionId}\n`);
            }
            process.exitCode = 1;
            return;
          }
          fromPath = latest;
        }
        if (!fromPath) {
          if (opts.json === true) {
            process.stdout.write(JSON.stringify({
              ok: false,
              error: 'MISSING_PATH: pass --from <path> or --session-id <sid>'
            }) + '\n');
          } else {
            process.stderr.write('MISSING_PATH: pass --from <path> or --session-id <sid>\n');
          }
          process.exitCode = 1;
          return;
        }
        const ctx = buildResumeContext({ checkpointPath: fromPath });
        if (opts.json === true) {
          process.stdout.write(JSON.stringify({
            ok: true,
            data: {
              sourcePath: ctx.sourcePath,
              relativeAgeLabel: ctx.relativeAgeLabel,
              checkpointAgeMs: ctx.checkpointAgeMs,
              markdown: ctx.markdown,
              snapshot: ctx.snapshot
            }
          }) + '\n');
        } else {
          process.stdout.write(ctx.markdown + '\n');
        }
      } catch (error) {
        if (opts.json === true) {
          process.stdout.write(JSON.stringify({ ok: false, error: getErrorMessage(error) }) + '\n');
        } else {
          process.stderr.write(getErrorMessage(error) + '\n');
        }
        process.exitCode = 1;
      }
    });
}