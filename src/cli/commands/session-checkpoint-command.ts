/**
 * `peaks session checkpoint` — slice 011.
 *
 * Writes a JSON snapshot of the current session's state to
 * `_runtime/<sessionId>/checkpoints/<iso>.json`. Designed for skill
 * invocation; the CLI is the muscle, the LLM decides the cadence.
 */

import type { Command } from 'commander';
import {
  CHECKPOINT_CONSTANTS,
  CHECKPOINT_REASONS,
  writeCheckpoint,
  type CheckpointReason,
} from '../../services/session/session-checkpoint-service.js';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { getErrorMessage, type ProgramIO } from '../cli-helpers.js';

type SessionCheckpointOptions = {
  reason?: string;
  project?: string;
  sessionId?: string;
  currentPlan?: string;
  openQuestions?: string;
  recentDecisions?: string;
  recentArtifactPaths?: string;
  gitStatus?: string;
  skillsActive?: string;
  todoState?: string;
  json?: boolean;
};

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function registerSessionCheckpointCommand(session: Command, _io: ProgramIO): void {
  session
    .command('checkpoint')
    .description(
      `Write a JSON snapshot of the current session to ` +
        `_runtime/<sessionId>/checkpoints/<iso>.json (max ${CHECKPOINT_CONSTANTS.MAX_CHECKPOINTS} retained). ` +
        'Designed for skill-level invocation.'
    )
    .option('--reason <reason>', `one of: ${CHECKPOINT_REASONS.join(', ')} (default: periodic)`, 'periodic')
    .option('--project <path>', 'project root (defaults to current directory)', process.cwd())
    .option('--session-id <sid>', 'explicit session id (defaults to canonical binding from .peaks/_runtime/session.json)')
    .option('--current-plan <text>', 'current plan summary')
    .option('--open-questions <list>', 'newline-separated open questions')
    .option('--recent-decisions <list>', 'newline-separated recent decisions')
    .option('--recent-artifact-paths <list>', 'newline-separated recent artifact paths')
    .option('--git-status <text>', 'recent git status')
    .option('--skills-active <list>', 'newline-separated active skill names')
    .option('--todo-state <list>', 'newline-separated todo lines')
    .option('--json', 'emit a JSON envelope { ok, data } to stdout')
    .action(async (opts: SessionCheckpointOptions) => {
      try {
        const projectRoot = resolveCanonicalProjectRoot(opts.project ?? process.cwd());
        let sid: string | undefined = opts.sessionId;
        if (!sid) {
          const { getSessionIdCanonical } = await import('../../services/session/session-manager.js');
          sid = getSessionIdCanonical(projectRoot) ?? undefined;
        }
        if (!sid) {
          if (opts.json === true) {
            process.stdout.write(JSON.stringify({
              ok: false,
              error: 'NO_ACTIVE_SESSION: run `peaks workspace init` first or pass --session-id'
            }) + '\n');
          } else {
            process.stderr.write('NO_ACTIVE_SESSION: run `peaks workspace init` first or pass --session-id\n');
          }
          process.exitCode = 1;
          return;
        }
        const reasonRaw = opts.reason ?? 'periodic';
        if (!(CHECKPOINT_REASONS as readonly string[]).includes(reasonRaw)) {
          if (opts.json === true) {
            process.stdout.write(JSON.stringify({
              ok: false,
              error: `INVALID_REASON: --reason must be one of ${CHECKPOINT_REASONS.join(', ')} (got "${reasonRaw}")`
            }) + '\n');
          } else {
            process.stderr.write(`INVALID_REASON: --reason must be one of ${CHECKPOINT_REASONS.join(', ')} (got "${reasonRaw}")\n`);
          }
          process.exitCode = 1;
          return;
        }
        const reason = reasonRaw as CheckpointReason;
        const result = writeCheckpoint(projectRoot, {
          sessionId: sid,
          reason,
          ...(opts.currentPlan !== undefined ? { currentPlan: opts.currentPlan } : {}),
          ...(opts.gitStatus !== undefined ? { gitStatus: opts.gitStatus } : {}),
          openQuestions: splitList(opts.openQuestions),
          recentDecisions: splitList(opts.recentDecisions),
          recentArtifactPaths: splitList(opts.recentArtifactPaths),
          skillsActive: splitList(opts.skillsActive),
          todoState: splitList(opts.todoState)
        });
        if (opts.json === true) {
          process.stdout.write(JSON.stringify({ ok: true, data: result }) + '\n');
        } else {
          process.stdout.write(`checkpoint: ${result.path} (reason=${result.reason}, retained=${result.totalRetained})\n`);
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