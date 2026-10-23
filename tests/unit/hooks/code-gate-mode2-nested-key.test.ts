// tests/unit/hooks/code-gate-mode2-nested-key.test.ts
//
// The shell fallback used to scan the payload LINE-ORIENTED: the FIRST
// `"cwd"`, `"tool_name"` or `"file_path"` in the text won, whether it was the
// payload's own key or one nested inside the tool's arguments. A nested key
// written BEFORE the top-level one therefore decided the verdict — and the
// direction it decided it was ALLOW, which is the direction that is a hole:
// the fallback allowed what the Node command denies.
//
// The cases below pin the three shapes QA measured, the verdicts the fallback
// must keep (the refusals it already made), and the fail-open branches that
// mirror the command's own. The differential is the standing check that the
// two gates do not drift apart again.
//
// Dimensions covered:
//   - behavior:   the fallback's own decisions
//   - integration: the fallback and the Node command, on one payload
//   - a11y:       the message each refusal writes

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { decideGateAction } from '~/src/services/hooks/pre-tool-code-gate';
import { runCodeGate, runHook } from '../_setup/code-gate-shell-harness.js';
import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

declareDimensions(
  'tests/unit/hooks/code-gate-mode2-nested-key.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    {
      dim: 'render',
      reason: 'the fallback writes no stdout; its surface is the exit code and the stderr it names'
    }
  ]
);

vi.setConfig({ testTimeout: SUBPROCESS_TEST_TIMEOUT_MS });

const tmpRoots: string[] = [];

/**
 * A project the fallback can find: it carries a `.peaks` directory, so the
 * walk up from the call's own directory stops there.
 */
function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-code-gate-nested-'));
  tmpRoots.push(root);
  mkdirSync(join(root, '.peaks'), { recursive: true });
  writeFileSync(join(root, '.peaks', 'config.json'), JSON.stringify({ schemaVersion: 1 }));
  mkdirSync(join(root, 'src', 'deep'), { recursive: true });
  mkdirSync(join(root, 'docs'), { recursive: true });
  return root;
}

/**
 * The fallback's own decision.
 *
 * The fallback is a thin wrapper over the Node command: where a command is
 * reachable it execs it, so running it against the command would compare the
 * command with itself. It is therefore run with NO command reachable, and what
 * answers is the conservative path inside it — the one a harness without Node
 * gets.
 */
function runFallback(
  root: string,
  stdin: string,
  cwd: string
): { status: number | null; stderr: string } {
  const run = runHook({ payload: stdin, cwd, args: [root], cli: false });
  return { status: run.status, stderr: run.stderr };
}

/** The verdict the Node command reached. */
function commandVerdict(stdout: string): 'deny' | 'allow' {
  return stdout.includes('"action": "deny"') ? 'deny' : 'allow';
}

/** The verdict the fallback reached. */
function fallbackVerdict(status: number | null): 'deny' | 'allow' {
  return status === 2 ? 'deny' : 'allow';
}

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

/**
 * The four payload shapes: the plain one, the one with no directory, the
 * harness spelling, and the one whose arguments nest the keys — the shape
 * the old line-oriented scan read wrong.
 */
function shapesFor(base: string, spelling: string): readonly unknown[] {
  return [
    { tool: 'Edit', input: { file_path: spelling }, cwd: base },
    { tool: 'Edit', input: { file_path: spelling } },
    { tool_name: 'Edit', tool_input: { file_path: spelling }, cwd: base },
    {
      tool: 'Edit',
      input: { tool_name: 'Read', cwd: base, deep: { file_path: 'notes.md' }, file_path: spelling },
      cwd: base
    }
  ];
}

