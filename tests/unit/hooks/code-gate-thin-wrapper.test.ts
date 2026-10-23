// tests/unit/hooks/code-gate-thin-wrapper.test.ts
//
// The shell sibling is a THIN WRAPPER over the Node command: where a CLI is
// reachable it execs `peaks code-gate` with the payload on stdin, so there is
// ONE implementation of the rule wherever Node exists and the two cannot
// drift. Where no CLI is reachable it falls back to its own conservative
// guard — and that fallback REFUSES when it cannot place the file, which is
// the refusal that closes the gap where the sibling allowed what the command
// denies.
//
// Three things are pinned here:
//   - the wrapper's plumbing: which CLI it finds, what it forwards, and that
//     the payload arrives unchanged;
//   - the agreement between the wrapper and the Node command over one matrix;
//   - the fallback's contract, exercised in an environment where no command —
//     and no `node` — is reachable at all.
//
// Dimensions covered:
//   - behavior:   the fallback's own decisions
//   - integration: the wrapper, the command, and the environments they run in
//   - a11y:       the refusal each path writes

import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { setPresenceLease } from '~/src/services/skills/presence-lease-service';
import {
  HOOK_SCRIPT,
  REPO_ROOT,
  SOURCE_CLI_MARKER,
  commandReachable,
  runCodeGate,
  nodeOnlyEnv,
  runHook,
  runHookCopy,
  verdictOf,
  withoutCliEnv
} from '../_setup/code-gate-shell-harness.js';
import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

declareDimensions(
  'tests/unit/hooks/code-gate-thin-wrapper.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    {
      dim: 'render',
      reason: 'the wrapper writes no stdout; its surface is the exit code and the stderr it names'
    }
  ]
);

vi.setConfig({ testTimeout: SUBPROCESS_TEST_TIMEOUT_MS });

const SESSION = '2026-10-23-session-thin-wrapper';

/** The project fixture: a peaks workspace with a family directory in it. */
interface Fixture {
  /** The project root. */
  readonly root: string;
  /** A directory OUTSIDE the project. */
  readonly outside: string;
  /** A junction inside the project that points at its `src/`. */
  readonly toSrc: string;
}

const tmpLinks: string[] = [];

/** The directories the cases own. */
const tmpDirs: string[] = [];

/** The links the cases remove on their own: a recursive remove can follow one. */

function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'peaks-code-gate-wrapper-'));
  const outside = mkdtempSync(join(tmpdir(), 'peaks-code-gate-outside-'));
  tmpDirs.push(root, outside);
  mkdirSync(join(root, '.peaks', '_runtime'), { recursive: true });
  writeFileSync(
    join(root, '.peaks', '_runtime', 'session.json'),
    JSON.stringify({ sessionId: SESSION, createdAt: new Date().toISOString(), projectRoot: root })
  );
  writeFileSync(join(root, '.peaks', 'config.json'), JSON.stringify({ schemaVersion: 1 }));
  mkdirSync(join(root, 'src', 'deep'), { recursive: true });
  writeFileSync(join(root, 'src', 'deep', 'x.ts'), 'x');
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs', 'spec.md'), 'spec');
  mkdirSync(join(outside, 'src'), { recursive: true });
  writeFileSync(join(outside, 'src', 'x.ts'), 'x');
  const toSrc = join(root, 'to-src');
  symlinkSync(join(root, 'src'), toSrc, 'junction');
  tmpLinks.push(toSrc);
  const fixture: Fixture = { root, outside, toSrc };
  return fixture;
}

/** A tool call, and the directory it runs in. */
function payload(filePath: string, cwd?: string, callerId?: string): string {
  return JSON.stringify({
    tool: 'Edit',
    input: { file_path: filePath },
    ...(cwd === undefined ? {} : { cwd }),
    ...(callerId === undefined ? {} : { session_id: callerId })
  });
}

