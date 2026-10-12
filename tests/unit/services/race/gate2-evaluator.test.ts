/**
 * Behavioural tests for the gate-2 evaluator. Nothing here asserts that a symbol
 * exists or that a module exports a helper: every case asserts a COUNT, a VERDICT,
 * or the CONTENT of a reason (with its `observed`/`threshold` pair).
 *
 * The coverage value is DERIVED (PRD §3.2) — a row qualifies by reaching a
 * hard-blocked path family or by exercising the safety arm — and the safety-arm
 * count uses a different counting basis on purpose: every record, `escalated` and
 * `stopped` included.
 */
import { describe, expect, it } from 'vitest';

import {
  evaluatePilotGate,
  safetyArmExercised,
  taskExercisesCoreCapability,
  type PilotTaskRow
} from '../../../../src/services/race/gate2-evaluator.js';
import { RACE_GATE2_POLICY_V1 } from '../../../../src/services/race/gate2-policy.js';

const POLICY = RACE_GATE2_POLICY_V1;

type RowOverride = Partial<PilotTaskRow> & { rid: string };

function row(overrides: RowOverride): PilotTaskRow {
  return {
    sessionId: '2026-10-01-session-aaaaaa',
    date: '2026-10-01',
    laneChosenBy: 'user-named',
    outcome: 'landed',
    filesChanged: [],
    riskSurfacesHit: [],
    riskSurfaceHandling: 'none',
    rolledBack: false,
    ciRed: false,
    missedRiskSurface: false,
    ...overrides
  };
}

/** Ten landed rows: six in session A off the families, four in session B in `src/`. */
function passingRows(): PilotTaskRow[] {
  const rows: PilotTaskRow[] = [];
  for (let i = 1; i <= 6; i += 1) {
    rows.push(row({ rid: `rid-a${i}`, filesChanged: ['skills/x/SKILL.md'] }));
  }
  for (let i = 1; i <= 4; i += 1) {
    rows.push(
      row({
        rid: `rid-b${i}`,
        sessionId: '2026-10-02-session-bbbbbb',
        date: '2026-10-02',
        filesChanged: ['src/services/a.ts']
      })
    );
  }
  // One safety-arm row: the floor is >= 1, and a hit with a disposition fires it.
  rows.push(
    row({
      rid: 'rid-arm',
      sessionId: '2026-10-02-session-bbbbbb',
      date: '2026-10-02',
      filesChanged: ['skills/x/SKILL.md'],
      riskSurfacesHit: [1],
      riskSurfaceHandling: 'refused'
    })
  );
  return rows;
}

