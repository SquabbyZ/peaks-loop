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
import { afterEach, describe, expect, it } from 'vitest';

import { setPresenceLease } from '~/src/services/skills/presence-lease-service';

const ROOT = resolve(__dirname, '..', '..', '..');
const SESSION = '2026-10-10-session-racecode';
const BLOCKED = 'src/services/foo.ts';
const UNGATED = 'notes.txt';

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