afterEach(() => {
  while (tmpLinks.length > 0) {
    const link = tmpLinks.pop();
    if (link !== undefined) unlinkSync(link);
  }
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

describe('integration — the wrapper and the command reach the same verdict', () => {
  const cases: ReadonlyArray<{
    readonly label: string;
    readonly dir: (f: Fixture) => string;
    readonly filePath: (f: Fixture) => string;
    readonly verdict: 'deny' | 'allow';
  }> = [
    {
      label: 'the file a call inside the family lands in',
      dir: (f) => join(f.root, 'src'),
      filePath: () => 'deep/x.ts',
      verdict: 'deny'
    },
    {
      label: 'the same file named with a leading dot segment',
      dir: (f) => join(f.root, 'src'),
      filePath: () => './deep/x.ts',
      verdict: 'deny'
    },
    {
      label: 'the same file named with a doubled separator',
      dir: (f) => join(f.root, 'src'),
      filePath: () => './/deep/x.ts',
      verdict: 'deny'
    },
    {
      label: 'a case variant of the family',
      dir: (f) => f.root,
      filePath: () => 'SRC/x.ts',
      verdict: 'deny'
    },
    {
      label: 'a backslash spelling of the family',
      dir: (f) => f.root,
      filePath: () => 'src\\x.ts',
      verdict: 'deny'
    },
    {
      label: 'a file that leaves the family directory',
      dir: (f) => join(f.root, 'src'),
      filePath: () => '../docs/spec.md',
      verdict: 'allow'
    },
    {
      label: 'an absolute path inside the project',
      dir: (f) => f.root,
      filePath: (f) => join(f.root, 'src', 'deep', 'x.ts'),
      verdict: 'deny'
    },
    {
      label: 'an absolute path outside the project',
      dir: (f) => f.root,
      filePath: (f) => join(f.outside, 'x.ts'),
      verdict: 'allow'
    },
    {
      label: 'an allow-listed path',
      dir: (f) => f.root,
      filePath: () => 'docs/spec.md',
      verdict: 'allow'
    },
    {
      label: 'a path spelled from outside the project',
      dir: (f) => f.outside,
      filePath: () => 'src/x.ts',
      verdict: 'deny'
    },
    {
      label: 'the file a symlinked base lands in',
      dir: (f) => f.toSrc,
      filePath: () => 'deep/x.ts',
      verdict: 'deny'
    }
  ];

  // The name is a LITERAL with a `$label` placeholder — the case's own label
  // is interpolated by the runner, so every case still carries its own name
  // and the description the contract reads is a string literal.
  it.each(cases)(
    'when the case is $label, should reach the same verdict in the wrapper and the command',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    (testCase) => {
      // given: one payload, one project, and one directory the call runs in
      // when: the wrapper and the Node command are both given it
      // then: both reach the same verdict
      const fixture = makeFixture();
      const cwd = testCase.dir(fixture);
      const stdin = payload(testCase.filePath(fixture), cwd);

      const wrapper = runHook({ payload: stdin, cwd, args: [fixture.root] });
      const command = runCodeGate(fixture.root, stdin, cwd);

      const commandVerdict = command.stdout.includes('"action": "deny"') ? 'deny' : 'allow';

      expect(verdictOf(wrapper), `wrapper: ${wrapper.stderr}`).toBe(testCase.verdict);
      expect(commandVerdict, `command: ${command.stdout}`).toBe(testCase.verdict);
      expect(verdictOf(wrapper)).toBe(commandVerdict);
    }
  );
  it(
    'when a command is reachable, should run the source and not the one the host has installed',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a PATH whose `peaks` is a shim over this repository's source
      // when: the wrapper is run with it
      // then: the run carries the shim's marker — so the measurement is of
      //   the source, and not of whatever `peaks` the host has installed
      const fixture = makeFixture();
      const stdin = payload('src/deep/x.ts', fixture.root);

      const run = runHook({ payload: stdin, cwd: fixture.root, args: [fixture.root] });

      expect(run.stderr).toContain(SOURCE_CLI_MARKER);
    }
  );
});

describe('integration — the wrapper finds the command in the sibling file', () => {
  it(
    'when the command is not on PATH, should use the package root the installer wrote beside it',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a copy of the wrapper, a sibling file naming a package root,
      //   and that package's own `bin/peaks.js`
      // when: the copy is run with no command on PATH
      // then: it execs the package's CLI, which is what the marker proves
      const fixture = makeFixture();
      const hooksDir = mkdtempSync(join(tmpdir(), 'peaks-code-gate-hooks-'));
      tmpDirs.push(hooksDir);
      const packageRoot = mkdtempSync(join(tmpdir(), 'peaks-code-gate-package-'));
      tmpDirs.push(packageRoot);
      mkdirSync(join(packageRoot, 'bin'), { recursive: true });
      writeFileSync(
        join(packageRoot, 'bin', 'peaks.js'),
        [
          '#!/usr/bin/env node',
          "import { spawnSync } from 'node:child_process';",
          "process.stderr.write('FIXTURE-CLI-INVOKED\\n');",
          `const child = spawnSync(process.execPath, [${JSON.stringify(
            join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')
          )}, ${JSON.stringify(join(REPO_ROOT, 'src', 'cli', 'index.ts'))}, ...process.argv.slice(2)], { stdio: 'inherit' });`,
          'process.exit(child.status ?? 1);',
          ''
        ].join('\n'),
        'utf8'
      );
      copyFileSync(HOOK_SCRIPT, join(hooksDir, 'pre-tool-code-gate.sh'));
      writeFileSync(join(hooksDir, 'pre-tool-code-gate.package-root'), `${packageRoot}\n`, 'utf8');

      const stdin = payload('src/deep/x.ts', fixture.root);
      const run = runHookCopy({
        dir: hooksDir,
        payload: stdin,
        cwd: fixture.root,
        args: [fixture.root],
        env: nodeOnlyEnv()
      });

      expect(run.stderr).toContain('FIXTURE-CLI-INVOKED');
      expect(run.status).toBe(2);
    }
  );

  it(
    'when the sibling file names no package, should take its own conservative path',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a copy of the wrapper with no sibling file beside it
      // when: it is run with no command on PATH
      // then: it decides on its own, and refuses the family
      const fixture = makeFixture();
      const hooksDir = mkdtempSync(join(tmpdir(), 'peaks-code-gate-hooks-'));
      tmpDirs.push(hooksDir);
      copyFileSync(HOOK_SCRIPT, join(hooksDir, 'pre-tool-code-gate.sh'));

      const stdin = payload('src/deep/x.ts', fixture.root);
      const run = runHookCopy({
        dir: hooksDir,
        payload: stdin,
        cwd: fixture.root,
        env: withoutCliEnv()
      });

      expect(run.stderr).not.toContain('FIXTURE-CLI-INVOKED');
      expect(run.status).toBe(2);
    }
  );
});

