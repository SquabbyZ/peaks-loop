// tests/unit/services/context/dispatch-l1-worktree-block-invocations.test.ts
//
// The L1 worktree-governance block is injected into EVERY sub-agent dispatch and
// prints the commands a sub-agent may use. Nothing checked that they are commands
// this CLI ACCEPTS.
//
// Measured before this slice (2026-10-13), both printed invocations were wrong:
//   `peaks worktree spawn --rid <rid> --ttl <duration> --purpose <text>`
//   `peaks worktree auth grant --rid <id> --reason <text> --ttl <5m>`
// The auth-grant line named `--rid` (undeclared), omitted the required
// `--operation`, and gave `--ttl` a unit it does not take. The spawn line named
// only real flags — and still could not run, because `--role` is required.
//
// WHY IT SURVIVED — three questions read as one. "Does the flag exist?" and "does
// the line run?" are different checks: the spawn line passes the first (the 9.31
// checker reads it CLEAN) and fails the second. `BINDING_RULE_TOKENS` asked a
// third, and a presence test is a CONSISTENCY test: it pins the block and the token
// to each other and says nothing about whether the quoted command runs.
//
// WHAT THE ARMS CHECK, exactly — two earlier revisions of this header claimed more
// than the code did, so the list is exhaustive and the gaps are named after it.
// For every invocation the block prints: (1) flag EXISTENCE; (2) MANDATORY PRESENCE;
// (3) OPTION SHAPE per occurrence — each option is followed by the value its
// declaration asks for, a valueless flag is not followed by an operand, and no stray
// operand is left over, so a repeated flag is checked twice; (4) ENUM MEMBERSHIP —
// every literal operation value the block prints is one the declaration allows.
//
// WHAT THEY CANNOT SEE: nothing here spawns the CLI, so a well-SHAPED invocation can
// still be refused by the command's own validation (an empty `--reason`, a `--ttl`
// of zero). Every value is a placeholder or an enum member checked against the
// declaration, never against a run.
//
// THE HAND-COPIED LITERALS: the three pre-fix inputs the red arms are built from
// (`OLD_FALLBACK_LINE`, `OLD_SPAWN_LINE`, `VALUE_ONLY_DEFECT_LINE`, which no longer
// exist to be derived from); the two token lists in the `render`/mirror case below
// (`BINDING_RULE_TOKENS` and the command cut out of the block are derived); the four
// malformed lines in the shape case and the `not-a-real-op` substitution; and the
// structural counts. Everything else is read off the block or the registered command.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Command, Option } from 'commander';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { createProgram } from '~/src/cli/program';
import {
  checkPromptCliInvocation,
  checkPromptCliInvocations,
  cliInvocationWarnings
} from '~/src/cli/commands/dispatch-cli-invocation-check';
import {
  extractPromptCliInvocations,
  type PromptCliInvocation
} from '~/src/cli/commands/dispatch-cli-invocation-scan';
import {
  BINDING_RULE_TOKENS,
  L1_WORKTREE_GOVERNANCE_BLOCK
} from '~/src/services/context/build-dispatch-system-prompt';