describe('Scenario: gate2-evaluator — counting', () => {
  it('when rows include escalated and stopped outcomes, should count only landed tasks', () => {
    // given: one landed row beside an escalated and a stopped one
    const tasks = [
      row({ rid: 'rid-o1', filesChanged: ['skills/x/SKILL.md'] }),
      row({
        rid: 'rid-o2',
        outcome: 'escalated',
        riskSurfacesHit: [7],
        riskSurfaceHandling: 'escalated'
      }),
      row({ rid: 'rid-o3', outcome: 'stopped' })
    ];
    // when:  the gate is evaluated
    const { counts } = evaluatePilotGate(tasks, POLICY);
    // then:  taskCount is the landed rows only — the other two are recorded, not counted
    expect(counts.taskCount).toBe(1);
    expect(counts.sessionCount).toBe(1);
  });

  it('when a landed row changes a file in a hard-blocked family, should raise the coverage count', () => {
    // given: a landed row whose only change is inside `src/`
    const tasks = [row({ rid: 'rid-core-a', filesChanged: ['src/cli/commands/x.ts'] })];
    // when:  the gate is evaluated
    const { counts } = evaluatePilotGate(tasks, POLICY);
    // then:  the derived coverage condition fires — no field said so
    expect(counts.coreCapabilityTaskCount).toBe(1);
  });

  it('when a landed row changes only prose and hits no risk surface, should not raise the coverage count', () => {
    // given: a landed row whose change is a skill document and whose risk surfaces are empty
    const tasks = [row({ rid: 'rid-core-b', filesChanged: ['skills/a/SKILL.md'] })];
    // when:  the gate is evaluated
    const { counts } = evaluatePilotGate(tasks, POLICY);
    // then:  nothing in either branch of the derivation is satisfied
    expect(counts.coreCapabilityTaskCount).toBe(0);
  });

  it('when a landed row hits a risk surface and records a disposition, should raise the coverage count', () => {
    // given: a landed row that hit a risk surface and refused it
    const tasks = [
      row({
        rid: 'rid-core-c',
        filesChanged: ['skills/a/SKILL.md'],
        riskSurfacesHit: [1],
        riskSurfaceHandling: 'refused'
      })
    ];
    // when:  the gate is evaluated
    const { counts } = evaluatePilotGate(tasks, POLICY);
    // then:  the safety branch of the derivation fires
    expect(counts.coreCapabilityTaskCount).toBe(1);
  });

  it('when a landed row hits a risk surface but records no disposition, should not raise the coverage count', () => {
    // given: a hit whose handling is `none` — a missing record, not a clean row
    const tasks = [
      row({
        rid: 'rid-core-d',
        filesChanged: ['skills/a/SKILL.md'],
        riskSurfacesHit: [1],
        riskSurfaceHandling: 'none'
      })
    ];
    // when:  the gate is evaluated
    const { counts } = evaluatePilotGate(tasks, POLICY);
    // then:  the `handling !== 'none'` conjunct is a real short circuit, not decoration
    expect(counts.coreCapabilityTaskCount).toBe(0);
    expect(safetyArmExercised(tasks[0] as PilotTaskRow)).toBe(false);
  });

  it('when every hard-blocked family is changed by its own row, should count each of the five', () => {
    // given: one landed row per family beyond `src/`
    const families = [
      'tests/unit/foo.test.ts',
      'tests/integration/foo.test.ts',
      'config/peaks.json',
      'bin/peaks.js',
      'scripts/release-pack.mjs'
    ];
    // when:  the gate is evaluated
    const { counts } = evaluatePilotGate(
      families.map((file, index) => row({ rid: `rid-fam-${index}`, filesChanged: [file] })),
      POLICY
    );
    // then:  the whole imported family list is in force, not just its first entry
    expect(counts.coreCapabilityTaskCount).toBe(5);
  });

  it('when a landed row changes only allow-listed paths, should not raise the coverage count', () => {
    // given: three landed rows outside every hard-blocked family
    const tasks = [
      row({ rid: 'rid-neg-1', filesChanged: ['.peaks/memory/x.md'] }),
      row({ rid: 'rid-neg-2', filesChanged: ['docs/x.md'] }),
      row({ rid: 'rid-neg-3', filesChanged: ['skills/a/SKILL.md'] })
    ];
    // when:  the gate is evaluated
    const { counts } = evaluatePilotGate(tasks, POLICY);
    // then:  none of them is core capability
    expect(counts.coreCapabilityTaskCount).toBe(0);
  });

  it('when a non-landed row changes a hard-blocked family, should not raise the coverage count', () => {
    // given: an escalated row in `src/` — the same row taskCount excludes
    const tasks = [row({ rid: 'rid-core-e', outcome: 'escalated', filesChanged: ['src/a.ts'] })];
    // when:  the gate is evaluated
    const { counts } = evaluatePilotGate(tasks, POLICY);
    // then:  coverage runs over landed rows only, so neither numerator nor denominator moves
    expect(counts.taskCount).toBe(0);
    expect(counts.coreCapabilityTaskCount).toBe(0);
  });
});

describe('Scenario: gate2-evaluator — the safety arm has its own counting basis', () => {
  it('when an escalated record exercised the safety arm, should count it there while taskCount ignores it', () => {
    // given: an escalated record that hit a risk surface and escalated on it
    const tasks = [
      row({
        rid: 'rid-arm-escalated',
        outcome: 'escalated',
        filesChanged: [],
        riskSurfacesHit: [7],
        riskSurfaceHandling: 'escalated'
      })
    ];
    // when:  the gate is evaluated
    const { counts } = evaluatePilotGate(tasks, POLICY);
    // then:  the arm count is 1 and the task count is 0 — different bases, by design
    expect(counts.safetyArmExercisedCount).toBe(1);
    expect(counts.taskCount).toBe(0);
  });

  it('when a record hit a risk surface with no disposition recorded, should not count the arm', () => {
    // given: a hit with handling `none`
    const tasks = [row({ rid: 'rid-arm-none', riskSurfacesHit: [1], riskSurfaceHandling: 'none' })];
    // when:  the gate is evaluated
    const { counts } = evaluatePilotGate(tasks, POLICY);
    // then:  a hit with no disposition is a missing record and credits nothing
    expect(counts.safetyArmExercisedCount).toBe(0);
  });
});

