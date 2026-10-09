// `peaks compact force` — write the pre-compact checkpoint. The only `peaks compact`
// verb that writes; the IDE-side `/compact` stays the LLM's call.
import type { Command } from 'commander';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { fail, ok, getErrorMessage } from 'peaks-loop-shared/result';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  writeCheckpoint,
  type CheckpointWriteResult
} from '../../services/session/session-checkpoint-service.js';
import { resolveSessionId } from './compact-shared.js';

type CompactForceOptions = {
  reason?: string;
  json?: boolean;
  project?: string;
  sessionId?: string;
  currentPlan?: string;
  openQuestions?: string;
  recentDecisions?: string;
  recentArtifactPaths?: string;
  gitStatus?: string;
  skillsActive?: string;
  todoState?: string;
};

type SessionResolveError = { code: string; message: string; nextActions: string[] };

const COMPACT_FORCE_NEXT_ACTIONS = [
  'After the LLM fires the IDE-side /compact, call `peaks compact survival` to see what to persist before the next compact.'
];

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function registerCompactForceCommand(compact: Command, io: ProgramIO): void {
  // -----------------------------------------------------------------
  // 5. peaks compact force [--reason <text>] [--json]
  // -----------------------------------------------------------------
  addJsonOption(
    compact
      .command('force')
      .description(
        'Write a pre-compact checkpoint via `peaks session checkpoint --reason context-fill`. ' +
          "The IDE-side `/compact` is still the LLM's call; this primitive guarantees " +
          'the pre-compact state is persisted. NO sleep, NO wait for IDE response.'
      )
      .option(
        '--reason <text>',
        'human-readable reason for the pre-compact checkpoint',
        'pre-force-compact'
      )
      .option('--project <path>', 'project root (defaults to git root or cwd)')
      .option('--session-id <sid>', 'override the active session id')
      .option(
        '--current-plan <text>',
        'current plan summary (forwarded to the checkpoint snapshot)'
      )
      .option('--open-questions <list>', 'newline-separated open questions')
      .option('--recent-decisions <list>', 'newline-separated recent decisions')
      .option('--recent-artifact-paths <list>', 'newline-separated recent artifact paths')
      .option('--git-status <text>', 'recent git status')
      .option('--skills-active <list>', 'newline-separated active skill names')
      .option('--todo-state <list>', 'newline-separated todo lines')
  ).action((options: CompactForceOptions) => runCompactForce(options, io));
}

function runCompactForce(options: CompactForceOptions, io: ProgramIO): void {
  try {
    const projectRoot =
      options.project !== undefined
        ? resolveCanonicalProjectRoot(options.project)
        : (findProjectRoot(process.cwd()) ?? process.cwd());
    const session = resolveSessionId(projectRoot, options.sessionId);
    if (session.error !== null) {
      printCompactForceSessionError(session.error, projectRoot, io, options.json);
      return;
    }
    const reason = (options.reason ?? 'pre-force-compact').slice(0, 200);
    // The session-checkpoint-service restricts `reason` to a fixed
    // enum. The strategic-compact `force` primitive uses
    // 'context-fill' (the closest semantic match: the LLM is
    // compacting because of context pressure) and records the
    // caller's free-form reason in `gitStatus` so the snapshot
    // is self-describing without inventing a new enum value.
    const checkpointOptions: Parameters<typeof writeCheckpoint>[1] = {
      sessionId: session.sid as string,
      reason: 'context-fill',
      gitStatus: `compact.force: ${reason}`,
      openQuestions: splitList(options.openQuestions),
      recentDecisions: splitList(options.recentDecisions),
      recentArtifactPaths: splitList(options.recentArtifactPaths),
      skillsActive: splitList(options.skillsActive),
      todoState: splitList(options.todoState)
    };
    if (options.currentPlan !== undefined) {
      checkpointOptions.currentPlan = options.currentPlan;
    }
    const result = writeCheckpoint(projectRoot, checkpointOptions);
    printCompactForceResult(result, reason, io, options.json);
  } catch (error) {
    reportCompactForceFailure(io, error, options.json);
  }
}

function printCompactForceSessionError(
  error: SessionResolveError,
  projectRoot: string,
  io: ProgramIO,
  json?: boolean
): void {
  printResult(
    io,
    fail('compact.force', error.code, error.message, { projectRoot }, error.nextActions),
    json
  );
  process.exitCode = 1;
}

function buildCompactForceData(
  result: CheckpointWriteResult,
  reason: string
): {
  checkpointPath: string;
  reason: string;
  callerReason: string;
  sessionId: string;
  createdAt: string;
  totalRetained: number;
  message: string;
} {
  return {
    checkpointPath: result.path,
    reason: 'pre-force-compact',
    callerReason: reason,
    sessionId: result.sessionId,
    createdAt: result.createdAt,
    totalRetained: result.totalRetained,
    message:
      "Pre-compact checkpoint written. The IDE-side /compact is still the LLM's call; this CLI does NOT invoke the IDE slash command."
  };
}

function printCompactForceResult(
  result: CheckpointWriteResult,
  reason: string,
  io: ProgramIO,
  json?: boolean
): void {
  printResult(
    io,
    ok('compact.force', buildCompactForceData(result, reason), [], COMPACT_FORCE_NEXT_ACTIONS),
    json
  );
}

function reportCompactForceFailure(io: ProgramIO, error: unknown, json?: boolean): void {
  printResult(
    io,
    fail('compact.force', 'COMPACT_FORCE_FAILED', getErrorMessage(error), {}, [
      'Verify the project path is writable and a session is bound'
    ]),
    json
  );
  process.exitCode = 1;
}
