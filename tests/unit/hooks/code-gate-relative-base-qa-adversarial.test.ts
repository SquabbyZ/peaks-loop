// tests/unit/hooks/code-gate-relative-base-qa-adversarial.test.ts
//
// QA's independent adversarial cases for the slice
// `2026-10-22-code-gate-relative-base`.
//
// The RD's two suites cover the case the owner's ruling names and the
// agreement of the two gates. These cases try to BREAK the fix: every
// spelling of the same file, the Windows spellings, the case variants, the
// paths that climb out of the project, the payload shapes that carry no
// directory or a false one, and the two gates measured against each other.
//
// Two cases here used to PIN a behaviour that QA found DEFICIENT rather
// than correct: the sibling's `./`-strip escape and the Node command's
// trust in a payload `cwd` that is not a usable directory. Round 1 of the
// QA review returned `return-to-rd` on both, and the repair closed both.
// The cases below therefore PIN CLOSED HOLES now — they assert the deny
// that the repair produces, so a regression re-opens them loudly.
//
// Dimensions covered:
//   - behavior:   the pure decision and the payload reader
//   - integration: the Node command and the shell sibling, on one payload
//   - a11y:       the message a denial carries

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { decideGateAction } from '~/src/services/hooks/pre-tool-code-gate';
import { readToolCallCwd } from '~/src/services/hooks/hook-payload-cwd';
import { runHook } from '../_setup/code-gate-shell-harness.js';
import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

declareDimensions(
  'tests/unit/hooks/code-gate-relative-base-qa-adversarial.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    {
      dim: 'render',
      reason:
        'neither gate writes stdout text; the Node command’s JSON envelope belongs to its own suite'
    }
  ]
);

const ROOT = resolve(__dirname, '..', '..', '..');

vi.setConfig({ testTimeout: SUBPROCESS_TEST_TIMEOUT_MS });

const tmpRoots: string[] = [];

/** A project the sibling can find: it carries a `.peaks` directory. */
function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-code-gate-qa-'));
  tmpRoots.push(root);
  mkdirSync(join(root, '.peaks'), { recursive: true });
  writeFileSync(join(root, '.peaks', 'config.json'), JSON.stringify({ schemaVersion: 1 }));
  for (const dir of ['src/deep', 'src/a/b', 'docs', 'bin']) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  return root;
}

/** A tool call naming a path, and optionally the directory it runs in. */
function payload(filePath: string, cwd?: string): string {
  return JSON.stringify({
    tool: 'Edit',
    input: { file_path: filePath },
    ...(cwd === undefined ? {} : { cwd })
  });
}

/** The Node command, run in the directory the call runs in. */
function runCodeGate(
  root: string,
  stdin: string,
  cwd: string
): { status: number | null; stdout: string } {
  const run = spawnSync(
    process.execPath,
    [
      join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      join(ROOT, 'src', 'cli', 'index.ts'),
      'code-gate',
      '--project',
      root,
      '--dry-run',
      '--json'
    ],
    { cwd, encoding: 'utf8', windowsHide: true, input: stdin, env: { ...process.env } }
  );
  return { status: run.status, stdout: run.stdout ?? '' };
}

/**
 * The sibling's OWN decision.
 *
 * The sibling is a thin wrapper over the Node command: where a command is
 * reachable it execs it, so running it against the command would compare the
 * command with itself. It is therefore run with NO command reachable at all,
 * and what answers is the conservative path inside it — the one a harness
 * without Node gets.
 */
function runShellSibling(
  root: string,
  stdin: string,
  cwd: string
): { status: number | null; stderr: string } {
  const run = runHook({ payload: stdin, cwd, args: [root], cli: false });
  return { status: run.status, stderr: run.stderr };
}

/** The verdict the Node command reached. */
function nodeVerdict(stdout: string): 'deny' | 'allow' {
  return stdout.includes('"action": "deny"') ? 'deny' : 'allow';
}

/** The verdict the shell sibling reached. */
function shellVerdict(status: number | null): 'deny' | 'allow' {
  return status === 2 ? 'deny' : 'allow';
}

/**
 * Every spelling of the file `<root>/src/deep/x.ts`, read from `<root>/src`.
 * Each one NAMES that file, so each one must reach the `src/` family.
 */
const SPELLINGS_OF_THE_BLOCKED_FILE = [
  'deep/x.ts',
  './deep/x.ts',
  '././deep/x.ts',
  'sub/../deep/x.ts',
  './sub/../deep/x.ts',
  'a/../deep/x.ts',
  'a/b/../../deep/x.ts',
  '../src/deep/x.ts',
  '../src/./deep/x.ts',
  '..\\src\\deep\\x.ts',
  'deep\\x.ts',
  'deep//x.ts',
  'SRC/deep/x.ts',
  'Src/deep/x.ts'
];