declareDimensions('tests/unit/services/context/dispatch-l1-worktree-block-invocations.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/**
 * The surfaces that repeat the block or its commands without being the block:
 * three bullet-for-bullet mirrors, and two files the census caught printing the
 * spawn command in prose. `MIRRORS` is asserted line for line; `REPEATERS` at the
 * granularity it shares. A THIRD prose surface added later would go unchecked.
 */
const SURFACES: readonly { readonly path: string; readonly unit: 'line' | 'command' }[] = [
  {
    path: join(repoRoot, 'skills', 'bee', 'peaks-rd', 'references', 'rd-sub-agent-dispatch.md'),
    unit: 'line'
  },
  {
    path: join(repoRoot, 'skills', 'bee', 'peaks-qa', 'references', 'qa-sub-agent-dispatch.md'),
    unit: 'line'
  },
  { path: join(repoRoot, 'skills', 'bee', 'peaks-ui', 'SKILL.md'), unit: 'line' },
  { path: join(repoRoot, 'skills', 'peaks-code', 'SKILL.md'), unit: 'command' },
  {
    path: join(repoRoot, 'skills', 'peaks-code', 'references', 'worktree-governance.md'),
    unit: 'command'
  }
];

/** The pre-fix auth-grant bullet, verbatim — the input the check must reject. */
const OLD_FALLBACK_LINE =
  '- until then: `peaks worktree auth grant --rid <id> --reason <text> --ttl <5m>`';

/** The pre-fix spawn bullet, verbatim — the case that shows the two questions apart. */
const OLD_SPAWN_LINE =
  '- `peaks worktree spawn --rid <rid> --ttl <duration> --purpose <text>` (after rid-L2-extended ships)';

/**
 * The VALUE-only defect, verbatim from the repair round's reviewer: the pre-fix
 * `--ttl` half restored with nothing else wrong. The CLI ACCEPTS it and writes a
 * grant with `ttlMs: 5`, five milliseconds wide.
 */
const VALUE_ONLY_DEFECT_LINE =
  '- until then: `peaks worktree auth grant --operation <op> --reason <text> --ttl 5m`';

let cli: Command;

beforeAll(() => {
  cli = createProgram();
});

/** A token that is an option rather than an operand. */
function isOption(token: string): boolean {
  return /^--?[A-Za-z]/.test(token);
}

/**
 * The invocations the block PRINTS — every extracted run carrying at least one flag.
 * A run with no flag is a PROSE MENTION and is never checked, which is what bounds
 * the census in the RD request: its 98 mentions include instruction-shaped prose.
 */
function printedInvocations(): readonly {
  readonly line: string;
  readonly invocation: PromptCliInvocation;
}[] {
  return L1_WORKTREE_GOVERNANCE_BLOCK.split('\n').flatMap((line) =>
    extractPromptCliInvocations(line)
      .filter((invocation) => invocation.tokens.some(isOption))
      .map((invocation) => ({ line, invocation }))
  );
}

/** The block line that prints `invocation`. */
function lineOf(invocation: PromptCliInvocation): string {
  const found = printedInvocations().find((entry) => entry.invocation.text === invocation.text);
  if (found === undefined) throw new Error(`the block prints no line for: ${invocation.text}`);
  return found.line;
}

/** The `command` named by `path` in the registered tree, or a loud failure. */
function registeredCommandAt(path: string, root: Command): Command {
  let current: Command = root;
  for (const part of path.split(' ')) {
    const next = current.commands.find(
      (candidate) => candidate.name() === part || candidate.aliases().includes(part)
    );
    if (next === undefined) throw new Error(`no registered command answers to '${part}'`);
    current = next;
  }
  return current;
}

/** The command `invocation` resolves to, or a loud failure — never a silent skip. */
function resolveCommand(invocation: PromptCliInvocation, root: Command): Command {
  const verdict = checkPromptCliInvocation(invocation, root);
  if (verdict.kind === 'unknown-command') {
    throw new Error(`the block prints a command that does not resolve: ${verdict.attempted}`);
  }
  return registeredCommandAt(verdict.command, root);
}

/** The single `peaks …` run `line` carries. Throws rather than returning nothing. */
function soleInvocation(line: string): PromptCliInvocation {
  const invocations = extractPromptCliInvocations(line);
  const [first] = invocations;
  if (first === undefined || invocations.length !== 1) {
    throw new Error(`expected exactly one peaks run in: ${line}`);
  }
  return first;
}

/** Every option `command` or an ancestor declares, keyed by long and short name. */
function optionsUpward(command: Command): Map<string, Option> {
  const found = new Map<string, Option>();
  let current: Command | null = command;
  while (current !== null) {
    for (const option of current.options) {
      if (option.long !== undefined) found.set(option.long, option);
      if (option.short !== undefined) found.set(option.short, option);
    }
    current = current.parent;
  }
  return found;
}

/**
 * The VALUE a declaration asks for, as written: `<ms>` from `--ttl <ms>`, and
 * `<text>` from `-q, --query <text>`. Taken from the END of the flags string, so a
 * short alias in front is irrelevant — comparing the whole string would read a
 * correctly spelled `--query <text>` as wrong, because the declared string carries
 * `-q,` too.
 */
function declaredValue(option: Option): string | null {
  return /(<[^>]+>|\[[^\]]+\])\s*$/.exec(option.flags)?.[1] ?? null;
}

/**
 * The flags `command` declares as MANDATORY — `option.mandatory`, the one
 * `requiredOption` sets. `option.required` is true for every flag that takes a
 * value and is never read here.
 */
