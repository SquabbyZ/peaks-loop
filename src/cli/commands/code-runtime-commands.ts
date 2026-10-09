/**
 * context-now / context-audit / post-compact-detect / auto-compact / gate-step-08 /
 * emit-handoff.
 *
 * Owns: 6 sub-commands that read or mutate runtime state.
 *
 * This module is the registrar only. Each sub-command owns a file, and the pure
 * helpers they share live beside them rather than inside one of them. Both
 * re-exports below are part of the published surface of this module path, so the
 * callers that reach for them keep their specifier.
 */

import type { Command } from 'commander';

import type { ProgramIO } from '../cli-helpers.js';
import { registerCodePostCompactDetectCommand } from './code-post-compact-detect-command.js';
import { registerCodeAutoCompactCommand } from './code-auto-compact-command.js';
import { registerCodeContextNowCommand } from './code-context-now-command.js';
import { registerCodeContextAuditCommand } from './code-context-audit-command.js';
import { registerCodeGateStep08Command } from './code-gate-step-08-command.js';
import { registerCodeEmitHandoffCommand } from './code-emit-handoff-command.js';

export { buildAutoCompactEnvelope } from './code-auto-compact-envelope.js';
export { contextNowActionFor } from './code-context-now-mapping.js';

export function registerCodeRuntimeCommands(code: Command, io: ProgramIO): void {
  registerCodePostCompactDetectCommand(code, io);
  registerCodeAutoCompactCommand(code, io);
  registerCodeContextNowCommand(code, io);
  registerCodeContextAuditCommand(code, io);
  registerCodeGateStep08Command(code, io);
  registerCodeEmitHandoffCommand(code, io);
}
