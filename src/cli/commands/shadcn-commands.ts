import { Command } from 'commander';
import { createShadcnInvocation, executeShadcnInvocation } from '../../services/shadcn/shadcn-service.js';
import { fail } from '../../shared/result.js';
import { getErrorMessage, printResult, redactSensitiveErrorMessage, type ProgramIO } from '../cli-helpers.js';

function printShadcnFailure(io: ProgramIO, error: unknown, exitCode = 1): void {
  printResult(
    io,
    fail('shadcn', 'SHADCN_COMMAND_FAILED', redactSensitiveErrorMessage(getErrorMessage(error)), {}, ['Check the shadcn command arguments before retrying']),
    false
  );
  process.exitCode = exitCode;
}

async function runShadcnCommand(io: ProgramIO, args: string[]): Promise<void> {
  try {
    const invocation = createShadcnInvocation({ args });
    const result = await executeShadcnInvocation(invocation);
    const didFail = result.exitCode !== null && result.exitCode !== 0;

    if (result.stdout.length > 0) {
      io.stdout((didFail ? redactSensitiveErrorMessage(result.stdout) : result.stdout).trimEnd());
    }

    if (result.stderr.length > 0) {
      io.stderr((didFail ? redactSensitiveErrorMessage(result.stderr) : result.stderr).trimEnd());
    }

    if (didFail) {
      process.exitCode = result.exitCode;
    }
  } catch (error) {
    printShadcnFailure(io, error);
  }
}

export function registerShadcnCommands(program: Command, io: ProgramIO): void {
  program
    .command('shadcn')
    .description('Run the pinned shadcn CLI bundled with Peaks')
    .allowUnknownOption(true)
    .helpOption(false)
    .argument('<args...>', 'arguments forwarded to shadcn')
    .action((args: string[]) => runShadcnCommand(io, args));
}
