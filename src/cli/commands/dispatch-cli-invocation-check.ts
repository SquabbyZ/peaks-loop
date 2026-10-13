/**
 * Whether the invocations a dispatch prompt names are commands this CLI will
 * accept, with the flags the prompt gives them.
 *
 * A dispatch brief tells a sub-agent which commands to run, and those quotations
 * are prose to every other reader — no gate parses them. A brief naming a flag
 * the command does not declare therefore reaches the sub-agent intact and costs
 * it a failed run, and nothing measures it. This module makes the quotation
 * checkable: each run `./dispatch-cli-invocation-scan.ts` cut out of the prompt
 * is resolved against the registered command tree, and the flags it carries are
 * compared with the ones the resolved command declares.
 *
 * The source of truth is the REGISTERED CLI, never a hand-kept flag table. The
 * caller passes the real root `Command`; declared flags are read off
 * `option.long` / `option.short` and gathered up the parent chain, so a flag an
 * ancestor declares counts as declared. Measured on this CLI: `peaks code
 * context-now --verbose` is accepted and `--verbose` is declared only on the
 * root program, while `peaks worktree auth grant --rid x` is refused — with
 * `error: required option '--operation <op>' not specified` in that form, and
 * with `error: unknown option '--rid'` only once `--operation` and `--reason`
 * are supplied, because commander reports a missing required option first. Both
 * halves were run.
 *
 * The `option.mandatory` distinction recorded in
 * `tests/unit/services/artifacts/artifact-contract-block.test.ts` does NOT apply
 * here. That test asks which flags a command REQUIRES; this one asks which flags
 * a command DECLARES. `option.required` — true for every option that takes a
 * value — is never read, so the trap of reading it in place of `mandatory`
 * cannot arise.
 *
 * WHAT THIS CHECK DOES NOT SEE, each one measured and each one deliberate:
 *
 * - A sentence that NAMES a flag without invoking a command.
 * - A flag COMMANDER itself supplies. `--help` (and its short form) is accepted by
 *   every registered command but is not one of `command.options`, so
 *   `peaks worktree auth grant --help` is reported as an undeclared flag. Measured
 *   while correcting the dispatch block, where a pointer at `--help` was a
 *   candidate rewording and had to be rejected for this reason alone. Recorded
 *   rather than fixed: the same walk up the parent chain is what makes an
 *   inherited flag count as declared, so a targeted excuse for `--help` belongs to
 *   its own slice with its own corpus measurement.
 * - An invocation of a program that is not `peaks` (`git`, `pnpm`, `npx` — this
 *   CLI holds no registry for them), and an invocation that reaches this CLI by
 *   PATH rather than by name. The corpus spells the perf-audit run it ought to
 *   have flagged as `node node_modules/tsx/dist/cli.mjs src/cli/index.ts
 *   perf-audit run --rid …`, with no `peaks` token at all, so no run is
 *   extracted and that line is unchecked today.
 * - Whether a quoted invocation is meant as an INSTRUCTION or as a quotation of
 *   a defect. This is the check's known false-positive class, measured rather
 *   than hidden: a brief that documents a rejected invocation quotes it, and
 *   reads exactly like a brief that instructs it.
 * - A run longer than the scan's bound, a flag spelled past a line break that is
 *   not a continuation, and a capitalised `Peaks`. Each is measured and argued
 *   in `./dispatch-cli-invocation-scan.ts`, where the boundary lives.
 * - `--mode detached` and `--from-dag`, which return before the pipeline that
 *   composes a prompt (`dispatch-commands.ts`), so a brief handed over on either
 *   path is never checked. The in-process path is the one that writes the
 *   dispatch record the corpus is drawn from.
 *
 * TWO DECISIONS ARE RECORDED HERE BECAUSE BOTH ARE MEASUREMENTS, NOT TASTE.
 *
 * 1. The subject is the CALLER's prompt, not the assembled one. Measured over
 *    the 147 dispatch records under `.peaks/_sub_agents/`: 176 undeclared-flag
 *    findings, of which 147 sit inside the machine-injected worktree block this
 *    CLI writes into every prompt and 29 inside caller-authored text. Only the
 *    29 belong to the caller who is warned, and only they make the check
 *    discriminating — a check reading the assembled string warns on every
 *    dispatch, whatever the brief says.
 * 2. A finding WARNS; it does not refuse. Of those 29, ONE is a false positive:
 *    a CORRECT brief (the record for this very slice) that quotes
 *    `peaks request init --rid <rid>` inside a table documenting the defect. A
 *    corpus that cannot be made clean is the branch that must not refuse, and
 *    narrowing the check until it is green would stop it firing on the input it
 *    exists for. The false positive is named rather than engineered away.
 */
