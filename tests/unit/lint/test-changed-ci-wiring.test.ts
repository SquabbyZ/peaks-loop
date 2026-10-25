// tests/unit/lint/test-changed-ci-wiring.test.ts
//
// The CI wiring behind the changed-tests subset: the job exists, it is advisory, it bases the
// diff on an explicit merge-base, and the runner it calls can still tell "the base was wrong"
// from "nothing to run".
//
// WHY THIS IS PINNED IN A TEST RATHER THAN TRUSTED AS PROSE. `scripts/test-changed.mjs` is a
// mature subset runner that had never been called by a workflow: a runner wired to no executor
// is a script, not a signal. And the wiring that would have been written naively is WORSE than
// no wiring — `actions/checkout` leaves a clean worktree at the PR's merge commit, so a base of
// `HEAD` diffs empty, the runner selects nothing, and the job shows a green tick that proves
// nothing next to the red authoritative suite.
//
// WHY THE WORKFLOW IS PARSED AS YAML. The sibling wiring tests slice the file as text, and a
// text slice reaches into the NEXT job's comment — which is how a rationale that merely NAMES a
// key ("no `continue-on-error` here") reads as the key itself. Parsing makes the structural
// properties unambiguous. The COMMENTS are still read as text, because the parser keeps none:
// the advisory split has to be stated IN THE FILE, so it is pinned against the job's comment.
//
// WHY THE RUNNER'S EXIT CODES ARE EXECUTED, NOT MATCHED. A regex over the runner's source can
// only say what the source says. The properties that matter are what the runner DOES with an
// empty selection, so the arms below run the real runner in a scratch repository and read its
// exit code. The control arm matters most: it records what the runner does TODAY with the same
// input, so the flag's effect is a difference between two observed runs, not a flag's name.
//
// Dimensions covered: behavior (the predicates), integration (the real workflow and runner)
// and a11y (the refusal names the base). `render` is omitted: nothing is rendered.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { declareDimensions } from '../_setup/4dim-template.js';
import { createScratchGitRepo, type ScratchGitRepo } from '../_setup/scratch-git-repo.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const WORKFLOW_REL = join('.github', 'workflows', 'ci.yml');
const SUBSET_JOB = 'changed-tests-subset';
const AUTHORITATIVE_JOB = 'test';
/** The runner's own scripts: the fixture runs the REAL runner, so it needs all four. */
const GATE_SCRIPTS = [
  'test-changed.mjs',
  'test-changed-classify.mjs',
  'test-changed-root-tier.mjs',
  'git-hook-env.mjs'
] as const;
/** The classifier's `BASELINE_REL` — the artifact whose stamp alone selects no test. */
const BASELINE_REL = join('.peaks', 'lint', 'gate-baseline.json');
const STUB_VITEST_MARKER = '[stub-vitest] spawned';
const BASE_STAMP = '{"generatedAt": "2026-01-01T00:00:00.000Z"}\n';
const MOVED_STAMP = '{"generatedAt": "2026-06-01T00:00:00.000Z"}\n';

type Step = {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  'continue-on-error'?: boolean;
  with?: Record<string, unknown>;
};
type Job = {
  'runs-on'?: string;
  'timeout-minutes'?: number;
  'continue-on-error'?: boolean;
  if?: string;
  env?: Record<string, string>;
  strategy?: unknown;
  steps?: Step[];
};
type Workflow = { jobs?: Record<string, Job> };

declareDimensions(
  'tests/unit/lint/test-changed-ci-wiring.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    {
      dim: 'render',
      reason:
        'the subject is the workflow and the runner`s exit codes; nothing is rendered, and the operator-facing part is the refusal sentence asserted under a11y'
    }
  ]
);

/** One top-level job's raw block — used for the COMMENTS only, which the parser keeps none
 *  of. `null` means the job is absent. */
export function jobBlock(workflow: string, job: string): string | null {
  const lines = workflow.split('\n');
  const start = lines.indexOf(`  ${job}:`);
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^ {2}[A-Za-z0-9_-]+:$/.test(line));
  const block = (end < 0 ? rest : rest.slice(0, end)).join('\n');
  return block.trim() === '' ? null : block;
}

/** The runner's positional arguments — the base it diffs against. The runner takes the LAST
 *  non-flag argument as its base; the scan stops at the first shell operator, because a pipe is
 *  the shell`s business and not an argument the runner ever sees. */
