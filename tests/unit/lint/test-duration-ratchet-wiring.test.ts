// tests/unit/lint/test-duration-ratchet-wiring.test.ts
//
// The CI wiring behind the unit suite's duration ceiling: the `test-duration-ratchet` job
// exists, its step really runs the ratchet, the step CAN fail, and the `test` job runs the
// suite at the concurrency the ceiling's key names.
//
// WHY THE WIRING IS PINNED IN A TEST RATHER THAN TRUSTED AS PROSE. This repository has paid
// for the gap more than once, and every time it was a green-looking job that ran nothing: a
// `test:ci` leg that could never pass and was called by no workflow, and a README linter
// reported as unit-test coverage because it was collected by the wrong glob. A ceiling no
// job invokes is a number in a file.
//
// WHY A NEGATIVE ARM ON `continue-on-error` AND `|| true`. A step that cannot fail is exactly
// the defect the `format-check` job's own comment names. Either spelling would leave this job
// green while measuring nothing, which is strictly worse than having no gate at all — a
// reader would believe the suite's duration was guarded.
//
// WHY THE STEP IS MATCHED AS A WHOLE COMMAND. The first draft of the sibling coverage-floor
// wiring used `block.includes(STEP)`, so `run: node .husky/coverage-ratchet.mjs --report
// /tmp/forged.json` satisfied every arm — a job whose red could be faked by handing the
// ratchet a report of the author's choosing. Here the whole-string match IS the contract:
// CI invokes the ratchet with NO ARGUMENTS, because an argument is a verdict somebody chose.
//
// THE INJECTION CONTROL IS IN THIS FILE. Arm A drives the SAME predicate over a block that
// carries each defect, so the predicate cannot pass by being unable to fail. Arm E does the
// same for the extraction: a workflow with no such job yields `null`, and that is asserted
// rather than left to a silent skip.
//
// Dimensions covered:
//   - behavior:    the predicate, on a clean block and on six injected defects
//   - integration: the real `.github/workflows/ci.yml` is read off disk and its jobs sliced out
//   - a11y:        the refusal names the job and the defect, so a maintainer knows what to edit

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const WORKFLOW_REL = join('.github', 'workflows', 'ci.yml');
const CEILING_REL = join('.peaks', 'lint', 'test-duration-ceiling.json');
const JOB = 'test-duration-ratchet';
const STEP = 'node .husky/test-duration-ratchet.mjs';
const TEST_JOB = 'test';
const TEST_STEP = 'npx vitest run --reporter=default --reporter=github-actions';

/**
 * The two swallow shapes, as PATTERNS and NOT AS SUBSTRINGS.
 *
 * A job's block reaches from its own key to the next one, so it carries the NEXT job's
 * rationale comment as well as the job's own body — and this repository's rationales NAME
 * these two things in prose ("NO `continue-on-error`, NO `|| true`"). A substring scan
 * therefore reads the neighbouring job's COMMENT as a defect. So the scan looks for the
 * YAML KEY and for a `run:` COMMAND that ends in the swallow, which is what the two
 * defects actually are.
 */
const CONTINUE_ON_ERROR = /^\s*continue-on-error\s*:/m;
const OR_TRUE_SUFFIX = /^\s*run:[^\n]*\|\|\s*true\s*$/m;

declareDimensions(
  'tests/unit/lint/test-duration-ratchet-wiring.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    {
      dim: 'render',
      reason:
        'the subject is the workflow text, a set of wiring problems and one JSON artifact; nothing is rendered, and the operator-facing part is the refusal sentence asserted under a11y'
    }
  ]
);

/**
 * One top-level job's block, from its `  <job>:` line to the next top-level key.
 *
 * Matched by exact line rather than by regex over the whole document, so a job whose *name*
 * or a *comment* mentions another job cannot be sliced by accident. `null` means the job is
 * absent, which every caller must treat as a failure rather than as "nothing to check".
 */
export function jobBlock(workflow: string, job: string): string | null {
  const lines = workflow.split('\n');
  const start = lines.indexOf(`  ${job}:`);
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^ {2}[A-Za-z0-9_-]+:$/.test(line));
  const block = (end < 0 ? rest : rest.slice(0, end)).join('\n');
  return block.trim() === '' ? null : block;
}

/**
 * Every `run:` command in a block, trimmed. A `run: |` script block contributes its marker
 * only — the arms below ask whether ONE command equals the expected step, not whether a
 * string is mentioned somewhere.
 */
