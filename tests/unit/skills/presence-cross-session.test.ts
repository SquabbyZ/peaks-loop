// tests/unit/skills/presence-cross-session.test.ts
//
// Slice 2026-10-24 — rid-t2-presence-cross-session.
// Split 2026-10-24 — rid-t3-presence-cross-session-test-split.
//
// This file now holds ONLY the presence scenarios that need a real disk: the
// cross-session read over real session trees (integration), the `--json`
// envelope (render), and the plain-language refusal of a malformed gate (a11y).
//
// The pure tests moved to two sibling files, both fixture-free:
//
//   - `tests/unit/skills/presence-gate.test.ts` — the 6 gate-contract tests.
//   - `tests/unit/skills/presence-lease-selection.test.ts` — the 8 selection tests.
//
// Only the 11 tests left here pay for a scratch workspace per test.
//
// Dimensions: integration, render, a11y; `behavior` is omitted with a reason
// in the `declareDimensions` call below.
//
// Run with: pnpm vitest run tests/unit/skills/presence-cross-session.test.ts

import { Command } from 'commander';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import {
  cleanupTmpWorkspace,
  useTmpWorkspace,
  type TmpWorkspace
} from '../_setup/tmp-workspace.js';
import { getSkillPresence } from '../../../src/services/skills/skill-presence-service.js';
import { diagnosePresence } from '../../../src/services/skills/presence-lease-resolver.js';
import { registerSkillCommand } from '../../../src/cli/commands/core/skill-command.js';

declareDimensions(
  'tests/unit/skills/presence-cross-session.test.ts',
  ['integration', 'render', 'a11y'],
  [{ dim: 'behavior', reason: 'the pure behaviour tests moved to the two sibling files.' }]
);

const BOUND_SID = '2026-10-24-session-0000aa';
const OTHER_SID = '2026-10-23-session-0000bb';

const NOW = new Date().toISOString();
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

let ws: TmpWorkspace;
const savedEnv = { ...process.env };
let savedExitCode: number | string | null | undefined;

beforeEach(() => {
  ws = useTmpWorkspace('peaks-presence-cross-session-');
  // The caller id must NOT resolve, or the bound-session path would be
  // decided by an ambient binding instead of the fixture. The whole point
  // of the slice is that presence keeps working when it does NOT resolve.
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
type LeaseFixture = {
  callerId?: string;
  workflowId?: string;
  skill?: string;
  status?: 'running' | 'preparing' | 'terminalized' | 'lost';
  mode?: string;
  gate?: string;
  startedAt?: string;
  lastHeartbeat?: string;
  terminalAt?: string;
};

/** Write a canonical sid-scoped lease file under a session tree. */
function writeLease(projectRoot: string, sessionId: string, fixture: LeaseFixture = {}): void {
  const callerId = fixture.callerId ?? 'caller-a';
  const workflowId = fixture.workflowId ?? 'wf-a';
  const dir = join(projectRoot, '.peaks', '_runtime', sessionId, 'leases');
  mkdirSync(dir, { recursive: true });
  const lease: Record<string, unknown> = {
    callerId,
    workflowId,
    graphRef: `graphs/${workflowId}.json`,
    skill: fixture.skill ?? 'peaks-code',
    depth: 0,
    startedAt: fixture.startedAt ?? NOW,
    lastHeartbeat: fixture.lastHeartbeat ?? NOW,
    status: fixture.status ?? 'running',
    schemaVersion: 1
  };
  if (fixture.mode !== undefined) lease.mode = fixture.mode;
  if (fixture.gate !== undefined) lease.gate = fixture.gate;
  if (fixture.terminalAt !== undefined) lease.terminalAt = fixture.terminalAt;
  writeFileSync(
    join(dir, `presence-${callerId}-${workflowId}.json`),
    JSON.stringify(lease, null, 2),
    'utf8'
  );
}

/** Point the project-global binding at a session tree. */
function seedBoundSession(projectRoot: string, sessionId: string): void {
  const dir = join(projectRoot, '.peaks', '_runtime');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'session.json'),
    JSON.stringify({ sessionId, createdAt: NOW, projectRoot }, null, 2),
    'utf8'
  );
}

