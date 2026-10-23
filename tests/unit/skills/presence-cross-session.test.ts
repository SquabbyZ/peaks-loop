// tests/unit/skills/presence-cross-session.test.ts
//
// Slice 2026-10-24 — rid-t2-presence-cross-session.
//
// Three defects this file holds down. (1) `peaks skill presence --json` read
// ONE session tree (the bound one) and answered `{"active": false}` even when
// a live lease sat in another tree of the same project — 16 trees held
// `preparing` leases while the bound tree held none. (2) The `gate` never
// reached the disk: `SetPresenceLeaseInput.gate` existed, the lease
// constructor never expanded it, and the read side had nothing to project —
// so `Peaks-Loop Gate: <gate>` was model-invented prose. (3) A lease that
// reached a terminal state, or whose heartbeat went cold, still counted as
// "active" — the amplifier that keeps a finished session's lease on the books.
//
// Dimensions: behavior (the selection rules + the gate contract, pure),
// integration (real session trees on disk), render (the `--json` envelope),
// a11y (the human-facing rejection of a malformed gate).
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
import {
  explainInactivePresence,
  selectActivePresenceLease,
  staleThresholdMs,
  type PresenceLeaseCandidate
} from '../../../src/services/skills/presence-lease-selection.js';
import {
  STALE_HEARTBEAT_MS,
  STALE_STARTED_AFTER_MS
} from '../../../src/services/skills/presence-lease-types.js';
import {
  KNOWN_PRESENCE_GATES,
  MAX_PRESENCE_GATE_LENGTH,
  normalizePresenceGate,
  readPresenceGate
} from '../../../src/services/skills/presence-gate.js';
import { registerSkillCommand } from '../../../src/cli/commands/core/skill-command.js';

