/**
 * The push gate's suite must not inherit git's hook context.
 *
 * Rid `2026-10-05-prepush-git-env-leak`. `.husky/pre-push` runs `pnpm test:changed`, whose
 * trigger list sends this repo to the FULL unit suite; git exports `GIT_DIR` to every hook,
 * and dozens of tests build a scratch repo with `git init` in a temp dir and commit into it.
 * With `GIT_DIR` pointing at the host repository those commits land in the host: measured on
 * one pre-push run, 233 arms red across 50 files (the identical suite outside the hook: 0
 * red) and 169 commits titled `fixture` / `baseline` / `init` written onto the branch.
 * Exporting `GIT_DIR` alone takes `tests/unit/services/scan/file-size-scan.test.ts` from
 * 19/19 passed to 18 failed — that is the mechanism, at the size of one file.
 *
 * Dimensions:
 *   - behavior:    the scrub removes exactly the variables that relocate git's context,
 *                  and does not mutate the caller's env (the runner still needs it)
 *   - integration: the scrub is what the SUITE's child process actually receives, proven by
 *                  spawning a real child, and by reading the runner's source so the wiring
 *                  cannot be deleted while these arms keep passing. Source-reading alone
 *                  cannot fail (rid `2026-10-10-gate-classifier-backstop-repair`, M1), so the
 *                  classification arm asserts a PREDICATE that is also shown false on a
 *                  mutated copy of the same source: the runner cannot be un-wired silently.
 *   - a11y:        omitted — this module prints nothing; the human-facing symptom was 233
 *                  false test failures, and the fix's evidence is the arms below
 *   - render:      omitted — no output shape
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/scripts/test-changed-git-env.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'a11y', reason: 'the module prints nothing; the symptom was false test failures' },
    { dim: 'render', reason: 'no output shape of its own' }
  ]
);

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const MODULE_URL = pathToFileURL(join(REPO_ROOT, 'scripts', 'git-hook-env.mjs')).href;
const RUNNER_REL = join('scripts', 'test-changed.mjs');
const CLASSIFIER_REL = join('scripts', 'test-changed-classify.mjs');
const CLASSIFIER_URL = pathToFileURL(join(REPO_ROOT, CLASSIFIER_REL)).href;

type GitHookEnvModule = {
  GIT_CONTEXT_VARS: readonly string[];
  scrubGitHookEnv(env?: Record<string, string | undefined>): Record<string, string | undefined>;
};

/**
 * The classifier's policy surface, as `2026-10-10-gate-classifier-backstop-repair` left it:
 * the rules the runner must NOT restate. Typed here rather than imported statically for the
 * same reason `git-hook-env.mjs` is loaded this way — the sibling carries no `.d.mts`, and the
 * point is that it is importable at all.
 */
type ClassifyModule = {
  BASELINE_REL: string;
  CENSUS_POLICY_REL: string;
  FILE_SET_STATUSES: readonly string[];
  FULL_FALLBACK_EXEMPT: readonly string[];
  FULL_FALLBACK_TRIGGERS: readonly RegExp[];
  GATE_GUARD_SUITES: readonly string[];
  LINT_GUARD_PATH: string;
  STANDARDS_GUARD_PATH: string;
};

async function loadModule(): Promise<GitHookEnvModule> {
  return (await import(MODULE_URL)) as GitHookEnvModule;
}

async function loadClassifier(): Promise<ClassifyModule> {
  return (await import(CLASSIFIER_URL)) as ClassifyModule;
}

// ---------------------------------------------------------------------------
// the runner's wiring to the classifier, as a PREDICATE rather than an assertion.
//
// AC7's warning — "a guard that passes when the wiring is deleted is a vacuous guard" — was
// earned: the first version of this arm pinned the import and the `plan.reasons` loop and
// nothing else, so replacing the `classifyChanged(...)` CALL with a hardcoded plan while
// keeping the import and the loop left it green. A predicate can be shown false on a mutated
// copy of the same source; a bare `expect(source.includes(...))` cannot.
// ---------------------------------------------------------------------------

