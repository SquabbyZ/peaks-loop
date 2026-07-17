import type { Command } from 'commander';
import { planProxyTest } from '../../../services/proxy/proxy-service.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, failUnsupportedNonDryRun, getErrorMessage, printResult, type ProgramIO } from '../../cli-helpers.js';

export function registerProxyCommand(program: Command, io: ProgramIO): void {
  const proxy = program.command('proxy').description('Manage proxy settings');
  addJsonOption(
    proxy
      .command('test')
      .description('Plan or run a proxy connectivity test')
      .requiredOption('--proxy <url>', 'proxy URL')
      .option('--target <url>', 'target URL', 'https://www.google.com')
      .option('--dry-run', 'only print the planned command', true)
      .option('--no-dry-run', 'unsupported: do not execute connectivity tests from this CLI')
  ).action((options: { proxy: string; target: string; dryRun?: boolean; json?: boolean }) => {
    if (options.dryRun === false) {
      failUnsupportedNonDryRun(io, 'proxy.test', options.json);
      return;
    }

    try {
      const plan = planProxyTest(options.proxy, options.target, true);
      printResult(io, ok('proxy.test', plan), options.json);
    } catch (error) {
      printResult(io, fail('proxy.test', 'INVALID_PROXY', getErrorMessage(error), {}, ['Use a proxy URL starting with http:// or https://']), options.json);
      process.exitCode = 1;
    }
  });
}