/**
 * The spellings the sibling's `./`-strip loop used to turn into a leading
 * `/`: it stripped the `./` and then read the leftover `/` as an absolute
 * path, which it never relativized, so the family was never matched. The
 * repair decides "is this absolute?" from the spelling BEFORE the strip, so
 * these are read against the call's own directory like any other relative
 * path — and they deny.
 */
const SPELLINGS_THE_STRIP_USED_TO_ESCAPE = [
  './/deep/x.ts',
  './//deep/x.ts',
  '././/deep/x.ts',
  './/./deep/x.ts',
  './/a/b/../../deep/x.ts',
  './/../src/deep/x.ts',
  './/x.ts'
];

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

describe('behavior — every spelling of a blocked file reaches the family', () => {
  it('when the call runs in a subdirectory, should deny every spelling of the file it lands in', () => {
    // given: a project root, and a tool call that runs in its `src` directory
    // when: each spelling of the file `<root>/src/deep/x.ts` is judged
    // then: every one of them denies, and the reason names the `src/` family
    const root = makeProject();

    for (const spelling of SPELLINGS_OF_THE_BLOCKED_FILE) {
      const verdict = decideGateAction('Edit', { file_path: spelling }, null, {
        projectRoot: root,
        toolCwd: join(root, 'src')
      });

      expect(verdict.action, `spelling: ${spelling}`).toBe('deny');
      if (verdict.action !== 'deny') continue;
      expect(verdict.reason, `spelling: ${spelling}`).toContain('src/');
    }
  });

  it('when the call runs in a subdirectory, should deny the file it lands in from a nested directory', () => {
    // given: a project root, and a tool call that runs in `<root>/src/a/b`
    // when: a relative path that climbs back into the `src/` family is judged
    // then: it denies, because the file it lands in is inside `src/`
    const root = makeProject();

    const verdict = decideGateAction('Edit', { file_path: '../../src/deep/x.ts' }, null, {
      projectRoot: root,
      toolCwd: join(root, 'src', 'a', 'b')
    });

    expect(verdict.action).toBe('deny');
    if (verdict.action !== 'deny') return;
    expect(verdict.reason).toContain('src/');
  });

  it('when the path is absolute, should judge it by where it lands in the project', () => {
    // given: a project root, and a directory outside it
    // when: an absolute path inside the root and one outside it are judged
    // then: the first denies and the second belongs to no family
    const root = makeProject();

    const inside = decideGateAction(
      'Edit',
      { file_path: join(root, 'src', 'deep', 'x.ts') },
      null,
      { projectRoot: root, toolCwd: join(root, 'src') }
    );
    const outside = decideGateAction(
      'Edit',
      { file_path: resolve(root, '..', 'other-repo', 'src', 'x.ts') },
      null,
      { projectRoot: root, toolCwd: join(root, 'src') }
    );

    expect(inside.action).toBe('deny');
    expect(outside.action).toBe('allow');
  });

  it('when the payload states a directory, should read that one and no other', () => {
    // given: a payload whose tool arguments carry a directory of their own
    // when: the directory of the tool call is read
    // then: only the top-level key counts, so the argument is not read
    expect(readToolCallCwd({ cwd: '/tmp/project/src' })).toBe('/tmp/project/src');
    expect(readToolCallCwd({ tool_input: { cwd: '/tmp/project/src' } })).toBeNull();
    expect(readToolCallCwd({ tool_input: { cwd: 42 } })).toBeNull();
    expect(readToolCallCwd({ cwd: '   ' })).toBeNull();
    expect(readToolCallCwd({ cwd: 42 })).toBeNull();
  });
});

