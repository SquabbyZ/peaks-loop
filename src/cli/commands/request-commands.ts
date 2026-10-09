// src/cli/commands/request-commands.ts
//
// The `peaks request` registrar. Split into one module per subcommand
// init, list, show, transition, lint,
// repair-status — with the transition family further split into preflight /
// hooks / failures. This file wires them up in the registration order the CLI
// surface dump pins.
import type { Command } from 'commander';
import type { ProgramIO } from '../cli-helpers.js';
import { registerRequestInitCommand } from './request-init-command.js';
import { registerRequestListCommand } from './request-list-command.js';
import { registerRequestShowCommand } from './request-show-command.js';
import { registerRequestTransitionCommand } from './request-transition-command.js';
import { registerRequestLintCommand } from './request-lint-command.js';
import { registerRequestRepairStatusCommand } from './request-repair-status-command.js';

// Published import path preserved: `tests/unit/services/context/summary-view.test.ts`
// imports `buildRequestListSummary` from here.
export { buildRequestListSummary } from './request-list-command.js';

const REQUEST_DESCRIPTION = 'Manage per-request Peaks role artifacts (PRD / UI / RD / QA)';

export function registerRequestCommands(program: Command, io: ProgramIO): void {
  const request = program.command('request').description(REQUEST_DESCRIPTION);

  registerRequestInitCommand(request, io);
  registerRequestListCommand(request, io);
  registerRequestShowCommand(request, io);
  registerRequestTransitionCommand(request, io);
  registerRequestLintCommand(request, io);
  registerRequestRepairStatusCommand(request, io);
}
