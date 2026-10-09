// src/cli/commands/statusline-install-command.ts
//
// `peaks statusline install` — write the statusLine entry into the adapter's
// settings.json. Split out of `statusline-commands.ts`; the scope resolution,
// the warnings, the next-action string and the failure envelope are unchanged.

import { getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import {
  applyStatusLineInstall,
  planStatusLineInstall
} from '../../services/skills/statusline-settings-service.js';
import {
  resolveIdeForCommand,
  resolveProjectRoot,
  resolveScope,
  type InstallOptions
} from './statusline-command-shared.js';

function emitInstall(
  io: ProgramIO,
  options: InstallOptions,
  target: {
    readonly scope: ReturnType<typeof resolveScope>;
    readonly projectRoot: string | undefined;
    readonly ide: ReturnType<typeof resolveIdeForCommand>;
  }
): void {
  const { scope, projectRoot, ide } = target;
  if (options.dryRun) {
    const plan = planStatusLineInstall(scope, projectRoot, { ide });
    const warnings = plan.conflict
      ? [
          `An existing statusLine command is set: ${plan.conflictCommand}. Rerun with --force to overwrite.`
        ]
      : [];
    printResult(
      io,
      ok('statusline.install', { ...plan, ide, applied: false, dryRun: true }, warnings),
      options.json ?? false
    );
    return;
  }
  const result = applyStatusLineInstall(scope, projectRoot, {
    force: options.force === true,
    ide
  });
  const warnings =
    result.conflict && !result.applied
      ? [
          `An existing statusLine command is set: ${result.conflictCommand}. Rerun with --force to overwrite.`
        ]
      : [];
  const nextActions = result.applied
    ? ['Restart the IDE (or reload the workspace) so the status line takes effect']
    : [];
  printResult(
    io,
    ok('statusline.install', { ...result, ide, dryRun: false }, warnings, nextActions),
    options.json ?? false
  );
}

export function runStatuslineInstall(io: ProgramIO, options: InstallOptions): void {
  const scope = resolveScope(options);
  const projectRoot = scope === 'project' ? resolveProjectRoot(options.project) : undefined;
  const ide = resolveIdeForCommand(options, projectRoot);
  try {
    emitInstall(io, options, { scope, projectRoot, ide });
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    printResult(
      io,
      fail(
        'statusline.install',
        'STATUSLINE_INSTALL_FAILED',
        message,
        { scope, ide, applied: false },
        [message]
      ),
      options.json ?? false
    );
    process.exitCode = 1;
  }
}
