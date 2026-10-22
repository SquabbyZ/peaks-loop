// tests/unit/hooks/code-gate-relative-base-shell.test.ts
//
// The shell sibling is the second gate, and it carried the same escape: it
// judged a RELATIVE path as spelled, so a call running in `src/` could name
// `deep/x.ts` and reach `src/deep/x.ts`.
//
// It reads the path against the directory the call runs in (`$PWD`) and
// judges the file it lands in, and the Node command must reach the same
// verdict for the same input.
//
// It reads that path TWICE — as it is spelled and as the file really sits
// on disk — and takes the STRICTEST of the two readings. A base that is a
// symlink INSIDE the project pointing at a hard-blocked directory is the
// shape that needs the second reading: the call runs in `to-src/`,
// `to-src/` points at `src/`, and the file it writes lands in `src/`. The
// spelling says `to-src/deep/x.ts` (no family) and the directory the file
// really sits in says `src/deep/x.ts` (a family).
//
// Dimensions covered:
//   - behavior:   the sibling's own reading of a relative path
//   - integration: the sibling spawned with a payload, and the Node command
//     spawned with the same one
//   - a11y:       the deny message names the file and the family
//
// The sibling is not relativizing an ABSOLUTE path — it has no project root
// in the payload's own spelling — so the cases below are relative paths,
// which is where the two gates can be compared.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

declareDimensions(
  'tests/unit/hooks/code-gate-relative-base-shell.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    {
      dim: 'render',
      reason: 'the sibling writes no stdout; its surface is the exit code and the stderr it names'
    }
  ]
);

const ROOT = resolve(__dirname, '..', '..', '..');
const HOOK_SCRIPT = resolve(ROOT, 'src', 'services', 'hooks', 'pre-tool-code-gate.sh');

vi.setConfig({ testTimeout: SUBPROCESS_TEST_TIMEOUT_MS });

const tmpRoots: string[] = [];

/**
 * The links the cases below remove on their own: a recursive remove that
 * walks a link can follow it to the directory it names.
 */
const tmpLinks: string[] = [];

/**
 * A project the sibling can find: it carries a `.peaks` directory, so the
 * walk up from the call's own directory stops there.
 */
function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-code-gate-shell-'));
  tmpRoots.push(root);
  mkdirSync(join(root, '.peaks'), { recursive: true });
  writeFileSync(join(root, '.peaks', 'config.json'), JSON.stringify({ schemaVersion: 1 }));
  mkdirSync(join(root, 'src', 'deep'), { recursive: true });
  mkdirSync(join(root, 'docs'), { recursive: true });
  mkdirSync(join(root, 'bin'), { recursive: true });
  return root;
}

/**
 * A project whose OWN `to-src` points at its `src/`, so the directory the
 * call runs in is named `to-src` while the file it lands in lives under
 * `src`. The file every case below names is `<root>/src/deep/x.ts`.
 *
 * The link is a JUNCTION on Windows and a symlink on POSIX: `symlinkSync`
 * reads the type on Windows only, and a junction needs no elevation, so the
 * case runs the same way on every platform.
 */
function makeLinkedProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-code-gate-shell-linked-'));
  tmpRoots.push(root);
  mkdirSync(join(root, '.peaks'), { recursive: true });
  writeFileSync(join(root, '.peaks', 'config.json'), JSON.stringify({ schemaVersion: 1 }));
  mkdirSync(join(root, 'src', 'deep'), { recursive: true });
  writeFileSync(join(root, 'src', 'deep', 'x.ts'), 'x');
  mkdirSync(join(root, 'docs'), { recursive: true });
  const junction = join(root, 'to-src');
  symlinkSync(join(root, 'src'), junction, 'junction');
  tmpLinks.push(junction);
  const docsLink = join(root, 'to-docs');
  symlinkSync(join(root, 'docs'), docsLink, 'junction');
  tmpLinks.push(docsLink);
  return root;
}

/** A tool call, stating the directory it runs in. */
function payload(filePath: string, cwd: string): string {
  return JSON.stringify({ tool: 'Edit', input: { file_path: filePath }, cwd });
}

/** The sibling, run in the directory the call runs in. */
function runShellSibling(
  root: string,
  stdin: string,
  cwd: string
): { status: number | null; stderr: string } {
  const run = spawnSync('bash', [HOOK_SCRIPT], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    input: stdin
  });
  return { status: run.status, stderr: run.stderr ?? '' };
}

/** The Node command, run with the same payload and the same project. */
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

