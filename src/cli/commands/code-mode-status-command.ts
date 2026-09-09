/**
 * Slice 2026-09-09-mode-consolidation (Slice D) — `peaks code mode status`.
 *
 * One read for the whole stacked autonomy picture:
 *   - presence MODE (`full-auto | assisted | strict | 24h`),
 *   - the 24h internal state machine (only when the mode is `24h`),
 *   - Job mode,
 *   - the resolved auto-compact profile (`standard | partial`).
 *
 * Read-only and fail-soft: the service degrades every unreadable
 * artifact to `null` / `false`; this command only wraps the call in an
 * envelope. Nested under the existing `peaks code` verb (no new
 * top-level verb — peaks-loop is enhancement, not a new CLI surface).
 */

import type { Command } from 'commander';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { resolveModeStatus } from '../../services/mode/mode-status-service.js';

export function registerCodeModeStatusCommand(code: Command, io: ProgramIO): void {
  // Explicit two-step nesting (NOT `.command('mode status')` — that form
  // creates a positional `<status>` argument, not a subcommand).
  const mode = code
    .command('mode')
    .description('Mode introspection (read-only). Sub-actions: status.');

  addJsonOption(
    mode
      .command('status')
      .description(
        'v4.0.34 (slice 2026-09-09-mode-consolidation): one read for the whole stacked ' +
          'autonomy picture — presence mode, the 24h internal state (when mode=24h), Job mode, ' +
          'and the resolved auto-compact profile. Read-only + fail-soft.'
      )
      .option('--project <path>', 'project root (defaults to current directory)')
      .option('--session-id <sessionId>', 'explicit session id (defaults to the canonical binding)')
  ).action((options: { project?: string; sessionId?: string; json?: boolean }) => {
    try {
      const projectRoot = resolveCanonicalProjectRoot(options.project ?? process.cwd());
      const status = resolveModeStatus({
        projectRoot,
        sessionId: options.sessionId ?? null
      });
      printResult(
        io,
        ok('code.mode.status', { projectRoot, ...status }, [], [
          status.mode === null
            ? 'No presence mode recorded — Step 1 mode selection has not run for this session.'
            : `mode=${status.mode} (${status.modeSource}) → auto-compact profile=${status.autoCompactProfile}`
        ]),
        options.json
      );
    } catch (error) {
      printResult(
        io,
        fail('code.mode.status', 'MODE_STATUS_FAILED', getErrorMessage(error), null, [
          'Verify the project path and try again'
        ]),
        options.json
      );
      process.exitCode = 1;
    }
  });
}