declareDimensions('tests/unit/skills/presence-cross-session.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

const BOUND_SID = '2026-10-24-session-0000aa';
const OTHER_SID = '2026-10-23-session-0000bb';

const NOW = new Date().toISOString();
const ONE_HOUR_MS = 60 * 60 * 1000;
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

/** A candidate set for the pure selection functions. */
function candidate(
  lease: Partial<PresenceLeaseCandidate['lease']> & { lastHeartbeat?: string },
  scope: 'bound' | 'other',
  sessionId = scope === 'bound' ? BOUND_SID : OTHER_SID
): PresenceLeaseCandidate {
  return {
    lease: {
      callerId: 'caller-a',
      workflowId: 'wf-a',
      graphRef: 'graphs/wf-a.json',
      skill: 'peaks-code',
      depth: 0,
      startedAt: NOW,
      lastHeartbeat: NOW,
      status: 'running',
      schemaVersion: 1,
      ...lease
    },
    sessionId,
    scope
  };
}

/* ---------- behavior: the selection rules ---------- */
describe('Scenario: behavior — presence lease selection rules', () => {
  it('when the bound tree holds no lease but another tree does, should report the other tree’s lease', () => {
    // given: a candidate set holding one live lease in another session tree
    // when: the active lease is selected
    // then: the other tree lease is selected and marked as out of the bound tree
    const selection = selectActivePresenceLease(
      [candidate({ lastHeartbeat: NOW }, 'other')],
      Date.now()
    );
    expect(selection?.sessionId).toBe(OTHER_SID);
    expect(selection?.scope).toBe('other');
  });

  it('when the bound tree holds a lease, should keep the bound tree’s precedence over a fresher foreign lease', () => {
    // given: a candidate set holding a bound lease and a fresher foreign lease
    // when: the active lease is selected
    // then: the bound tree keeps precedence
    const selection = selectActivePresenceLease(
      [
        candidate({ lastHeartbeat: isoAgo(10 * 60 * 1000) }, 'bound'),
        candidate({ lastHeartbeat: NOW }, 'other')
      ],
      Date.now()
    );
    expect(selection?.scope).toBe('bound');
    expect(selection?.sessionId).toBe(BOUND_SID);
  });

  it('when every lease reached a terminal state, should select nothing', () => {
    // given: a candidate set holding only terminalized and lost leases
    // when: the active lease is selected
    // then: nothing is selected
    const selection = selectActivePresenceLease(
      [
        candidate({ status: 'terminalized', terminalAt: NOW }, 'bound'),
        candidate({ status: 'lost', terminalAt: NOW }, 'other')
      ],
      Date.now()
    );
    expect(selection).toBeNull();
  });

  it('when the heartbeat is older than the stale window, should not report the lease as active', () => {
    // given: a candidate set holding a lease whose heartbeat is older than the stale window
    // when: the active lease is selected
    // then: nothing is selected
    const selection = selectActivePresenceLease(
      [candidate({ lastHeartbeat: isoAgo(STALE_HEARTBEAT_MS + ONE_HOUR_MS) }, 'other')],
      Date.now()
    );
    expect(selection).toBeNull();
  });

  // The 24h run must not lose its presence after one hour just because
  // nothing refreshes the lease heartbeat while the run is in flight.
  it('when a 24h lease is past the 1h window but inside its own window, should keep it active', () => {
    // given: a 24h lease whose heartbeat is older than the 1h window
    // when: the active lease is selected
    // then: the 24h lease keeps its presence
    const age = STALE_HEARTBEAT_MS + ONE_HOUR_MS;
    expect(age).toBeLessThan(STALE_STARTED_AFTER_MS);
    const selection = selectActivePresenceLease(
      [candidate({ mode: '24h', lastHeartbeat: isoAgo(age) }, 'other')],
      Date.now()
    );
    expect(selection?.lease.mode).toBe('24h');
  });

  it('when the window is asked for, should give 24h30m to a 24h lease and 1h to every other', () => {
    // given: a 24h lease and a lease with no mode
    // when: the stale threshold is asked for
    // then: the 24h lease gets the 24h30m window and every other lease the 1h window
    expect(staleThresholdMs(candidate({ mode: '24h' }, 'other').lease)).toBe(
      STALE_STARTED_AFTER_MS
    );
    expect(staleThresholdMs(candidate({}, 'other').lease)).toBe(STALE_HEARTBEAT_MS);
    expect(STALE_HEARTBEAT_MS).toBe(60 * 60 * 1000);
    expect(STALE_STARTED_AFTER_MS).toBe(24 * 60 * 60 * 1000 + 30 * 60 * 1000);
  });

  it('when nothing is eligible, should explain why the read found nothing', () => {
    // given: a candidate set holding one terminalized lease and one stale lease
    // when: the inactive presence is explained
    // then: the reason names terminal and stale leases and counts each of them
    const diagnostic = explainInactivePresence(
      [
        candidate({ status: 'terminalized', terminalAt: NOW }, 'bound'),
        candidate({ lastHeartbeat: isoAgo(TWO_HOURS_MS) }, 'other')
      ],
      Date.now()
    );
    expect(diagnostic.reason).toBe('terminal-and-stale');
    expect(diagnostic.leaseCount).toBe(2);
    expect(diagnostic.terminalCount).toBe(1);
    expect(diagnostic.staleCount).toBe(1);
    expect(diagnostic.eligibleCount).toBe(0);
  });

  it('when there is no lease at all, should report the empty reason', () => {
    // given: an empty candidate set
    // when: the inactive presence is explained
    // then: the reason is that there were no leases at all
    expect(explainInactivePresence([], Date.now()).reason).toBe('no-leases');
  });
});

/* ---------- behavior: the gate contract ---------- */
describe('Scenario: behavior — the gate contract', () => {
  it('when a gate value is well formed, should accept it verbatim (trimmed)', () => {
    // given: a well-formed gate value
    // when: the gate is normalised
    // then: the gate is accepted verbatim, trimmed
    expect(normalizePresenceGate('startup')).toBe('startup');
    expect(normalizePresenceGate('  swarm-fan-out  ')).toBe('swarm-fan-out');
  });

  it('when a gate value is absent or empty, should drop it rather than persist an empty string', () => {
    // given: an absent, null or blank gate value
    // when: the gate is normalised
    // then: no gate value is produced
    expect(normalizePresenceGate(undefined)).toBeUndefined();
    expect(normalizePresenceGate(null)).toBeUndefined();
    expect(normalizePresenceGate('   ')).toBeUndefined();
  });

  it('when a gate value is unknown, should accept it — the vocabulary is open', () => {
    // given: a gate value this repository has never seen
    // when: the gate is normalised
    // then: the unknown gate is accepted, because the vocabulary is open
    expect(normalizePresenceGate('a-gate-nobody-predicted')).toBe('a-gate-nobody-predicted');
  });

  it('when a gate value carries a control character or is too long, should reject it', () => {
    // given: a gate value carrying a control character or longer than the maximum
    // when: the gate is normalised
    // then: the gate value is rejected
    expect(() => normalizePresenceGate('bad\u0001gate')).toThrow();
    expect(() => normalizePresenceGate('x'.repeat(MAX_PRESENCE_GATE_LENGTH + 1))).toThrow();
  });

  it('when every gate value this repository uses is checked, should accept all of them', () => {
    // given: every gate value this repository uses
    // when: each one is normalised
    // then: every gate is accepted unchanged
    for (const gate of KNOWN_PRESENCE_GATES) {
      expect(normalizePresenceGate(gate)).toBe(gate);
    }
  });

  it('when a stored gate is read back, should tolerate a missing or non-string value', () => {
    // given: a stored gate that is missing, not a string or empty
    // when: the stored gate is read back
    // then: no gate value is produced for the bad entries
    expect(readPresenceGate('startup')).toBe('startup');
    expect(readPresenceGate(undefined)).toBeUndefined();
    expect(readPresenceGate(42)).toBeUndefined();
    expect(readPresenceGate('')).toBeUndefined();
  });
});

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
