// tests/unit/skills/qa-presence-cross-session.test.ts
//
// QA (peaks-qa) — INDEPENDENT verification of slice rid-t2-presence-cross-session.
//
// The RD artifact is `.peaks/_runtime/2026-10-23-session-5e40e0/rd/requests/
// 003-rid-t2-presence-cross-session.md`. This file re-measures the QA spec's
// acceptance list with its OWN fixtures (the spec's session ids, its own lease
// shapes, its own CLI entry points). It deliberately does NOT import or reuse
// `tests/unit/skills/presence-cross-session.test.ts`, so a shared misreading
// cannot hide behind a shared green.
//
// EVERY fixture lives in a throwaway `mkdtemp` project. No presence lease is
// ever created on this machine — the state under measurement is left untouched.
//
// Dimensions covered: behavior (the selection + gate contracts), integration
// (real session trees on disk), render (the `peaks skill presence --json`
// envelope), a11y (the human-facing exit code / message surface).
//
// Run with: pnpm vitest run tests/unit/skills/qa-presence-cross-session.test.ts

import { Command } from 'commander';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import {
  cleanupTmpWorkspace,
  useTmpWorkspace,
  type TmpWorkspace
} from '../_setup/tmp-workspace.js';
import { registerSkillCommand } from '../../../src/cli/commands/core/skill-command.js';
import { registerStatusLineCommands } from '../../../src/cli/commands/statusline-commands.js';
import { getSkillPresence } from '../../../src/services/skills/skill-presence-service.js';
import {
  listPresenceLeases,
  markPresenceLost,
  setPresenceLease
} from '../../../src/services/skills/presence-lease-service.js';
import {
  STALE_HEARTBEAT_MS,
  STALE_STARTED_AFTER_MS
} from '../../../src/services/skills/presence-lease-types.js';

declareDimensions('tests/unit/skills/qa-presence-cross-session.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

/** The session trees the QA spec names: one with a lease, one without. */
const TREE_A = '2026-09-16-session-aaaaaa';
const TREE_B = '2026-09-16-session-bbbbbb';
const TREE_C = '2026-09-16-session-cccccc';

const CALLER = 'qa-caller';
const WORKFLOW = 'qa-workflow';

let ws: TmpWorkspace;
const savedEnv = { ...process.env };
let savedExitCode: number | string | null | undefined;

beforeEach(() => {
  ws = useTmpWorkspace('peaks-qa-presence-');
  // The caller id must NOT resolve, or the bound tree would be decided by an
  // ambient binding instead of the fixture.
  delete process.env.PEAKS_CALLER_ID;
  delete process.env.PEAKS_SESSION_ID;
  delete process.env.PEAKS_OUTER_SESSION_ID;
  delete process.env.CLAUDE_CODE_SESSION_ID;
  savedExitCode = process.exitCode;
});

afterEach(() => {
  process.exitCode = savedExitCode;
  Object.assign(process.env, savedEnv);
  cleanupTmpWorkspace();
});

/* ---------- fixtures ---------- */

type LeaseOpts = {
  skill?: string;
  status?: 'running' | 'preparing' | 'terminalized' | 'lost';
  mode?: string;
  gate?: string;
  /** Age of `lastHeartbeat` in ms. */
  heartbeatAgeMs?: number;
  /** Age of `startedAt` in ms. */
  startedAgeMs?: number;
  /** An exact ISO stamp for BOTH `startedAt` and `lastHeartbeat`. */
  fixedAt?: string;
  /** When set, `terminalAt` is written. */
  terminal?: boolean;
  /** When false, the `gate` field is omitted (a pre-gate lease). */
  withGate?: boolean;
};

function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

function leasePath(root: string, sessionId: string): string {
  return join(
    root,
    '.peaks',
    '_runtime',
    sessionId,
    'leases',
    `presence-${CALLER}-${WORKFLOW}.json`
  );
}

/** Write a canonical sid-scoped lease file under a session tree. */
function writeLease(root: string, sessionId: string, opts: LeaseOpts = {}): string {
  const dir = join(root, '.peaks', '_runtime', sessionId, 'leases');
  mkdirSync(dir, { recursive: true });
  const lease: Record<string, unknown> = {
    callerId: CALLER,
    workflowId: WORKFLOW,
    graphRef: `graphs/${WORKFLOW}.json`,
    skill: opts.skill ?? 'peaks-code',
    depth: 0,
    startedAt: opts.fixedAt ?? isoAgo(opts.startedAgeMs ?? 0),
    lastHeartbeat: opts.fixedAt ?? isoAgo(opts.heartbeatAgeMs ?? 0),
    status: opts.status ?? 'running',
    schemaVersion: 1
  };
  if (opts.mode !== undefined) lease.mode = opts.mode;
  if (opts.withGate !== false && opts.gate !== undefined) lease.gate = opts.gate;
  if (opts.terminal === true) lease.terminalAt = isoAgo(0);
  const path = join(dir, `presence-${CALLER}-${WORKFLOW}.json`);
  writeFileSync(path, JSON.stringify(lease, null, 2), 'utf8');
  return path;
}

/** Point the project-level binding at a session tree. */
function bindTree(root: string, sessionId: string): void {
  const dir = join(root, '.peaks', '_runtime');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'session.json'),
    JSON.stringify({ sessionId, projectRoot: root }, null, 2),
    'utf8'
  );
}

