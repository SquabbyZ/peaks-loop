// tests/unit/hooks/code-gate-driver.test.ts
//
// `peaks code-gate` is the command the PreToolUse hook runs on every `Edit` /
// `Write` / `MultiEdit`. The decision itself is a pure function
// (`decideGateAction`); what this file pins is the layer above it, the one that
// turns a hook payload into the single driver string that decision takes.
//
// The fixtures are real presence leases on disk (`setPresenceLease`), not a
// stubbed resolver. "Does this caller own a lease?" is the whole question, and
// a stub would answer it by construction.
//
// The gate is the one hook in this family that fails CLOSED. Absent identity,
// an identity that owns no lease, and an identity whose lease names some other
// skill all leave the hard-blocked families denied — so each case below asserts
// a deny, rather than the mere absence of an allow.
//
// A tool call reaches this command under one of two spellings of the same
// three keys: `{tool, input}` and `{tool_name, tool_input}`. Both must be
// judged, so the payloads below cover each spelling on the same cases.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setPresenceLease } from '~/src/services/skills/presence-lease-service';
import { runHook } from '../_setup/code-gate-shell-harness.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

const ROOT = resolve(__dirname, '..', '..', '..');
const SESSION = '2026-10-10-session-racecode';
const BLOCKED = 'src/services/foo.ts';
const UNGATED = 'notes.txt';

// Every case spawns the real CLI (`node --import tsx src/cli/index.ts`, ~2.5 s per
// call alone on this host, and the exit-channel cases spawn twice). The global 30 s
// budget is a HANG detector, not a load budget — this file was measured timing out
// at it under a full-suite run (backlog §7.1). The shared subprocess budget is the
// measured class budget, so it is scoped to the file instead of repeated per case.
vi.setConfig({ testTimeout: SUBPROCESS_TEST_TIMEOUT_MS });

const tmpRoots: string[] = [];

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-code-gate-'));
  tmpRoots.push(root);
  const runtime = join(root, '.peaks', '_runtime');
  mkdirSync(runtime, { recursive: true });
  writeFileSync(
    join(runtime, 'session.json'),
    JSON.stringify({ sessionId: SESSION, createdAt: new Date().toISOString(), projectRoot: root })
  );
  // A project marker of our own, so the root resolves to itself: without one
  // the canonical resolver walks up for a `.git` or a `package.json` and
  // answers with an ancestor.
  writeFileSync(join(root, '.peaks', 'config.json'), JSON.stringify({ schemaVersion: 1 }));
  return root;
}

function writeLease(root: string, callerId: string, skill: string): void {
  setPresenceLease({
    projectRoot: root,
    sessionId: SESSION,
    callerId,
    workflowId: callerId,
    graphRef: `graphs/${callerId}.json`,
    skill
  });
}

/** A tool call under the legacy spelling this command's own header documents. */
function payload(filePath: string, callerId?: string): string {
  return JSON.stringify({
    tool: 'Edit',
    input: { file_path: filePath },
    ...(callerId === undefined ? {} : { session_id: callerId })
  });
}

/** The same call under the harness spelling of the tool name and arguments. */
function harnessPayload(filePath: string, callerId?: string): string {
  return JSON.stringify({
    tool_name: 'Edit',
    tool_input: { file_path: filePath },
    ...(callerId === undefined ? {} : { session_id: callerId })
  });
}

function runCodeGate(root: string, stdin: string): { status: number | null; stdout: string } {
  const run = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      join(ROOT, 'src', 'cli', 'index.ts'),
      'code-gate',
      '--project',
      root,
      '--dry-run',
      '--json'
    ],
    { cwd: ROOT, encoding: 'utf8', windowsHide: true, input: stdin, env: { ...process.env } }
  );
  return { status: run.status, stdout: run.stdout ?? '' };
}

/**
 * The same command through the channel the installed hook actually reads: no
 * `--dry-run`, so the verdict leaves as the process status and a denial's text
 * goes to stderr. `runCodeGate` above answers with a JSON envelope on stdout
 * instead, which no hook consumes.
 */
function runCodeGateLive(root: string, stdin: string): { status: number | null; stderr: string } {
  const run = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      join(ROOT, 'src', 'cli', 'index.ts'),
      'code-gate',
      '--project',
      root,
      '--json'
    ],
    { cwd: ROOT, encoding: 'utf8', windowsHide: true, input: stdin, env: { ...process.env } }
  );
  return { status: run.status, stderr: run.stderr ?? '' };
}

