// tests/unit/lint/gate-changed-tag-push-base.test.ts
//
// A TAG PUSH IS MEASURED AGAINST THE PREVIOUS RELEASE, NOT AGAINST origin/main.
//
// `git push origin vX.Y.Z` runs the push gate after main was already pushed, so the
// default base `origin/main...HEAD` is empty by construction and the gate refused
// every release tag. `.husky/pre-push` now hands the pushed ref lines to the
// changed-set gate; a tag-only push takes the release tag before the tagged commit as
// its base. These arms pin that rule against the real gate in a throwaway repository:
//
//   A  tag-only push, previous tag exists     → measured vs the previous tag, exit 0
//   B  tag-only push, no previous tag          → REFUSED, exit 1 (never a silent pass)
//   C  explicit PEAKS_GATE_CHANGED_BASE       → wins over the tag rule, no fallback
//   D  branch push                             → the branch base list, unchanged
//   E  tag push naming two tagged commits      → REFUSED, exit 1 (one base cannot cover both)
//   F  previous tag named like a git OPTION   → REFUSED, and no file is written
//
// NOTHING IS WRITTEN INTO THE REPOSITORY. Every arm runs in its own fixture repository
// under OS tmp, removed in `afterAll`.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';
import { createFixture, type Fixture } from './_file-size-hooks-fixture.js';

declareDimensions(
  'tests/unit/lint/gate-changed-tag-push-base.test.ts',
  ['integration', 'a11y'],
  [
    {
      dim: 'render',
      reason:
        'the subject is a process exit code and its sentence; there is no structured output shape to assert'
    },
    {
      dim: 'behavior',
      reason:
        'every arm runs the gate as a child process over a real git repository, so the boundary (git, spawn) is the dimension under test'
    }
  ]
);

const GATE_REL = join('.husky', 'peaks-gate.mjs');
const ARTIFACT_REL = join('.peaks', 'lint', 'gate-baseline.json');
const ZERO_SHA = '0'.repeat(40);

type GateRun = { code: number; out: string };

const fixtures: Fixture[] = [];

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
}

/** A fresh fixture repository whose HEAD carries the artifact the gate reads, and no tags. */
function newRepo(): Fixture {
  const f = createFixture('gate-tag-push-base');
  fixtures.push(f);
  f.write(
    ARTIFACT_REL,
    `${JSON.stringify(
      {
        version: 3,
        scope: { dirs: ['src'], extensions: 'ts, tsx, mts, cts, mjs, cjs, js' },
        phantomRules: [],
        ceilings: {},
        files: {}
      },
      null,
      2
    )}\n`
  );
  f.commitAll('fixture: artifact');
  return f;
}

/** A docs-only commit, so the diff under test contains no in-scope file. */
function docsCommit(f: Fixture, body: string, message: string): void {
  f.write('README.md', body);
  f.commitAll(message);
}

const shaOf = (f: Fixture, rev = 'HEAD'): string => git(f.root, ['rev-parse', rev]).trim();

/** One pushed-ref line as git feeds pre-push: `<local ref> <local sha> <remote ref> <remote sha>`. */
const pushLine = (remoteRef: string, localSha: string): string =>
  `${remoteRef} ${localSha} ${remoteRef} ${ZERO_SHA}`;

/** The real changed-set gate, run in the fixture with the push refs it would be handed. */
function runChanged(f: Fixture, pushRefs: string | undefined, base?: string): GateRun {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // The arms set these explicitly; an inherited value would make them unreadable.
  delete env.PEAKS_GATE_CHANGED_BASE;
  delete env.PEAKS_PUSH_REFS;
  if (base !== undefined) env.PEAKS_GATE_CHANGED_BASE = base;
  if (pushRefs !== undefined) env.PEAKS_PUSH_REFS = pushRefs;
  const spawned = spawnSync(process.execPath, [GATE_REL, 'changed'], {
    cwd: f.root,
    encoding: 'utf8',
    windowsHide: true,
    env
  });
  if (spawned.error !== undefined) throw spawned.error;
  return { code: spawned.status ?? 1, out: `${spawned.stdout ?? ''}${spawned.stderr ?? ''}` };
}

afterAll(() => {
  for (const f of fixtures) f.cleanup();
});

