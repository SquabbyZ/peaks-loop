/**
 * `peaks web open|text|snap|click|shot|metrics` — the S1 command surface.
 *
 * Layer rule (tech-doc §1.1): this file owns commander wiring, option parsing,
 * `--json`, `printResult` and `process.exitCode`. It owns ZERO path
 * construction and ZERO Playwright calls — those live in `src/services/web/*`.
 *
 * The envelope is built once, in `runWebOp`, and that is also the single place
 * `WRAPPED_OPS` is applied — one place, not six. Every page- or daemon-derived
 * string that leaves this process (payload, diagnostic, warning) is capped and
 * wrapped there, because this is the boundary the model actually reads.
 *
 * The pieces live beside this file: the verb table in `web-verb-specs.ts`, the
 * op's envelope in `web-op-runner.ts`, its payload shaping in
 * `web-op-payload.ts`, its refusal texts in `web-op-refusals.ts`, and the
 * daemon-lifecycle verbs in `web-lifecycle-commands.ts`.
 */
import type { Command } from 'commander';

import { addJsonOption, type ProgramIO } from '../cli-helpers.js';
import { registerWebLifecycleCommands } from './web-lifecycle-commands.js';
import { runWebOp } from './web-op-runner.js';
import { PROFILE_OPTION_DESCRIPTION, WEB_VERBS } from './web-verb-specs.js';

export function registerWebCommands(program: Command, io: ProgramIO): void {
  const web = program
    .command('web')
    .description(
      'Bounded, isolated browser access driven by a pinned local Playwright. This is the primary ' +
        'browser path; `peaks playwright` is kept as the MCP fallback. Every artifact lands under ' +
        '.peaks/_runtime/<sessionId>/web/ — never in the project root.'
    );

  for (const verb of WEB_VERBS) {
    const takesArgument = verb.argument !== null;
    let command = web.command(verb.name).description(verb.description);
    if (verb.argument !== null) {
      command = command.argument(verb.argument.name, verb.argument.description);
    }
    if (verb.takesProfile === true) {
      command = command.option('--profile <name>', PROFILE_OPTION_DESCRIPTION);
    }
    command = addJsonOption(command);
    // Commander calls the handler as (…declaredArgs, options, command), so the
    // options object sits at the declared-argument count — not at the end.
    command.action(async (...actionArgs: unknown[]) => {
      const options = actionArgs[takesArgument ? 1 : 0] as
        { json?: boolean; profile?: string } | undefined;
      const rawArgument = actionArgs[0];
      const positional = takesArgument
        ? [typeof rawArgument === 'string' ? rawArgument : undefined]
        : [];
      await runWebOp(
        io,
        verb.op,
        verb.toArgs(positional, options?.profile),
        options?.json === true
      );
    });
  }

  registerWebLifecycleCommands(web, io);
}

// Re-export for tests / external consumers; the implementation moved to
// `web-op-runner.ts` with the split.
export { runWebOp } from './web-op-runner.js';
