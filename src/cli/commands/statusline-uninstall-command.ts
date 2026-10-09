// src/cli/commands/statusline-uninstall-command.ts
//
// `peaks statusline uninstall` — remove the statusLine entry from the
// adapter's settings.json. Split out of `statusline-commands.ts`; the scope
// resolution and both envelopes are unchanged.

import { getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { removeStatusLineInstall } from '../../services/skills/statusline-settings-service.js';
import {
  resolveIdeForCommand,
  resolveProjectRoot,
  resolveScope,
  type UninstallOptions
} from './statusline-command-shared.js';

export function runStatuslineUninstall(io: ProgramIO, options: UninstallOptions): void {
  const scope = resolveScope(options);
  const projectRoot = scope === 'project' ? resolveProjectRoot(options.project) : undefined;
  const ide = resolveIdeForCommand(options, projectRoot);
  try {
    const result = removeStatusLineInstall(scope, projectRoot, { ide });
    printResult(io, ok('statusline.uninstall', { ...result, ide }), options.json ?? false);
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    printResult(
      io,
      fail(
        'statusline.uninstall',
        'STATUSLINE_UNINSTALL_FAILED',
        message,
        { scope, ide, removed: false },
        [message]
      ),
      options.json ?? false
    );
    process.exitCode = 1;
  }
}