describe('Scenario: integration — a tag push is measured against the previous release', () => {
  it(
    'A: when a tag-only push is measured, should measure the release against the previous tag',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: v1.0.0 at the artifact commit, then one docs-only commit tagged v1.1.0
      // when:  the push gate is handed the tag-only push of v1.1.0
      // then:  the base is v1.0.0, not origin/main; the docs-only diff is an honest empty set
      const f = newRepo();
      git(f.root, ['tag', 'v1.0.0']);
      docsCommit(f, '# fixture\n', 'docs-only change for the release');
      git(f.root, ['tag', 'v1.1.0']);

      const run = runChanged(f, pushLine('refs/tags/v1.1.0', shaOf(f)));

      expect(run.code, run.out).toBe(0);
      expect(run.out).toContain('EMPTY CHANGE SET (changed vs v1.0.0)');
      expect(run.out).not.toContain('origin/main');
    }
  );

  it(
    'B: when a tag push has no previous release tag, should REFUSE — never pass on an unmeasured set',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a repository with commits and no tag anywhere
      // when:  the push gate is handed a tag push of HEAD
      // then:  a loud refusal that names the missing previous release
      const f = newRepo();
      docsCommit(f, '# fixture\n', 'docs-only change');

      const run = runChanged(f, pushLine('refs/tags/v1.0.0', shaOf(f)));

      expect(run.code, run.out).toBe(1);
      expect(run.out).toContain('cannot find the release tag before');
      expect(run.out).toContain('REFUSING to pass');
      expect(run.out).not.toContain('EMPTY CHANGE SET');
    }
  );

  it(
    'C: when PEAKS_GATE_CHANGED_BASE is explicit, should win over the tag rule, with no fallback',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: v1.0.0 exists, and the operator names a different commit as the base
      // when:  the same tag push arrives with the override set
      // then:  the named base is the one measured; the previous tag is not consulted
      const f = newRepo();
      git(f.root, ['tag', 'v1.0.0']);
      docsCommit(f, '# fixture\n', 'first docs-only change');
      const named = shaOf(f);
      docsCommit(f, '# fixture v2\n', 'second docs-only change');
      git(f.root, ['tag', 'v1.1.0']);

      const run = runChanged(f, pushLine('refs/tags/v1.1.0', shaOf(f)), named);

      expect(run.code, run.out).toBe(0);
      expect(run.out).toContain(`vs ${named}`);
      expect(run.out).not.toContain('vs v1.0.0');
    }
  );

  it(
    'D: when the push is a branch push, should keep the branch base list and never consult the tags',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a release tag exists, and the push is a branch push of HEAD
      // when:  the gate is handed a branch push
      // then:  the branch resolution runs: origin/main is the first candidate, and the
      //        tag is not the base. The fixture has no remote and its own default branch
      //        name varies by git config, so either branch-side refusal is accepted.
      const f = newRepo();
      git(f.root, ['tag', 'v1.0.0']);
      docsCommit(f, '# fixture\n', 'docs-only change');

      const run = runChanged(f, `refs/heads/main ${shaOf(f)} refs/heads/main ${ZERO_SHA}`);

      expect(run.code, run.out).toBe(1);
      expect(run.out).toMatch(/origin\/main|main resolves to HEAD/);
      expect(run.out).not.toContain('vs v1.0.0');
    }
  );

  it(
    'E: when a tag push names two different tagged commits, should REFUSE — one base cannot cover both',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: two release tags on two different commits, pushed together
      // when:  both tag refs are handed to the gate in one push
      // then:  a refusal naming the ambiguity, not a measurement against one of them
      const f = newRepo();
      git(f.root, ['tag', 'v1.0.0']);
      docsCommit(f, '# fixture\n', 'docs-only change');
      git(f.root, ['tag', 'v1.1.0']);

      const run = runChanged(
        f,
        [
          pushLine('refs/tags/v1.0.0', shaOf(f, 'v1.0.0')),
          pushLine('refs/tags/v1.1.0', shaOf(f, 'v1.1.0'))
        ].join('\n')
      );

      expect(run.code, run.out).toBe(1);
      expect(run.out).toContain('names 2 different tagged commits');
      expect(run.out).toContain('REFUSING to pass');
    }
  );

  it(
    'F: when a previous tag NAME looks like a git option, should be refused and write no file',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a previous release tag whose name git would read as an OPTION. git
      //        accepts such a ref (`git update-ref refs/tags/--output=x` succeeds), and
      //        `git diff --output=x` WRITES a file — so a tag name must never reach a git
      //        argv position.
      // when:  the push gate is handed the tag push of v1.1.0
      // then:  it refuses — a name that cannot be resolved as a ref is not a base
      const f = newRepo();
      git(f.root, ['update-ref', 'refs/tags/--output=pwned.txt', 'HEAD']);
      docsCommit(f, '# fixture\n', 'docs-only change');
      git(f.root, ['tag', 'v1.1.0']);

      const run = runChanged(f, pushLine('refs/tags/v1.1.0', shaOf(f)));

      expect(run.code, run.out).toBe(1);
      expect(run.out).toContain('cannot find the release tag before');
      expect(run.out).toContain('REFUSING to pass');
      // and:  no file was written by the option-shaped name
      const stray = readdirSync(f.root).filter((n) => n.startsWith('pwned'));
      expect(stray).toEqual([]);
      expect(existsSync(join(f.root, 'pwned.txt'))).toBe(false);
    }
  );
});