const CLASSIFIER_IMPORT =
  /import\s*\{[^}]*\bclassifyChanged\b[^}]*\}\s*from\s*['"]\.\/test-changed-classify\.mjs['"]/;
const CLASSIFIER_CALL = /\bclassifyChanged\(\s*[A-Za-z_$][\w$]*/;
const REASONS_PRINTED = /\bplan\.reasons\b/;
const MODE_BRANCHED = /\bplan\.mode\b/;

/** Does the runner still classify through the module, and branch on what it returns? */
function classifyWiringIsIntact(source: string): boolean {
  return (
    CLASSIFIER_IMPORT.test(source) &&
    CLASSIFIER_CALL.test(source) &&
    REASONS_PRINTED.test(source) &&
    MODE_BRANCHED.test(source)
  );
}

/**
 * Source text with quoting, escaping and whitespace removed — the comparison used for the
 * POSITIVE control only ("the classifier really does carry this rule"). Applied to both sides,
 * so `'A', 'D', 'R', 'C'` and `['A','D','R','C']` are the same rule. The runner-side pins use
 * the exact spelling instead: there, the literal IS the thing being forbidden.
 */
function skeleton(source: string): string {
  return source.replace(/[\s'"`\\]/g, '');
}

/**
 * The spelling a path takes when it is written as a regex literal — `.` → `\.`, `/` → `\/`.
 * A path-like rule restated as a pattern (`/^\.peaks\/lint\/gate-baseline\.json$/`) carries no
 * quote character at all, so a quote-only pin would miss it.
 */
function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\//g, '\\/');
}

/**
 * Every way the runner could restate a rule the classifier owns — built FROM the module's own
 * constants, so the pins move with the rules instead of pinning one spelling of them
 * (rid `2026-10-10-gate-classifier-backstop-repair`, M2).
 *
 * Two match modes, because the two kinds of rule fail differently:
 *   `exact`    — a path or pattern restated as a literal. Pinned in every plausible literal
 *                spelling (single quote, double quote, regex literal), so `"…"` and `/^…\.…/`
 *                are caught, not just the `'…'` the first version of this arm checked.
 *   `stripped` — the status LIST restated with arbitrary quoting and spacing. Compared against
 *                the source with quotes/escapes/whitespace removed, so `['A','D','R','C']` is
 *                the same rule as `'A', 'D', 'R', 'C'`.
 *
 * BOUNDARY, stated as a boundary: a trigger respelled as a character class (`/^scripts[/]/`) is
 * not caught — pinning every equivalent regex spelling is not a decidable problem — and a PATH
 * is not `stripped`-pinned, because the runner's prose legitimately names it inside a longer
 * path. The `exact` pins cover the plausible restatements, and the classifier's own arms prove
 * the rules behave.
 */
type RulePin = { rule: string; spelling: string; mode: 'exact' | 'stripped' };

function forbiddenRuleSpellings(mod: ClassifyModule): RulePin[] {
  const pins: RulePin[] = [];
  const exact = (rule: string, spelling: string): void => {
    pins.push({ rule, spelling, mode: 'exact' });
  };
  const pathRules: ReadonlyArray<readonly [string, string]> = [
    ['the guard suite', mod.STANDARDS_GUARD_PATH],
    ['the lint guard suite', mod.LINT_GUARD_PATH],
    ...mod.GATE_GUARD_SUITES.map((suite) => [`the gate guard suite ${suite}`, suite] as const),
    ['the baseline exemption', mod.BASELINE_REL],
    ['the census policy path', mod.CENSUS_POLICY_REL]
  ];
  for (const [rule, value] of pathRules) {
    exact(rule, `'${value}'`);
    exact(rule, `"${value}"`);
    exact(rule, escapeRegexLiteral(value));
  }
  pins.push({
    rule: 'the file-set statuses',
    spelling: mod.FILE_SET_STATUSES.map((status) => `'${status}'`).join(', '),
    mode: 'stripped'
  });
  for (const re of mod.FULL_FALLBACK_TRIGGERS) exact(`the trigger ${re.source}`, re.source);
  return pins;
}

/** The name of the first rule this source restates, or `null` when it restates none. */
function restatedRule(source: string, pins: readonly RulePin[]): string | null {
  const strippedSource = skeleton(source);
  for (const pin of pins) {
    const found =
      pin.mode === 'exact'
        ? source.includes(pin.spelling)
        : strippedSource.includes(skeleton(pin.spelling));
    if (found) return `${pin.rule} (as ${pin.spelling})`;
  }
  return null;
}

/** A host environment with git's hook context injected, as a hook would see it. */
function hookEnv(): Record<string, string | undefined> {
  return {
    PATH: '/usr/bin',
    NODE_ENV: 'test',
    GIT_DIR: '/repo/.git/worktrees/peaks-loop',
    GIT_WORK_TREE: '/repo',
    GIT_INDEX_FILE: '/repo/.git/worktrees/peaks-loop/index',
    GIT_OBJECT_DIRECTORY: '/repo/.git/objects',
    GIT_COMMON_DIR: '/repo/.git',
    GIT_PREFIX: '',
    GIT_QUARANTINE_PATH: '/repo/.git/objects/quarantine',
    GIT_NAMESPACE: 'refs/ns',
    GIT_ALTERNATE_OBJECT_DIRECTORIES: '/repo/alternates',
    GIT_TRACE: '1'
  };
}

describe('Scenario: behavior — the scrub takes git away from the child, not the caller', () => {
  it('removes every variable that relocates git context, and keeps the rest', async () => {
    const mod = await loadModule();
    const scrubbed = mod.scrubGitHookEnv(hookEnv());
    for (const name of mod.GIT_CONTEXT_VARS) {
      expect(scrubbed[name], `${name} must not reach the suite`).toBeUndefined();
    }
    expect(scrubbed.PATH).toBe('/usr/bin');
    expect(scrubbed.NODE_ENV).toBe('test');
    // Not a blanket `GIT_*` wipe: `GIT_TRACE` is a user's own setting, and deleting
    // variables nobody asked about is how a fix makes the hooked run differ from a manual
    // one in a NEW way while solving the old way.
    expect(scrubbed.GIT_TRACE, 'GIT_TRACE is not git context — leave the operator alone').toBe('1');
  });

  it('does not mutate the env it is handed, because the runner still needs its own context', async () => {
    const mod = await loadModule();
    const source = hookEnv();
    mod.scrubGitHookEnv(source);
    expect(source.GIT_DIR, 'process.env-style mutation would break the runner own git calls').toBe(
      '/repo/.git/worktrees/peaks-loop'
    );
    expect(mod.scrubGitHookEnv(source)).not.toBe(source);
  });

  it('is one list in one module: the runner restates no variable name itself', async () => {
    const mod = await loadModule();
    expect(
      mod.GIT_CONTEXT_VARS.length,
      'a 2-item list would not cover a hook env'
    ).toBeGreaterThanOrEqual(6);
    expect(mod.GIT_CONTEXT_VARS).toContain('GIT_DIR');
    expect(mod.GIT_CONTEXT_VARS).toContain('GIT_INDEX_FILE');
    const source = readFileSync(join(REPO_ROOT, RUNNER_REL), 'utf8');
    for (const name of mod.GIT_CONTEXT_VARS) {
      expect(
        source.includes(`'${name}'`),
        `${RUNNER_REL} carries a second copy of ${name} — two lists, one drift`
      ).toBe(false);
    }
  });
});

describe('Scenario: integration — a real child process is what the gate spawns', () => {
  it('a child spawned with the scrubbed env reports no GIT_DIR, while its cwd still finds the repo', async () => {
    const mod = await loadModule();
    const probe = 'process.stdout.write(process.env.GIT_DIR === undefined ? "clean" : "leaked")';
    const withHook = spawnSync(process.execPath, ['-e', probe], {
      env: { ...process.env, GIT_DIR: resolve(REPO_ROOT, '.git') },
      encoding: 'utf8',
      windowsHide: true
    });
    expect(withHook.stdout, 'the probe must see the leak this file exists to stop').toBe('leaked');
    const scrubbed = spawnSync(process.execPath, ['-e', probe], {
      env: mod.scrubGitHookEnv({ ...process.env, GIT_DIR: resolve(REPO_ROOT, '.git') }),
      encoding: 'utf8',
      windowsHide: true
    });
    expect(scrubbed.stdout).toBe('clean');
  });

  it('the runner wires the scrub into the spawn that runs the suite, not just into the module', async () => {
    const source = readFileSync(join(REPO_ROOT, RUNNER_REL), 'utf8');
    expect(
      source.includes('./git-hook-env.mjs'),
      `${RUNNER_REL} no longer imports the scrubber — the gate is leaking again`
    ).toBe(true);
    // Every `spawn(` (the suite's path) must hand over the scrubbed env. `spawnSync(` is
    // the runner's OWN git calls, which must keep the context — so the guard is scoped to
    // the spawn that runs tests, and refuses to pass when the wiring is deleted.
    const spawnBlocks = source.match(/spawn\(cmd, args, \{[\s\S]{0,240}?\}\);/g) ?? [];
    expect(spawnBlocks.length, 'no suite spawn matches this pattern — the guard is vacuous').toBe(
      1
    );
    for (const block of spawnBlocks) {
      expect(
        block.includes('env: suiteEnv()'),
        `the suite spawn would inherit git's hook context:\n${block}`
      ).toBe(true);
    }
  });

  it('when the classification moves, should leave the runner importing it and restating no rule', async () => {
    // given: the rule literals the classifier owns, and the runner's own source text
    // when:  each rule is looked for in the runner and in the classifier
    // then:  the runner imports the module, prints its reasons, and carries no second copy
    const mod = await loadClassifier();
    const runner = readFileSync(join(REPO_ROOT, RUNNER_REL), 'utf8');
    const classifier = readFileSync(join(REPO_ROOT, CLASSIFIER_REL), 'utf8');

    expect(
      runner.includes('./test-changed-classify.mjs'),
      `${RUNNER_REL} no longer imports the classifier — the rules went back inside it`
    ).toBe(true);
    // AC6: the per-mode reason is narrated by the runner, not only produced by the module.
    expect(
      runner.includes('plan.reasons'),
      `${RUNNER_REL} no longer prints the classifier's reasons — the stderr contract lost them`
    ).toBe(true);

    const pins = forbiddenRuleSpellings(mod);
    // The pins below can only be red for the right reason if the rules really live there.
    expect(mod.FULL_FALLBACK_TRIGGERS.length, 'an empty list would make every pin vacuous').toBe(7);
    expect(mod.FULL_FALLBACK_EXEMPT.length).toBeGreaterThanOrEqual(1);
    expect(pins.length, 'an empty pin list cannot fail').toBeGreaterThan(
      mod.FULL_FALLBACK_TRIGGERS.length
    );

    // A re-inlined rule is a LITERAL in code. Prose that names a path is not a rule — which is
    // why the pins are quote- and escape-shaped and the bare prose form is not a pin.
    expect(
      restatedRule(runner, pins),
      `${RUNNER_REL} carries a second copy of a classifier rule`
    ).toBeNull();

    for (const re of mod.FULL_FALLBACK_TRIGGERS) {
      expect(classifier.includes(re.source), `${re.source} must live in the classifier`).toBe(true);
    }
    const strippedClassifier = skeleton(classifier);
    for (const pin of pins) {
      if (pin.rule.startsWith('the trigger')) continue;
      expect(
        strippedClassifier.includes(skeleton(pin.spelling)),
        `${pin.rule} must live in the classifier (control for the runner pin)`
      ).toBe(true);
    }
  });

  it('when a rule is restated in the runner, should show the pin set goes red', async () => {
    // given: the runner's real source, plus five restatements of rules the classifier owns
    // when:  the same pin predicate is asked about each
    // then:  each is caught, so the "no second copy" arm is a guard and not a restatement
    const mod = await loadClassifier();
    const runner = readFileSync(join(REPO_ROOT, RUNNER_REL), 'utf8');
    const pins = forbiddenRuleSpellings(mod);
    const injections: ReadonlyArray<readonly [string, string]> = [
      ['a single-quoted guard path', "const GUARDS = 'tests/unit/standards/';"],
      ['a double-quoted guard path', 'const GUARDS = "tests/unit/standards/";'],
      [
        'the exemption as a regex literal',
        'const EXEMPT = /\\.peaks\\/lint\\/gate-baseline\\.json$/;'
      ],
      ['a re-spaced status list', "const FILE_SET = ['A','D','R','C'];"],
      ['the census policy path', 'const POLICY = "src/services/scan/file-size-policy.ts";']
    ];

    expect(restatedRule(runner, pins), 'control: the unmutated runner restates nothing').toBeNull();
    for (const [label, injection] of injections) {
      const restated = restatedRule(`${runner}\n${injection}\n`, pins);
      expect(restated, `${label} must be caught by a pin`).not.toBeNull();
    }
  });

  it('when the classifier call is replaced by a hardcoded plan, should show the wiring arm goes red', async () => {
    // given: AC8's mutation — the import and the reasons loop kept, the CALL replaced by a literal
    // when:  the arm's own predicate is asked about the mutated source
    // then:  it returns false, so the arm above is a guard rather than a restatement
    const runner = readFileSync(join(REPO_ROOT, RUNNER_REL), 'utf8');

    expect(classifyWiringIsIntact(runner), 'the real runner must satisfy the predicate').toBe(true);

    const hardcoded = runner.replace(
      /classifyChanged\(\s*[A-Za-z_$][\w$]*\s*(?:,\s*\{[^}]*\})?\s*\)/,
      "{ mode: 'full', paths: [], reasons: [], code: 'hardcoded' }"
    );
    expect(hardcoded, 'the mutation must really change the runner').not.toBe(runner);
    expect(
      classifyWiringIsIntact(hardcoded),
      'a hardcoded plan with the import still in place must redden the arm'
    ).toBe(false);

    // The import half is live too: the original AC7 defect (wiring deleted, arm green).
    const unimported = runner.replace(CLASSIFIER_IMPORT, '// the classifier import was deleted');
    expect(unimported, 'the mutation must really change the runner').not.toBe(runner);
    expect(classifyWiringIsIntact(unimported)).toBe(false);
  });
});
