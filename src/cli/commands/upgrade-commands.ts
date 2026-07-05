/**
 * peaks upgrade * CLI surface — Slice: 1.x → 2.0 umbrella +
 * Slice 3: --detect-1x flag.
 *
 * Per the "one-key completion" + "minimal-user-operation" tenets
 * (2026-06-11), the user's typical upgrade path is
 * `npm i -g peaks-loop@2.0` (the postinstall does the upgrade).
 *
 * The `peaks upgrade --to 2.0` CLI is the manual fallback for
 * when the postinstall is skipped (e.g. CI uses
 * `--ignore-scripts`). The umbrella orchestrates 7 sub-commands:
 * config-migrate / standards-migrate / memory-extract /
 * hooks-install / skill-sync / audit-verify + write-upgrade-record.
 *
 * The `--detect-1x` flag (added in slice 3) is a read-only
 * probe that the peaks-code skill calls to gate the
 * AskUserQuestion that prompts the 1.x → 2.0 upgrade. The
 * probe returns the JSON envelope from the
 * 1x-detector-service; it does NOT modify any files.
 */
import { Command } from 'commander';
import { runUpgrade } from '../../services/upgrade/upgrade-service.js';
import { detect1xProjectState } from '../../services/upgrade/1x-detector-service.js';
import { initWorkspace } from '../../services/workspace/workspace-service.js';
import { ensureSessionWithRotation } from '../../services/session/session-manager.js';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok, type ResultEnvelope } from '../../shared/result.js';

type UpgradeOptions = {
  project?: string;
  auto?: boolean;
  detect1x?: boolean;
  applyInit?: boolean;
  json?: boolean;
};

