/**
 * peaks upgrade * CLI surface — Slice: 1.x → 2.0 umbrella +
 * Slice 3: --detect-1x flag.
 *
 * Per the "one-key completion" + "minimal-user-operation" tenets
 * (2026-06-11), the user's typical upgrade path is
 * `npm i -g peaks-cli@2.0` (the postinstall does the upgrade).
 *
 * The `peaks upgrade --to 2.0` CLI is the manual fallback for
 * when the postinstall is skipped (e.g. CI uses
 * `--ignore-scripts`). The umbrella orchestrates 7 sub-commands:
 * config-migrate / standards-migrate / memory-extract /
 * hooks-install / skill-sync / audit-verify + write-upgrade-record.
 *
 * The `--detect-1x` flag (added in slice 3) is a read-only
 * probe that the peaks-solo skill calls to gate the
 * AskUserQuestion that prompts the 1.x → 2.0 upgrade. The
 * probe returns the JSON envelope from the
 * 1x-detector-service; it does NOT modify any files.
 */
import { Command } from 'commander';
import { runUpgrade } from '../../services/upgrade/upgrade-service.js';
import { detect1xProjectState } from '../../services/upgrade/1x-detector-service.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok, type ResultEnvelope } from '../../shared/result.js';

type UpgradeOptions = {
  project?: string;
  auto?: boolean;
  detect1x?: boolean;
  json?: boolean;
};

export function registerUpgradeCommands(program: Command, io: ProgramIO): void {
  addJsonOption(
    program
      .command('upgrade')
      .description(
        'Upgrade a peaks-cli 1.x project to 2.0. Umbrella that orquestrates 7 sub-commands: config-migrate / standards-migrate / memory-extract / hooks-install / skill-sync / audit-verify + write-upgrade-record. Per the "one-key completion" tenet, prefer letting `npm i -g peaks-cli@2.0` postinstall run this for you. Use `--detect-1x` for a read-only probe (no file writes) that the peaks-solo skill uses to gate the 1.x → 2.0 AskUserQuestion.'
      )
      .option('--to <version>', 'target version (only "2.0" supported)', '2.0')
      .option('--project <path>', 'project root to upgrade (default: cwd)')
      .option('--auto', 'non-interactive: accept soft-fail on any sub-step (used by the postinstall hook)')
      .option('--detect-1x', 'read-only probe: returns the 1.x state as JSON (no file writes); consumed by peaks-solo Step 0.55 to gate the AskUserQuestion')
  ).action((options: UpgradeOptions) => {
    const projectRoot = options.project ?? process.cwd();

    // Branch 1: --detect-1x (read-only probe)
    if (options.detect1x === true) {
      try {
        const state = detect1xProjectState(projectRoot);
        const nextActions: string[] = [];
        if (state.isOneX) {
          nextActions.push(
            `Detected 1.x state. peaks-solo Step 0.55 should present an AskUserQuestion to invoke \`peaks upgrade --to 2.0 --auto --project ${state.projectRoot ?? projectRoot}\`.`
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

    // Branch 2: the umbrella (existing behavior)
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
