/**
 * v2.15.0 follow-up — G14: smoke regression CLI.
 *
 *   - `peaks smoke define`           — bulk-define critical paths (JSON or --paths)
 *   - `peaks smoke run`             — record a run; for now this is a
 *                                     dry-summary (no real Playwright)
 *   - `peaks smoke run-and-repair`  — same as run, but emit a "needs
 *                                     repair" warning when paths fail
 *   - `peaks smoke add-path`        — add a single critical path
 *                                     (used by `peaks impact must-check`
 *                                     piping or manual registration)
 *
 * The actual Playwright execution is out of scope for this slice.
 * The state model + 4 commands + repair-loop signal are what
 * 2.15.0 follow-up needs.
 *
 * Slice c1-eslint-family-sweep / leaf c4w1-cli-b: the four sub-command
 * registrations moved VERBATIM to `smoke-commands-define.ts`,
 * `smoke-commands-run.ts` (run + run-and-repair) and
 * `smoke-commands-add-path.ts` so this registration file clears the 300-line
 * cap and the `max-lines-per-function` / `complexity` findings that sat on the
 * sub-command action arrows fall with them. The public surface of this module
 * is unchanged: `registerSmokeCommands` and the `EMPTY_SMOKE_STATE`
 * re-export for impact-commands both stay importable from this exact path.
 */

import type { Command } from 'commander';

import { EMPTY_SMOKE_STATE } from '../../services/smoke/smoke-paths-state.js';
import type { ProgramIO } from '../cli-helpers.js';

import { registerSmokeDefine } from './smoke-commands-define.js';
import { registerSmokeRun, registerSmokeRunAndRepair } from './smoke-commands-run.js';
import { registerSmokeAddPath } from './smoke-commands-add-path.js';

export function registerSmokeCommands(program: Command, io: ProgramIO): void {
  const smoke = program
    .command('smoke')
    .description(
      'v2.15.0 follow-up G14: lightweight regression critical-paths management (5-10 min, no full E2E).'
    );

  registerSmokeDefine(smoke, io);
  registerSmokeRun(smoke, io);
  registerSmokeRunAndRepair(smoke, io);
  registerSmokeAddPath(smoke, io);
}

// Expose the empty state symbol so other modules (e.g. impact-commands)
// can pipe must-check items into smoke state without circular imports.
export { EMPTY_SMOKE_STATE };