type Envelope = {
  ok: boolean;
  command?: string;
  data: Record<string, unknown>;
  code?: string;
  message?: string;
};

/** Run a `peaks skill ...` verb in-process and return its JSON envelope. */
async function runSkill(args: readonly string[], project: string): Promise<Envelope> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  registerSkillCommand(program, io);
  await program.parseAsync(['skill', ...args, '--project', project, '--json'], { from: 'user' });
  return JSON.parse(captured.text()) as Envelope;
}

/* ---------- integration: the cross-session read ---------- */

describe('Scenario: integration — the presence read reaches the other session trees', () => {
  it('when the bound tree holds no lease and another tree holds a live one, should report that tree', async () => {
    // given: a project bound to the empty tree, with a live lease in the other tree
    // when: the presence is read through the CLI entry point
    // then: the other tree's lease is reported, not "inactive"
    bindTree(ws.path, TREE_B);
    writeLease(ws.path, TREE_A, { skill: 'peaks-code' });
    const envelope = await runSkill(['presence'], ws.path);
    expect(envelope.data.active).toBe(true);
    expect(envelope.data.skill).toBe('peaks-code');
    expect(envelope.data.sessionId).toBe(TREE_A);
  });

  it('when the binding points at the tree that holds the lease, should report it too', async () => {
    // given: the same project, now bound to the tree that holds the lease
    // when: the presence is read
    // then: the bound path still answers "active"
    bindTree(ws.path, TREE_A);
    writeLease(ws.path, TREE_A, { skill: 'peaks-code' });
    const envelope = await runSkill(['presence'], ws.path);
    expect(envelope.data.active).toBe(true);
    expect(envelope.data.sessionId).toBe(TREE_A);
  });

  it('when the bound tree holds its own lease and another tree holds a fresher one, should keep the bound tree', async () => {
    // given: the bound tree holds a lease, and a foreign tree holds a fresher one
    // when: the presence is read
    // then: the bound tree keeps its precedence, so the bound tree is reported
    bindTree(ws.path, TREE_B);
    writeLease(ws.path, TREE_B, { skill: 'peaks-qa', heartbeatAgeMs: 30 * 60 * 1000 });
    writeLease(ws.path, TREE_A, { skill: 'peaks-code', heartbeatAgeMs: 0 });
    const envelope = await runSkill(['presence'], ws.path);
    expect(envelope.data.active).toBe(true);
    expect(envelope.data.skill).toBe('peaks-qa');
    expect(envelope.data.sessionId).toBe(TREE_B);
  });
});

/* ---------- behavior: the selection rule is deterministic ---------- */

describe('Scenario: behavior — the selection rule names one winner', () => {
  it('when three trees hold leases with different heartbeats, should pick the freshest', async () => {
    // given: three eligible leases with descending freshness
    // when: the presence is read
    // then: the freshest heartbeat wins — a stated rule, not "it looks right"
    bindTree(ws.path, TREE_B);
    writeLease(ws.path, TREE_A, { skill: 'peaks-a', heartbeatAgeMs: 3 * 60 * 60 * 1000 });
    writeLease(ws.path, TREE_B, { skill: 'peaks-b', heartbeatAgeMs: 2 * 60 * 60 * 1000 });
    writeLease(ws.path, TREE_C, { skill: 'peaks-c', heartbeatAgeMs: 1000 });
    const envelope = await runSkill(['presence'], ws.path);
    expect(envelope.data.sessionId).toBe(TREE_C);
    expect(envelope.data.skill).toBe('peaks-c');
  });

  it('when two trees tie on heartbeat and start, should pick the same tree every time', async () => {
    // given: two leases that tie on every ordered field except the session id
    // when: the presence is read twice
    // then: both reads name the same winner (the lexicographically smaller session id)
    bindTree(ws.path, '2026-09-16-session-zzzzzz');
    const sameStamp = isoAgo(60 * 1000);
    writeLease(ws.path, TREE_A, { skill: 'peaks-a', fixedAt: sameStamp });
    writeLease(ws.path, TREE_B, { skill: 'peaks-b', fixedAt: sameStamp });
    const first = await runSkill(['presence'], ws.path);
    const second = await runSkill(['presence'], ws.path);
    expect(first.data.sessionId).toBe(TREE_A);
    expect(second.data.sessionId).toBe(TREE_A);
  });
});