/**
 * The sibling's OWN decision.
 *
 * The sibling is a thin wrapper over the Node command: where a command is
 * reachable it execs it, and the comparison below would be the command
 * against itself. It is therefore run with NO command reachable at all, so
 * what answers is the conservative path inside it — the one a harness without
 * Node gets, and the one that takes no caller identity into account.
 *
 * Its cwd is the lease-bearing project on purpose: a sibling that grew a
 * driver lookup would find the lease there and open the family, so running
 * it anywhere else would let this test pass without pinning anything.
 */
function runShellSibling(root: string, stdin: string): { status: number | null; stderr: string } {
  const run = runHook({ payload: stdin, cwd: root, args: [root], cli: false });
  return { status: run.status, stderr: run.stderr };
}

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

describe('peaks code-gate — which caller is driving the tool call', () => {
  it('denies a hard-blocked edit when the payload names no caller', () => {
    // The identity is the gate's only input, so its absence cannot open the
    // gate — not even in a session that is demonstrably driven by the fast
    // lane's own lease.
    const root = makeProject();
    writeLease(root, 'caller-a', 'peaks-race-code');

    const { status, stdout } = runCodeGate(root, payload(BLOCKED));

    expect(status).toBe(0);
    expect(stdout).toContain('"action": "deny"');
    expect(stdout).toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');
  });

  it('denies when the named caller owns no lease, though the session holds the fast lane', () => {
    // The lease on disk says `peaks-race-code`, but it belongs to caller-a. An
    // answer read without scoping to the caller would hand the write to
    // caller-b, so the scoping — not the skill name — is what this pins.
    const root = makeProject();
    writeLease(root, 'caller-a', 'peaks-race-code');

    const { status, stdout } = runCodeGate(root, payload(BLOCKED, 'caller-b'));

    expect(status).toBe(0);
    expect(stdout).toContain('"action": "deny"');
    expect(stdout).toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');
  });

  it('denies when the caller owns a lease that names some other skill', () => {
    const root = makeProject();
    writeLease(root, 'caller-b', 'peaks-code');

    const { status, stdout } = runCodeGate(root, payload(BLOCKED, 'caller-b'));

    expect(status).toBe(0);
    expect(stdout).toContain('"action": "deny"');
  });

  it('allows a hard-blocked edit when the caller owns the fast lane lease', () => {
    const root = makeProject();
    writeLease(root, 'caller-a', 'peaks-race-code');

    const { status, stdout } = runCodeGate(root, payload(BLOCKED, 'caller-a'));

    expect(status).toBe(0);
    expect(stdout).toContain('"action": "allow"');
    expect(stdout).not.toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');
  });

  it('denies a hard-blocked edit in a project with no peaks lease at all', () => {
    // The command-layer half of the default branch: a resolution that finds
    // nothing must leave the two-argument verdict — deny — untouched.
    const root = makeProject();

    const { status, stdout } = runCodeGate(root, payload(BLOCKED, 'caller-a'));

    expect(status).toBe(0);
    expect(stdout).toContain('"action": "deny"');
  });

  it('allows an ungated path for a caller the gate cannot place', () => {
    // Resolution failure may only ever fall back to the two-argument verdict,
    // which denies the hard-blocked families and nothing else. A gate that
    // denied every unresolvable call would block ordinary edits outright.
    const root = makeProject();
    writeLease(root, 'caller-a', 'peaks-race-code');

    const { status, stdout } = runCodeGate(root, payload(UNGATED, 'caller-b'));

    expect(status).toBe(0);
    expect(stdout).toContain('"action": "allow"');
  });
});

describe('peaks code-gate — the harness spelling of the tool call', () => {
  it('denies a hard-blocked path when the payload uses the harness spelling', () => {
    // A real PreToolUse call carries `tool_name` / `tool_input`. A command that
    // reads only `tool` / `input` sees no tool name, and every tool name that
    // is not Edit/Write/MultiEdit is allowed — so the gate never fires.
    const root = makeProject();

    const { status, stdout } = runCodeGate(root, harnessPayload(BLOCKED));

    expect(status).toBe(0);
    expect(stdout).toContain('"action": "deny"');
    expect(stdout).toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');
  });

  it('still judges the legacy spelling', () => {
    const root = makeProject();

    const { status, stdout } = runCodeGate(root, payload(BLOCKED));

    expect(status).toBe(0);
    expect(stdout).toContain('"action": "deny"');
    expect(stdout).toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');
  });

  it('allows a hard-blocked path the harness spelling places under the fast lane', () => {
    // The write the fast lane exists to perform: with the tool call judged at
    // all, its lease is what opens `src/`.
    const root = makeProject();
    writeLease(root, 'caller-a', 'peaks-race-code');

    const { status, stdout } = runCodeGate(root, harnessPayload(BLOCKED, 'caller-a'));

    expect(status).toBe(0);
    expect(stdout).toContain('"action": "allow"');
    expect(stdout).not.toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');
  });

  it('allows an ungated path under the harness spelling', () => {
    // Reading the harness spelling must not widen the deny: a path in no
    // hard-blocked family stays an allow, as it does under the legacy spelling.
    const root = makeProject();

    const { status, stdout } = runCodeGate(root, harnessPayload(UNGATED));

    expect(status).toBe(0);
    expect(stdout).toContain('"action": "allow"');
  });
});