describe('integration — the two gates on one payload', () => {
  it('when the case is a spelling of a blocked file, should reach the same verdict in both gates', () => {
    // given: one payload, one project, and the directory the call runs in
    // when: the Node command and the shell sibling are both given it
    // then: both deny it, and name the family
    const root = makeProject();
    const cwd = join(root, 'src');

    for (const spelling of SPELLINGS_OF_THE_BLOCKED_FILE) {
      const stdin = payload(spelling, cwd);
      const cli = runCodeGate(root, stdin, cwd);
      const shell = runShellSibling(root, stdin, cwd);

      expect(nodeVerdict(cli.stdout), `node: ${spelling}`).toBe('deny');
      expect(shellVerdict(shell.status), `shell: ${spelling}`).toBe('deny');
      expect(shell.stderr, `shell: ${spelling}`).toContain('src/');
    }
  });

  it('when the case is a path outside the project, should reach the same verdict in both gates', () => {
    // given: a call running in the project, naming a file outside it
    // when: the Node command and the shell sibling are both given it
    // then: both allow it, because it belongs to no family
    const root = makeProject();
    const cwd = join(root, 'docs');
    const stdin = payload('../docs/spec.md', cwd);

    const cli = runCodeGate(root, stdin, cwd);
    const shell = runShellSibling(root, stdin, cwd);

    expect(nodeVerdict(cli.stdout)).toBe('allow');
    expect(shellVerdict(shell.status)).toBe('allow');
  });

  it('when the case is a spelling the `./`-strip used to escape, should deny in both gates', () => {
    // given: a spelling whose `./`-strip used to leave a leading `/`, which
    // the sibling read as an absolute path and did not relativize
    // when: both gates are given it
    // then: both DENY it, because the file the call writes is
    // `<root>/src/deep/x.ts`, inside the `src/` family
    const root = makeProject();
    const cwd = join(root, 'src');

    for (const spelling of SPELLINGS_THE_STRIP_USED_TO_ESCAPE) {
      const stdin = payload(spelling, cwd);
      const cli = runCodeGate(root, stdin, cwd);
      const shell = runShellSibling(root, stdin, cwd);

      expect(nodeVerdict(cli.stdout), `node: ${spelling}`).toBe('deny');
      expect(shellVerdict(shell.status), `shell: ${spelling}`).toBe('deny');
    }
  });

  it('when the payload states a directory that does not exist, should deny the file the call would really write', () => {
    // given: a call that really runs in `<root>/src`, and a payload whose
    // top-level `cwd` names a directory that is not there
    // when: the payload is judged, with the gate running where the call runs
    // then: the verdict is DENY, because the file the call writes is
    // `<root>/src/deep/x.ts`, inside the `src/` family
    const root = makeProject();
    const cwd = join(root, 'src');
    const stdin = payload('deep/x.ts', join(root, 'no', 'such', 'dir'));

    const cli = runCodeGate(root, stdin, cwd);

    expect(nodeVerdict(cli.stdout)).toBe('deny');
  });
});

describe('integration — a payload directory that cannot be a base', () => {
  it('when the payload states an unusable directory, should deny the file the call would really write', () => {
    // given: a call that really runs in `<root>/src`, and a payload whose
    // top-level `cwd` is one of the shapes that cannot name a directory
    // the gate can resolve a path against
    // when: the gate is run where the call runs, once per shape
    // then: every one of them DENIES, because the file the call writes is
    // `<root>/src/deep/x.ts`, inside the `src/` family
    const root = makeProject();
    const cwd = join(root, 'src');
    const unusable = [
      join(root, 'no', 'such', 'dir'),
      join(root, '.peaks', 'config.json'),
      'no/such/dir',
      resolve(root, '..'),
      '/'
    ];

    for (const stated of unusable) {
      const cli = runCodeGate(root, payload('deep/x.ts', stated), cwd);

      expect(nodeVerdict(cli.stdout), `cwd: ${stated}`).toBe('deny');
    }
  });

  it('when the payload states no directory at all, should deny the file the call would really write', () => {
    // given: a call that really runs in `<root>/src`, and a payload with no
    // top-level `cwd`
    // when: the gate is run where the call runs
    // then: it DENIES, because the gate's own working directory is the
    // call's directory and the file lands inside the `src/` family
    const root = makeProject();
    const cwd = join(root, 'src');

    const cli = runCodeGate(root, payload('deep/x.ts'), cwd);

    expect(nodeVerdict(cli.stdout)).toBe('deny');
  });
});

describe('a11y — what a denial says', () => {
  it('when the gate denies, should name the family and the file the tool asked for', () => {
    // given: a call running in `src/`, naming a file that lands in `src/`
    // when: each gate refuses it
    // then: both name the `src/` family and the path the tool asked for
    const root = makeProject();
    const cwd = join(root, 'src');
    const stdin = payload('deep/x.ts', cwd);

    const cli = runCodeGate(root, stdin, cwd);
    const shell = runShellSibling(root, stdin, cwd);

    expect(cli.stdout).toContain('src/');
    expect(cli.stdout).toContain('deep/x.ts');
    expect(shell.stderr).toContain('src/');
    expect(shell.stderr).toContain('deep/x.ts');
  });
});
