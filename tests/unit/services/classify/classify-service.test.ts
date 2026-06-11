import { describe, it, expect } from 'vitest';
import { classifyTask } from '../../../../src/services/classify/classify-service.js';
import { TASK_LEVEL_GATE_SETS } from '../../../../src/services/classify/classify-types.js';

const FIXED_CLOCK = () => '2026-06-11T10:00:00.000Z';

describe('classify-service.classifyTask', () => {
  it('classifies a 1-file / 1-line diff as typo (default)', () => {
    const result = classifyTask({
      signals: {
        filesChanged: 1,
        linesChanged: 1,
        touchesDependencies: false,
        touchesMigrationScripts: false,
        isPureRefactor: true,
        keywords: [],
      },
      conservatism: 'default',
      clock: FIXED_CLOCK,
    });
    expect(result.level).toBe('typo');
    expect(result.gateSet.stages).toEqual(TASK_LEVEL_GATE_SETS.typo.stages);
  });

  it('classifies a 5-file / 50-line diff as bug (mid-low default)', () => {
    const result = classifyTask({
      signals: {
        filesChanged: 5,
        linesChanged: 50,
        touchesDependencies: false,
        touchesMigrationScripts: false,
        isPureRefactor: true,
        keywords: [],
      },
      conservatism: 'default',
      clock: FIXED_CLOCK,
    });
    expect(result.level).toBe('bug');
  });

  it('classifies a 12-file / 200-line diff as feature', () => {
    const result = classifyTask({
      signals: {
        filesChanged: 12,
        linesChanged: 200,
        touchesDependencies: false,
        touchesMigrationScripts: false,
        isPureRefactor: false,
        keywords: [],
      },
      conservatism: 'default',
      clock: FIXED_CLOCK,
    });
    expect(result.level).toBe('feature');
  });

  it('classifies a touch of dependencies as migration', () => {
    const result = classifyTask({
      signals: {
        filesChanged: 2,
        linesChanged: 30,
        touchesDependencies: true,
        touchesMigrationScripts: false,
        isPureRefactor: false,
        keywords: [],
      },
      conservatism: 'default',
      clock: FIXED_CLOCK,
    });
    expect(result.level).toBe('migration');
  });

  it('classifies a pure refactor > 50 lines as refactor', () => {
    const result = classifyTask({
      signals: {
        filesChanged: 4,
        linesChanged: 80,
        touchesDependencies: false,
        touchesMigrationScripts: false,
        isPureRefactor: true,
        keywords: ['refactor'],
      },
      conservatism: 'default',
      clock: FIXED_CLOCK,
    });
    expect(result.level).toBe('refactor');
  });

  it('applies strict conservatism to promote by one level', () => {
    const result = classifyTask({
      signals: {
        filesChanged: 1,
        linesChanged: 1,
        touchesDependencies: false,
        touchesMigrationScripts: false,
        isPureRefactor: true,
        keywords: [],
      },
      conservatism: 'strict',
      clock: FIXED_CLOCK,
    });
    expect(result.level).toBe('bug'); // typo → bug
  });

  it('applies lax conservatism to demote by one level', () => {
    const result = classifyTask({
      signals: {
        filesChanged: 12,
        linesChanged: 200,
        touchesDependencies: false,
        touchesMigrationScripts: false,
        isPureRefactor: false,
        keywords: [],
      },
      conservatism: 'lax',
      clock: FIXED_CLOCK,
    });
    // feature → bug (demote by one)
    expect(result.level).toBe('bug');
  });

  it('override forces the level and writes to audit', () => {
    const result = classifyTask({
      signals: {
        filesChanged: 1,
        linesChanged: 1,
        touchesDependencies: false,
        touchesMigrationScripts: false,
        isPureRefactor: true,
        keywords: [],
      },
      conservatism: 'default',
      override: { level: 'feature', reason: 'user forced feature for a small fix' },
      clock: FIXED_CLOCK,
    });
    expect(result.level).toBe('feature');
    expect(result.audit.overrideApplied).toBe(true);
    expect(result.audit.reason).toBe('user forced feature for a small fix');
  });

  it('clamps strict to the topmost level (cannot promote past migration)', () => {
    const result = classifyTask({
      signals: {
        filesChanged: 1,
        linesChanged: 1,
        touchesDependencies: false,
        touchesMigrationScripts: false,
        isPureRefactor: true,
        keywords: [],
      },
      conservatism: 'strict',
      override: { level: 'migration', reason: 'ceiling' },
      clock: FIXED_CLOCK,
    });
    expect(result.level).toBe('migration');
  });
});
