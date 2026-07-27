import type { Command } from 'commander';
import type { ProgramIO } from '../cli-helpers.js';
import { registerDashboardLongRunCommand } from './dashboard-long-run.js';

/** Registers the top-level `peaks dashboard` command tree. */
export function registerDashboardCommands(program: Command, io: ProgramIO): void {
  const dashboard = program
    .command('dashboard')
    .description('peaks dashboard surface (24h long-run view etc.)');
  registerDashboardLongRunCommand(dashboard, io);
}
