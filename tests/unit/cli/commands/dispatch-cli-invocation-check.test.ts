// tests/unit/cli/commands/dispatch-cli-invocation-check.test.ts
//
// A dispatch brief tells a sub-agent which commands to run, and nothing parsed
// those quotations: the brief is the one artifact in this workflow no gate
// reads. Measured on 2026-10-13, a shared brief carried `peaks request init
// --rid <rid>` on three separate dispatches, and the flag is `--id`.
//
// The check under test resolves every `peaks …` run in a prompt against the
// REGISTERED command tree and reports the flags the resolved command does not
// declare. Nothing here keeps its own flag table: `createProgram()` is the same
// tree the CLI parses, so the test cannot agree with a second, hand-kept list.
//
// THE RED ARMS COME FROM THE REAL DISPATCHED TEXT, with one substitution named
// rather than hidden. REVISION 2026-10-13 (repair round): the first header said
// both arms were verbatim, and that was stronger than the code. Arm 1 is
// verbatim. Arm 2 is not, and the disclosure is now complete in two parts —
// (a) the corpus's own flagged perf-audit line is spelled
// `node node_modules/tsx/dist/cli.mjs src/cli/index.ts perf-audit run …`, with
// no `peaks` token, so this extractor would not see it at all, and the arm
// rewrites it with a `peaks ` prefix; and (b) the `--judged` flag is the one the
// real sentence demands and the corpus never shows on a perf invocation, which
// is why nothing caught it. Both substitutions are asserted below as their own
// case as well, so the boundary they cross is pinned rather than implied.
//
// THE CONTROL ARM, named so its absence is not read as an omission: a correct
// brief must produce NO finding and NO warning. It is discriminating because the
// check reads the caller's prompt, not the assembled one — the composer appends
// its own blocks, one of which quotes a flag this CLI rejects, so a check that
// read the assembled string would warn on every dispatch and every assertion
// here would pass without the brief mattering at all.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Command } from 'commander';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { makeCapturedIo } from '../../_setup/io.js';
import { createProgram } from '~/src/cli/program';
import { parseCliEnvelope } from '~/src/cli/cli-envelope';
import {
  checkPromptCliInvocations,
  cliInvocationWarnings,
  type PromptCliFinding
} from '~/src/cli/commands/dispatch-cli-invocation-check';
import { extractPromptCliInvocations } from '~/src/cli/commands/dispatch-cli-invocation-scan';