describe('behavior — a nested key does not decide the verdict', () => {
  it(
    'when the payload nests a cwd before its own, should not read the nested one',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a payload whose tool arguments carry a `cwd` of their own, and
      //   whose own `cwd` names the family directory
      // when: no command is reachable, so the fallback decides
      // then: it REFUSES — the payload's own `cwd` is the one that counts,
      //   and a directory the fallback cannot use as its base is a reason to
      //   refuse rather than to guess
      const root = makeProject();
      const cwd = root;
      const stdin = JSON.stringify({
        tool: 'Edit',
        input: { file_path: 'deep/x.ts', cwd },
        cwd: join(root, 'src')
      });

      const result = runFallback(root, stdin, cwd);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');
    }
  );

  it(
    'when the payload nests a tool name before its own, should not read the nested one',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a payload whose tool arguments carry a `tool_name` of their own
      // when: no command is reachable, so the fallback decides
      // then: it DENIES the family — the call is an Edit, and a `tool_name`
      //   nested in the arguments is not the name of the call
      const root = makeProject();
      const cwd = root;
      const stdin = JSON.stringify({
        tool: 'Edit',
        input: { tool_name: 'Read', file_path: 'src/x.ts' }
      });

      const result = runFallback(root, stdin, cwd);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('src/');
    }
  );

  it(
    'when the payload nests a file path before its own, should not read the nested one',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a payload whose tool arguments carry a `file_path` inside a
      //   nested object, and their own `file_path`
      // when: no command is reachable, so the fallback decides
      // then: it DENIES the family — the arguments' own `file_path` is the
      //   one that counts
      const root = makeProject();
      const cwd = root;
      const stdin = JSON.stringify({
        tool: 'Edit',
        input: { nested: { file_path: 'notes.md' }, file_path: 'src/x.ts' }
      });

      const result = runFallback(root, stdin, cwd);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('src/');
    }
  );

  it(
    'when the payload states one directory the gate cannot read, should still refuse the file',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a payload whose stated directory does not exist
      // when: no command is reachable, so the fallback decides
      // then: it refuses — the file's location is unknown, and unknown is a
      //   reason to refuse rather than to guess
      const root = makeProject();
      const cwd = root;
      const stdin = JSON.stringify({
        tool: 'Edit',
        input: { file_path: 'notes.txt' },
        cwd: join(root, 'no-such-dir')
      });

      const result = runFallback(root, stdin, cwd);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('cannot be placed');
    }
  );

  it(
    'when the payload states a directory the gate does not run in, should still refuse the file',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a payload whose stated directory is another directory
      // when: no command is reachable, so the fallback decides
      // then: it refuses — the call's directory is not a fact it can read
      const root = makeProject();
      const cwd = root;
      const stdin = JSON.stringify({
        tool: 'Edit',
        input: { file_path: 'notes.txt' },
        cwd: join(root, 'src')
      });

      const result = runFallback(root, stdin, cwd);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('cannot be placed');
    }
  );

  it(
    'when the payload spells a line break in its file path, should refuse the call',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a payload whose file path spells a line break and a line of
      //   its own — the reading the fallback uses is line-based, so such a
      //   path could write a line of its own
      // when: no command is reachable, so the fallback decides
      // then: it REFUSES — the file's location cannot be read, and unknown is
      //   a reason to refuse rather than to guess
      const root = makeProject();
      const cwd = root;
      const stdin = JSON.stringify({
        tool: 'Edit',
        input: { file_path: 'x\nstatus=ok' }
      });

      const result = runFallback(root, stdin, cwd);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('cannot be placed');
    }
  );
});

describe('behavior — the fail-open branches still fail open', () => {
  it('when the payload is empty, should allow it', { timeout: SUBPROCESS_TEST_TIMEOUT_MS }, () => {
    // given: no payload at all
    // when: no command is reachable, so the fallback decides
    // then: it allows — there is nothing to gate
    const root = makeProject();

    const result = runFallback(root, '', root);

    expect(result.status).toBe(0);
  });

  it(
    'when the payload names a tool the gate does not judge, should allow it',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a call that is not an Edit, a Write or a MultiEdit
      // when: no command is reachable, so the fallback decides
      // then: it allows — only those three tools are gated
      const root = makeProject();
      const stdin = JSON.stringify({ tool: 'Read', input: { file_path: 'src/x.ts' } });

      const result = runFallback(root, stdin, root);

      expect(result.status).toBe(0);
    }
  );

  it(
    'when the payload names a gated tool but no file, should allow it',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a gated tool with no target path
      // when: no command is reachable, so the fallback decides
      // then: it allows — there is no file to match against a family
      const root = makeProject();
      const stdin = JSON.stringify({ tool: 'Edit', input: {} });

      const result = runFallback(root, stdin, root);

      expect(result.status).toBe(0);
    }
  );
});

