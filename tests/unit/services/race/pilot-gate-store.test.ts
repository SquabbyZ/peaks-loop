/**
 * Tests for the gate-2 evidence store — the only I/O module of this slice.
 *
 * Two things are asserted that a structural claim could not make:
 *   - the coverage value CANNOT be self-reported: a row carrying an extra
 *     `coreCapability: true` produces the same counts as the same row without it;
 *   - the written `policy` block is a copy of the code constant, so the record
 *     cannot drift from the authority the verdict is computed from.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  evaluatePilotGate,
  type PilotTaskRow
} from '../../../../src/services/race/gate2-evaluator.js';
import { RACE_GATE2_POLICY_V1 } from '../../../../src/services/race/gate2-policy.js';
import {
  buildPilotTaskRow,
  pilotGatePath,
  readPilotGate,
  upsertPilotTask,
  type PilotTaskInput
} from '../../../../src/services/race/pilot-gate-store.js';

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-race-store-'));
  roots.push(root);
  mkdirSync(join(root, '.peaks', 'race'), { recursive: true });
  return root;
}

function input(overrides: Partial<PilotTaskInput> = {}): PilotTaskInput {
  return {
    rid: 'rid-example',
    sessionId: '2026-10-01-session-aaaaaa',
    date: '2026-10-01',
    laneChosenBy: 'user-named',
    outcome: 'landed',
    filesChanged: ['skills/x/SKILL.md'],
    riskSurfacesHit: [],
    riskSurfaceHandling: 'none',
    rolledBack: false,
    ciRed: false,
    missedRiskSurface: false,
    ...overrides
  };
}

function rowOf(overrides: Partial<PilotTaskInput> = {}): PilotTaskRow {
  const built = buildPilotTaskRow(input(overrides));
  if (built.kind !== 'ok') throw new Error(`fixture row rejected: ${built.message}`);
  return built.row;
}

function writeRawGate(root: string, body: unknown): void {
  writeFileSync(pilotGatePath(root), `${JSON.stringify(body, null, 2)}\n`, 'utf8');
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop() as string, { recursive: true, force: true });
  }
});

describe('Scenario: pilot-gate-store — the evidence file is read fail-closed', () => {
  it('when the evidence file is absent, should report missing rather than an empty verdict', () => {
    // given: a project root with no gate-2 evidence
    const root = makeRoot();
    // when:  the store reads it
    const read = readPilotGate(root);
    // then:  absence is its own outcome — never an empty row set that would judge as insufficient
    expect(read.kind).toBe('missing');
    expect(read.path).toBe(pilotGatePath(root));
  });

  it('when the evidence file is not valid JSON, should report invalid and carry the parse error', () => {
    // given: a truncated evidence file
    const root = makeRoot();
    writeFileSync(pilotGatePath(root), '{ "tasks": [', 'utf8');
    // when:  the store reads it
    const read = readPilotGate(root);
    // then:  unreadable evidence is not a verdict
    expect(read.kind).toBe('invalid');
  });

  it('when a row is malformed, should report invalid and name the offending field', () => {
    // given: a row whose outcome is not one of the three legal values
    const root = makeRoot();
    writeRawGate(root, {
      policyVersion: 'race-gate2-policy-v1',
      tasks: [{ ...rowOf(), outcome: 'maybe' }]
    });
    // when:  the store reads it
    const read = readPilotGate(root);
    // then:  the refusal names the path into the offending field
    expect(read.kind).toBe('invalid');
    expect(read.kind === 'invalid' ? read.message : '').toContain('outcome');
  });
});

describe('Scenario: pilot-gate-store — coverage cannot be self-reported', () => {
  it('when a row carries an author-written coreCapability flag, should ignore it and derive the count', () => {
    // given: the same row twice — once clean, once with `coreCapability: true` added
    const root = makeRoot();
    const clean = rowOf({ rid: 'rid-self-report' });
    writeRawGate(root, { policyVersion: 'race-gate2-policy-v1', tasks: [clean] });
    const withoutFlag = readPilotGate(root);
    writeRawGate(root, {
      policyVersion: 'race-gate2-policy-v1',
      tasks: [{ ...clean, coreCapability: true }]
    });
    const withFlag = readPilotGate(root);
    // when:  both are evaluated
    if (withoutFlag.kind !== 'ok' || withFlag.kind !== 'ok')
      throw new Error('fixture did not read');
    const before = evaluatePilotGate(withoutFlag.gate.tasks, RACE_GATE2_POLICY_V1).counts;
    const after = evaluatePilotGate(withFlag.gate.tasks, RACE_GATE2_POLICY_V1).counts;
    // then:  writing the flag buys nothing — `skills/` reaches no family and no arm
    expect(before.coreCapabilityTaskCount).toBe(0);
    expect(after).toEqual(before);
  });
});

describe('Scenario: pilot-gate-store — the writer owns the evidence file', () => {
  it('when the same rid is recorded twice, should replace that row in place', () => {
    // given: one recorded row, then a second recording of the same rid
    const root = makeRoot();
    upsertPilotTask(root, rowOf({ rid: 'rid-again', filesChanged: ['skills/x/SKILL.md'] }));
    upsertPilotTask(root, rowOf({ rid: 'rid-again', filesChanged: ['src/services/a.ts'] }));
    // when:  the file is read back
    const read = readPilotGate(root);
    // then:  one row, carrying the later value — the upsert is idempotent by rid
    expect(read.kind).toBe('ok');
    const tasks = read.kind === 'ok' ? read.gate.tasks : [];
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.filesChanged).toEqual(['src/services/a.ts']);
  });

  it('when a new rid is recorded, should append it after the rows already there', () => {
    // given: two records with different rids
    const root = makeRoot();
    upsertPilotTask(root, rowOf({ rid: 'rid-first' }));
    upsertPilotTask(root, rowOf({ rid: 'rid-second' }));
    // when:  the file is read back
    const read = readPilotGate(root);
    // then:  first-seen order is preserved, so the committed diff stays one row
    expect(read.kind).toBe('ok');
    expect(read.kind === 'ok' ? read.gate.tasks.map((task) => task.rid) : []).toEqual([
      'rid-first',
      'rid-second'
    ]);
  });

  it('when a row is recorded, should write the policy constant and a reproducible lastEvaluation', () => {
    // given: one recorded row
    const root = makeRoot();
    upsertPilotTask(root, rowOf({ rid: 'rid-recorded', filesChanged: ['src/services/a.ts'] }));
    // when:  the raw artifact is read and the evaluator is re-run over the rows it holds
    const raw = JSON.parse(readFileSync(pilotGatePath(root), 'utf8')) as {
      policy: unknown;
      tasks: readonly PilotTaskRow[];
      lastEvaluation: { verdict: string; counts: unknown };
    };
    const recomputed = evaluatePilotGate(raw.tasks, RACE_GATE2_POLICY_V1);
    // then:  the recorded policy is the code constant, and the recorded verdict is
    //        what the committed rows actually produce
    expect(raw.policy).toEqual(RACE_GATE2_POLICY_V1);
    expect(raw.lastEvaluation.verdict).toBe(recomputed.verdict);
    expect(raw.lastEvaluation.counts).toEqual(recomputed.counts);
  });

  it('when the existing evidence file is unreadable, should refuse instead of overwriting its rows', () => {
    // given: a corrupt evidence file
    const root = makeRoot();
    writeFileSync(pilotGatePath(root), 'not json at all', 'utf8');
    // when:  a row is recorded
    const attempt = (): unknown => upsertPilotTask(root, rowOf({ rid: 'rid-guarded' }));
    // then:  it throws, and the corrupt bytes are left exactly as they were
    expect(attempt).toThrow(/PILOT_GATE_EVIDENCE_INVALID/);
    expect(readFileSync(pilotGatePath(root), 'utf8')).toBe('not json at all');
  });
});

describe('Scenario: pilot-gate-store — the writer refuses what it cannot record', () => {
  it('when a rid does not carry the rid- prefix, should refuse it', () => {
    // given: a bare word where a task id belongs
    const built = buildPilotTaskRow(input({ rid: 'not-a-rid' }));
    // when:  the row is built
    const message = built.kind === 'invalid' ? built.message : '';
    // then:  refused, and the message names the flag
    expect(built.kind).toBe('invalid');
    expect(message).toContain('--rid');
  });

  it('when a session id climbs out of its directory, should refuse it before writing', () => {
    // given: a traversal-shaped session id
    const built = buildPilotTaskRow(input({ sessionId: '../../PWNED' }));
    // when:  the row is built
    const message = built.kind === 'invalid' ? built.message : '';
    // then:  refused, and the message names the flag
    expect(built.kind).toBe('invalid');
    expect(message).toContain('--session-id');
  });

  it('when a changed file is absolute or climbs out, should refuse it', () => {
    // given: an absolute path and a traversal path
    const absolute = buildPilotTaskRow(input({ filesChanged: ['C:\\src\\a.ts'] }));
    const climbing = buildPilotTaskRow(input({ filesChanged: ['../outside.ts'] }));
    // when:  both rows are built
    const refused = absolute.kind === 'invalid' && climbing.kind === 'invalid';
    // then:  neither reaches the evidence file
    expect(refused).toBe(true);
    expect(absolute.kind === 'invalid' ? absolute.message : '').toContain('--file');
    expect(climbing.kind === 'invalid' ? climbing.message : '').toContain('--file');
  });

  it('when a changed file uses backslashes, should normalize it to a repository-relative path', () => {
    // given: a Windows-style relative path under a hard-blocked family
    const built = buildPilotTaskRow(input({ filesChanged: ['src\\services\\a.ts'] }));
    // when:  the row is built
    // then:  it is stored normalized, and the family match still fires
    expect(built.kind).toBe('ok');
    expect(built.kind === 'ok' ? built.row.filesChanged : []).toEqual(['src/services/a.ts']);
  });

  it('when a risk surface number is outside 1..7, should refuse it', () => {
    // given: a surface index that names no row of the risk table
    const built = buildPilotTaskRow(
      input({ riskSurfacesHit: [9], riskSurfaceHandling: 'refused' })
    );
    // when:  the row is built
    const message = built.kind === 'invalid' ? built.message : '';
    // then:  refused with the legal range named
    expect(built.kind).toBe('invalid');
    expect(message).toContain('--risk-surface');
  });

  it('when a risk surface is hit but the handling is none, should refuse the row', () => {
    // given: a hit with no disposition — the shape that reads as a missing record
    const built = buildPilotTaskRow(input({ riskSurfacesHit: [1], riskSurfaceHandling: 'none' }));
    // when:  the row is built
    const message = built.kind === 'invalid' ? built.message : '';
    // then:  refused, rather than silently crediting nothing and saying nothing
    expect(built.kind).toBe('invalid');
    expect(message).toContain('--risk-surface-handling');
  });

  it('when a row is well formed, should accept it and keep the fields it was given', () => {
    // given: a complete row
    const built = buildPilotTaskRow(
      input({
        rid: 'rid-good',
        outcome: 'escalated',
        riskSurfacesHit: [7],
        riskSurfaceHandling: 'escalated'
      })
    );
    // when:  it is built
    // then:  accepted with the escalation recorded as given
    expect(built.kind).toBe('ok');
    expect(built.kind === 'ok' ? built.row.outcome : '').toBe('escalated');
    expect(built.kind === 'ok' ? built.row.riskSurfaceHandling : '').toBe('escalated');
  });
});