describe('Scenario: gate2-evaluator — verdicts and reasons', () => {
  it('when all four floors are met, should pass with no reason', () => {
    // given: ten landed rows across two sessions, coverage met, one safety-arm row
    const tasks = passingRows();
    // when:  the gate is evaluated
    const { verdict, reasons, counts } = evaluatePilotGate(tasks, POLICY);
    // then:  pass, and every floor is visibly satisfied
    expect(verdict).toBe('pass');
    expect(reasons).toEqual([]);
    expect(counts.taskCount).toBeGreaterThanOrEqual(10);
    expect(counts.coreCapabilityTaskCount).toBeGreaterThanOrEqual(3);
    expect(counts.sessionCount).toBe(2);
    expect(counts.safetyArmExercisedCount).toBeGreaterThanOrEqual(1);
  });

  it('when a floor is unmet, should return insufficient-evidence naming the quantity with observed and threshold', () => {
    // given: four landed rows in one session, none of them core capability
    const tasks = [1, 2, 3, 4].map((n) =>
      row({
        rid: `rid-q${n}`,
        sessionId: '2026-10-03-session-cccccc',
        date: '2026-10-03',
        filesChanged: ['skills/x/SKILL.md']
      })
    );
    // when:  the gate is evaluated
    const { verdict, reasons } = evaluatePilotGate(tasks, POLICY);
    // then:  insufficient-evidence is not a failure, and each reason carries numbers
    expect(verdict).toBe('insufficient-evidence');
    expect(reasons.map((reason) => [reason.observed, reason.threshold])).toEqual([
      [4, 10],
      [0, 3],
      [1, 2],
      [0, 1]
    ]);
    for (const reason of reasons) {
      expect(typeof reason.code).toBe('string');
      expect(reason.message).toContain('below the minimum');
    }
  });

  it('when a hard zero is above its max, should fail even though every floor is met', () => {
    // given: all four floors met, plus one rolled-back landed row
    const tasks = [
      ...passingRows(),
      row({
        rid: 'rid-rolled',
        sessionId: '2026-10-02-session-bbbbbb',
        date: '2026-10-02',
        filesChanged: ['skills/x/SKILL.md'],
        rolledBack: true
      })
    ];
    // when:  the gate is evaluated
    const { verdict, reasons, counts } = evaluatePilotGate(tasks, POLICY);
    // then:  fail wins over the floors, and the reason names the rollback
    expect(verdict).toBe('fail');
    expect(counts.rollbackCount).toBe(1);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]?.observed).toBe(1);
    expect(reasons[0]?.threshold).toBe(0);
    expect(reasons[0]?.message).toMatch(/rollback/i);
  });

  it('when the same rows are re-judged with the rollback cleared, should pass', () => {
    // given: the fail fixture with its one defect removed — the adversarial arm
    //        that proves the case above was measuring the hard zero and nothing else
    const tasks = [
      ...passingRows(),
      row({
        rid: 'rid-rolled',
        sessionId: '2026-10-02-session-bbbbbb',
        date: '2026-10-02',
        filesChanged: ['skills/x/SKILL.md'],
        rolledBack: false
      })
    ];
    // when:  the gate is evaluated
    const { verdict } = evaluatePilotGate(tasks, POLICY);
    // then:  pass
    expect(verdict).toBe('pass');
  });

  it('when a hard zero is raised by a non-landed record, should still fail', () => {
    // given: an escalated record that was rolled back
    const tasks = [row({ rid: 'rid-armed', outcome: 'escalated', rolledBack: true })];
    // when:  the gate is evaluated
    const { verdict, counts } = evaluatePilotGate(tasks, POLICY);
    // then:  a hard zero is a safety quantity, read over every record
    expect(counts.rollbackCount).toBe(1);
    expect(verdict).toBe('fail');
  });
});

describe('Scenario: gate2-evaluator — the derivation predicate', () => {
  it('when a row is asked whether it exercises the core capability, should answer from its own fields', () => {
    // given: one row per branch of the derivation
    const viaFamily = row({ rid: 'rid-p1', filesChanged: ['src/a.ts'] });
    const viaSafety = row({
      rid: 'rid-p2',
      filesChanged: ['skills/a/SKILL.md'],
      riskSurfacesHit: [2],
      riskSurfaceHandling: 'user-override-recorded'
    });
    const viaNeither = row({ rid: 'rid-p3', filesChanged: ['docs/a.md'] });
    // when:  the predicate is applied
    const answers = [viaFamily, viaSafety, viaNeither].map(taskExercisesCoreCapability);
    // then:  a disjunction of the two branches, and nothing else
    expect(answers).toEqual([true, true, false]);
  });
});