afterEach(() => {
  while (tmpLinks.length > 0) {
    const link = tmpLinks.pop();
    if (link !== undefined) unlinkSync(link);
  }
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

describe('behavior — the sibling reads a relative path against the call directory', () => {
  it(
    'when the call runs in a subdirectory, should deny the file it lands in',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a project, and a call that runs in its `src` directory
      // when: the payload names `deep/x.ts`
      // then: the sibling refuses, because the file is `src/deep/x.ts`
      const root = makeProject();

      const result = runShellSibling(
        root,
        payload('deep/x.ts', join(root, 'src')),
        join(root, 'src')
      );

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');
    }
  );

  it(
    'when the call runs in the project root, should keep every earlier verdict',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a project, and a call that runs in it
      // when: the payload names a blocked file and an allow-listed one
      // then: the first is refused and the second is allowed
      const root = makeProject();

      const blocked = runShellSibling(root, payload('src/x.ts', root), root);
      const allowed = runShellSibling(root, payload('docs/spec.md', root), root);

      expect(blocked.status).toBe(2);
      expect(allowed.status).toBe(0);
    }
  );

  it(
    'when the call runs outside the project, should keep reading the spelling',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a project, and a call that runs in another directory
      // when: the payload names a blocked spelling
      // then: the sibling refuses it — the project can only read the spelling
      const root = makeProject();

      const result = runShellSibling(
        root,
        payload('src/x.ts', resolve(root, '..')),
        resolve(root, '..')
      );

      expect(result.status).toBe(2);
    }
  );
});

describe('integration — the two gates reach the same verdict', () => {
  const cases: ReadonlyArray<{
    readonly label: string;
    readonly dir: (root: string) => string;
    readonly filePath: string;
    readonly verdict: 'deny' | 'allow';
  }> = [
    {
      label: 'a blocked file in the project root',
      dir: (r) => r,
      filePath: 'src/x.ts',
      verdict: 'deny'
    },
    {
      label: 'an allow-listed file in the project root',
      dir: (r) => r,
      filePath: 'docs/spec.md',
      verdict: 'allow'
    },
    {
      label: 'a file that lands in a family from inside it',
      dir: (r) => join(r, 'src'),
      filePath: 'deep/x.ts',
      verdict: 'deny'
    },
    {
      label: 'a file beside the family directory',
      dir: (r) => join(r, 'src'),
      filePath: 'x.ts',
      verdict: 'deny'
    },
    {
      label: 'a file that leaves the family directory',
      dir: (r) => join(r, 'src'),
      filePath: '../docs/spec.md',
      verdict: 'allow'
    },
    {
      label: 'a file that stays in the family directory',
      dir: (r) => join(r, 'src'),
      filePath: '../src/deep/x.ts',
      verdict: 'deny'
    },
    {
      label: 'a markdown file in the family directory',
      dir: (r) => join(r, 'src'),
      filePath: 'notes.md',
      verdict: 'allow'
    },
    {
      label: 'a binary entrypoint in the project root',
      dir: (r) => r,
      filePath: 'bin/peaks.js',
      verdict: 'deny'
    },
    {
      label: 'a unit test in the project root',
      dir: (r) => r,
      filePath: 'tests/unit/x.test.ts',
      verdict: 'deny'
    }
  ];

  for (const testCase of cases) {
    it(
      `when the case is ${testCase.label}, should reach the same verdict in both gates`,
      { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
      () => {
        // given: one payload, one project, and one directory the call runs in
        // when: the Node command and the shell sibling are both given it
        // then: both reach the same verdict
        const root = makeProject();
        const cwd = testCase.dir(root);
        const stdin = payload(testCase.filePath, cwd);

        const cli = runCodeGate(root, stdin, cwd);
        const shell = runShellSibling(root, stdin, cwd);

        const cliVerdict = cli.stdout.includes('"action": "deny"') ? 'deny' : 'allow';
        const shellVerdict = shell.status === 2 ? 'deny' : 'allow';

        expect(cliVerdict, `node: ${cli.stdout}`).toBe(testCase.verdict);
        expect(shellVerdict, `shell: ${shell.stderr}`).toBe(testCase.verdict);
        expect(cliVerdict).toBe(shellVerdict);
      }
    );
  }

  it(
    'when a spelling reaches a blocked family, should not let any of them through',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a call running in `src/`, and the file it is reaching
      // when: the same file is named four ways
      // then: every spelling is denied, in both gates
      const root = makeProject();
      const cwd = join(root, 'src');
      const spellings = ['deep/x.ts', './deep/x.ts', 'sub/../deep/x.ts', '../src/deep/x.ts'];

      for (const spelling of spellings) {
        const stdin = payload(spelling, cwd);
        const cli = runCodeGate(root, stdin, cwd);
        const shell = runShellSibling(root, stdin, cwd);

        expect(cli.stdout, `node: ${spelling}`).toContain('"action": "deny"');
        expect(shell.status, `shell: ${spelling}`).toBe(2);
      }
    }
  );

  it(
    'when a spelling carries a doubled separator, should reach the same verdict in both gates',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a call running in `src/`, and the file it is reaching
      // when: the same file is named with a doubled separator, which the
      // sibling's `./`-strip would turn into a leading `/`
      // then: every spelling is denied, in both gates
      const root = makeProject();
      const cwd = join(root, 'src');
      const spellings = [
        './/deep/x.ts',
        './//deep/x.ts',
        '././/deep/x.ts',
        './/./deep/x.ts',
        './/a/b/../../deep/x.ts',
        './/../src/deep/x.ts',
        './/deep//x.ts',
        './/x.ts'
      ];

      for (const spelling of spellings) {
        const stdin = payload(spelling, cwd);
        const cli = runCodeGate(root, stdin, cwd);
        const shell = runShellSibling(root, stdin, cwd);

        expect(cli.stdout, `node: ${spelling}`).toContain('"action": "deny"');
        expect(shell.status, `shell: ${spelling}`).toBe(2);
        expect(shell.stderr, `shell: ${spelling}`).toContain('src/');
      }
    }
  );
});