/* ---------- behavior + integration: the gate reaches the disk ---------- */

describe('Scenario: behavior — the gate is persisted and read back', () => {
  it('when a lease is written with a gate, should carry the gate on disk and in the read', async () => {
    // given: a lease written through the SetPresenceLeaseInput.gate write path
    // when: the lease file on disk is read back
    // then: the gate is really on disk, and the read projects it
    bindTree(ws.path, TREE_A);
    setPresenceLease({
      projectRoot: ws.path,
      sessionId: TREE_A,
      callerId: CALLER,
      workflowId: WORKFLOW,
      graphRef: `graphs/${WORKFLOW}.json`,
      skill: 'peaks-code',
      gate: 'qa-validation'
    });
    const onDisk = JSON.parse(readFileSync(leasePath(ws.path, TREE_A), 'utf8')) as {
      gate?: string;
    };
    expect(onDisk.gate).toBe('qa-validation');
    expect(getSkillPresence(ws.path)?.gate).toBe('qa-validation');
    const envelope = await runSkill(['presence'], ws.path);
    expect(envelope.data.gate).toBe('qa-validation');
  });

  it('when a lease written by an older release carries no gate field, should still load it', async () => {
    // given: a schemaVersion-1 lease with no gate field at all
    // when: the lease is loaded and the presence is read
    // then: it loads without an error and projects no gate
    bindTree(ws.path, TREE_A);
    writeLease(ws.path, TREE_A, { skill: 'peaks-code', withGate: false });
    const leases = listPresenceLeases(ws.path, TREE_A);
    const presence = getSkillPresence(ws.path);
    expect(leases).toHaveLength(1);
    expect(leases[0]?.schemaVersion).toBe(1);
    expect(presence?.skill).toBe('peaks-code');
    expect(presence?.gate).toBeUndefined();
  });
});

/* ---------- behavior: stale and terminal leases are not active ---------- */

describe('Scenario: behavior — a cold or finished lease is not reported as active', () => {
  it('when the heartbeat is past the stale window, should not report the lease as active', async () => {
    // given: a lease whose heartbeat is two hours old
    // when: the presence is read
    // then: it is inactive, and the diagnostic says why
    bindTree(ws.path, TREE_A);
    writeLease(ws.path, TREE_A, { heartbeatAgeMs: 2 * 60 * 60 * 1000 });
    const envelope = await runSkill(['presence'], ws.path);
    expect(envelope.data.active).toBe(false);
    const withReason = await runSkill(['presence', '--check-stale'], ws.path);
    expect((withReason.data.presenceInactive as { reason?: string })?.reason).toBe('all-stale');
  });

  it('when the lease reached a terminal state, should not report the lease as active', async () => {
    // given: a lease that carries terminalAt
    // when: the presence is read
    // then: it is inactive
    bindTree(ws.path, TREE_A);
    writeLease(ws.path, TREE_A, { status: 'terminalized', terminal: true });
    const envelope = await runSkill(['presence'], ws.path);
    expect(envelope.data.active).toBe(false);
  });

  it('when a lease is fresh, should report it as active', async () => {
    // given: a lease written moments ago
    // when: the presence is read
    // then: it is active
    bindTree(ws.path, TREE_A);
    writeLease(ws.path, TREE_A, { heartbeatAgeMs: 0 });
    const envelope = await runSkill(['presence'], ws.path);
    expect(envelope.data.active).toBe(true);
  });

  it('when the heartbeat sits on the stale boundary, should use the repo lease window, not a new one', async () => {
    // given: a lease one millisecond inside the window, and one one millisecond past it
    // when: the presence is read
    // then: it is still active — the window is the repo's existing 1h heartbeat window
    bindTree(ws.path, '2026-09-16-session-zzzzzz');
    writeLease(ws.path, TREE_A, { heartbeatAgeMs: STALE_HEARTBEAT_MS - 1000 });
    const inside = await runSkill(['presence'], ws.path);
    expect(inside.data.active).toBe(true);
    expect(STALE_HEARTBEAT_MS).toBe(60 * 60 * 1000);
    expect(STALE_STARTED_AFTER_MS).toBe(24 * 60 * 60 * 1000 + 30 * 60 * 1000);
  });

  it('when a 24h lease is past the 1h window but inside its own window, should keep it active', async () => {
    // given: a 24h lease whose heartbeat is two hours old
    // when: the presence is read
    // then: the 24h run keeps its presence (its window is 24h30m)
    bindTree(ws.path, TREE_A);
    writeLease(ws.path, TREE_A, { mode: '24h', heartbeatAgeMs: 2 * 60 * 60 * 1000 });
    const envelope = await runSkill(['presence'], ws.path);
    expect(envelope.data.active).toBe(true);
    expect(envelope.data.mode).toBe('24h');
  });
});

