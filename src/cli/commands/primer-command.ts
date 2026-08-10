/**
 * Slice rid-statusline-stale-ux AC-2: `peaks session primer --project <path>`.
 *
 * Lightweight SessionStart primer that fires rotation + presence
 * cleanup BEFORE the first statusline render of a fresh session.
 * Independent subcommand (NOT a flag on `peaks workspace init` per
 * task regulation: "don't add a flag to workspace init"). Cleaner
 * permission boundary — primer cannot be mistaken for init by users.
 *
 * Performs only 3 things:
 *   1. ensureSessionWithRotation(projectRoot) — the real rotation
 *      entry point (verified at
 *      src/services/session/session-binding-bridge.ts:461-527).
 *   2. If outer-mismatch rotation occurred: call
 *      clearStalePresenceOnRotation with the verified single-options-
 *      object signature (mirrors init-command.ts:324-329 pattern with
 *      all 3 fields populated). Note: on 4.0.11-A sid-scoped leases
 *      this is a legacy-compat no-op; the real cleanup mechanism is
 *      rotation itself (rebinding changes the bound sid so the
 *      reader looks in the new sid's empty lease dir).
 *   3. gcStalePresenceLeases({ projectRoot, trigger: 'manual' }) —
 *      sync; documented as legacy-compat no-op on 4.0.11-A sid-scoped
 *      data.
 *
 * SKIPS (per RD §4.2.1):
 *   - bootstrapProjectScan
 *   - materializeClaudeSettingsLocal
 *   - resolveFirstTimeHooksInstall
 *   - applyHookInstall (prevents accidental first-launch hook install)
 *
 * Mounted as a CHILD of the existing `session` commander group at
 * `src/cli/commands/core/session-command.ts:32` (verified pattern:
 * `session.command('list')...`). NOT `program.command('session primer')`.
 *
 * The action handler is exported as `runPrimerAction` so the
 * integration test suite can drive it directly without going through
 * Commander's argv-parsing wrapper (which would mangle empty /
 * whitespace / NUL-byte inputs before reaching the action body).
 */

import type { Command } from 'commander';
import type { ProgramIO } from '../cli-helpers.js';
import { printResult } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { resolveCanonicalProjectRootStrict, InvalidProjectRootError } from '../../services/config/config-safety.js';
import { ensureSessionWithRotation } from '../../services/session/session-manager.js';
import { clearStalePresenceOnRotation } from '../../services/skills/skill-presence-service.js';
import { gcStalePresenceLeases } from '../../services/skills/presence-lease-service.js';

export type PrimerOptions = {
  project: string;
  json?: boolean;
};

/**
 * Pure action body for `peaks session primer`. Exported so
 * integration tests can drive it directly with crafted inputs (empty
 * string, whitespace, NUL byte) that would otherwise be rejected by
 * Commander's argv parser.
 *
 * Returns `{ exitCode: 0 | 1 }` so callers (CLI path or test path)
 * can apply the exit code uniformly. NEVER calls `process.exit` —
 * exits are the responsibility of the CLI wrapper.
 */