function runCommands(block: string): string[] {
  return block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('run:'))
    .map((line) => line.slice('run:'.length).trim());
}

/**
 * The lines of the step that runs `runValue`, from the command to the next step.
 *
 * `null` when no step runs that command. The env of a step is BELOW its `run:`, so the env
 * is only readable by taking the step's own lines — a block-wide search would find a
 * neighbouring step's variable and pass for a wrong reason.
 */
export function stepBlock(block: string, runValue: string): string | null {
  const lines = block.split('\n');
  const start = lines.findIndex((line) => line.trim() === `run: ${runValue}`);
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^\s*-\s/.test(line));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
}

/**
 * Why this job block does not enforce anything, as sentences. `[]` means it does.
 *
 * The step is matched as a WHOLE COMMAND, NOT AS A SUBSTRING, and a step that carries the
 * ratchet WITH arguments is refused separately: an argument-bearing step hands the ratchet
 * a verdict the author chose, so both shapes have to be red.
 */
export function wiringProblems(block: string, job = JOB): string[] {
  const problems: string[] = [];
  if (block.trim() === '') {
    return [`the ${job} job has no steps, so nothing is enforced`];
  }
  const commands = runCommands(block);
  if (!commands.includes(STEP)) {
    problems.push(
      `the ${job} job never runs \`${STEP}\` as a whole command (it runs: ${
        commands.length === 0 ? 'nothing' : commands.join(' | ')
      })`
    );
  }
  const withArguments = commands.filter((command) => command.startsWith(STEP) && command !== STEP);
  if (withArguments.length > 0) {
    problems.push(
      `a step in the ${job} job runs \`${STEP}\` with arguments (${withArguments.join(' | ')}), ` +
        'so the verdict is whatever the arguments say rather than what the tree measured'
    );
  }
  if (!block.includes('runs-on: ubuntu-latest')) {
    problems.push(
      `the ${job} job is not pinned to ubuntu-latest, and a duration measured on one machine ` +
        'is not a duration measured on another'
    );
  }
  if (!block.includes('PEAKS_VITEST_MAX_WORKERS')) {
    problems.push(
      `the ${job} job does not set PEAKS_VITEST_MAX_WORKERS, so the measurement would be taken ` +
        'at a concurrency the ceiling does not name, and the two are not comparable'
    );
  }
  if (CONTINUE_ON_ERROR.test(block)) {
    problems.push(`the ${job} job sets continue-on-error, so its red is not a block`);
  }
  if (OR_TRUE_SUFFIX.test(block)) {
    problems.push(`a step in the ${job} job ends in \`|| true\`, which swallows its exit code`);
  }
  return problems;
}

describe('Scenario: behavior — the predicate flags each way a job can look green and enforce nothing', () => {
  const clean = [
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - name: Test duration ceiling',
    `        run: ${STEP}`,
    '        env:',
    "          PEAKS_VITEST_MAX_WORKERS: '4'"
  ].join('\n');

  it('A: should find no problem in a clean block', () => {
    // given: a job block that runs the ratchet as a whole command and can fail
    // when: the predicate is applied to it
    // then: it reports nothing, so the arms below are not passing vacuously
    expect(wiringProblems(clean)).toEqual([]);
  });

  it('B: should find a problem for each injected defect', () => {
    // given: six blocks, each carrying one way the job can look green and enforce nothing
    // when: the same predicate is applied to each of them
    // then: every one is reported, and each report names its own defect
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['arguments', clean.split(`run: ${STEP}`).join(`run: ${STEP} --report /tmp/forged.json`)],
      ['with arguments', `${clean}\n        run: ${STEP} --report /tmp/forged.json`],
      ['continue-on-error', `${clean}\n    continue-on-error: true`],
      ['|| true', `${clean}\n        run: ${STEP} || true`],
      ['never runs', clean.split(STEP).join('node some-other-thing.mjs')],
      ['ubuntu-latest', clean.split('ubuntu-latest').join('windows-latest')]
    ];
    for (const [needle, block] of cases) {
      const problems = wiringProblems(block);
      expect(problems.length, `no problem reported for ${needle}:\n${block}`).toBeGreaterThan(0);
      expect(problems.join(' ')).toContain(needle);
    }
  });

  it('C: should find a problem for a block that measures at no named concurrency', () => {
    // given: a job that runs the ratchet but never says at which concurrency it measures
    // when: the predicate is applied to it
    // then: the missing PEAKS_VITEST_MAX_WORKERS is named, because the ceiling's key would
    //       describe a measurement that was never taken at that concurrency
    const problems = wiringProblems(clean.split('PEAKS_VITEST_MAX_WORKERS').join(''));
    expect(problems.join(' ')).toContain('PEAKS_VITEST_MAX_WORKERS');
  });

  it('D: should find a problem in an empty block rather than pass it vacuously', () => {
    // given: a job block with no steps at all
    // when: the predicate is applied to it
    // then: it is reported as enforcing nothing
    expect(wiringProblems('')).toHaveLength(1);
  });
});

