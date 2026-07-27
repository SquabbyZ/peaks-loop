import type { Command } from 'commander';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { read24hState, write24hState, type State } from '../../services/24h-mode/index.js';
import { getErrorMessage, type ProgramIO } from '../cli-helpers.js';

export type CodeRun24hOptions = {
  json?: boolean;
  '24h'?: boolean;
  project?: string;
  sessionId?: string;
  tier?: string;
  trigger?: string;
};

function emit(io: ProgramIO, payload: unknown, json: boolean | undefined): void {
  io.stdout((json === true ? JSON.stringify(payload) : JSON.stringify(payload, null, 2)) + '\n');
}

async function sessionId(options: CodeRun24hOptions, projectRoot: string): Promise<string | null> {
  if (options.sessionId) return options.sessionId;
  const { getSessionIdCanonical } = await import('../../services/session/session-manager.js');
  return getSessionIdCanonical(projectRoot);
}

/** Registers `peaks code run`, the thin 24h-mode bridge for peaks-code. */
export function registerCodeRunCommand(code: Command, io: ProgramIO): void {
  code
    .command('run')
    .description('Run a code change; --24h enables the 24h orchestration bridge')
    .argument('[change-id]', 'change id or natural-language work reference')
    .option('--24h', 'enable 24h mode')
    .option('--tier <tier>', 'routing tier (T1, T2, T3, or T4)')
    .option('--trigger <trigger>', 'auto-engage trigger (T3 or T4)')
    .option('--project <path>', 'project root (defaults to current directory)')
    .option('--session-id <sessionId>', 'explicit session id')
    .option('--json', 'emit machine-readable JSON')
    .action(async (changeId: string | undefined, options: CodeRun24hOptions) => {
      if (options['24h' as keyof CodeRun24hOptions] !== true) {
        emit(io, { ok: false, code: 'CODE_RUN_24H_REQUIRED', message: 'code run requires --24h for this integration surface' }, options.json);
        process.exitCode = 1;
        return;
      }
      const projectRoot = resolveCanonicalProjectRoot(options.project ?? process.cwd());
      const sid = await sessionId(options, projectRoot);
      if (!sid) {
        emit(io, { ok: false, code: 'NO_ACTIVE_SESSION', message: 'no --session-id and no canonical binding' }, options.json);
        process.exitCode = 1;
        return;
      }
      const autoEngage = options.tier === 'T3' || options.tier === 'T4' || options.trigger === 'T3' || options.trigger === 'T4';
      try {
        const current = read24hState(projectRoot, sid);
        if (!autoEngage) {
          emit(io, {
            ok: true,
            data: { changeId: changeId ?? null, mode: '24H_REQUESTED', state: current.state, brainstorming: 'reference-only', sessionId: sid },
            next: 'Use the brainstorming reference-only bridge, then let peaks-code continue the normal runbook.'
          }, options.json);
          return;
        }
        const nextState: State = '24H_ACTIVE';
        const next = write24hState(projectRoot, sid, {
          ...current,
          state: nextState,
          enteredAt: new Date().toISOString(),
          enteredFrom: current.state,
          exitCondition: null
        });
        emit(io, {
          ok: true,
          data: { changeId: changeId ?? null, mode: '24H_ACTIVE', state: nextState, autoEngaged: true, trigger: options.trigger ?? options.tier, sessionId: sid, path: next.path },
          next: 'Continue the existing 24H_ACTIVE flow; no brainstorming gate is required for T3/T4.'
        }, options.json);
      } catch (error) {
        emit(io, { ok: false, code: 'CODE_RUN_24H_FAILED', message: getErrorMessage(error), sessionId: sid }, options.json);
        process.exitCode = 1;
      }
    });
}
