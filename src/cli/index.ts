import { CommanderError } from 'commander';
import { createProgram } from './program.js';
import { getErrorMessage } from '../shared/result.js';

createProgram().parseAsync(process.argv).catch((error: unknown) => {
  if (error instanceof CommanderError && error.code === 'commander.version') {
    return;
  }
  // exitOverride() also throws for help; suppress those — the text already went
  // to stdout/stderr, the error envelope confuses newcomers. --help is success
  // (exit 0); a bad command/option is an error (exit 1).
  if (error instanceof CommanderError) {
    if (error.code === 'commander.help' || error.code === 'commander.helpDisplayed') {
      return;
    }
    if (error.code === 'commander.missingArgument' || error.code === 'commander.unknownCommand' || error.code === 'commander.unknownOption') {
      process.exitCode = 1;
      return;
    }
  }

  console.error(JSON.stringify({ // TODO(g2): legacy console.error without envelope — grace: 1 minor release (v2.14.0)
    ok: false,
    command: 'cli',
    code: 'UNHANDLED_ERROR',
    message: getErrorMessage(error),
    data: {},
    warnings: [],
    nextActions: []
  }, null, 2));
  process.exitCode = 1;
});
