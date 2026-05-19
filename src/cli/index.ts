import { CommanderError } from 'commander';
import { createProgram } from './program.js';
import { getErrorMessage } from '../shared/result.js';

createProgram().parseAsync(process.argv).catch((error: unknown) => {
  if (error instanceof CommanderError && error.code === 'commander.version') {
    return;
  }

  console.error(JSON.stringify({
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