function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

/* ---------- integration: real session trees on disk ---------- */
describe('Scenario: integration — cross-session presence over real session trees', () => {
  it('when the bound tree has no lease and another tree has a live one, should report the live skill', () => {
    // given: a bound session tree with no lease and another tree with a live lease
    // when: the skill presence is read
    // then: the live lease skill, session id and gate are reported
    seedBoundSession(ws.path, BOUND_SID);
    writeLease(ws.path, OTHER_SID, { skill: 'peaks-qa', gate: 'qa-validation' });
    const presence = getSkillPresence(ws.path);
    expect(presence?.skill).toBe('peaks-qa');
    expect(presence?.sessionId).toBe(OTHER_SID);
    expect(presence?.gate).toBe('qa-validation');
  });

  // No session.json, no caller binding: the bound tree is unresolvable.
  it('when the caller id cannot be resolved at all, should still see the lease of another tree', () => {
    // given: a project with no session binding and no resolvable caller id
    // when: the skill presence is read
    // then: the lease of another tree is still reported
    writeLease(ws.path, OTHER_SID, { skill: 'peaks-rd' });
    const presence = getSkillPresence(ws.path);
    expect(presence?.skill).toBe('peaks-rd');
  });

  it('when every lease on disk reached a terminal state, should report no presence', () => {
    // given: a bound tree and another tree, both holding only terminal leases
    // when: the skill presence is read
    // then: no presence is reported
    seedBoundSession(ws.path, BOUND_SID);
    writeLease(ws.path, BOUND_SID, { status: 'terminalized', terminalAt: NOW });
    writeLease(ws.path, OTHER_SID, { status: 'lost', terminalAt: NOW });
    expect(getSkillPresence(ws.path)).toBeNull();
  });

  it('when the only lease on disk has a cold heartbeat, should report no presence', () => {
    // given: a bound tree with no lease and another tree holding a cold-heartbeat lease
    // when: the skill presence is read
    // then: no presence is reported
    seedBoundSession(ws.path, BOUND_SID);
    writeLease(ws.path, OTHER_SID, { lastHeartbeat: isoAgo(TWO_HOURS_MS) });
    expect(getSkillPresence(ws.path)).toBeNull();
  });

  it('when a lease was written by an older release and carries no gate field, should still load it', () => {
    // given: a lease written by an older release that carries no gate field
    // when: the skill presence is read
    // then: the lease is still reported, without a gate
    seedBoundSession(ws.path, BOUND_SID);
    writeLease(ws.path, BOUND_SID, { skill: 'peaks-code' });
    const presence = getSkillPresence(ws.path);
    expect(presence?.skill).toBe('peaks-code');
    expect(presence?.gate).toBeUndefined();
  });

  it('when a gate is written to disk, should read it back through the presence projection', () => {
    // given: a lease written with a gate
    // when: the skill presence is read
    // then: the gate is projected onto the presence
    seedBoundSession(ws.path, BOUND_SID);
    writeLease(ws.path, BOUND_SID, { gate: 'swarm-converged' });
    expect(getSkillPresence(ws.path)?.gate).toBe('swarm-converged');
  });

  it('when nothing is active, should explain that every lease is stale', () => {
    // given: a bound tree with no lease and another tree holding only a stale lease
    // when: the presence is diagnosed
    // then: the diagnostic says every lease was stale and counts them
    seedBoundSession(ws.path, BOUND_SID);
    writeLease(ws.path, OTHER_SID, { lastHeartbeat: isoAgo(TWO_HOURS_MS) });
    const diagnostic = diagnosePresence(ws.path);
    expect(diagnostic.reason).toBe('all-stale');
    expect(diagnostic.leaseCount).toBe(1);
    expect(diagnostic.staleCount).toBe(1);
  });
});