describe('behavior — the fallback refuses what it cannot place', () => {
  it(
    'when the payload states a directory the gate cannot read, should refuse the file',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a payload whose stated directory does not exist
      // when: no command is reachable, so the fallback decides
      // then: it refuses — the file's location is unknown, and unknown is a
      //   reason to refuse rather than to guess
      const fixture = makeFixture();
      const stdin = payload('notes.txt', join(fixture.root, 'no-such-dir'));

      const run = runHook({ payload: stdin, cwd: fixture.root, cli: false });

      expect(run.status).toBe(2);
      expect(run.stderr).toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');
    }
  );

  it(
    'when the payload states a directory the gate does not run in, should refuse the file',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a payload whose stated directory is another directory
      // when: no command is reachable, so the fallback decides
      // then: it refuses — the call's directory is not a fact it can read
      const fixture = makeFixture();
      const stdin = payload('notes.txt', join(fixture.root, 'src'));

      const run = runHook({ payload: stdin, cwd: fixture.root, cli: false });

      expect(run.status).toBe(2);
      expect(run.stderr).toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');
    }
  );

  it(
    'when no command and no node are reachable, should still decide on its own',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: an environment holding neither a command nor a runtime
      // when: the fallback is exercised in it
      // then: it still refuses the family — it needs neither of them
      const fixture = makeFixture();
      const env = withoutCliEnv();
      expect(commandReachable('peaks', env)).toBe(false);
      expect(commandReachable('node', env)).toBe(false);

      const stdin = payload('src/deep/x.ts', fixture.root);
      const run = runHook({ payload: stdin, cwd: fixture.root, env });

      expect(run.status).toBe(2);
      expect(run.stderr).toContain('src/');
    }
  );
});

