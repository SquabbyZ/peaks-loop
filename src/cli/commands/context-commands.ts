/**
 * peaks context * CLI (Slice #3 L1c) — context 4-layer loader.
 *
 * The LLM-side UX layer (peaks-code / peaks-ide) picks the layer based
 * on the L1a task level:
 *   - typo:     L0 only (a few lines)
 *   - bug:     L0 + L1
 *   - feature: L0 + L1 + L2 + L3(按需)
 *   - refactor: L0 + L1 + L2 + L3
 *   - migration: L0 + L1 + L2 + L3 + codegraph
 */
import type { Command } from 'commander';

import type { ProgramIO } from '../cli-helpers.js';
import { registerContextCheckCommand } from './context-check-command.js';
import { registerContextLayerCommand } from './context-layer-command.js';
import { registerContextStatusCommand } from './context-status-command.js';

export type { ContextLayer } from './context-layer-fetchers.js';

export function registerContextCommands(program: Command, io: ProgramIO): void {
  const context = program
    .command('context')
    .description('Slice L1c: context 4-layer loader (L0 full / L1 summary / L2 index / L3 fuzzy)');

  registerContextLayerCommand(context, io);
  registerContextStatusCommand(context, io);
  registerContextCheckCommand(context, io);
}