export function baseArguments(invocation: string): string[] {
  const tokens = invocation.split(/\s+/).filter((token) => token !== '');
  const start = tokens.findIndex((token) => token.includes('test-changed.mjs'));
  if (start < 0) return [];
  const rest: string[] = [];
  for (const token of tokens.slice(start + 1)) {
    if (/^(?:\||&|;|>)/.test(token)) break;
    rest.push(token);
  }
  return rest
    .filter((token) => !token.startsWith('--'))
    .map((token) => token.replace(/^['"]|['"]$/g, ''));
}

/** Why the advisory job does not deliver the signal it promises, as sentences. `[]` means it
 *  does. EVERY PROPERTY IS A KEY OR A VALUE HERE, never a word in a comment. */
export function subsetJobProblems(job: Job | undefined): string[] {
  const problems: string[] = [];
  if (job === undefined) return [`the ${SUBSET_JOB} job is absent from the workflow`];
  const steps = job.steps ?? [];
  const runs = steps.map((step) => step.run ?? '').filter((run) => run !== '');
  const checkout = steps.find((step) => (step.uses ?? '').startsWith('actions/checkout'));
  const invocation = runs.find((run) => run.includes('scripts/test-changed.mjs'));
  const timeout = job['timeout-minutes'];

  if (job['runs-on'] !== 'ubuntu-latest') problems.push('the job does not run on ubuntu-latest');
  if (job.strategy !== undefined)
    problems.push('the job carries a matrix; the signal is one runner');
  if (typeof job.if !== 'string' || !job.if.includes("'pull_request'")) {
    problems.push('the job does not pin itself to pull_request');
  }
  if (job['continue-on-error'] !== true) {
    problems.push('the job is not advisory (continue-on-error: true)');
  }
  if (checkout === undefined) {
    problems.push('the job checks nothing out');
  } else if (checkout.with?.['fetch-depth'] !== 0) {
    problems.push('the checkout is not full history (fetch-depth: 0)');
  }
  if (typeof timeout !== 'number') {
    problems.push('the job declares no timeout-minutes');
  } else if (timeout < 60) {
    problems.push(`the timeout-minutes (${timeout}) cannot cover the full-suite fallback`);
  }
  if (job.env?.PEAKS_VITEST_MAX_WORKERS !== '4') {
    problems.push("the job does not set PEAKS_VITEST_MAX_WORKERS to '4'");
  }
  if (runs.some((run) => /\bnpx\b/.test(run))) problems.push('a step runs npx');
  if (invocation === undefined) {
    problems.push('the job never runs scripts/test-changed.mjs');
  } else {
    if (!invocation.includes('--require-nonempty')) {
      problems.push('the invocation does not pass --require-nonempty');
    }
    if (baseArguments(invocation).includes('HEAD')) {
      problems.push('the invocation bases the diff on HEAD');
    }
  }
  if (!runs.some((run) => run.includes('git merge-base')))
    problems.push('the job computes no merge-base');
  return problems;
}

/** Why the authoritative job could stop blocking a PR, as sentences. `[]` means it still
 *  blocks. The `continue-on-error` and `if:` checks look at the JOB and at every STEP of it. */
export function authoritativeJobProblems(job: Job | undefined): string[] {
  const problems: string[] = [];
  if (job === undefined) return [`the ${AUTHORITATIVE_JOB} job is absent from the workflow`];
  const steps = job.steps ?? [];
  const timeout = job['timeout-minutes'];

  if (job['continue-on-error'] !== undefined) {
    problems.push('the authoritative job sets continue-on-error');
  }
  for (const step of steps) {
    if (step['continue-on-error'] === true) {
      problems.push(`the step "${step.name ?? '?'}" sets continue-on-error`);
    }
  }
  if (job.if !== undefined) problems.push('the authoritative job carries an `if:`');
  for (const step of steps) {
    if (step.if !== undefined) problems.push(`the step "${step.name ?? '?'}" carries an \`if:\``);
  }
  const fullSuite = steps.find((step) => {
    const run = (step.run ?? '').trim();
    return /^npx vitest run\b/.test(run) && !/\.test\.ts|\btests\//.test(run);
  });
  if (fullSuite === undefined)
    problems.push('the authoritative job no longer runs the whole suite');
  if (typeof timeout !== 'number') {
    problems.push('the authoritative job declares no timeout-minutes');
  } else if (timeout < 60) {
    problems.push(`the authoritative job's timeout-minutes (${timeout}) is below 60`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// the fixture — the REAL runner, in a scratch repository
// ---------------------------------------------------------------------------

/** The stub the runner spawns instead of vitest: cheap, and it records what it was handed. */
const STUB_VITEST = `process.stderr.write('${STUB_VITEST_MARKER} ' + process.argv.slice(2).join(' ') + '\\n');\nprocess.exit(0);\n`;

type RunnerFixture = { repo: ScratchGitRepo; env: NodeJS.ProcessEnv; base: string };
type RunnerRun = { status: number | null; stderr: string };

/** git's hook context is what makes a fixture commit land in the HOST repository. */
async function scrubbedEnv(): Promise<NodeJS.ProcessEnv> {
  const url = pathToFileURL(join(REPO_ROOT, 'scripts', 'git-hook-env.mjs')).href;
  const mod = (await import(url)) as {
    scrubGitHookEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
  };
  return mod.scrubGitHookEnv({ ...process.env });
}

/** One git command in the fixture. A refusal THROWS — a fixture that did not run is not a pass. */
function git(cwd: string, args: readonly string[], env: NodeJS.ProcessEnv): string {
  const res = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    env,
    windowsHide: true
  });
  if (res.error !== undefined && res.error !== null) {
    throw new Error(`fixture: git ${args.join(' ')} did not run: ${res.error.message}`);
  }
  if (res.status !== 0) {
    throw new Error(`fixture: git ${args.join(' ')} failed: ${(res.stderr ?? '').trim()}`);
  }
  return res.stdout ?? '';
}

/** A scratch repository holding the runner's OWN scripts, a stub vitest and the gate artifact.
 *  WHY THE SCRIPTS ARE COPIED: the runner resolves its repository root from its own path, so
 *  invoking this repository`s copy would measure THIS repository. */
async function buildRunnerFixture(): Promise<RunnerFixture> {
  const env = await scrubbedEnv();
  const repo = createScratchGitRepo('peaks-changed-ci-');
  git(repo.path, ['config', 'core.autocrlf', 'false'], env);
  mkdirSync(join(repo.path, 'scripts'), { recursive: true });
  for (const name of GATE_SCRIPTS) {
    copyFileSync(join(REPO_ROOT, 'scripts', name), join(repo.path, 'scripts', name));
  }
  mkdirSync(join(repo.path, 'node_modules', 'vitest'), { recursive: true });
  writeFileSync(join(repo.path, 'node_modules', 'vitest', 'vitest.mjs'), STUB_VITEST, 'utf8');
  mkdirSync(join(repo.path, '.peaks', 'lint'), { recursive: true });
  writeFileSync(join(repo.path, BASELINE_REL), BASE_STAMP, 'utf8');
  git(repo.path, ['add', '-A'], env);
  git(repo.path, ['commit', '--quiet', '-m', 'changed-ci fixture base'], env);
  return { repo, env, base: git(repo.path, ['rev-parse', 'HEAD'], env).trim() };
}

/** Run the REAL runner in the fixture; return its exit code and everything it printed. */
function runRunner(fixture: RunnerFixture, args: readonly string[]): RunnerRun {
  const script = join(fixture.repo.path, 'scripts', 'test-changed.mjs');
  const res = spawnSync(process.execPath, [script, ...args], {
    cwd: fixture.repo.path,
    env: fixture.env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000
  });
  if (res.error !== undefined && res.error !== null) {
    throw new Error(`the runner did not run: ${res.error.message}`);
  }
  return { status: res.status, stderr: res.stderr ?? '' };
}

/** Build a fixture, hand it to the arm, and dispose it — the shape every execution arm needs. */
async function withFixture<T>(arm: (fixture: RunnerFixture) => T | Promise<T>): Promise<T> {
  const fixture = await buildRunnerFixture();
  try {
    return await arm(fixture);
  } finally {
    fixture.repo.dispose();
  }
}

describe('Scenario: behavior — the predicates flag each way the wiring can look right and prove nothing', () => {
  const CLEAN_JOB: Job = {
    'runs-on': 'ubuntu-latest',
    'timeout-minutes': 60,
    'continue-on-error': true,
    if: "github.event_name == 'pull_request'",
    env: { PEAKS_VITEST_MAX_WORKERS: '4', TZ: 'UTC' },
    steps: [
      { uses: 'actions/checkout@v4', with: { 'fetch-depth': 0 } },
      { name: 'Base', run: 'git merge-base "origin/${{ github.base_ref }}" HEAD' },
      { name: 'Run', run: 'node scripts/test-changed.mjs --require-nonempty "$SHA"' }
    ]
  };
  const withSteps = (steps: Step[]): Job => ({ ...CLEAN_JOB, steps });

  it('A: when a clean advisory job is judged, should report no problem', () => {
    // given: a job that is ubuntu-only, PR-only, advisory, full-history and merge-based
    // when: the predicate is applied to it
    // then: it reports nothing, so the arms below are not passing vacuously
    expect(subsetJobProblems(CLEAN_JOB)).toEqual([]);
  });

  it('B: when each injected defect is judged, should report that defect', () => {
    // given: eleven jobs, each carrying one way the subset signal can be green and empty
    // when: the same predicate is applied to each of them
    // then: every one is reported, and each report names its own defect
    const cases: ReadonlyArray<readonly [string, Job]> = [
      ['ubuntu-latest', { ...CLEAN_JOB, 'runs-on': 'windows-latest' }],
      ['matrix', { ...CLEAN_JOB, strategy: { matrix: { os: ['ubuntu-latest'] } } }],
      ['pull_request', { ...CLEAN_JOB, if: "github.event_name == 'push'" }],
      ['continue-on-error', { ...CLEAN_JOB, 'continue-on-error': false }],
      ['fetch-depth', withSteps([{ uses: 'actions/checkout@v4', with: { 'fetch-depth': 1 } }])],
      ['timeout-minutes', { ...CLEAN_JOB, 'timeout-minutes': 10 }],
      ['PEAKS_VITEST_MAX_WORKERS', { ...CLEAN_JOB, env: { PEAKS_VITEST_MAX_WORKERS: '2' } }],
      ['npx', withSteps([{ name: 'Run', run: 'npx vitest run tests/unit' }])],
      ['--require-nonempty', withSteps([{ run: 'node scripts/test-changed.mjs "$SHA"' }])],
      ['HEAD', withSteps([{ run: 'node scripts/test-changed.mjs --require-nonempty HEAD' }])],
      [
        'merge-base',
        withSteps([{ run: 'node scripts/test-changed.mjs --require-nonempty "$SHA"' }])
      ]
    ];
    for (const [needle, job] of cases) {
      const problems = subsetJobProblems(job);
      expect(problems.length, `no problem reported for ${needle}`).toBeGreaterThan(0);
      expect(problems.join(' ')).toContain(needle);
    }
  });

  it('C: when the job is absent, should report it rather than pass vacuously', () => {
    // given: a workflow with no such job
    // when: the predicate is applied to it
    // then: it is reported as delivering no signal at all
    expect(subsetJobProblems(undefined)).toHaveLength(1);
  });

  it('D: when the authoritative job is weakened, should report that weakness', () => {
    // given: the authoritative job, healthy, and five variants that each weaken it
    // when: the same predicate is applied to each of them
    // then: every one is reported, and each report names its own defect
    const testStep: Step = {
      name: 'Test',
      run: 'npx vitest run --reporter=default --reporter=github-actions'
    };
    const clean: Job = { 'runs-on': '${{ matrix.os }}', 'timeout-minutes': 60, steps: [testStep] };
    expect(authoritativeJobProblems(clean)).toEqual([]);

    const cases: ReadonlyArray<readonly [string, Job]> = [
      ['continue-on-error', { ...clean, 'continue-on-error': true }],
      ['continue-on-error', { ...clean, steps: [{ ...testStep, 'continue-on-error': true }] }],
      ['`if:`', { ...clean, if: "github.event_name == 'push'" }],
      ['`if:`', { ...clean, steps: [{ ...testStep, if: "github.event_name == 'push'" }] }],
      [
        'whole suite',
        { ...clean, steps: [{ name: 'Test', run: 'npx vitest run tests/unit/services' }] }
      ],
      ['timeout-minutes', { ...clean, 'timeout-minutes': 30 }]
    ];
    for (const [needle, job] of cases) {
      const problems = authoritativeJobProblems(job);
      expect(problems.length, `no problem reported for ${needle}`).toBeGreaterThan(0);
      expect(problems.join(' ')).toContain(needle);
    }
  });
});

describe('Scenario: integration — the real workflow carries the job, and the real runner keeps its contract', () => {
  it('E: when the real workflow is judged, should carry the advisory job wired as the signal needs', () => {
    // given: the workflow this repository runs
    // when: it is parsed and the subset job is judged
    // then: it is ubuntu-only, PR-only, advisory, full-history, merge-based and flag-carrying
    const workflow = readFileSync(join(REPO_ROOT, WORKFLOW_REL), 'utf8');
    expect(workflow.length, 'ci.yml read as empty').toBeGreaterThan(1000);
    const parsed = parseYaml(workflow) as Workflow;

    const problems = subsetJobProblems(parsed.jobs?.[SUBSET_JOB]);
    expect(
      problems,
      `the ${SUBSET_JOB} job does not deliver the signal:\n${problems.join('\n')}`
    ).toEqual([]);
  });

  it('F: when the authoritative job is judged, should still block a PR with the full suite', () => {
    // given: the same workflow
    // when: the authoritative job is judged
    // then: it still runs the whole suite, still has no `if:` and no continue-on-error, and its
    //       timeout is still at least 60 — so the advisory job above cannot become the only gate
    const workflow = readFileSync(join(REPO_ROOT, WORKFLOW_REL), 'utf8');
    const parsed = parseYaml(workflow) as Workflow;

    const problems = authoritativeJobProblems(parsed.jobs?.[AUTHORITATIVE_JOB]);
    expect(
      problems,
      `the ${AUTHORITATIVE_JOB} job could stop blocking a PR:\n${problems.join('\n')}`
    ).toEqual([]);
  });

  it('G: when the job comment is read, should say which of the two jobs blocks a merge', () => {
    // given: the real workflow
    // when: the subset job's own comment block is read
    // then: it names the authoritative gate and its own advisory nature, so a reader who only
    //       reads the YAML can tell which job a red belongs to
    const workflow = readFileSync(join(REPO_ROOT, WORKFLOW_REL), 'utf8');
    const comment = jobBlock(workflow, SUBSET_JOB) ?? '';
    expect(comment, 'the advisory job has no comment of its own').not.toBe('');
    expect(comment).toMatch(/authoritative/i);
    expect(comment).toMatch(/advisory/i);
    expect(comment).toContain('`test`');
  });

  it(
    'H: when no base is given, should still diff against HEAD and run the whole suite',
    async () => {
      // given: a scratch repository whose worktree is clean at HEAD — the state a CI checkout is in
      // when: the runner is given no base at all
      // then: it diffs against HEAD, the diff is empty, and the runner runs the WHOLE suite —
      //       which is what the base of HEAD buys, and what the flag below has to refuse
      const run = await withFixture((fixture) => runRunner(fixture, []));
      expect(run.status, run.stderr).toBe(0);
      expect(run.stderr, 'the default base must still be HEAD').toContain('base = HEAD');
      expect(run.stderr).toContain('verdict: empty-diff');
      expect(run.stderr, 'the whole suite runs on an empty diff').toContain(STUB_VITEST_MARKER);
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it(
    'I: when the selection is empty, should exit 0 without the flag and 2 with it',
    async () => {
      // given: a scratch repository whose only change is the artifact`s generatedAt stamp — the
      //        one change that selects no test at all
      // when: the runner is run twice over that same change, once without the flag and once with
      // then: the default answer is still exit 0 with the loud message, and the flagged answer is
      //        exit 2 — the infrastructure failure CI needs, with the base named
      const { plain, flagged } = await withFixture((fixture) => {
        writeFileSync(join(fixture.repo.path, BASELINE_REL), MOVED_STAMP, 'utf8');
        return {
          plain: runRunner(fixture, [fixture.base]),
          flagged: runRunner(fixture, ['--require-nonempty', fixture.base])
        };
      });
      expect(plain.status, plain.stderr).toBe(0);
      expect(plain.stderr).toContain('0 test files selected');
      expect(flagged.status, flagged.stderr).toBe(2);
      expect(flagged.stderr).toContain('selected 0 test files');
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it(
    'J: when the base selects no file at all, should exit 2 instead of running the suite',
    async () => {
      // given: the same clean scratch repository — a CI checkout with a base of HEAD, whose diff
      //        against that base is empty
      // when: the runner is run with the flag
      // then: it refuses with exit 2 instead of running the whole suite, so a wrong base is a
      //       named failure rather than a green tick beside a red authoritative suite
      const run = await withFixture((fixture) => runRunner(fixture, ['--require-nonempty']));
      expect(run.status, run.stderr).toBe(2);
      expect(run.stderr).toContain('selected 0 changed files');
      expect(run.stderr, 'no suite may run when the base selected nothing').not.toContain(
        STUB_VITEST_MARKER
      );
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );
});

describe('Scenario: a11y — the refusal names the base it used', () => {
  it(
    'K: when the runner refuses, should name the base it used',
    async () => {
      // given: a run that refused an empty selection
      // when: the operator reads what it printed
      // then: the base it resolved to is named, because the base is the thing to change
      await withFixture((fixture) => {
        const run = runRunner(fixture, ['--require-nonempty', fixture.base]);
        expect(run.status, run.stderr).toBe(2);
        expect(run.stderr).toContain(fixture.base);
        expect(run.stderr).toContain('--require-nonempty');
      });
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );
});