function mandatoryFlags(command: Command): string[] {
  return command.options
    .filter((option) => option.mandatory === true)
    .flatMap((option) => (option.long === undefined ? [] : [option.long]));
}

/** The operation values the registered `--operation` help declares. */
function declaredOperations(command: Command): string[] {
  const description = command.options.find((option) => option.long === '--operation')?.description;
  const [, values] = (description ?? '').split(':');
  return (values ?? '')
    .split('|')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

/**
 * The mandatory flags of the command `invocation` resolves to that it omits — the
 * half the 9.31 checker cannot see, since a required flag that is simply MISSING
 * reads as clean.
 */
function missingMandatoryFlags(invocation: PromptCliInvocation, root: Command): string[] {
  const command = resolveCommand(invocation, root);
  return mandatoryFlags(command).filter((flag) => !invocation.tokens.includes(flag));
}

/**
 * Every way `invocation`'s option SHAPE departs from the registered declarations,
 * judged per occurrence: a value-taking option must be followed by the value its
 * declaration asks for (so `--ttl 5m` fails, and so does a SECOND `--operation`
 * when only the first is well formed); a valueless flag must not be followed by an
 * operand; and any token no option consumed is a stray operand. An option the
 * command does not declare is not reported here — that is the checker's
 * `undeclared-flag`, and dividing the two keeps each arm able to say what it found.
 */
function optionShapeProblems(invocation: PromptCliInvocation, root: Command): string[] {
  const tokens = [...invocation.tokens];
  const problems: string[] = [];

  // The command path is the leading chain of subcommand words, ending at the first
  // token that is not a child of the command reached so far.
  let current: Command = root;
  const consumed = new Set<number>();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? '';
    if (isOption(token)) continue;
    const next = current.commands.find(
      (candidate) => candidate.name() === token || candidate.aliases().includes(token)
    );
    if (next === undefined) break;
    consumed.add(index);
    current = next;
  }
  if (consumed.size === 0) return [`no registered command resolves from '${tokens[0] ?? ''}'`];

  const declared = optionsUpward(current);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? '';
    if (!isOption(token) || consumed.has(index)) continue;
    const name = token.split('=')[0] ?? token;
    const option = declared.get(name);
    if (option === undefined) continue;
    const following = tokens[index + 1];
    const value = declaredValue(option);
    if (value === null) {
      if (following !== undefined && !isOption(following)) {
        problems.push(`${name} takes no value, but '${following}' follows it`);
      }
      continue;
    }
    if (following !== value) {
      problems.push(`${name} expects ${value}, but '${following ?? 'nothing'}' follows it`);
      continue;
    }
    consumed.add(index + 1);
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? '';
    if (consumed.has(index) || isOption(token)) continue;
    problems.push(`unexpected operand '${token}'`);
  }
  return problems;
}