/* ---------- render: the CLI envelope ---------- */
async function runPresence(
  projectRoot: string,
  extraArgs: readonly string[] = []
): Promise<{ stdout: string; stderr: string }> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  registerSkillCommand(program, io);
  await program.parseAsync(['skill', 'presence', '--project', projectRoot, ...extraArgs], {
    from: 'user'
  });
  return { stdout: captured.text(), stderr: captured.stderrText() };
}

describe('Scenario: render — the `peaks skill presence --json` envelope', () => {
  it('when no lease exists anywhere, should report exactly `active: false`', async () => {
    // given: a bound session tree with no lease anywhere in the project
    // when: the presence is read as JSON
    // then: the envelope reports active false and carries no other field
    seedBoundSession(ws.path, BOUND_SID);
    const { stdout } = await runPresence(ws.path, ['--json']);
    const envelope = JSON.parse(stdout) as { data: Record<string, unknown> };
    expect(envelope.data.active).toBe(false);
    // The empty case stays empty — no optimistic default, no extra fields.
    expect(Object.keys(envelope.data).sort()).toEqual(['active']);
  });

  it('when a lease is live in another tree, should report the skill and the gate', async () => {
    // given: a live lease in another tree carrying a skill, a gate and a mode
    // when: the presence is read as JSON
    // then: the envelope reports the lease as active with its skill, gate and mode
    seedBoundSession(ws.path, BOUND_SID);
    writeLease(ws.path, OTHER_SID, { skill: 'peaks-code', gate: 'startup', mode: 'full-auto' });
    const { stdout } = await runPresence(ws.path, ['--json']);
    const envelope = JSON.parse(stdout) as { data: Record<string, unknown> };
    expect(envelope.data.active).toBe(true);
    expect(envelope.data.skill).toBe('peaks-code');
    expect(envelope.data.gate).toBe('startup');
    expect(envelope.data.mode).toBe('full-auto');
  });

  it('when the read is inactive and `--check-stale` is asked for, should say why', async () => {
    // given: an inactive presence and a --check-stale request
    // when: the presence is read as JSON
    // then: the envelope says why nothing is active and counts the stale leases
    seedBoundSession(ws.path, BOUND_SID);
    writeLease(ws.path, OTHER_SID, { lastHeartbeat: isoAgo(TWO_HOURS_MS) });
    const { stdout } = await runPresence(ws.path, ['--json', '--check-stale']);
    const envelope = JSON.parse(stdout) as {
      data: { active: boolean; presenceInactive?: Record<string, unknown> };
    };
    expect(envelope.data.active).toBe(false);
    expect(envelope.data.presenceInactive?.reason).toBe('all-stale');
    expect(envelope.data.presenceInactive?.staleCount).toBe(1);
  });
});

/* ---------- a11y: the human-facing rejection ---------- */
describe('Scenario: a11y — a malformed gate is refused in plain language', () => {
  it('when `presence:set` is given a gate with a control character, should refuse and name the reason', async () => {
    // given: a gate value carrying a control character
    // when: presence:set is run with it
    // then: the command is refused with INVALID_GATE and exits 1
    const { io, captured } = makeCapturedIo();
    const program = new Command();
    registerSkillCommand(program, io);
    await program.parseAsync(
      [
        'skill',
        'presence:set',
        'peaks-code',
        '--project',
        ws.path,
        '--gate',
        'bad\u0001gate',
        '--json'
      ],
      { from: 'user' }
    );
    const envelope = JSON.parse(captured.text()) as {
      ok: boolean;
      code?: string;
      message?: string;
    };
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('INVALID_GATE');
    expect(envelope.message).toContain('Invalid gate');
    expect(process.exitCode).toBe(1);
  });
});
