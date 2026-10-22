// tests/unit/hooks/code-gate-relative-base.test.ts
//
// A RELATIVE path names the file the tool call will really touch, so the
// gate has to read it against the directory the call runs in — not against
// the project root the caller named. The two differ whenever the call runs
// in a subdirectory, and the difference was a silent escape: with the call
// running in `src/`, the payload `deep/x.ts` named `src/deep/x.ts` and the
// gate allowed it.
//
// The deny families stay relative to the NAMED project root: a project
// nested inside another repository is judged against itself.
//
// Dimensions covered:
//   - behavior:   the pure decision, with the tool call's directory named
//   - integration: the real CLI, spawned with a payload and a working
//     directory
//   - a11y:       the reason a denial names

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { decideGateAction, normalizeGatePath } from '~/src/services/hooks/pre-tool-code-gate';
import { readToolCallCwd, resolveToolCallBaseDir } from '~/src/services/hooks/hook-payload-cwd';
import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

declareDimensions(
  'tests/unit/hooks/code-gate-relative-base.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    {
      dim: 'render',
      reason:
        'the surface here is a verdict and the reason a denial names; the envelope shape belongs to the command’s own suite'
    }
  ]
);

const ROOT = resolve(__dirname, '..', '..', '..');

vi.setConfig({ testTimeout: SUBPROCESS_TEST_TIMEOUT_MS });

const tmpRoots: string[] = [];

/**
 * A project the canonical resolver answers with itself: it carries a
 * `.peaks/config.json` marker, so the root it reports IS this directory.
 */
function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-code-gate-base-'));
  tmpRoots.push(root);
  mkdirSync(join(root, '.peaks'), { recursive: true });
  writeFileSync(join(root, '.peaks', 'config.json'), JSON.stringify({ schemaVersion: 1 }));
  mkdirSync(join(root, 'src', 'deep'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'project' }));
  return root;
}

/** A tool call, optionally stating the directory it runs in. */
function payload(filePath: string, cwd?: string): string {
  return JSON.stringify({
    tool: 'Edit',
    input: { file_path: filePath },
    ...(cwd === undefined ? {} : { cwd })
  });
}

/**
 * The command the PreToolUse hook runs, in the directory the call runs in.
 *
 * The runner is spelled with ABSOLUTE paths because the working directory
 * is the variable under test: a relative runner path would only resolve in
 * the repository, and the case that matters runs somewhere else.
 */