/** The backticked tokens on `line` that are literal values — not the command, not a placeholder. */
function printedLiteralValues(line: string): string[] {
  return [...line.matchAll(/`([^`]+)`/g)]
    .map((match) => match[1] ?? '')
    .filter((span) => !span.includes(' ') && !span.includes('<'));
}

describe('behavior — every command the block prints is one the CLI accepts', () => {
  it('when the block is checked, should report no undeclared flag on any invocation it carries', () => {
    // given: the injected block, and the registered CLI that parses it
    // when:  every `peaks …` run in the block is resolved against that tree
    const invocations = checkPromptCliInvocations(L1_WORKTREE_GOVERNANCE_BLOCK, cli);
    // then:  nothing is undeclared, and at least one run was read — an extractor
    //        that found nothing must not pass as "all clean"
    expect(invocations.length).toBeGreaterThan(0);
    expect(invocations.filter((f) => f.verdict.kind === 'undeclared-flag')).toEqual([]);
  });

  it('when each printed invocation is resolved, should carry every flag its command requires', () => {
    // given: the block's printed invocations and the CLI's registered commands
    const printed = printedInvocations();
    const runsInBlock = extractPromptCliInvocations(L1_WORKTREE_GOVERNANCE_BLOCK);
    // when:  each one's mandatory flags are read off ITS resolved command
    const missing = printed.flatMap((e) => missingMandatoryFlags(e.invocation, cli));
    // then:  every printed invocation carries its own mandatory set, and the
    //        structural counts stop a resolver from passing by resolving nothing
    expect(runsInBlock.length).toBe(2);
    expect(printed.length).toBe(2);
    expect(new Set(printed.map((e) => resolveCommand(e.invocation, cli).name()))).toEqual(
      new Set(['spawn', 'grant'])
    );
    expect(missing).toEqual([]);
  });

  it('when every printed invocation is walked, should match the option shape its declaration asks for', () => {
    // given: the printed invocations
    const printed = printedInvocations();
    // when:  each is walked per occurrence
    // then:  the shipped lines are shaped correctly, and the walk had something to bite on
    expect(printed.length).toBeGreaterThan(0);
    for (const { invocation } of printed) {
      expect(optionShapeProblems(invocation, cli), lineOf(invocation)).toEqual([]);
    }
  });

  it('when a line is malformed four ways, should report each one', () => {
    // given: four inputs the flag-LEVEL arms all read as clean — the last three
    //        named as blind spots by the repair reviews
    const shapes: ReadonlyArray<readonly [string, string]> = [
      [VALUE_ONLY_DEFECT_LINE, '--ttl'],
      ['`peaks worktree auth grant bogus --operation <op> --reason <text>`', 'bogus'],
      ['`peaks worktree auth grant --operation <op> --reason <text> --multi bogus`', '--multi'],
      [
        '`peaks worktree auth grant --operation <op> --operation not-a-real-op --reason <text>`',
        '--operation'
      ]
    ];
    // when:  each line is resolved and walked
    for (const [line, expected] of shapes) {
      const problems = optionShapeProblems(soleInvocation(line), cli);
      // then:  the arm names the offending token, and the flag level stays silent —
      //        which is why this arm exists
      expect(problems.join('\n'), line).toContain(expected);
      expect(cliInvocationWarnings(line, cli), `${line} :: flag level`).toEqual([]);
    }
  });

  it('when the value-only defect is checked, should be silent at flag level and loud at shape level', () => {
    // given: the pre-fix `--ttl` half, restored with nothing else wrong
    const invocation = soleInvocation(VALUE_ONLY_DEFECT_LINE);
    // when:  all three layers are asked about the same input
    const shape = optionShapeProblems(invocation, cli);
    // then:  the two flag-level arms are SILENT — this is the input an earlier
    //        revision read as fully green — and the shape arm names the option
    expect(cliInvocationWarnings(VALUE_ONLY_DEFECT_LINE, cli)).toEqual([]);
    expect(missingMandatoryFlags(invocation, cli)).toEqual([]);
    expect(shape.join('\n')).toContain('--ttl expects <ms>');
  });

  it('when the pre-fix lines are checked, should report the flag each one got wrong', () => {
    // given: both bullets exactly as they read before this slice — the real input
    // when:  the checker and the completeness check are run over each
    // then:  the auth-grant line fails BOTH halves, the spawn line only the
    //        completeness half, which is why the checker called it clean
    expect(cliInvocationWarnings(OLD_FALLBACK_LINE, cli)).toEqual([
      expect.stringContaining('`--rid`')
    ]);
    expect(missingMandatoryFlags(soleInvocation(OLD_FALLBACK_LINE), cli)).toEqual(['--operation']);
    expect(cliInvocationWarnings(OLD_SPAWN_LINE, cli)).toEqual([]);
    expect(missingMandatoryFlags(soleInvocation(OLD_SPAWN_LINE), cli)).toEqual(['--role']);
  });

  it('when an option carries a short alias, should accept its correctly spelled long form', () => {
    // given: `peaks skill search` declares `-q, --query <text>`, so its declared
    //        string is NOT the long form and a whole-string comparison would call
    //        the long form wrong. The tree has six short aliases (-v/-V/-q/-t/-d/-l)
    //        and none is on a command the block prints — luck, not design.
    const query = registeredCommandAt('skill search', cli).options.find(
      (option) => option.long === '--query'
    ) as Option;
    // when:  the long form is walked
    const problems = optionShapeProblems(
      soleInvocation('`peaks skill search --query <text>`'),
      cli
    );
    // then:  nothing is reported
    expect(query.flags).toContain('-q,');
    expect(declaredValue(query)).toBe('<text>');
    expect(problems).toEqual([]);
  });
});

describe('render — the block still carries the text the token registry pins', () => {
  it('when the binding-rule tokens are read, should register every printed invocation verbatim', () => {
    // given: the commands cut out of the block itself
    const commands = printedInvocations().map((entry) => `\`${entry.invocation.text}\``);
    // when:  the token registry is searched for each of them
    // then:  correcting one bullet and not the other reddens here
    expect(commands.length).toBe(2);
    for (const command of commands) {
      expect(BINDING_RULE_TOKENS).toContain(command);
    }
  });
});