import type { Command } from 'commander';

import {
  extractPromptCliInvocations,
  type PromptCliInvocation
} from './dispatch-cli-invocation-scan.js';

/** How many undeclared flags a warning names before it counts the rest instead. */
const FLAG_LIMIT = 8;

/**
 * What the registered CLI said about one invocation. `unknown-command` is a
 * distinct state on purpose: a check that folded "could not resolve" into
 * "clean" would pass every prompt it failed to read.
 */
export type PromptCliVerdict =
  | { readonly kind: 'clean'; readonly command: string }
  | {
      readonly kind: 'undeclared-flag';
      readonly command: string;
      readonly flags: readonly string[];
    }
  | { readonly kind: 'unknown-command'; readonly attempted: string };

/** One invocation and the verdict on it. */
export interface PromptCliFinding {
  readonly text: string;
  readonly verdict: PromptCliVerdict;
}

/** The flag a token carries, or null when the token is an operand rather than an option. */
function optionName(token: string): string | null {
  if (!/^--?[A-Za-z]/.test(token)) return null;
  const equals = token.indexOf('=');
  return equals === -1 ? token : token.slice(0, equals);
}

/** The subcommand of `command` that answers to `name`, matching aliases too. */
function childNamed(command: Command, name: string): Command | undefined {
  return command.commands.find(
    (candidate) => candidate.name() === name || candidate.aliases().includes(name)
  );
}

/** The flags `command` declares, plus every flag its ancestors declare. */
function declaredFlags(command: Command): Set<string> {
  const flags = new Set<string>();
  let current: Command | null = command;
  while (current !== null) {
    for (const option of current.options) {
      if (option.long !== undefined) flags.add(option.long);
      if (option.short !== undefined) flags.add(option.short);
    }
    current = current.parent;
  }
  return flags;
}

/**
 * Resolve one invocation against `root` and compare its flags with the ones the
 * resolved command declares. Operands stop the descent; options are skipped
 * during it, since a flag may sit between two subcommand words.
 */
export function checkPromptCliInvocation(
  invocation: PromptCliInvocation,
  root: Command
): PromptCliVerdict {
  const path: string[] = [];
  let current = root;
  for (const token of invocation.tokens) {
    if (optionName(token) !== null) continue;
    const next = childNamed(current, token);
    if (next === undefined) break;
    path.push(token);
    current = next;
  }
  if (path.length === 0) {
    return { kind: 'unknown-command', attempted: invocation.tokens[0] ?? '' };
  }
  const declared = declaredFlags(current);
  const flags: string[] = [];
  for (const token of invocation.tokens) {
    const flag = optionName(token);
    if (flag !== null && !declared.has(flag)) flags.push(flag);
  }
  if (flags.length > 0) return { kind: 'undeclared-flag', command: path.join(' '), flags };
  return { kind: 'clean', command: path.join(' ') };
}

/** Every invocation `text` carries, each with the verdict on it. */
export function checkPromptCliInvocations(text: string, root: Command): PromptCliFinding[] {
  return extractPromptCliInvocations(text).map((invocation) => ({
    text: invocation.text,
    verdict: checkPromptCliInvocation(invocation, root)
  }));
}

/** The warning list a dispatch envelope carries for the prompt it is handing over. */
export function cliInvocationWarnings(text: string, root: Command): string[] {
  const warnings: string[] = [];
  for (const { text: quoted, verdict } of checkPromptCliInvocations(text, root)) {
    if (verdict.kind === 'undeclared-flag') {
      const rest = verdict.flags.length - FLAG_LIMIT;
      const named = verdict.flags
        .slice(0, FLAG_LIMIT)
        .map((flag) => `\`${flag}\``)
        .join(', ');
      const flags = rest > 0 ? `${named} (and ${rest} more)` : named;
      warnings.push(
        `PROMPT_CLI_FLAG_NOT_DECLARED: \`${quoted}\` — \`peaks ${verdict.command}\` declares no ${flags}.`
      );
    } else if (verdict.kind === 'unknown-command') {
      warnings.push(
        `PROMPT_CLI_COMMAND_NOT_FOUND: \`${quoted}\` — no registered command resolves from ` +
          `\`${verdict.attempted}\`.`
      );
    }
  }
  return warnings;
}
