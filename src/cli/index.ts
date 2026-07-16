import { CommanderError } from 'commander';
import { createProgram } from './program.js';
import { getErrorMessage } from '../shared/result.js';

// D-013 wrapper exit-code fix (PART 2): Commander's `--help` short-circuit
// fires BEFORE `commander.unknownCommand` is raised, so `peaks xxx --help`
// (where `xxx` is not a registered command) prints the help banner and
// exits 0 instead of 1. Detect this case BEFORE Commander runs by scanning
// `process.argv` for a non-option positional token. If present AND
// `--help` is also present, the user asked for help on an unknown command
// — emit `COMMAND_NOT_FOUND` envelope + exit 1.
//
// This pre-check is intentionally conservative: only fires when BOTH a
// positional token AND `--help`/`-h` are present. Bare `--help` (no
// positional) is legitimate help → exit 0. Positional without `--help`
// is handled by the root `.action()` in `program.ts`.
const argv = process.argv.slice(2);
const hasHelp = argv.some((arg) => arg === '--help' || arg === '-h');
const firstPositional = argv.find((arg) => !arg.startsWith('-'));
if (hasHelp && firstPositional !== undefined) {
  // Defer the check by 0ms so Commander's own help handler runs first
  // (it will print help text + try to exit 0). We then override.
  setImmediate(() => {
    console.error(JSON.stringify({ // TODO(g2): legacy console.error without envelope — grace: 1 minor release (v2.14.0)
      ok: false,
      command: 'cli',
      code: 'COMMAND_NOT_FOUND',
      message: `Unknown command: ${firstPositional}. Run \`peaks --help\` for available commands.`,
      data: { argv: firstPositional, combinedWithHelp: true },
      warnings: [],
      nextActions: ['Run `peaks --help` to list available commands.']
    }, null, 2));
    process.exit(1);
  });
}

createProgram().parseAsync(process.argv).catch((error: unknown) => {
  if (error instanceof CommanderError && error.code === 'commander.version') {
    return;
  }
  // D-013 wrapper exit-code fix: distinguish "bare `peaks --help` /
  // `peaks help <cmd>`" (legitimate help, exit 0) from
  // "`peaks <unknown> --help`" (user typed a non-existent command,
  // even if they added --help, the command itself is invalid → exit 1).
  // Commander only emits `commander.helpDisplayed` for the LEGITIMATE
  // help path (bare `--help` or a registered subcommand's help). For
  // unknown commands, Commander throws `commander.unknownCommand`
  // BEFORE the help text is rendered, so we route that case to the
  // unknownCommand branch below. This preserves the historical behavior
  // for valid help while fixing the unknown-command exit code.
  if (error instanceof CommanderError) {
    if (error.code === 'commander.help' || error.code === 'commander.helpDisplayed') {
      return;
    }
    if (error.code === 'commander.missingArgument' || error.code === 'commander.unknownCommand' || error.code === 'commander.unknownOption') {
      // Emit a `COMMAND_NOT_FOUND` JSON envelope for the unknown-command
      // path. The error text already went to stderr via Commander's
      // default handler; we add a structured envelope for LLM-side
      // consumers (Human-NL-Choice-Only: don't tell the human to type
      // a CLI verb — say what the LLM can coordinate).
      console.error(JSON.stringify({ // TODO(g2): legacy console.error without envelope — grace: 1 minor release (v2.14.0)
        ok: false,
        command: 'cli',
        code: 'COMMAND_NOT_FOUND',
        message: getErrorMessage(error),
        data: {},
        warnings: [],
        nextActions: ['Run `peaks --help` to list available commands.']
      }, null, 2));
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
