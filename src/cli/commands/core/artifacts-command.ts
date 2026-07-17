import type { Command } from 'commander';
import { createArtifactInitPlan, getArtifactStatus, createGuidedArtifactSetup } from '../../../services/artifacts/artifact-service.js';
import { getArtifactWorkspaceStatus, planArtifactSync } from '../../../services/artifacts/workspace-service.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, failUnsupportedNonDryRun, isArtifactProvider, isArtifactSetupStep, printResult, type ProgramIO } from '../../cli-helpers.js';

export function registerArtifactsCommand(program: Command, io: ProgramIO): void {
  const artifacts = program.command('artifacts').description('Manage intermediate artifact repositories');
  addJsonOption(artifacts.command('status').description('Show artifact repository status')).action((options: { json?: boolean }) => {
    printResult(io, ok('artifacts.status', getArtifactStatus()), options.json);
  });
  addJsonOption(
    artifacts
      .command('init')
      .description('Plan remote-first artifact repository initialization')
      .requiredOption('--provider <provider>', 'artifact provider: github or gitlab')
      .requiredOption('--name <name>', 'remote repository name')
      .option('--path <path>', 'local artifact working copy path', '.peaks-artifacts')
      .option('--dry-run', 'preview without creating repositories or files', true)
      .option('--no-dry-run', 'unsupported: do not create repositories or files from this CLI')
  ).action((options: { provider: string; name: string; path: string; dryRun?: boolean; json?: boolean }) => {
    if (options.dryRun === false) {
      failUnsupportedNonDryRun(io, 'artifacts.init', options.json);
      return;
    }

    if (!isArtifactProvider(options.provider)) {
      printResult(io, fail('artifacts.init', 'UNSUPPORTED_ARTIFACT_PROVIDER', `Unsupported provider ${options.provider}`, {}, ['Use --provider github or --provider gitlab']), options.json);
      process.exitCode = 1;
      return;
    }

    printResult(io, ok('artifacts.init', createArtifactInitPlan({
      provider: options.provider,
      name: options.name,
      localPath: options.path,
      dryRun: true
    })), options.json);
  });
  addJsonOption(
    artifacts
      .command('sync')
      .description('Plan sync between local artifact workspace and remote repository')
      .option('--workspace <id>', 'workspace identifier (uses current if not specified)')
      .option('--dry-run', 'preview sync plan without executing', true)
      .option('--no-dry-run', 'unsupported: do not sync from this CLI')
  ).action((options: { workspace?: string; dryRun?: boolean; json?: boolean }) => {
    if (options.dryRun === false) {
      failUnsupportedNonDryRun(io, 'artifacts.sync', options.json);
      return;
    }
    printResult(io, ok('artifacts.sync', planArtifactSync(options.workspace, true)), options.json);
  });
  addJsonOption(artifacts.command('workspace').description('Show artifact workspace status for current or specified workspace').option('--workspace <id>', 'workspace identifier')).action((options: { workspace?: string; json?: boolean }) => {
    printResult(io, ok('artifacts.workspace', getArtifactWorkspaceStatus(options.workspace)), options.json);
  });
  addJsonOption(artifacts.command('setup').description('Interactive guided artifact repository setup').option('--step <step>', 'start from specific step: detect, configure, validate, complete')).action((options: { step?: string; json?: boolean }) => {
    const requestedStep = options.step;
    const setup = createGuidedArtifactSetup();

    if (requestedStep) {
      if (!isArtifactSetupStep(requestedStep)) {
        printResult(io, fail('artifacts.setup', 'INVALID_ARTIFACT_SETUP_STEP', `Invalid artifact setup step ${requestedStep}`, {}, ['Use one of: detect, configure, validate, complete']), options.json);
        process.exitCode = 1;
        return;
      }
      setup.step = requestedStep;
    }

    printResult(io, ok('artifacts.setup', setup), options.json);
  });
}
