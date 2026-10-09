// src/cli/commands/statusline-status-command.ts
//
// `peaks statusline status` — report whether the status line is installed.
// Split out of `statusline-commands.ts`; the scope resolution and both
// envelopes are unchanged.

import { getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { readHookStatus as readSettingsStatus } from '../../services/skills/hooks-settings-service.js';
import {
  resolveIdeForCommand,
  resolveProjectRoot,
  resolveScope,
  type StatusOptions
} from './statusline-command-shared.js';

export function runStatuslineStatus(io: ProgramIO, options: StatusOptions): void {
  const scope = resolveScope(options);
  const projectRoot = scope === 'project' ? resolveProjectRoot(options.project) : undefined;
  const ide = resolveIdeForCommand(options, projectRoot);
  try {
    const status = readSettingsStatus(scope, projectRoot, { ide });
    printResult(
      io,
      ok('statusline.status', { ...status, ide, command: 'peaks statusline' }),
      options.json ?? false
    );
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    printResult(
      io,
      fail('statusline.status', 'STATUSLINE_STATUS_FAILED', message, { scope, ide }, [message]),
      options.json ?? false
    );
    process.exitCode = 1;
  }
}