describe('behavior — the fallback keeps its own contract', () => {
  it(
    'when the spelling carries a doubled separator, should still deny the file it lands in',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a call running inside the family directory
      // when: the fallback is given the doubled-separator spelling
      // then: it denies — the drop of the leading segments must not turn a
      //   relative path into an absolute one
      const fixture = makeFixture();
      const cwd = join(fixture.root, 'src');
      const stdin = payload('.//deep/x.ts', cwd);

      const run = runHook({ payload: stdin, cwd, cli: false });

      expect(run.status).toBe(2);
      expect(run.stderr).toContain('src/');
    }
  );

  it(
    'when the caller owns a lease the command would open the family for, should still deny it',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a project with a presence lease naming the fast-lane skill
      // when: the fallback is given a call from that caller
      // then: it denies — it takes no caller identity into account
      const fixture = makeFixture();
      setPresenceLease({
        projectRoot: fixture.root,
        sessionId: SESSION,
        callerId: 'caller-a',
        workflowId: 'caller-a',
        graphRef: 'graphs/caller-a.json',
        skill: 'peaks-race-code'
      });
      const stdin = payload('src/deep/x.ts', fixture.root, 'caller-a');

      const run = runHook({ payload: stdin, cwd: fixture.root, cli: false });

      expect(run.status).toBe(2);
      expect(run.stderr).toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');
    }
  );
});

describe('a11y — the refusal names the file and the code', () => {
  it(
    'when the wrapper refuses a file, should name the file and the code',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a call that writes a file inside the family
      // when: the wrapper refuses it
      // then: the refusal names the file and the code the harness reads
      const fixture = makeFixture();
      const stdin = payload('src/deep/x.ts', fixture.root);

      const run = runHook({ payload: stdin, cwd: fixture.root, args: [fixture.root] });

      expect(run.stderr).toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');
      expect(run.stderr).toContain('src/deep/x.ts');
    }
  );

  it(
    'when the fallback refuses a file it cannot place, should name the file and the code',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a payload whose stated directory the fallback cannot read
      // when: the fallback refuses it
      // then: the refusal names the file, the code, and the reason
      const fixture = makeFixture();
      const stdin = payload('notes.txt', join(fixture.root, 'no-such-dir'));

      const run = runHook({ payload: stdin, cwd: fixture.root, cli: false });

      expect(run.stderr).toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');
      expect(run.stderr).toContain('notes.txt');
      expect(run.stderr).toContain('cannot be placed');
    }
  );

  it(
    'when the fallback refuses a file, should not name a session type',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a call the fallback refuses
      // when: the refusal is written
      // then: it names no session type — the fallback takes no caller
      //   identity into account, and says so by saying nothing about one
      const fixture = makeFixture();
      const stdin = payload('src/deep/x.ts', fixture.root);

      const run = runHook({ payload: stdin, cwd: fixture.root, cli: false });

      expect(run.stderr).not.toMatch(/lane|race|fast/i);
    }
  );
});
