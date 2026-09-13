import { CommanderError } from 'commander';
import { createProgram } from './program.js';
import { getErrorMessage } from 'peaks-loop-shared/result';

import { printErrorEnvelope, type ProgramIO } from './cli-helpers.js';

const defaultIo: ProgramIO = {
  stdout: (text) => process.stdout.write(`${text}\n`),
  stderr: (text) => process.stderr.write(`${text}\n`)
};

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
//
// Fix-5 (2026-07-26): skip the pre-check when the first positional token
// matches a REGISTERED subcommand. `peaks slice --help` is legitimate
// help on a registered command (slice IS in the program.commands list) —
// the prior blind pre-check was a false positive that printed
// `COMMAND_NOT_FOUND` + exit 1 alongside the slice help banner. We
// still catch true unknowns (`peaks unknown-cmd --help`): `firstPositional`
// won't be in the registered set, so the pre-check fires and exits 1.
const argv = process.argv.slice(2);
const hasHelp = argv.some((arg) => arg === '--help' || arg === '-h');
const firstPositional = argv.find((arg) => !arg.startsWith('-'));
const program = createProgram();
/**
 * The subcommand path the caller actually invoked, in the same tokens they
 * typed (`release canary`). Derived from the registered command tree by
 * consuming leading non-`-` argv tokens, so it never disagrees with what
 * Commander dispatched on.
 *
 * Commander's `CommanderError` carries a code and a message but no command
 * reference — `missingMandatoryOptionValue` is raised by the leaf command and
 * throws out of `parseAsync` with nothing naming it. Without this walk the
 * missing-option envelope could only say `command: "cli"`, which is the field
 * the caller needs to act on.
 */
function resolveInvokedCommandPath(): string {
  let cmd: (typeof program.commands)[number] | typeof program = program;
  const parts: string[] = [];
  for (const token of argv) {
    if (token.startsWith('-')) break;
    const next = cmd.commands.find((c) => c.name() === token || c.aliases().includes(token));
    if (next === undefined) break;
    parts.push(next.name());
    cmd = next;
  }
  return parts.length > 0 ? parts.join(' ') : program.name();
}

if (hasHelp && firstPositional !== undefined) {
  const registered = new Set(program.commands.map((c) => c.name()));
  if (!registered.has(firstPositional)) {
    // Defer the check by 0ms so Commander's own help handler runs first
    // (it will print help text + try to exit 0). We then override.
    setImmediate(() => {
      printErrorEnvelope(
        defaultIo,
        'cli',
        'COMMAND_NOT_FOUND',
        `Unknown command: ${firstPositional}. Run \`peaks --help\` for available commands.`,
        { argv: firstPositional, combinedWithHelp: true },
        ['Run `peaks --help` to list available commands.']
      );
      process.exit(1);
    });
  }
}

program.parseAsync(process.argv).catch((error: unknown) => {
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
    if (error.code === 'commander.missingMandatoryOptionValue') {
      // A `.requiredOption()` the caller did not supply. Commander raises this
      // as a plain `Error`-shaped `CommanderError`, so the `.catch()` below used
      // to file it under `UNHANDLED_ERROR` — "you left out an argument" reported
      // as a crash, with empty `nextActions` and no way to see WHICH option or
      // what values it takes. The flags string Commander formats carries both
      // (`--percent <10|50>`), so it is worth extracting rather than
      // paraphrasing: it is the option's own declaration.
      const message = getErrorMessage(error);
      const option = /required option '([^']+)'/.exec(message)?.[1];
      const invoked = resolveInvokedCommandPath();
      printErrorEnvelope(
        defaultIo,
        invoked,
        'MISSING_REQUIRED_OPTION',
        option === undefined
          ? message
          : `Missing required option '${option}' for \`peaks ${invoked}\`.`,
        { option: option ?? null },
        [
          option === undefined
            ? `Run \`peaks ${invoked} --help\` to see the options this command requires.`
            : `Supply ${option} — it is required, so the command has no default for it.`,
          `Run \`peaks ${invoked} --help\` for the option's accepted values and its siblings.`
        ]
      );
      return;
    }
    if (error.code === 'commander.missingArgument' || error.code === 'commander.unknownCommand' || error.code === 'commander.unknownOption') {
      // Emit a `COMMAND_NOT_FOUND` JSON envelope for the unknown-command
      // path. The error text already went to stderr via Commander's
      // default handler; we add a structured envelope for LLM-side
      // consumers (Human-NL-Choice-Only: don't tell the human to type
      // a CLI verb — say what the LLM can coordinate).
      printErrorEnvelope(
        defaultIo,
        'cli',
        'COMMAND_NOT_FOUND',
        getErrorMessage(error),
        {},
        ['Run `peaks --help` to list available commands.']
      );
      process.exitCode = 1;
      return;
    }
  }

  printErrorEnvelope(
    defaultIo,
    'cli',
    'UNHANDLED_ERROR',
    getErrorMessage(error),
    {},
    []
  );
  process.exitCode = 1;
});
