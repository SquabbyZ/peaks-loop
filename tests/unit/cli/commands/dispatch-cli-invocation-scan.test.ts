// tests/unit/cli/commands/dispatch-cli-invocation-scan.test.ts
//
// The extraction half of the dispatch-prompt CLI check: which `peaks …` runs a
// prompt carries, and where each one stops. Split out from
// `dispatch-cli-invocation-check.test.ts` because both files were near the
// repository's 500-line test cap, not because the two halves stopped being one
// subject.
//
// THIS SHAPE WAS THE REPAIR ROUND'S FIRST FINDING. The check's own test file
// exercised only a single long line, and the shipped scanner was quadratic on a
// prompt of MANY SHORT LINES — the shape `'peaks test --json\n'.repeat(n)`, which
// an independent review measured at 493 ms for 32k lines and 109.9 s for 200k /
// 3.5 MB, running synchronously inside `composeDispatchPrompt` on caller-supplied
// text. The generator below is that reviewer's input. The COST is a measurement
// recorded on the scanner and cannot be held by an assertion; what this file pins
// is the SHAPE — every line is read, and each run stops at its own line.
//
// REVISION 2026-10-13 (repair round), second finding: a run used to end at every
// line break, so a wrapped invocation's later flags went unchecked while the
// invocation still reported clean. The continuation cases here are built from the
// real corpus text that carries that shape.

import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import {
  PROMPT_CLI_RUN_LIMIT,
  extractPromptCliInvocations
} from '~/src/cli/commands/dispatch-cli-invocation-scan';

declareDimensions(
  'tests/unit/cli/commands/dispatch-cli-invocation-scan.test.ts',
  ['render', 'behavior'],
  [
    {
      dim: 'integration',
      reason: 'the extractor is a pure function of one string: no fs, no process, no clock, no env.'
    },
    {
      dim: 'a11y',
      reason:
        'the extractor prints nothing and exits nothing; the sentences a caller reads are asserted in the check file.'
    }
  ]
);

describe('render — the runs a prompt hands back', () => {
  it('should restore the command word and split the run into tokens when quoting an invocation', () => {
    // given: a quoted invocation inside a sentence
    const text = 'then run `peaks request show rid-x --role rd --json` and read it';

    // when/then: the run is quoted back whole, and its tokens carry no quotation
    expect(extractPromptCliInvocations(text)).toEqual([
      {
        text: 'peaks request show rid-x --role rd --json',
        tokens: ['request', 'show', 'rid-x', '--role', 'rd', '--json']
      }
    ]);
  });

  it('should end a run at the closing backtick and at the line break', () => {
    // The prose around a quotation is not its arguments. Without this boundary
    // the sentence after a quoted command would be read as its operands — and a
    // flag mentioned in that sentence would be reported as a defect.
    const text = 'run `peaks test --json` today, and consider --bogus tomorrow\npeaks --bogus\n';

    // then: two runs, and neither carries the neighbouring sentence's flag
    const runs = extractPromptCliInvocations(text).map((invocation) => invocation.text);
    expect(runs).toEqual(['peaks test --json', 'peaks --bogus']);
  });

  it('should read every run in a prompt of many short lines, one per line', () => {
    // THE SHAPE THE FIRST VERSION WAS QUADRATIC ON. The generator is the
    // reviewer's; the count and the per-line tokens are the assertion.
    const lines = 2000;
    const text = 'peaks test --json\n'.repeat(lines);

    const invocations = extractPromptCliInvocations(text);
    expect(invocations).toHaveLength(lines);
    expect(invocations[0]?.text).toBe('peaks test --json');
    expect(invocations[lines - 1]?.text).toBe('peaks test --json');
    // and a run still stops at its own line: the next line is not its arguments
    for (const invocation of invocations) expect(invocation.tokens).toEqual(['test', '--json']);
  });

  it('should stop at a line break a markdown bullet follows, not only at a long option', () => {
    // The continuation rule keys on `--`, so a prose bullet under a command is not
    // swallowed. Without that distinction the `--bogus` of ordinary prose would be
    // read as the command's flag.
    const text = '`peaks test --json`\n- see `--bogus` for details\n';

    expect(extractPromptCliInvocations(text)).toEqual([
      { text: 'peaks test --json', tokens: ['test', '--json'] }
    ]);
  });

  it('should not extract a capitalised `Peaks`, which is this project name in prose', () => {
    // Deliberate, and measured: 51 corpus lines use `Peaks` as the project's own
    // name (`… bypassed Peaks worktree governance`) and none of them is an
    // invocation. Matching case-insensitively would add 51 findings on prose.
    expect(extractPromptCliInvocations('the active Peaks skill does X')).toEqual([]);
    expect(extractPromptCliInvocations('`peaks skill presence --json`')).toHaveLength(1);
  });
});

describe('behavior — where a run stops', () => {
  it('should bound a run, so many invocations on one line stay linear', () => {
    // A run ends only at a delimiter, so without a second bound a single long
    // line carrying many invocations is quadratic when the run is read in full:
    // measured, a 123 KB prompt with 5024 invocations on one line took 7.2
    // seconds and an 800 KB one exhausted a 4 GB heap, against 1.0 ms for a real
    // 30 KB prompt. The bound is a stated cost, not a silent one.
    const long = `\`peaks test ${'x'.repeat(PROMPT_CLI_RUN_LIMIT * 4)}\``;

    const [invocation] = extractPromptCliInvocations(long);
    expect(invocation?.tokens).toEqual(['test', 'x'.repeat(PROMPT_CLI_RUN_LIMIT - 'test '.length)]);
    // and the bound is what the module publishes, so the two cannot drift apart
    expect(PROMPT_CLI_RUN_LIMIT).toBe(512);
  });

  it('should read the flags a wrapped invocation puts on the next line', () => {
    // The real corpus text, from
    // `dispatch-rid-s3-artifact-contract-enforcement-2026-10-12T07-52-31-798Z.json`:
    // the sentence wraps, so `--project <root> --type <type>` sits on the next
    // line. Before the continuation rule those flags were unchecked and the
    // invocation still reported clean — a false negative that reads as a pass.
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
  });

  it('should trim a long punctuation run from a token without backtracking over it', () => {
    // `'.'.repeat(n) + 'x'` is the shape a `…+$` regex is quadratic on: measured,
    // 0.4 ms at n=1000 and 94.8 ms at n=16000. The trim is a backwards scan, and
    // this case pins its RESULT for that input class; the cost claim is a
    // measurement recorded on the module, not something an assertion can hold.
    const text = `\`peaks test ${'.'.repeat(400)}x\``;

    const [invocation] = extractPromptCliInvocations(text);
    expect(invocation?.tokens).toEqual(['test', `${'.'.repeat(400)}x`]);
  });
});