declareDimensions('tests/unit/cli/commands/dispatch-cli-invocation-check.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

let cli: Command;

beforeAll(() => {
  cli = createProgram();
});

/** The findings for the flags only — what a caller acts on. */
function flagged(prompt: string, root: Command = cli): PromptCliFinding[] {
  return checkPromptCliInvocations(prompt, root).filter(
    (finding) => finding.verdict.kind === 'undeclared-flag'
  );
}

// ── the real text, verbatim from the dispatch records ────────────────────────

/** record `dispatch-rid-audit-refusal-names-blocker-2026-10-13T01-10-50-973Z.json` */
const REAL_INIT_LINE =
  '| `rd/requests/<NNN>-<rid>.md` | create with `peaks request init --role rd --rid <rid> ' +
  '--project . --apply`, then **backfill every `<placeholder>` in it** — a placeholder left ' +
  'in place is a `LINT_GATE_FAILED` at the transition |';

/** record `dispatch-rid-a-name-may-key-but-must-not-judge-2026-10-13T09-14-15-478Z.json` */
const REAL_JUDGED_SENTENCE =
  '**The audit CLI now also requires `--judged <paths...>`** — the paths the audit judged. ' +
  'Without it the run refuses with `declaration-missing` and writes nothing.';

/**
 * The invocation the sentence above instructs. The corpus carries this exact
 * perf-audit run without `--judged` — which is why nothing caught the sentence —
 * so the arm adds the flag the sentence asks for.
 */
const REAL_PERF_INVOCATION =
  '`peaks perf-audit run --rid rid-lane-phase-json-carrier --sid 2026-10-12-session-74bd69 ' +
  '--project D:/projects/peaks-loop --envelope <your.json> --judged <paths...> --json`';

/** the third recorded instance, as an earlier revision of the brief spelled it */
const REAL_TEST_REPORTS_CLAIM =
  '| `qa/test-reports/<rid>.md` | `## Test execution`, and it must contain `test(` or `it(` |';

/** a brief that quotes no command of this CLI — the control input */
const CORRECT_BRIEF =
  'Read `package.json#scripts.test` first, then run `pnpm exec vitest run tests/unit/x`. ' +
  'Move the request with `peaks request transition <rid> --role rd --state implemented ' +
  '--session-id <sid> --project .`.';

describe('render — what the check hands back', () => {
  it('should carry a verdict from the closed set, and never a bare pass/fail', () => {
    // given: one finding per invocation — `tact read` is registered as of
    // rid-mut-producer-chain, so the unknown arm names a genuinely unregistered
    // VERB. A shape like `peaks tact not-a-command` is not enough: `tact` is a
    // registered parent, so the checker resolves that to an undeclared-flag
    // verdict on the group rather than unknown-command.
    const findings = checkPromptCliInvocations(
      '`peaks test` and `peaks tact read` and `peaks definitely-not-a-command`',
      cli
    );

    // then: each carries the state that decided it
    expect(findings.map((finding) => finding.verdict.kind)).toEqual([
      'clean',
      'clean',
      'unknown-command'
    ]);
  });

  it('should quote the run back as the prompt spelled it', () => {
    // The extraction boundary itself is asserted in
    // `dispatch-cli-invocation-scan.test.ts`; what matters here is that the
    // verdict travels with the text a reader can find in the prompt.
    const text = 'then run `peaks request show rid-x --role rd --json` and read it';

    expect(checkPromptCliInvocations(text, cli)[0]?.text).toBe(
      'peaks request show rid-x --role rd --json'
    );
  });
});

describe('behavior — the states the check can be in', () => {
  it('should report `--rid` on request init, from the line the brief really carried', () => {
    // given: the real dispatched line (the first recorded instance)
    const findings = flagged(REAL_INIT_LINE);

    // when/then: the undeclared flag is named, with the command that lacks it
    expect(findings).toEqual([
      {
        text: 'peaks request init --role rd --rid <rid> --project . --apply',
        verdict: { kind: 'undeclared-flag', command: 'request init', flags: ['--rid'] }
      }
    ]);
    // and the flags the command DOES declare are not swept up with it — the
    // assertion above would still pass if every flag on the line were reported
    expect(extractPromptCliInvocations(REAL_INIT_LINE)[0]?.tokens).toContain('--role');
    expect(extractPromptCliInvocations(REAL_INIT_LINE)[0]?.tokens).toContain('--apply');
  });

  it('should report `--judged` on perf-audit run, and stay quiet on security-audit run', () => {
    // given: the real sentence the brief carried, paired with the invocation it
    // instructs — the second recorded instance, in the only half of it a flag
    // check can reach
    const faulty = `${REAL_JUDGED_SENTENCE}\n${REAL_PERF_INVOCATION}`;

    // then: reported, naming the flag and the command
    expect(flagged(faulty)).toEqual([
      {
        text:
          'peaks perf-audit run --rid rid-lane-phase-json-carrier --sid 2026-10-12-session-74bd69 ' +
          '--project D:/projects/peaks-loop --envelope <your.json> --judged <paths...> --json',
        verdict: { kind: 'undeclared-flag', command: 'perf-audit run', flags: ['--judged'] }
      }
    ]);

    // when: the same flag on the command that DOES declare it
    const correct = REAL_PERF_INVOCATION.replace('perf-audit', 'security-audit');

    // then: clean — so the arm above fires on the command, not on the flag name
    expect(flagged(correct)).toEqual([]);
  });

  it('should read the flags a wrapped invocation puts on the next line', () => {
    // The real corpus text, from
    // `dispatch-rid-s3-artifact-contract-enforcement-2026-10-12T07-52-31-798Z.json`:
    // the sentence wraps, so `--project <root> --type <type>` sits on the next
    // line. REVISION 2026-10-13 (repair round): before the continuation rule, that
    // line's flags were unchecked and the invocation still reported clean — a
    // false negative that reads as a pass. The token assertion is what makes this
    // case fail without the fix.
    const text =
      'The checker already exists. `peaks workflow verify-pipeline --rid <rid>\n' +
      '--project <root> --type <type>` reads the artifact contract.';

    const [invocation] = extractPromptCliInvocations(text);
    expect(invocation?.tokens).toEqual([
      'workflow',
      'verify-pipeline',
      '--rid',
      '<rid>',
      '--project',
      '<root>',
      '--type',
      '<type>'
    ]);
    // both are declared, so the reading is clean for the right reason
    expect(flagged(text)).toEqual([]);
  });

  it('should report an undeclared flag sitting on a continuation line', () => {
    // The red direction for the rule above: same wrapped shape, one flag that the
    // command does not declare. Without continuation this passes as clean.
    const text = '`peaks workflow verify-pipeline --rid <rid>\n--project <root> --zzz`';

    expect(flagged(text)).toEqual([
      {
        text: 'peaks workflow verify-pipeline --rid <rid>\n--project <root> --zzz',
        verdict: { kind: 'undeclared-flag', command: 'workflow verify-pipeline', flags: ['--zzz'] }
      }
    ]);
  });

  it('should report nothing for the third recorded instance — it is not an invocation', () => {
    // The brief also attached `test(` / `it(` to `qa/test-reports`, and that
    // claim is false: the marker belongs to `UNIT_TESTS` on `test-cases`. It is
    // an ARTIFACT-PATH claim, not a flag on a resolved command, so this check
    // cannot reach it. Pinned here rather than reported as a third catch.
    const prompt = `${REAL_TEST_REPORTS_CLAIM}\nRun \`peaks workflow verify-pipeline --json\`.`;

    expect(checkPromptCliInvocations(prompt, cli)).toEqual([
      {
        text: 'peaks workflow verify-pipeline --json',
        verdict: { kind: 'clean', command: 'workflow verify-pipeline' }
      }
    ]);
  });

  it('should report nothing for a correct brief — the control', () => {
    // given: a brief whose every invocation resolves and declares its flags
    // when/then: no finding, and no warning either
    expect(checkPromptCliInvocations(CORRECT_BRIEF, cli)).toEqual([
      {
        text:
          'peaks request transition <rid> --role rd --state implemented --session-id <sid> ' +
          '--project .',
        verdict: { kind: 'clean', command: 'request transition' }
      }
    ]);
    expect(cliInvocationWarnings(CORRECT_BRIEF, cli)).toEqual([]);
  });

  it('should report an unresolvable command as its own state, not as clean', () => {
    // given: `peaks tact read` is registered, so it resolves cleanly...
    expect(checkPromptCliInvocations('`peaks tact read --json`', cli)[0]?.verdict).toEqual({
      kind: 'clean',
      command: 'tact read'
    });

    // ...while a verb this CLI does not register must not be folded into that
    // clean verdict.
    const findings = checkPromptCliInvocations(
      'Run `peaks definitely-not-a-command --json` first.',
      cli
    );

    // then: a distinct state that names what could not be resolved, so a check
    // that resolved nothing can never read as a pass
    expect(findings).toEqual([
      {
        text: 'peaks definitely-not-a-command --json',
        verdict: { kind: 'unknown-command', attempted: 'definitely-not-a-command' }
      }
    ]);
    expect(
      cliInvocationWarnings('Run `peaks definitely-not-a-command --json` first.', cli)
    ).toEqual([expect.stringContaining('PROMPT_CLI_COMMAND_NOT_FOUND')]);
  });

  it('should not report a flag the ROOT program declares, used on a nested command', () => {
    // A flag declared on an ancestor is inherited, so `peaks code context-now
    // --verbose` is accepted by the CLI (measured) and must not be reported.
    const inherited = flagged('`peaks code context-now --verbose`', cli);
    expect(inherited).toEqual([]);
    // control: the same position, a flag no ancestor declares
    expect(flagged('`peaks code context-now --verbose --zzz`', cli)).toEqual([
      {
        text: 'peaks code context-now --verbose --zzz',
        verdict: { kind: 'undeclared-flag', command: 'code context-now', flags: ['--zzz'] }
      }
    ]);
  });

  it('should read declared flags up the parent chain on a synthetic nested group', () => {
    // The registered tree has no two-level group whose parent declares a flag of
    // its own, so the rule is pinned on a group built here: parent declares
    // `--shared`, child declares nothing, and the child still owns it.
    const program = new Command();
    const group = program.command('group').option('--shared <value>');
    group.command('child').option('--own <value>');

    expect(flagged('`peaks group child --shared 1 --own 2`', program)).toEqual([]);
    expect(flagged('`peaks group child --alien 1`', program)).toEqual([
      {
        text: 'peaks group child --alien 1',
        verdict: { kind: 'undeclared-flag', command: 'group child', flags: ['--alien'] }
      }
    ]);
  });
});

describe('integration — resolution comes from the registered CLI', () => {
  it('should clear the invocations the corpus really carries', () => {
    // given: three invocations that appear across the dispatch records
    const prompt = [
      '`peaks security-audit run --rid x --sid y --project . --judged a.ts --json`',
      '`peaks scan file-size --project . --json`',
      '`peaks sub-agent shutdown register --pid 1 --name svc`'
    ].join('\n');

    // then: none of them is a defect — the flags exist on the commands named
    expect(flagged(prompt)).toEqual([]);
  });

  it('should separate the two audit commands on `--judged`, as the registered tree does', () => {
    // The measured fact behind the second recorded instance: the declaration
    // check reads the security artifact only, and the perf CLI does not accept
    // `--judged`. Asserted against the tree, not against a copy of it.
    const security = cli.commands
      .find((candidate) => candidate.name() === 'security-audit')
      ?.commands.find((candidate) => candidate.name() === 'run');
    const perf = cli.commands
      .find((candidate) => candidate.name() === 'perf-audit')
      ?.commands.find((candidate) => candidate.name() === 'run');
    const longs = (command: Command | undefined): string[] =>
      (command?.options ?? []).flatMap((option) =>
        option.long === undefined ? [] : [option.long]
      );

    expect(longs(security)).toContain('--judged');
    expect(longs(perf)).not.toContain('--judged');
  });

  it('should not see an invocation that reaches this CLI by path rather than by name', () => {
    // The boundary the second red arm crosses, pinned here from the real corpus
    // line. This is why nothing caught the `--judged` claim on the perf side: the
    // record spells the run with a path and no `peaks` token, so there is no run to
    // resolve. Stated as a limitation rather than left to a reader to discover.
    const text =
      '`node node_modules/tsx/dist/cli.mjs src/cli/index.ts perf-audit run --rid rid-x ' +
      '--sid s --project . --envelope <your.json> --json`';

    expect(checkPromptCliInvocations(text, cli)).toEqual([]);
  });

  it('should correct the inherited-group example the brief names', () => {
    // The brief verified the inheritance rule against `peaks request transition`
    // "inheriting from `peaks request`". Measured: `peaks request` declares no
    // options at all, so that pair cannot show anything. The case that CAN is
    // the root program, exercised above.
    const request = cli.commands.find((candidate) => candidate.name() === 'request');
    expect(request?.options).toEqual([]);
    const transition = request?.commands.find((candidate) => candidate.name() === 'transition');
    expect(transition?.options.map((option) => option.long)).toContain('--role');
  });

  it('should carry the finding in the envelope of a real dispatch, and nothing for a clean brief', async () => {
    // given: a project, and two briefs — one carrying the real faulty line
    const project = mkdtempSync(join(tmpdir(), 'dispatch-cli-invocation-'));
    try {
      const faulty = await runDispatch(project, `BRIEF\n${REAL_INIT_LINE}\n`);

      // then: the dispatch still succeeds — the corpus is not clean, so this
      // check warns rather than refuses — and the warning names the flag
      expect(faulty.ok).toBe(true);
      const faultyWarnings = (faulty.warnings as string[]).filter((warning) =>
        warning.startsWith('PROMPT_CLI_FLAG_NOT_DECLARED')
      );
      expect(faultyWarnings).toHaveLength(1);
      expect(faultyWarnings[0]).toContain('--rid');
      expect(faultyWarnings[0]).toContain('peaks request init');

      // when: the same dispatch with a brief whose quotations are all correct
      const clean = await runDispatch(project, `${CORRECT_BRIEF}\n`);

      // then: no invocation warning at all. REVISED TWICE, 2026-10-13 and 2026-10-14,
      // when the slice that corrected the injected block landed. This comment used to
      // say the arm was discriminating BY ITSELF: the composer appends a block quoting
      // `peaks worktree auth grant --rid`, which this CLI rejects, so a check reading
      // the ASSEMBLED prompt would warn here too. That premise became FALSE when the
      // block was corrected, and the first revision of this comment replaced it with a
      // second overclaim — that the pair of arms above still separates the two
      // implementations. It does not, and that was MEASURED: with the block corrected,
      // a freshly composed prompt for any of the seven roles is clean (63 invocations,
      // 0 flagged), so an implementation reading the assembled prompt passes BOTH arms
      // of this test. What supports the scoping decision now is the module's own corpus
      // measurement — 149 of 182 findings sitting in the machine-injected block versus
      // 29 in caller-authored text — and not any arm in this file. The assertion below
      // is kept because it is still worth making; it is not evidence for the contract
      // it used to be evidence for, and this comment says so rather than implying it.
      expect(clean.ok).toBe(true);
      expect(
        (clean.warnings as string[]).filter((warning) => warning.startsWith('PROMPT_CLI_'))
      ).toEqual([]);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe('a11y — the sentence a caller reads', () => {
  it('should name the flag, the command that lacks it, and quote the invocation', () => {
    const [warning] = cliInvocationWarnings(REAL_INIT_LINE, cli);

    expect(warning).toContain('PROMPT_CLI_FLAG_NOT_DECLARED');
    expect(warning).toContain('`--rid`');
    expect(warning).toContain('`peaks request init`');
    expect(warning).toContain('peaks request init --role rd --rid <rid>');
  });

  it('should bound the text it quotes back, and count the flags it does not name', () => {
    // A run that never meets a line break, and that carries more flags than a
    // warning should list, would otherwise paste a paragraph into the envelope.
    // Both bounds are visible rather than silent.
    const long = `\`peaks request init ${'--x '.repeat(80)}\``;
    const [warning] = cliInvocationWarnings(long, cli);

    expect(warning).toBeDefined();
    expect(warning?.length).toBeLessThan(400);
    expect(warning).toContain('…');
    expect(warning).toContain('(and 72 more)');
  });

  it('should not attribute an unresolvable invocation to its leading option', () => {
    // REVISION 2026-10-13 (repair round): the sentence used to read "`peaks --rid`
    // is not a registered command", which blames a flag for being an unknown
    // command. The finding still carries the first token — that is what the field
    // means — so the SENTENCE must not turn it into a command name.
    const [warning] = cliInvocationWarnings('`peaks --rid x`', cli);

    expect(warning).toContain('PROMPT_CLI_COMMAND_NOT_FOUND');
    expect(warning).toContain('no registered command resolves from `--rid`');
    expect(warning).not.toContain('is not a registered command');
  });

  it('should leave a prompt with no invocation of this CLI completely alone', () => {
    const text = 'Run `git status` and `pnpm exec vitest run tests/unit/x`, then report.';
    expect(cliInvocationWarnings(text, cli)).toEqual([]);
  });
});

/** Run a real `peaks sub-agent dispatch` against a temp project and parse the envelope. */
async function runDispatch(
  project: string,
  prompt: string
): Promise<ReturnType<typeof parseCliEnvelope>> {
  const { io, captured } = makeCapturedIo();
  // The REGISTERED program, so the brief's quotations resolve against the same
  // tree the CLI parses. A bare `Command` would resolve nothing and turn every
  // quotation into `unknown-command`.
  const program = createProgram(io);
  await program.parseAsync(
    [
      'sub-agent',
      'dispatch',
      'rd',
      '--prompt',
      prompt,
      '--request-id',
      'rid-dispatch-cli-invocation-check',
      '--session-id',
      '2026-10-13-dispatch-cli-invocation-check',
      '--project',
      project,
      '--graph-node',
      'n1',
      '--json'
    ],
    { from: 'user' }
  );
  return parseCliEnvelope(captured.text().trim());
}

beforeEach(() => {
  process.exitCode = undefined;
});

afterEach(() => {
  process.exitCode = undefined;
});
