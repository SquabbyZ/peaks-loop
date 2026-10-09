// `peaks code emit-handoff` — the size-fear ban. Refuses to emit a final handoff
// while a Job has remaining slices; exit 0 = allow, exit 1 = block.
import type { Command } from 'commander';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import {
  evaluateEmitHandoff,
  JOB_NOT_INITIALIZED,
  JOB_REMAINING_BLOCKED,
  type EmitHandoffVerdict
} from '../../services/code/emit-handoff.js';
import { readActiveSid } from './code-runtime-session.js';

interface CodeEmitHandoffOpts {
  project: string;
  sessionId?: string;
  jobId?: string;
  forceUnderJob?: boolean;
  json?: boolean;
}

type EmitHandoffAllowDoneVerdict = Extract<EmitHandoffVerdict, { kind: 'allow-done' }>;
type EmitHandoffAllowForceOverrideVerdict = Extract<
  EmitHandoffVerdict,
  { kind: 'allow-force-override' }
>;
type EmitHandoffBlockNotInitializedVerdict = Extract<
  EmitHandoffVerdict,
  { kind: 'block-not-initialized' }
>;
type EmitHandoffBlockRemainingVerdict = Extract<EmitHandoffVerdict, { kind: 'block-remaining' }>;

export function registerCodeEmitHandoffCommand(code: Command, io: ProgramIO): void {
  // v3.1.2 Step 11 / final handoff — Size-fear ban.
  // Refuses to emit a final handoff while a Job has remaining slices.
  addJsonOption(
    code
      .command('emit-handoff')
      .description(
        'v3.1.2 Step 11 size-fear ban: under Job mode, refuse to emit a final ' +
          'handoff while remaining > 0. Exit 0 = allow, exit 1 = block. Pass ' +
          '--force-under-job to override (requires explicit user approval).'
      )
      .requiredOption('--project <path>', 'target project root')
      .option('--session-id <sid>', 'override session id (default: read from active presence)')
      .option(
        '--job-id <jid>',
        'override job id (default: read from job-shape.json decision.suggestedJobId)'
      )
      .option(
        '--force-under-job',
        'override the remaining>0 block (explicit user approval required)'
      )
  ).action((opts: CodeEmitHandoffOpts) => runEmitHandoff(opts, io));
}

function runEmitHandoff(opts: CodeEmitHandoffOpts, io: ProgramIO): void {
  try {
    const sessionId = opts.sessionId ?? readActiveSid(opts.project);
    if (sessionId === null) {
      printEmitHandoffNoSession(io, opts.json);
      return;
    }
    const evalInput: {
      projectRoot: string;
      sessionId: string;
      jobId?: string;
      forceUnderJob?: boolean;
    } = {
      projectRoot: opts.project,
      sessionId
    };
    if (opts.jobId !== undefined) evalInput.jobId = opts.jobId;
    if (opts.forceUnderJob === true) evalInput.forceUnderJob = true;
    const verdict = evaluateEmitHandoff(evalInput);
    reportEmitHandoffVerdict(verdict, io, opts.json);
  } catch (err) {
    reportEmitHandoffFailure(io, err, opts.json);
  }
}

function reportEmitHandoffVerdict(
  verdict: EmitHandoffVerdict,
  io: ProgramIO,
  json?: boolean
): void {
  if (verdict.kind === 'allow-not-job') {
    printEmitHandoffAllowNotJob(io, json);
    return;
  }
  if (verdict.kind === 'allow-done') {
    printEmitHandoffAllowDone(verdict, io, json);
    return;
  }
  if (verdict.kind === 'allow-force-override') {
    printEmitHandoffAllowForceOverride(verdict, io, json);
    return;
  }
  if (verdict.kind === 'block-not-initialized') {
    printEmitHandoffBlockNotInitialized(verdict, io, json);
    return;
  }
  printEmitHandoffBlockRemaining(verdict, io, json);
}

function printEmitHandoffNoSession(io: ProgramIO, json?: boolean): void {
  const envelope = ok(
    'code.emit-handoff',
    { allow: true, mode: 'no-session' },
    [],
    ['No active session id; gate passes through (single-rid mode).']
  );
  printResult(io, envelope, json);
}

function printEmitHandoffAllowNotJob(io: ProgramIO, json?: boolean): void {
  const envelope = ok(
    'code.emit-handoff',
    { allow: true, mode: 'single' },
    [],
    ['job-shape.json says isJob=false (or absent); normal handoff allowed.']
  );
  printResult(io, envelope, json);
}

function printEmitHandoffAllowDone(
  verdict: EmitHandoffAllowDoneVerdict,
  io: ProgramIO,
  json?: boolean
): void {
  const envelope = ok(
    'code.emit-handoff',
    { allow: true, mode: 'job-done', remaining: verdict.remaining },
    [],
    [`Job is complete (remaining=0); handoff allowed.`]
  );
  printResult(io, envelope, json);
}

function printEmitHandoffAllowForceOverride(
  verdict: EmitHandoffAllowForceOverrideVerdict,
  io: ProgramIO,
  json?: boolean
): void {
  const envelope = ok(
    'code.emit-handoff',
    { allow: true, mode: 'job-force-override', remaining: verdict.remaining },
    [],
    [
      `Job has ${verdict.remaining} remaining slices; --force-under-job override applied. Handoff allowed (explicit user approval).`
    ]
  );
  printResult(io, envelope, json);
}

function printEmitHandoffBlockNotInitialized(
  verdict: EmitHandoffBlockNotInitializedVerdict,
  io: ProgramIO,
  json?: boolean
): void {
  const envelope = fail(
    'code.emit-handoff',
    JOB_NOT_INITIALIZED,
    `Job ${verdict.jobId} has no state.json; peaks job init was skipped.`,
    { jobId: verdict.jobId },
    [`Run \`peaks job init --job-id ${verdict.jobId} --slice-list <...>\` before emitting handoff.`]
  );
  printResult(io, envelope, json);
  process.exitCode = 1;
}

function printEmitHandoffBlockRemaining(
  verdict: EmitHandoffBlockRemainingVerdict,
  io: ProgramIO,
  json?: boolean
): void {
  // block-remaining
  const blockMessage = `BLOCKED: Job ${verdict.jobId} has ${verdict.remaining} remaining slices. Run \`peaks job status\`. Use --force-under-job only with explicit user approval.`;
  const envelope = fail(
    'code.emit-handoff',
    JOB_REMAINING_BLOCKED,
    blockMessage,
    { jobId: verdict.jobId, remaining: verdict.remaining },
    [
      `Run \`peaks job status --job-id ${verdict.jobId}\` to see remaining slices.`,
      'Resume Step 0.81 (per-slice checkpoint loop) and continue until remaining === 0.',
      'Use --force-under-job only with explicit user approval (size-fear ban override).'
    ]
  );
  io.stderr(`${blockMessage}\n`);
  printResult(io, envelope, json);
  process.exitCode = 1;
}

function reportEmitHandoffFailure(io: ProgramIO, err: unknown, json?: boolean): void {
  printResult(
    io,
    fail('code.emit-handoff', 'EMIT_HANDOFF_FAILED', getErrorMessage(err), null, [
      'Verify the project path and try again'
    ]),
    json
  );
  process.exitCode = 1;
}