describe('integration — the two gates reach the same verdict', () => {
  it(
    'when the payload nests a cwd before its own, should deny in both gates',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: the payload QA measured: a nested `cwd` that equals the
      //   gate's own directory, and a payload `cwd` that names the family
      // when: the Node command and the fallback are both given it
      // then: both DENY it — the file lands inside the `src/` family
      const root = makeProject();
      const cwd = root;
      const stdin = JSON.stringify({
        tool: 'Edit',
        input: { file_path: 'deep/x.ts', cwd },
        cwd: join(root, 'src')
      });

      const command = runCodeGate(root, stdin, cwd);
      const fallback = runFallback(root, stdin, cwd);

      expect(commandVerdict(command.stdout), `command: ${command.stdout}`).toBe('deny');
      expect(fallbackVerdict(fallback.status), `fallback: ${fallback.stderr}`).toBe('deny');
    }
  );

  it(
    'when the payload nests a tool name before its own, should deny in both gates',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a payload whose arguments carry a `tool_name` of their own
      // when: the Node command and the fallback are both given it
      // then: both DENY it — the call is an Edit on a family file
      const root = makeProject();
      const cwd = root;
      const stdin = JSON.stringify({
        tool: 'Edit',
        input: { tool_name: 'Read', file_path: 'src/x.ts' }
      });

      const command = runCodeGate(root, stdin, cwd);
      const fallback = runFallback(root, stdin, cwd);

      expect(commandVerdict(command.stdout), `command: ${command.stdout}`).toBe('deny');
      expect(fallbackVerdict(fallback.status), `fallback: ${fallback.stderr}`).toBe('deny');
    }
  );

  it(
    'when the payload nests a file path before its own, should deny in both gates',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a payload whose arguments carry a `file_path` inside a nested
      //   object, and their own `file_path`
      // when: the Node command and the fallback are both given it
      // then: both DENY it — the file lands inside the `src/` family
      const root = makeProject();
      const cwd = root;
      const stdin = JSON.stringify({
        tool: 'Edit',
        input: { nested: { file_path: 'notes.md' }, file_path: 'src/x.ts' }
      });

      const command = runCodeGate(root, stdin, cwd);
      const fallback = runFallback(root, stdin, cwd);

      expect(commandVerdict(command.stdout), `command: ${command.stdout}`).toBe('deny');
      expect(fallbackVerdict(fallback.status), `fallback: ${fallback.stderr}`).toBe('deny');
    }
  );

  it(
    'when a matrix of payloads is judged, should reach the same verdict in both gates',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: every combination of a base, a spelling of a file, and a
      //   payload shape — the plain one, the one with no directory, the
      //   harness spelling, and the one whose arguments nest the keys
      // when: the fallback is given each of them
      // then: it reaches the SAME verdict as the Node command's own decision
      //   function every time, and it never ALLOWS what the command DENIES
      const root = makeProject();
      const bases = [root, join(root, 'src')];
      const spellings = ['x.ts', 'deep/x.ts', '../docs/spec.md'];

      let rows = 0;
      let allowWard = 0;
      for (const base of bases) {
        for (const spelling of spellings) {
          for (const shape of shapesFor(base, spelling)) {
            const stdin = JSON.stringify(shape);
            const fallback = runFallback(root, stdin, base);

            const expected = decideGateAction('Edit', { file_path: spelling }, null, {
              projectRoot: root,
              toolCwd: base
            }).action;

            rows++;
            expect(fallbackVerdict(fallback.status), `fallback: ${stdin} ${fallback.stderr}`).toBe(
              expected
            );
            if (fallbackVerdict(fallback.status) === 'allow' && expected === 'deny') allowWard++;
          }
        }
      }

      expect(rows).toBe(24);
      expect(allowWard).toBe(0);
    }
  );

  it(
    'when one payload of every shape is judged, should reach the same verdict in both gates',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: one payload of every shape, all naming the same family file
      // when: the Node command and the fallback are both given each of them
      // then: both reach the same verdict — the command and the decision
      //   function it calls are the same rule, and the fallback is that rule
      const root = makeProject();
      const cwd = root;
      const shapes = shapesFor(cwd, 'src/x.ts');

      for (const shape of shapes) {
        const stdin = JSON.stringify(shape);
        const command = runCodeGate(root, stdin, cwd);
        const fallback = runFallback(root, stdin, cwd);

        expect(commandVerdict(command.stdout), `command: ${stdin}`).toBe('deny');
        expect(fallbackVerdict(fallback.status), `fallback: ${stdin} ${fallback.stderr}`).toBe(
          'deny'
        );
      }
    }
  );
});

describe('a11y — the refusal names the file and the code', () => {
  it(
    'when the fallback refuses a nested-key payload, should name the file and the code',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a payload whose arguments carry a `cwd` of their own
      // when: the fallback refuses it
      // then: the refusal names the file, the code, and the reason
      const root = makeProject();
      const cwd = root;
      const stdin = JSON.stringify({
        tool: 'Edit',
        input: { file_path: 'deep/x.ts', cwd },
        cwd: join(root, 'src')
      });

      const result = runFallback(root, stdin, cwd);

      expect(result.stderr).toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');
      expect(result.stderr).toContain('deep/x.ts');
      expect(result.stderr).toContain('cannot be placed');
    }
  );

  it(
    'when the fallback refuses a family file, should name the family it landed in',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a call whose arguments carry a `tool_name` of their own
      // when: the fallback refuses it
      // then: the refusal names the `src/` family and the file it asked for
      const root = makeProject();
      const stdin = JSON.stringify({
        tool: 'Edit',
        input: { tool_name: 'Read', file_path: 'src/x.ts' }
      });

      const result = runFallback(root, stdin, root);

      expect(result.stderr).toContain('src/');
      expect(result.stderr).toContain('src/x.ts');
    }
  );
});
