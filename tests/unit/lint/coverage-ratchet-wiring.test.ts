// tests/unit/lint/coverage-ratchet-wiring.test.ts
//
// The CI wiring behind the coverage floor: the `coverage-ratchet` job exists, its step really
// runs the ratchet, and the step CAN fail.
//
// WHY THE WIRING IS PINNED IN A TEST RATHER THAN TRUSTED AS PROSE. This repository has paid
// for the gap twice, and both times it was a green-looking job that ran nothing: a `test:ci`
// leg that could never pass and was called by no workflow, and a README linter reported as
// unit-test coverage because it was collected by the wrong glob. A floor that no job invokes
// is a number in a file. So the job's existence and its single command are asserted here.
//
// WHY A NEGATIVE ARM ON `continue-on-error` AND `|| true`. A step that cannot fail is exactly
// the defect the `format-check` job's own comment names. Either spelling would leave this job
// green while measuring nothing, which is strictly worse than having no gate at all — a
// reader would believe coverage was guarded.
//
// THE INJECTION CONTROL IS IN THIS FILE. Arm A drives the SAME predicate over a block that
// carries each defect, so the predicate cannot pass by being unable to fail. Arm E does the
// same for the extraction: a workflow with no such job yields `null`, and that is asserted
// rather than left to a silent skip.
//
// Dimensions covered:
//   - behavior:    the predicate, on a clean block and on three injected defects
//   - integration: the real `.github/workflows/ci.yml` is read off disk and its job sliced out
//   - a11y:        the refusal names the job and the defect, so a maintainer knows what to edit

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const WORKFLOW_REL = join('.github', 'workflows', 'ci.yml');
const JOB = 'coverage-ratchet';
const STEP = 'node .husky/coverage-ratchet.mjs';

declareDimensions(
  'tests/unit/lint/coverage-ratchet-wiring.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    {
      dim: 'render',
      reason:
        'the subject is the workflow text and a set of wiring problems; nothing is rendered, and the operator-facing part is the refusal sentence asserted under a11y'
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
 * Every `run:` command in a block, trimmed. A `run: |` script block contributes its marker only —
 * the arms below ask whether ONE command equals the expected step, not whether a string is
 * mentioned somewhere.
 */
function runCommands(block: string): string[] {
  return block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('run:'))
    .map((line) => line.slice('run:'.length).trim());
}

/**
 * Why this job block does not enforce anything, as sentences. `[]` means it does.
 *
 * THE STEP IS MATCHED AS A WHOLE COMMAND, NOT AS A SUBSTRING. The first draft used
 * `block.includes(STEP)`, so `run: node .husky/coverage-ratchet.mjs --report /tmp/forged.json`
 * satisfied every arm — a job whose red could be faked by handing the ratchet a report of the
 * author's choosing. The runner's own docstring claimed `--report` "cannot weaken CI … pinned by
 * this test"; the pin did not exist. A documented protection that is not there is worse than an
 * undocumented gap, so the comparison is now exact.
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
  // …and no step may run the ratchet WITH arguments either. A second, argument-carrying step next
  // to a clean one still hands the ratchet a verdict the author chose, so both shapes are refused.
  const withArguments = commands.filter((command) => command.startsWith(STEP) && command !== STEP);
  if (withArguments.length > 0) {
    problems.push(
      `a step in the ${job} job runs \`${STEP}\` with arguments (${withArguments.join(' | ')}), ` +
        'so the verdict is whatever the arguments say rather than what the tree measured'
    );
  }
  if (!block.includes('runs-on: ubuntu-latest')) {
    problems.push(
      `the ${job} job is not pinned to ubuntu-latest, and a coverage job that runs per-OS ` +
        'multiplies a full instrumented suite by the size of the matrix'
    );
  }
  if (block.includes('continue-on-error')) {
    problems.push(`the ${job} job sets continue-on-error, so its red is not a block`);
  }
  if (/\|\|\s*true/.test(block)) {
    problems.push(`a step in the ${job} job ends in \`|| true\`, which swallows its exit code`);
  }
  return problems;
}

describe('Scenario: behavior — the predicate flags each way a job can look green and enforce nothing', () => {
  const clean = [
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - name: Coverage floor',
    `        run: ${STEP}`
  ].join('\n');

  it('A: a clean block has no problems', () => {
    expect(wiringProblems(clean)).toEqual([]);
  });

  it('B: an argument on the step, continue-on-error, `|| true`, a missing step and a missing runs-on are each RED', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      // The exact shape that satisfied every arm of the first draft: the step still NAMES the
      // ratchet, but hands it a report the author chose, so its verdict is the author's.
      ['arguments', clean.split(`run: ${STEP}`).join(`run: ${STEP} --report /tmp/forged.json`)],
      // …and the same trick as an EXTRA step beside a clean one.
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

  it('C: an empty block is red rather than vacuously clean', () => {
    expect(wiringProblems('')).toHaveLength(1);
  });
});

describe('Scenario: integration — the real workflow carries the job', () => {
  it('D: the coverage-ratchet job exists, runs the ratchet, and can fail', () => {
    const workflow = readFileSync(join(REPO_ROOT, WORKFLOW_REL), 'utf8');
    // Non-vacuous: a workflow that failed to read would make the arm below meaningless.
    expect(workflow.length, 'ci.yml read as empty').toBeGreaterThan(1000);

    const block = jobBlock(workflow, JOB);
    const problems = wiringProblems(block ?? '');
    expect(problems, `the ${JOB} job does not enforce the floor:\n${problems.join('\n')}`).toEqual(
      []
    );
    expect(block).not.toBeNull();
  });

  it('E: a workflow with no such job yields null, so a rename cannot pass silently', () => {
    expect(jobBlock('jobs:\n  test:\n    runs-on: ubuntu-latest\n', JOB)).toBeNull();
  });

  it('F: the job block does not swallow the next job', () => {
    const workflow = readFileSync(join(REPO_ROOT, WORKFLOW_REL), 'utf8');
    const block = jobBlock(workflow, JOB) ?? '';
    expect(block).not.toContain('\n  test:');
    expect(block).toContain(`run: ${STEP}`);
  });
});
