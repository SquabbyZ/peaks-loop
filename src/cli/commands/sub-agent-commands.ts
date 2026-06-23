/**
 * `peaks sub-agent` CLI command group — slice 2026-06-07-sub-agent-context-governance.
 *
 * Thin entry point that wires the four sub-command registrars
 * (`dispatch`, `heartbeat`, `share`, `shared-read`, `await`) to the
 * parent `sub-agent` command. The actual implementations live in
 * sibling files (slice 2026-06-23-audit-p0-split refactor):
 *
 *   - `dispatch-commands.ts`  — `dispatch` single-dispatch action
 *   - `dispatch-from-dag.ts`  — `dispatch --from-dag` codepath (slice 9 perf)
 *   - `heartbeat-commands.ts` — `heartbeat` action (G6)
 *   - `share-commands.ts`     — `share` + `shared-read` + `await` actions (G8.4 / 2.7.0)
 *   - `sub-agent-shared.ts`   — shared types, constants, helpers
 *
 * Skill-first / CLI-auxiliary red line (PB-4 / AC-19/20):
 *   These commands are primitives that the peaks-solo / peaks-rd /
 *   peaks-qa SKILL.md compose. Users do NOT invoke them directly.
 */
import type { Command } from 'commander';
import type { ProgramIO } from '../cli-helpers.js';
import { registerDispatchCommand } from './dispatch-commands.js';
import { registerHeartbeatCommand } from './heartbeat-commands.js';
import {
  registerShareCommand,
  registerSharedReadCommand,
  registerAwaitCommand
} from './share-commands.js';

// Re-export `validateRole` for backward compat — the integration test
// suite and any external callers still import it from this entry file.
// The canonical implementation now lives in `sub-agent-shared.ts`.
export { validateRole } from './sub-agent-shared.js';

export function registerSubAgentCommands(program: Command, io: ProgramIO): void {
  const subAgent = program
    .command('sub-agent')
    .description(
      'Sub-agent dispatch primitive (skill-first / CLI-auxiliary). ' +
      'These commands are the primitives that peaks-solo / peaks-rd / ' +
      'peaks-qa SKILL.md compose. Users do not invoke this directly.'
    );

  registerDispatchCommand(subAgent, io);
  registerHeartbeatCommand(subAgent, io);
  registerShareCommand(subAgent, io);
  registerSharedReadCommand(subAgent, io);
  registerAwaitCommand(subAgent, io);
}