describe('integration — the two gates agree when the base is a symlink', () => {
  const cases: ReadonlyArray<{
    readonly label: string;
    readonly dir: (root: string) => string;
    readonly filePath: string;
    readonly verdict: 'deny' | 'allow';
  }> = [
    {
      label: 'a file that lands in the family the link points at',
      dir: (r) => join(r, 'to-src'),
      filePath: 'deep/x.ts',
      verdict: 'deny'
    },
    {
      label: 'a file beside the family the link points at',
      dir: (r) => join(r, 'to-src'),
      filePath: 'x.ts',
      verdict: 'deny'
    },
    {
      label: 'a file that leaves the family the link points at',
      dir: (r) => join(r, 'to-src'),
      filePath: '../docs/spec.md',
      verdict: 'allow'
    },
    {
      label: 'a file that lands in an allow-listed directory the link points at',
      dir: (r) => join(r, 'to-docs'),
      filePath: 'spec.txt',
      verdict: 'allow'
    }
  ];

  for (const testCase of cases) {
    it(
      `when the case is ${testCase.label}, should reach the same verdict in both gates`,
      { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
      () => {
        // given: a project whose own directory is named by a link, and a call
        //   that runs in that directory
        // when: the Node command and the shell sibling are both given the
        //   payload, from the directory the call runs in
        // then: both reach the same verdict — the file is judged by the
        //   directory it REALLY sits in
        const root = makeLinkedProject();
        const cwd = testCase.dir(root);
        const stdin = payload(testCase.filePath, cwd);

        const cli = runCodeGate(root, stdin, cwd);
        const shell = runShellSibling(root, stdin, cwd);

        const cliVerdict = cli.stdout.includes('"action": "deny"') ? 'deny' : 'allow';
        const shellVerdict = shell.status === 2 ? 'deny' : 'allow';

        expect(cliVerdict, `node: ${cli.stdout}`).toBe(testCase.verdict);
        expect(shellVerdict, `shell: ${shell.stderr}`).toBe(testCase.verdict);
        expect(cliVerdict).toBe(shellVerdict);
      }
    );
  }

  it(
    'when the base points at a hard-blocked directory, should deny the file it lands in',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a project whose own `to-src` points at its `src/`
      // when: the call runs in `to-src` and writes `deep/x.ts`
      // then: the sibling refuses it — the file really lands in `src/`
      const root = makeLinkedProject();
      const cwd = join(root, 'to-src');

      const result = runShellSibling(root, payload('deep/x.ts', cwd), cwd);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');
      expect(result.stderr).toContain('src/');
    }
  );

  it(
    'when the base points at a hard-blocked directory, should name the family it landed in',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: the same project
      // when: the sibling refuses the file
      // then: the message names the `src/` family and the file it was asked for
      const root = makeLinkedProject();
      const cwd = join(root, 'to-src');

      const result = runShellSibling(root, payload('deep/x.ts', cwd), cwd);

      expect(result.stderr).toContain('src/');
      expect(result.stderr).toContain('deep/x.ts');
    }
  );
});

describe('a11y — the deny message names the file and the family', () => {
  it(
    'when the sibling refuses a relative path, should name the family it landed in',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a call running in `src/`, and a relative path
      // when: the sibling refuses it
      // then: the message names the `src/` family and the file it was asked for
      const root = makeProject();
      const cwd = join(root, 'src');

      const result = runShellSibling(root, payload('deep/x.ts', cwd), cwd);

      expect(result.stderr).toContain('src/');
      expect(result.stderr).toContain('deep/x.ts');
    }
  );
});