function runCodeGate(
  root: string,
  stdin: string,
  cwd: string = ROOT
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
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

describe('behavior — a relative path belongs to the directory the call runs in', () => {
  it('when the call runs in a subdirectory, should read the path against that directory', () => {
    // given: a project root, and a tool call that runs in its `src` directory
    // when: a relative path is read against that directory
    // then: the path names the file the call will really touch
    const root = makeProject();

    expect(normalizeGatePath('deep/x.ts', root, join(root, 'src'))).toBe('src/deep/x.ts');
  });

  it('when the call runs in a subdirectory, should deny a file that lands in a hard-blocked family', () => {
    // given: a project root, and a tool call that runs in its `src` directory
    // when: the payload names a relative path
    // then: the verdict denies it, and the reason names the `src/` family
    const root = makeProject();

    const verdict = decideGateAction('Edit', { file_path: 'deep/x.ts' }, null, {
      projectRoot: root,
      toolCwd: join(root, 'src')
    });

    expect(verdict.action).toBe('deny');
    if (verdict.action !== 'deny') return;
    expect(verdict.reason).toContain('src/');
  });

  it('when the call runs in the project root, should reach the same verdict as before', () => {
    // given: a tool call that runs in the project root — the normal case
    // when: the payload names a hard-blocked path
    // then: the verdict denies it, exactly as it did before the base moved
    const root = makeProject();

    const verdict = decideGateAction('Edit', { file_path: 'src/services/foo.ts' }, null, {
      projectRoot: root,
      toolCwd: root
    });

    expect(verdict.action).toBe('deny');
    if (verdict.action !== 'deny') return;
    expect(verdict.reason).toContain('src/');
  });

  it('when the path is absolute, should still judge it by where it lands in the project', () => {
    // given: a project root and an absolute path inside it
    // when: the verdict is taken
    // then: the path belongs to the `src/` family of that project
    const root = makeProject();

    const inside = decideGateAction(
      'Edit',
      { file_path: join(root, 'src', 'services', 'foo.ts') },
      null,
      { projectRoot: root, toolCwd: join(root, 'src') }
    );
    const outside = decideGateAction(
      'Edit',
      { file_path: resolve(root, '..', 'other-repo', 'src', 'foo.ts') },
      null,
      { projectRoot: root, toolCwd: join(root, 'src') }
    );

    expect(inside.action).toBe('deny');
    expect(outside.action).toBe('allow');
  });

  it('when the call runs outside the project, should still read the spelling', () => {
    // given: a project root, and a tool call that runs in another directory
    // when: the payload names a hard-blocked spelling
    // then: the verdict denies it — the project can only read the spelling
    const root = makeProject();

    const verdict = decideGateAction('Edit', { file_path: 'src/services/foo.ts' }, null, {
      projectRoot: root,
      toolCwd: resolve(root, '..')
    });

    expect(verdict.action).toBe('deny');
  });

  it('when the payload states no directory, should read no directory from it', () => {
    // given: a payload with no top-level `cwd`
    // when: the directory is read
    // then: the reader reports none, and the caller falls back
    expect(readToolCallCwd({ tool: 'Edit', input: { file_path: 'x.ts' } })).toBeNull();
    expect(readToolCallCwd({ cwd: '   ' })).toBeNull();
    expect(readToolCallCwd({ cwd: '/tmp/project' })).toBe('/tmp/project');
  });

  it('when the payload states a directory, should read that one', () => {
    // given: a payload whose top level states the directory
    // when: the directory is read
    // then: it is the one the payload names
    expect(readToolCallCwd({ cwd: 'C:/project/src' })).toBe('C:/project/src');
  });
});

describe('behavior — a payload directory that is not a usable base', () => {
  it('when the payload states no directory, should use the working directory the gate runs in', () => {
    // given: a payload with no top-level `cwd`
    // when: the base a relative path is read against is resolved
    // then: it is the directory the caller handed over
    expect(resolveToolCallBaseDir({ tool: 'Edit', input: { file_path: 'x.ts' } }, ROOT, ROOT)).toBe(
      ROOT
    );
  });

  it('when the payload states a directory that is not there, should use the working directory the gate runs in', () => {
    // given: a payload whose `cwd` names a directory that does not exist
    // when: the base a relative path is read against is resolved
    // then: it is the directory the caller handed over, not the payload's
    expect(resolveToolCallBaseDir({ cwd: join(ROOT, 'no', 'such', 'dir') }, ROOT, ROOT)).toBe(ROOT);
  });

  it('when the payload states a file rather than a directory, should use the working directory the gate runs in', () => {
    // given: a payload whose `cwd` names a file
    // when: the base a relative path is read against is resolved
    // then: it is the directory the caller handed over, not the payload's
    expect(resolveToolCallBaseDir({ cwd: join(ROOT, 'package.json') }, ROOT, ROOT)).toBe(ROOT);
  });

  it('when the payload states a relative directory, should use the working directory the gate runs in', () => {
    // given: a payload whose `cwd` is a relative path
    // when: the base a relative path is read against is resolved
    // then: it is the directory the caller handed over, not the payload's
    expect(resolveToolCallBaseDir({ cwd: 'no/such/dir' }, ROOT, ROOT)).toBe(ROOT);
  });

  it('when the payload states a directory outside the project, should use the working directory the gate runs in', () => {
    // given: a payload whose `cwd` names a directory outside the project
    // when: the base a relative path is read against is resolved
    // then: it is the directory the caller handed over, not the payload's
    expect(resolveToolCallBaseDir({ cwd: resolve(ROOT, '..') }, ROOT, ROOT)).toBe(ROOT);
  });

  it('when the payload states a directory inside the project, should use that one', () => {
    // given: a payload whose `cwd` names an existing directory inside the project
    // when: the base a relative path is read against is resolved
    // then: it is the directory the payload names
    expect(resolveToolCallBaseDir({ cwd: join(ROOT, 'src') }, ROOT, ROOT)).toBe(join(ROOT, 'src'));
  });
});

describe('integration — the command the hook runs', () => {
  it(
    'when the payload states the directory the call runs in, should deny the file it lands in',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a project root, and a tool call that runs in its `src` directory
      // when: the command is run with that directory in the payload
      // then: the verdict denies it, and the reason names the `src/` family
      const root = makeProject();

      const { status, stdout } = runCodeGate(root, payload('deep/x.ts', join(root, 'src')));

      expect(status).toBe(0);
      expect(stdout).toContain('"action": "deny"');
      expect(stdout).toContain('src/');
    }
  );

  it(
    'when the command runs in the directory the call runs in, should deny the file it lands in',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a project root, and a tool call that runs in its `src` directory
      // when: the command is run in that directory, with no directory in the payload
      // then: the verdict denies it, and the reason names the `src/` family
      const root = makeProject();

      const { status, stdout } = runCodeGate(root, payload('deep/x.ts'), join(root, 'src'));

      expect(status).toBe(0);
      expect(stdout).toContain('"action": "deny"');
      expect(stdout).toContain('src/');
    }
  );

  it(
    'when the call runs in the project root, should keep every earlier verdict',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a project root, and a tool call that runs in it
      // when: the command is run for a blocked file and for an allow-listed one
      // then: the blocked file is denied and the other is allowed
      const root = makeProject();

      const blocked = runCodeGate(root, payload('src/services/foo.ts'), root);
      const allowed = runCodeGate(root, payload('docs/spec.md'), root);

      expect(blocked.stdout).toContain('"action": "deny"');
      expect(allowed.stdout).toContain('"action": "allow"');
    }
  );

  it(
    'when the project is nested in another repository, should judge it against itself',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a project nested inside a directory that carries the outer
      // repository's own `src/`
      // when: the command is run for a file in the nested project and for one
      // in the outer directory
      // then: the nested project's own file is denied and the outer one is not
      const outer = makeProject();
      const nested = join(outer, 'nested');
      mkdirSync(join(nested, '.peaks'), { recursive: true });
      writeFileSync(join(nested, '.peaks', 'config.json'), JSON.stringify({ schemaVersion: 1 }));
      mkdirSync(join(nested, 'src'), { recursive: true });
      mkdirSync(join(outer, 'src'), { recursive: true });

      const own = runCodeGate(nested, payload('src/x.ts', nested), nested);
      const above = runCodeGate(nested, payload('../src/x.ts', nested), nested);

      expect(own.stdout).toContain('"action": "deny"');
      expect(above.stdout).toContain('"action": "allow"');
    }
  );

  it(
    'when the payload states a directory that is not there, should deny the file the call would really write',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a call that really runs in `<root>/src`, and a payload whose
      // top-level `cwd` names a directory that is not there
      // when: the command is run with that payload
      // then: the verdict denies the file the call would really write
      const root = makeProject();
      const cwd = join(root, 'src');

      const { stdout } = runCodeGate(
        root,
        payload('deep/x.ts', join(root, 'no', 'such', 'dir')),
        cwd
      );

      expect(stdout).toContain('"action": "deny"');
      expect(stdout).toContain('src/');
    }
  );

  it(
    'when the payload states a file rather than a directory, should deny the file the call would really write',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a call that really runs in `<root>/src`, and a payload whose
      // top-level `cwd` names a file
      // when: the command is run with that payload
      // then: the verdict denies the file the call would really write
      const root = makeProject();
      const cwd = join(root, 'src');

      const { stdout } = runCodeGate(root, payload('deep/x.ts', join(root, 'package.json')), cwd);

      expect(stdout).toContain('"action": "deny"');
      expect(stdout).toContain('src/');
    }
  );

  it(
    'when the payload states a relative directory, should deny the file the call would really write',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a call that really runs in `<root>/src`, and a payload whose
      // top-level `cwd` is a relative path
      // when: the command is run with that payload
      // then: the verdict denies the file the call would really write
      const root = makeProject();
      const cwd = join(root, 'src');

      const { stdout } = runCodeGate(root, payload('deep/x.ts', 'no/such/dir'), cwd);

      expect(stdout).toContain('"action": "deny"');
      expect(stdout).toContain('src/');
    }
  );

  it(
    'when the payload states the filesystem root, should deny the file the call would really write',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a call that really runs in `<root>/src`, and a payload whose
      // top-level `cwd` names the filesystem root
      // when: the command is run with that payload
      // then: the verdict denies the file the call would really write
      const root = makeProject();
      const cwd = join(root, 'src');

      const { stdout } = runCodeGate(root, payload('deep/x.ts', '/'), cwd);

      expect(stdout).toContain('"action": "deny"');
      expect(stdout).toContain('src/');
    }
  );
});

describe('a11y — the reason a denial names the family', () => {
  it('when the file lands in a hard-blocked family, should name that family', () => {
    // given: a project root, and a tool call that runs in its `src` directory
    // when: the verdict denies the relative path
    // then: the reason names the `src/` family, so the caller can see why
    const root = makeProject();

    const verdict = decideGateAction('Edit', { file_path: 'deep/x.ts' }, null, {
      projectRoot: root,
      toolCwd: join(root, 'src')
    });

    expect(verdict.action).toBe('deny');
    if (verdict.action !== 'deny') return;
    expect(verdict.reason).toContain('src/');
    expect(verdict.message).toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');
  });
});
