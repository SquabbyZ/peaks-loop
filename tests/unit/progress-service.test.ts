import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { readSubAgentProgress, writeSubAgentProgress, subAgentProgressPath } from '../../src/services/progress/progress-service.js';

function makeTempProject(): string {
  // realpath so the session.json that ensureSession writes (which
  // goes through canonicalisation) matches the path the test
  // hands to the progress service. Same trap as
  // config-safety-canonical-root.test.ts.
  return realpathSync(mkdtempSync(join(tmpdir(), 'peaks-progress-')));
}

function seedSessionBinding(projectRoot: string, sessionId: string): void {
  mkdirSync(join(projectRoot, '.peaks', sessionId), { recursive: true });
  writeFileSync(
    join(projectRoot, '.peaks', '.session.json'),
    JSON.stringify({ sessionId, createdAt: '2026-06-03T00:00:00.000Z', projectRoot }),
    'utf8'
  );
}

describe('progress service', () => {
  let projectRoot: string;
  beforeEach(() => {
    projectRoot = makeTempProject();
    seedSessionBinding(projectRoot, '2026-06-03-session-progress01');
  });
  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  test('read returns no-binding when .peaks/.session.json is missing', () => {
    const empty = realpathSync(mkdtempSync(join(tmpdir(), 'peaks-progress-empty-')));
    try {
      const result = readSubAgentProgress({ projectRoot: empty });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('no-binding');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  test('read returns no-progress-file when session is bound but file is absent', () => {
    const result = readSubAgentProgress({ projectRoot });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no-progress-file');
  });

  test('write creates a fresh progress doc with the right shape', () => {
    const data = writeSubAgentProgress({
      projectRoot,
      requestId: '001-rid-progress',
      role: 'rd',
      step: 'starting up',
      phase: 'starting'
    });

    expect(data.version).toBe(1);
    expect(data.sessionId).toBe('2026-06-03-session-progress01');
    expect(data.role).toBe('rd');
    expect(data.requestId).toBe('001-rid-progress');
    expect(data.current.step).toBe('starting up');
    expect(data.current.phase).toBe('starting');
    expect(data.history).toEqual([]);

    const onDisk = join(projectRoot, '.peaks', 'system', 'subagent-progress.json');
    expect(existsSync(onDisk)).toBe(true);
  });

  test('write on the same (step, phase) heartbeats without growing history', async () => {
    writeSubAgentProgress({ projectRoot, requestId: '001', role: 'rd', step: 'starting up', phase: 'starting' });
    // Same step/phase = heartbeat, not transition.
    const data = writeSubAgentProgress({ projectRoot, requestId: '001', role: 'rd', step: 'starting up', phase: 'starting' });

    expect(data.history).toEqual([]);
    expect(data.current.step).toBe('starting up');
    expect(data.current.phase).toBe('starting');
  });

  test('write on a different step appends the prior current to history', () => {
    writeSubAgentProgress({ projectRoot, requestId: '001', role: 'rd', step: 'starting up', phase: 'starting' });
    const data = writeSubAgentProgress({ projectRoot, requestId: '001', role: 'rd', step: 'running tests', phase: 'running' });

    expect(data.history).toHaveLength(1);
    expect(data.history[0]?.step).toBe('starting up');
    expect(data.history[0]?.phase).toBe('starting');
    expect(data.current.step).toBe('running tests');
    expect(data.current.phase).toBe('running');
  });

  test('verdict and counts are recorded on the current step', () => {
    const data = writeSubAgentProgress({
      projectRoot,
      requestId: '001',
      role: 'qa',
      step: 'verifying',
      phase: 'verifying',
      verdict: 'pass',
      counts: { testsRun: 42, filesTouched: 3 }
    });
    expect(data.current.verdict).toBe('pass');
    expect(data.current.counts).toEqual({ testsRun: 42, filesTouched: 3 });
  });

  test('read after write returns the same data', () => {
    writeSubAgentProgress({ projectRoot, requestId: '001', role: 'rd', step: 'done', phase: 'finished', verdict: 'pass' });
    const result = readSubAgentProgress({ projectRoot });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.current.step).toBe('done');
      expect(result.data.current.phase).toBe('finished');
      expect(result.data.current.verdict).toBe('pass');
      expect(result.path).toBe(subAgentProgressPath(projectRoot));
    }
  });

  test('read returns invalid-json when the file is corrupt', () => {
    mkdirSync(join(projectRoot, '.peaks', 'system'), { recursive: true });
    writeFileSync(join(projectRoot, '.peaks', 'system', 'subagent-progress.json'), '{not-valid-json', 'utf8');
    const result = readSubAgentProgress({ projectRoot });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid-json');
  });
});