export async function runPrimerAction(
  opts: PrimerOptions,
  io: ProgramIO
): Promise<{ exitCode: 0 | 1 }> {
  // Explicit empty / whitespace-only guard BEFORE the strict
  // resolver. Commander's requiredOption checks presence, not
  // emptiness; node's `resolve('')` returns cwd (silent
  // fall-through), so we must short-circuit explicitly.
  if (!opts.project || opts.project.trim() === '') {
    printResult(
      io,
      fail(
        'session.primer',
        'PRIMER_EMPTY_PROJECT',
        '--project <path> required and must be non-empty',
        { project: opts.project },
        ['Pass a non-empty absolute path to --project']
      ),
      opts.json
    );
    return { exitCode: 1 };
  }
  // P1 H1 option A: use NEW strict helper. Throws on NUL /
  // non-canonical / non-existent path. The fail-open
  // `resolveCanonicalProjectRoot` is not safe here because primer
  // is invoked from a SessionStart hook on a path pulled from
  // `${CLAUDE_PROJECT_DIR}` — the env var is user-controlled and
  // may contain path traversal payloads.
  let projectRoot: string;
  try {
    projectRoot = resolveCanonicalProjectRootStrict(opts.project);
  } catch (error) {
    if (error instanceof InvalidProjectRootError) {
      printResult(
        io,
        fail(
          'session.primer',
          `PRIMER_INVALID_PROJECT_ROOT_${error.reason.replace(/-/g, '_').toUpperCase()}`,
          error.message,
          { project: opts.project, reason: error.reason },
          ['Pass a non-empty absolute canonical path to --project']
        ),
        opts.json
      );
      return { exitCode: 1 };
    }
    throw error;
  }
  // Real rotation entry point (verified
  // src/services/session/session-binding-bridge.ts:461-527).
  // NOT the invented `runRotationCheck` from cycle-2 RD.
  const rotation = await ensureSessionWithRotation(projectRoot);
  const rotationOccurred = rotation.previousSessionId !== null
    && rotation.rotationReason === 'outer-session-mismatch';
  let clearOutcome: { cleared: boolean; reason: string | null; recordedOuter?: string } | null = null;
  if (rotationOccurred) {
    // VERIFIED single-options-object signature (see
    // skill-presence-service.ts:584-588). Mirror the real caller
    // pattern at init-command.ts:324-329 with all 3 fields
    // populated. NOTE: on 4.0.11-A sid-scoped leases this is a
    // legacy-compat no-op (clearSkillPresence only unlinks legacy
    // single-slot files; the real cleanup mechanism is rotation
    // itself).
    clearOutcome = clearStalePresenceOnRotation({
      projectRootOverride: projectRoot,
      currentOuterSessionId: process.env.PEAKS_OUTER_SESSION_ID
        ?? process.env.CLAUDE_CODE_SESSION_ID,
      rotatedOutSessionId: rotation.previousSessionId
    });
  }
  // Sync call (verified presence-lease-service.ts:383-414) —
  // documented as legacy-compat no-op on 4.0.11-A sid-scoped
  // data; iterates `input.leases ?? []` and gets `[]` on the
  // real init-command.ts:463-466 caller.
  const gcOutcome = gcStalePresenceLeases({
    projectRoot,
    trigger: 'manual'
  });
  printResult(
    io,
    ok('session.primer', {
      projectRoot,
      sessionId: rotation.sessionId,
      rotationOccurred,
      ...(rotation.previousSessionId !== null
        ? { previousSessionId: rotation.previousSessionId }
        : {}),
      clearOutcome,
      gcOutcome: {
        removed: gcOutcome.removed,
        retained: gcOutcome.retained
      }
    }),
    opts.json
  );
  return { exitCode: 0 };
}

export function registerPrimerCommand(program: Command, io: ProgramIO): void {
  const session = program.command('session');
  session
    .command('primer')
    .description(
      'Lightweight SessionStart primer: rotation + presence cleanup. ' +
        'Does NOT bootstrap project scan / materialize settings / install hooks. ' +
        'Idempotent; safe to run on every SessionStart.'
    )
    .requiredOption('--project <path>', 'Project root (must be non-empty canonical path)')
    .option('--json', 'emit a JSON envelope { ok, data } to stdout')
    .action(async (opts: PrimerOptions) => {
      try {
        const { exitCode } = await runPrimerAction(opts, io);
        if (exitCode !== 0) {
          process.exitCode = exitCode;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        printResult(
          io,
          fail(
            'session.primer',
            'PRIMER_FAILED',
            message,
            { project: opts.project },
            ['Verify the project path exists, is writable, and is canonical']
          ),
          opts.json
        );
        process.exitCode = 1;
      }
    });
}