// ---------------------------------------------------------------------------
// The exit channel — what the installed hook actually reads
// ---------------------------------------------------------------------------
//
// Every case above drives `--dry-run`, which answers with a JSON envelope on
// stdout. No hook consumes that: the installed PreToolUse entry runs the
// command bare, so `src/cli/commands/code-gate-command.ts` reaches its second
// half — stderr plus `process.exit(2)` for a deny, `exit 0` otherwise. A
// broken channel there is a silent allow, the one failure this gate exists to
// prevent, so both spellings are pinned through it here.

describe('peaks code-gate — the exit channel', () => {
  it(
    'when a denied edit runs under the legacy spelling, should exit 2 with the marker on stderr',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a project whose only lease is caller-a's fast lane, so caller-b cannot be placed
      // when: the hard-blocked edit is run through the command's real exit path
      // then: the deny is status 2 with the marker on stderr, and the fast lane's own call is 0
      const root = makeProject();
      writeLease(root, 'caller-a', 'peaks-race-code');

      const denied = runCodeGateLive(root, payload(BLOCKED, 'caller-b'));
      expect(denied.status).toBe(2);
      expect(denied.stderr).toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');

      const allowed = runCodeGateLive(root, payload(BLOCKED, 'caller-a'));
      expect(allowed.status).toBe(0);
    }
  );

  it(
    'when a denied edit runs under the harness spelling, should exit 2 with the marker on stderr',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: the same project and lease, with the tool call under `tool_name` / `tool_input`
      // when: that payload is run through the command's real exit path
      // then: the deny is status 2 with the marker on stderr, and the fast lane's own call is 0
      const root = makeProject();
      writeLease(root, 'caller-a', 'peaks-race-code');

      const denied = runCodeGateLive(root, harnessPayload(BLOCKED, 'caller-b'));
      expect(denied.status).toBe(2);
      expect(denied.stderr).toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');

      const allowed = runCodeGateLive(root, harnessPayload(BLOCKED, 'caller-a'));
      expect(allowed.status).toBe(0);
    }
  );
});

// ---------------------------------------------------------------------------
// The shell sibling's own path — the second gate, and the one axis the two
// do not share
// ---------------------------------------------------------------------------
//
// `peaks hooks install --scope global` copies `pre-tool-code-gate.sh` alongside
// the command's own hook entry (`src/cli/commands/hooks-commands.ts`), and the
// script is now a THIN WRAPPER over that command: where a command is reachable
// it execs it. What is left of the script is the conservative path a harness
// WITHOUT the command gets, and it takes no driver input: nothing in it
// resolves a caller, so it denies the hard-blocked families whatever lease
// sits on disk. That is a real divergence from the command above, and it is
// deliberate — that path is the conservative fallback, and teaching it the
// lease resolution would be a second implementation of the one decision the
// command layer owns.
//
// So the divergence is pinned here rather than left to be rediscovered. The two
// are handed ONE payload, in ONE project state, and must disagree; the only
// input they do not share is the driver, so a change that syncs the fallback
// (or quiets the command) reddens this rather than drifting silently.

describe('peaks code-gate vs. the shell sibling — one call, two verdicts', () => {
  it(
    'the shell sibling denies the edit the command allows, because it takes no driver input',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // The legacy `{tool, input}` spelling, which both gates have always read,
      // so the payload spelling is not a second variable in the comparison.
      const root = makeProject();
      writeLease(root, 'caller-a', 'peaks-race-code');
      const stdin = payload(BLOCKED, 'caller-a');

      // The command resolves caller-a's lease and opens the family.
      const cli = runCodeGate(root, stdin);
      expect(cli.status).toBe(0);
      expect(cli.stdout).toContain('"action": "allow"');
      expect(cli.stdout).not.toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');

      // The sibling reads the same bytes, in the same project, with that same
      // lease on disk — and denies, because it never asks who is driving.
      const shell = runShellSibling(root, stdin);
      expect(shell.status).toBe(2);
      expect(shell.stderr).toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');
      expect(shell.stderr).toContain(BLOCKED);
    }
  );
});