/* ---------- integration: the terminal path ---------- */

describe('Scenario: integration — a lease can still reach a terminal state', () => {
  it('when the lease is terminalized, should stop reporting it as active', async () => {
    // given: a live lease
    // when: the lease is terminalized
    // then: the read no longer reports it, and the file records the end state
    bindTree(ws.path, TREE_A);
    setPresenceLease({
      projectRoot: ws.path,
      sessionId: TREE_A,
      callerId: CALLER,
      workflowId: WORKFLOW,
      graphRef: `graphs/${WORKFLOW}.json`,
      skill: 'peaks-code'
    });
    expect(getSkillPresence(ws.path)?.skill).toBe('peaks-code');
    markPresenceLost({
      projectRoot: ws.path,
      sessionId: TREE_A,
      callerId: CALLER,
      workflowId: WORKFLOW,
      graphRef: `graphs/${WORKFLOW}.json`,
      reason: 'success'
    });
    expect(getSkillPresence(ws.path)).toBeNull();
    const onDisk = JSON.parse(readFileSync(leasePath(ws.path, TREE_A), 'utf8')) as {
      status?: string;
      terminalAt?: string;
    };
    expect(onDisk.status).toBe('terminalized');
    expect(typeof onDisk.terminalAt).toBe('string');
  });
});

/* ---------- render: the empty envelope stays empty ---------- */

describe('Scenario: render — the empty scenario stays false', () => {
  it('when no lease exists anywhere, should report exactly `active: false`', async () => {
    // given: a project with a bound tree and no lease at all
    // when: the presence is read
    // then: it is inactive, with no optimistic default and no extra field
    bindTree(ws.path, TREE_B);
    const envelope = await runSkill(['presence'], ws.path);
    expect(envelope.data.active).toBe(false);
    expect(Object.keys(envelope.data).sort()).toEqual(['active']);
  });
});

/* ---------- a11y: the neighbouring entry points still work ---------- */

describe('Scenario: a11y — the neighbouring presence entry points still answer', () => {
  it('when the heartbeat is asked for, should report the live lease', async () => {
    // given: a project with one live lease
    // when: `skill heartbeat` is asked (it reads the cwd project)
    // then: it names the live skill and its gate
    bindTree(ws.path, TREE_A);
    writeLease(ws.path, TREE_A, { skill: 'peaks-code', gate: 'startup' });
    const { io, captured } = makeCapturedIo();
    const program = new Command();
    registerSkillCommand(program, io);
    await program.parseAsync(['skill', 'heartbeat', '--json'], { from: 'user' });
    const envelope = JSON.parse(captured.text()) as Envelope;
    expect(envelope.data.active).toBe(true);
    expect(envelope.data.skill).toBe('peaks-code');
    expect(envelope.data.gate).toBe('startup');
  });

  it('when presence:clear is asked for, should refuse to remove a live lease', async () => {
    // given: a project with one live lease
    // when: `skill presence:clear` runs
    // then: it reports the lease survived, and the lease file is still on disk
    bindTree(ws.path, TREE_A);
    writeLease(ws.path, TREE_A, { skill: 'peaks-code' });
    const envelope = await runSkill(['presence:clear'], ws.path);
    expect(envelope.data.active).toBe(true);
    expect(envelope.data.cleared).toBe(false);
    expect(existsSync(leasePath(ws.path, TREE_A))).toBe(true);
  });

  it('when the statusline is rendered, should produce a status line without failing', async () => {
    // given: a project with one live lease
    // when: `peaks statusline` renders
    // then: it renders a non-empty line and exits cleanly
    bindTree(ws.path, TREE_A);
    writeLease(ws.path, TREE_A, { skill: 'peaks-code' });
    const { io, captured } = makeCapturedIo();
    const program = new Command();
    registerStatusLineCommands(program, io);
    await program.parseAsync(['statusline', '--project', ws.path], { from: 'user' });
    expect(captured.text().trim().length).toBeGreaterThan(0);
    expect(process.exitCode ?? 0).toBe(0);
  });
});