describe('Scenario: integration — the real workflow carries the job and the artifact', () => {
  it('E: should find the duration job in the real ci.yml, running the ratchet and able to fail', () => {
    // given: the workflow this repository runs
    // when: the duration job is sliced out of it and judged
    // then: it enforces the ceiling, and it is not vacuously clean
    const workflow = readFileSync(join(REPO_ROOT, WORKFLOW_REL), 'utf8');
    expect(workflow.length, 'ci.yml read as empty').toBeGreaterThan(1000);

    const block = jobBlock(workflow, JOB);
    const problems = wiringProblems(block ?? '');
    expect(
      problems,
      `the ${JOB} job does not enforce the ceiling:\n${problems.join('\n')}`
    ).toEqual([]);
    expect(block).not.toBeNull();
  });

  it('F: should find no such job in a workflow that has none, so a rename cannot pass silently', () => {
    // given: a workflow without a duration job
    // when: the job is sliced out of it
    // then: nothing is found, and that is asserted rather than skipped
    expect(jobBlock('jobs:\n  test:\n    runs-on: ubuntu-latest\n', JOB)).toBeNull();
  });

  it('G: should run the unit suite in the `test` job at the concurrency the ceiling names', () => {
    // given: the `test` job of the real workflow
    // when: its unit-suite step is sliced out
    // then: the step sets PEAKS_VITEST_MAX_WORKERS to '4', because the ceiling is enforced at
    //       that concurrency and a measurement at another one is not comparable with it
    const workflow = readFileSync(join(REPO_ROOT, WORKFLOW_REL), 'utf8');
    const block = jobBlock(workflow, TEST_JOB);
    expect(block, 'the `test` job is absent from ci.yml').not.toBeNull();
    const step = stepBlock(block ?? '', TEST_STEP);
    expect(step, 'the unit-suite step is absent from the `test` job').not.toBeNull();
    expect(step).toContain("PEAKS_VITEST_MAX_WORKERS: '4'");
  });

  it('H: should find a tracked ceiling artifact whose shape the gate can read', () => {
    // given: the artifact this repository tracks
    // when: it is read off disk
    // then: it names a positive ceiling, a positive concurrency key and a positive population
    const raw = readFileSync(join(REPO_ROOT, CEILING_REL), 'utf8');
    const artifact = JSON.parse(raw) as {
      ceiling: { wallSeconds: number; maxWorkers: number };
      population: { files: number };
    };
    expect(artifact.ceiling.wallSeconds).toBeGreaterThan(0);
    expect(artifact.ceiling.maxWorkers).toBeGreaterThan(0);
    expect(artifact.population.files).toBeGreaterThan(0);
  });
});

describe('Scenario: a11y — the refusal names the job and the defect', () => {
  it('I: should name the job and what to change in every refusal', () => {
    // given: three blocks that each fail the wiring in a different way
    // when: the predicate reports on them
    // then: each report names the job and its own defect, so a maintainer knows what to edit
    const cases: ReadonlyArray<readonly [string, string]> = [
      [
        'never runs',
        '    runs-on: ubuntu-latest\n    steps:\n      - name: Other\n        run: echo hi'
      ],
      [
        'continue-on-error',
        `    runs-on: ubuntu-latest\n    continue-on-error: true\n    steps:\n      - name: X\n        run: ${STEP}`
      ],
      [
        '|| true',
        `    runs-on: ubuntu-latest\n    steps:\n      - name: X\n        run: ${STEP} || true`
      ]
    ];
    for (const [needle, block] of cases) {
      const problems = wiringProblems(block);
      expect(problems.length, `no problem reported for ${needle}`).toBeGreaterThan(0);
      expect(problems.join(' ')).toContain(JOB);
      expect(problems.join(' ')).toContain(needle);
    }
  });
});