export function registerUpgradeCommands(program: Command, io: ProgramIO): void {
  addJsonOption(
    program
      .command('upgrade')
      .description(
        'Upgrade a peaks-loop 1.x project to 2.0. Umbrella that orquestrates 7 sub-commands: config-migrate / standards-migrate / memory-extract / hooks-install / skill-sync / audit-verify + write-upgrade-record. Per the "one-key completion" tenet, prefer letting `npm i -g peaks-loop@2.0` postinstall run this for you. Use `--detect-1x` for a read-only probe (no file writes) that the peaks-code skill uses to gate the 1.x → 2.0 AskUserQuestion.'
      )
      .option('--to <version>', 'target version (only "2.0" supported)', '2.0')
      .option('--project <path>', 'project root to upgrade (default: cwd)')
      .option('--auto', 'non-interactive: accept soft-fail on any sub-step (used by the postinstall hook)')
      .option('--detect-1x', 'read-only probe: returns the 1.x state as JSON (no file writes); consumed by peaks-code Step 0.55 to gate the AskUserQuestion')
      .option('--apply-init', 'slice 4 (slice 2026-06-13-selfheal-claude-settings-template): run initWorkspace so the drift-driven self-heal fires on the consumer-project .claude/settings.local.json and the offline .peaks/.claude-settings-template.json. Idempotent. Use after a peaks-loop version bump if you do not otherwise re-run init. Mutually exclusive with --detect-1x.')
  ).action(async (options: UpgradeOptions) => {
    const projectRoot = options.project ?? process.cwd();

    // Branch 1: --detect-1x (read-only probe)
    if (options.detect1x === true) {
      try {
        const state = detect1xProjectState(projectRoot);
        const nextActions: string[] = [];
        if (state.isOneX) {
          nextActions.push(
            `Detected 1.x state. peaks-code Step 0.55 should present an AskUserQuestion to invoke \`peaks upgrade --to 2.0 --auto --project ${state.projectRoot ?? projectRoot}\`.`
          );
        } else {
          nextActions.push('No 1.x state detected. Proceed with the standing 2.0 layout.');
        }
        const envelope: ResultEnvelope<typeof state> = ok(
          'upgrade.detect-1x',
          state,
          [],
          nextActions
        );
        printResult(io, envelope, options.json);
      } catch (error) {
        const message = getErrorMessage(error);
        printResult(
          io,
          fail('upgrade.detect-1x', 'DETECT_1X_FAILED', message, { isOneX: false, signals: [], projectRoot: null, configPath: null }, [message]),
          options.json
        );
        process.exitCode = 1;
      }
      return;
    }

    // Branch 2: --apply-init (slice 4 — slice 2026-06-13-selfheal-claude-settings-template).
    //
    // The drift-driven self-heal inside initWorkspace only fires when
    // the user invokes init. After a peaks-loop version bump, users who
    // never re-run init are stuck with stale templates until they do.
    // This flag is the post-bump escape hatch: it triggers init for them.
    //
    // We do NOT pass --session-id (the CLI auto-generates / reuses an
    // existing binding). We do NOT pass --no-claude-hooks (the goal is to
    // bring the project to the current peaks-loop baseline, including the
    // consumer-project hook).
    if (options.applyInit === true) {
      try {
        const canonicalRoot = resolveCanonicalProjectRoot(projectRoot);
        // Match the workspace-init CLI's pattern: resolve the session id
        // (auto-generate / reuse binding / rotate on outer-mismatch)
        // BEFORE calling initWorkspace. initWorkspace itself validates
        // the session id and does NOT auto-generate, so we have to do
        // the rotation-aware resolution here.
        const sessionResolution = await ensureSessionWithRotation(canonicalRoot, {
          skipRotateOnOuterMismatch: false
        });
        const result = await initWorkspace({
          projectRoot: canonicalRoot,
          sessionId: sessionResolution.sessionId,
          allowSessionRebind: false
        });
        const nextActions: string[] = [];
        // Surface the same self-heal messaging that workspace-init uses.
        if (result.claudeSettings.offlineTemplate.action === 'refreshed') {
          nextActions.push(
            `Self-healed .peaks/.claude-settings-template.json (action: refreshed) — ` +
              'the offline recovery anchor now matches the current peaks-loop template.'
          );
          nextActions.push(
            '⚠️  If you had manually edited .peaks/.claude-settings-template.json, ' +
              'those edits have been overwritten by the self-heal.'
          );
        } else if (result.claudeSettings.offlineTemplate.action === 'written') {
          nextActions.push(
            'Wrote .peaks/.claude-settings-template.json (action: written) — ' +
              'the offline recovery anchor is now in place.'
          );
        }
        if (result.claudeSettings.action === 'refreshed') {
          nextActions.push(
            `Refreshed .claude/settings.local.json (action: refreshed) — ` +
              'the consumer-project hook now matches the current peaks-loop template. ' +
              'Restart Claude Code so the hooks take effect.'
          );
        } else if (result.claudeSettings.action === 'written') {
          nextActions.push(
            'Wrote .claude/settings.local.json (action: written) — ' +
              'the [Fact-Forcing Gate] bypass is now in effect. Restart Claude Code so the hooks take effect.'
          );
        }
        const envelope: ResultEnvelope<typeof result> = ok(
          'upgrade.apply-init',
          result,
          [],
          nextActions
        );
        printResult(io, envelope, options.json);
      } catch (error) {
        const message = getErrorMessage(error);
        printResult(
          io,
          fail('upgrade.apply-init', 'APPLY_INIT_FAILED', message, { applied: false }, [message]),
          options.json
        );
        process.exitCode = 1;
      }
      return;
    }

    // Branch 3: the umbrella (existing behavior)
    try {
      const result = runUpgrade({ projectRoot, auto: options.auto === true });
      const nextActions: string[] = [...result.nextActions];
      if (result.failedCount > 0) {
        nextActions.unshift(
          `${result.failedCount} sub-step(s) failed. Re-run \`peaks upgrade --to 2.0\` to retry.`
        );
      }
      if (result.upgradeRecordPath !== null) {
        nextActions.push(`Upgrade record written: ${result.upgradeRecordPath}`);
      }
      const envelope: ResultEnvelope<typeof result> = ok(
        'upgrade',
        result,
        [...result.warnings],
        nextActions
      );
      printResult(io, envelope, options.json);
      if (result.failedCount > 0) {
        process.exitCode = 1;
      }
    } catch (error) {
      const message = getErrorMessage(error);
      printResult(
        io,
        fail('upgrade', 'UPGRADE_FAILED', message, { applied: false }, [message]),
        options.json
      );
      process.exitCode = 1;
    }
  });
}
