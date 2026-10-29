// tests/unit/hooks/gate-enforce-grants-nothing.test.ts
//
// THE GRANT THIS FILE REFUSES TO LET COME BACK.
//
// `peaks gate enforce` is installed as a PreToolUse hook on every Bash call. Its
// allow path used to merge a Claude Code allow decision into the document it
// printed, and that decision is a real permission GRANT: the host approves the tool
// call and skips the user's own permission prompt. A gate that passes a call
// through has no opinion to give, so the allow path now prints the plain envelope
// and grants nothing — the call proceeds to the user's normal permission flow.
//
// The deny path is the POINT of the hook and is untouched: a real denial still
// prints the host's deny document on stdout and exits 2.
//
// The envelope shape is unchanged by the removal: ONE JSON document, the gate's own
// decision under `data`, and no root-level `decision` (the key the host owns, and the
// one whose value outside {approve, block} produced the per-call "Invalid option"
// error).
//
// Dimensions covered: behavior (what each allow path prints), integration (the
// installed hook command, run as a real process against a real payload).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
  emitAllowSkipped,
  emitAllowWorktree,
  emitSopAllow,
  type GateEnforceCliOptions
} from '~/src/cli/commands/gate-commands-enforce';
import { makeCapturedIo } from '../_setup/io.js';
import { runSourceCli } from '../_setup/source-cli.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

/** The installed hook's own spelling, as the host runs it. */
const GATE_ENFORCE_ARGS = ['gate', 'enforce', '--project'] as const;

/** A real PreToolUse payload for a Bash tool call. */
const BASH_PAYLOAD = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo hi' } });

/** A minimal `allow` SOP decision, shaped like `EnforceDecision`. */
const SOP_ALLOW = { decision: 'allow' as const, warnings: ['gate enforce: no SOP matched'] };

const options: GateEnforceCliOptions = { project: '.', json: true };

const scratchRoots: string[] = [];

/** A fresh project root for one case, removed after the file finishes. */
function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-gate-grant-'));
  scratchRoots.push(root);
  return root;
}

afterAll(() => {
  for (const root of scratchRoots) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** Parse stdout the way the host does: the WHOLE of it must be ONE JSON document. */
function parseDocument(stdout: string, detail: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `stdout is not one JSON document (${detail}): ${(error as Error).message}\n--- stdout ---\n${stdout}`
    );
  }
  return parsed as Record<string, unknown>;
}

describe('Scenario: the allow paths of the gate enforce hook', () => {
  it('when the SOP check is skipped, should print the envelope and grant nothing', () => {
    // given: an in-process capture around the skipped allow path
    // when: the skipped allow path is emitted
    // then: the document carries no permission decision and no root-level decision
    const { io, captured } = makeCapturedIo();
    emitAllowSkipped(io, options);
    const document = parseDocument(captured.text(), 'skipped allow path');
    expect(document).not.toHaveProperty('hookSpecificOutput');
    expect(document).not.toHaveProperty('decision');
    expect(document.data).toMatchObject({ decision: 'allow' });
  });

  it('when the worktree gate allowed the call, should print the envelope and grant nothing', () => {
    // given: an in-process capture around the worktree-allowed allow path
    // when: the worktree-allowed path is emitted
    // then: the document carries no permission decision and no root-level decision
    const { io, captured } = makeCapturedIo();
    emitAllowWorktree(io, options);
    const document = parseDocument(captured.text(), 'worktree allow path');
    expect(document).not.toHaveProperty('hookSpecificOutput');
    expect(document).not.toHaveProperty('decision');
    expect(document.data).toMatchObject({ decision: 'allow' });
  });

  it('when an SOP matched and allowed, should print the envelope and grant nothing', () => {
    // given: an in-process capture around the SOP-allowed allow path
    // when: the SOP-allowed path is emitted
    // then: the document carries no permission decision and no root-level decision
    const { io, captured } = makeCapturedIo();
    emitSopAllow(io, options, SOP_ALLOW);
    const document = parseDocument(captured.text(), 'SOP allow path');
    expect(document).not.toHaveProperty('hookSpecificOutput');
    expect(document).not.toHaveProperty('decision');
    expect(document.data).toMatchObject({ decision: 'allow' });
  });

  it(
    'when the installed hook runs on an ordinary Bash call, should grant nothing',
    () => {
      // given: a fresh project, and the payload the host sends for a Bash call
      // when: the installed hook command runs
      // then: it exits 0, prints one document, and grants no permission
      const project = makeProject();
      const run = runSourceCli([...GATE_ENFORCE_ARGS, project, '--json'], {
        input: BASH_PAYLOAD,
        cwd: project
      });
      expect(run.status).toBe(0);
      const document = parseDocument(run.stdout, `status ${String(run.status)}`);
      expect(document).not.toHaveProperty('hookSpecificOutput');
      expect(document).not.toHaveProperty('decision');
      // The envelope a downstream consumer reads is unchanged.
      expect(document).toMatchObject({ ok: true, command: 'gate.enforce' });
      expect(document.data).toMatchObject({ decision: 'allow' });
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );
});

describe('Scenario: the deny path of the gate enforce hook', () => {
  it(
    'when the gate denies a Bash call, should still print the deny document and exit 2',
    () => {
      // given: a fresh project with no worktree grant, and a worktree-mutating command
      // when: the installed hook command runs
      // then: it exits 2 and the host's deny document is on stdout
      const project = makeProject();
      const payload = JSON.stringify({
        tool_name: 'Bash',
        tool_input: { command: 'git worktree add ../wt-probe' }
      });
      const run = runSourceCli([...GATE_ENFORCE_ARGS, project, '--json'], {
        input: payload,
        cwd: project
      });
      expect(run.status).toBe(2);
      const document = parseDocument(run.stdout, `status ${String(run.status)}`);
      expect(document.hookSpecificOutput).toMatchObject({
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny'
      });
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );
});