describe('integration — every surface that repeats the block carries the same text', () => {
  it('when the surfaces are read from disk, should carry each unit the block prints', () => {
    // given: the composed lines, and the SPAWN command — the one the two prose
    //        surfaces print (the mirrors are where the auth-grant bullet lives too)
    const lines = printedInvocations().map((entry) => entry.line);
    const spawn = printedInvocations()
      .map((entry) => entry.invocation)
      .find((invocation) => resolveCommand(invocation, cli).name() === 'spawn');
    if (spawn === undefined) throw new Error('the block no longer prints the spawn command');
    // when:  each surface is compared at the granularity it shares
    expect(SURFACES.filter((s) => s.unit === 'line')).toHaveLength(3);
    expect(SURFACES.filter((s) => s.unit === 'command')).toHaveLength(2);
    expect(lines).toHaveLength(2);
    for (const { path, unit } of SURFACES) {
      const text = readFileSync(path, 'utf8');
      // then:  a bullet mirror carries both lines character for character; a prose
      //        surface carries the command. Nothing compared any of them before
      //        this slice — that is the finding, and this is the comparator.
      for (const unitText of unit === 'line' ? lines : [spawn.text]) {
        expect(text, `${path} :: ${unitText}`).toContain(unitText);
      }
    }
  });

  it('when the surfaces are read, should carry no trace of the pre-fix lines', () => {
    // given: the two pre-fix bullets and the pre-fix command text, taken out of
    //        them rather than copied again
    const oldCommand = OLD_SPAWN_LINE.split('`')[1] ?? '';
    expect(oldCommand.length).toBeGreaterThan(0);
    for (const { path } of SURFACES) {
      // when:  each surface is searched
      const text = readFileSync(path, 'utf8');
      // then:  none of it is present — the control for the comparator above
      expect(text, path).not.toContain(OLD_FALLBACK_LINE);
      expect(text, path).not.toContain(OLD_SPAWN_LINE);
      expect(text, path).not.toContain(oldCommand);
    }
  });
});

describe('a11y — what the block says about the operation values', () => {
  it('when the block names literal operation values, should name only values the declaration allows', () => {
    // given: the declared enum, and the bullet naming two members as examples
    const allowed = declaredOperations(registeredCommandAt('worktree auth grant', cli));
    const bullet = lineOf(soleInvocation(printedInvocations()[1]?.line ?? ''));
    const literals = printedLiteralValues(bullet);
    const invented = bullet.replaceAll(literals[literals.length - 1] ?? '', 'not-a-real-op');
    // when:  the literals are checked, on the shipped text and on an invented one
    const shipped = literals.filter((value) => !allowed.includes(value));
    const mutated = printedLiteralValues(invented).filter((value) => !allowed.includes(value));
    // then:  every value the block prints is real, and an invented one is named.
    //        Before this case, one legal value plus one invented value passed.
    expect(allowed.length).toBeGreaterThan(1);
    expect(literals.length).toBeGreaterThan(0);
    expect(shipped).toEqual([]);
    expect(mutated).toEqual(['not-a-real-op']);
  });

  it('when fewer than all the values are printed, should mark them illustrative', () => {
    // given: the declared enum and the bullet
    const allowed = declaredOperations(registeredCommandAt('worktree auth grant', cli));
    const bullet = lineOf(soleInvocation(printedInvocations()[1]?.line ?? ''));
    // when:  the values the bullet names are counted against the full set
    const named = allowed.filter((value) => bullet.includes(value));
    // then:  IF it names fewer than the CLI declares it says so — an implication,
    //        so a later slice that prints all four improves the block instead of
    //        being refused by this case
    expect(named.length).toBeGreaterThan(0);
    if (named.length < allowed.length) {
      expect(bullet).toContain('e.g.');
    }
  });
});
