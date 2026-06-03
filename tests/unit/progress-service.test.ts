import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  clearSpawnRecord,
  phaseAutoClosesSpawn,
  readSpawnRecord,
  readSubAgentProgress,
  subAgentProgressPath,
  subAgentSpawnPath,
  writeSpawnRecord,
  writeSubAgentProgress
} from '../../src/services/progress/progress-service.js';

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

    // The file lives under the session sub-directory, not directly
    // under .peaks/. Without the session prefix a session rotation
    // would orphan the file in the project root.
    const onDisk = join(projectRoot, '.peaks', '2026-06-03-session-progress01', 'system', 'subagent-progress.json');
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
      // The file lives under the session sub-directory.
      expect(result.path).toBe(
        join(projectRoot, '.peaks', '2026-06-03-session-progress01', 'system', 'subagent-progress.json')
      );
    }
  });

  test('read returns invalid-json when the file is corrupt', () => {
    // The progress file lives under the session sub-directory.
    mkdirSync(join(projectRoot, '.peaks', '2026-06-03-session-progress01', 'system'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.peaks', '2026-06-03-session-progress01', 'system', 'subagent-progress.json'),
      '{not-valid-json',
      'utf8'
    );
    const result = readSubAgentProgress({ projectRoot });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid-json');
  });
});

describe('progress service — spawn record + auto-close helpers', () => {
  let projectRoot: string;
  beforeEach(() => {
    projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'peaks-progress-spawn-')));
    seedSessionBinding(projectRoot, '2026-06-03-session-progress01');
  });
  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  test('subAgentProgressPath is session-prefixed (matches the file the writer creates)', () => {
    // The exported path MUST agree with the path the read/write
    // helpers resolve to. Without this, the watch banner would
    // point at a file the writer never touches, and the user
    // would `cat` an empty file.
    expect(subAgentProgressPath(projectRoot)).toBe(
      join(projectRoot, '.peaks', '2026-06-03-session-progress01', 'system', 'subagent-progress.json')
    );
    expect(subAgentSpawnPath(projectRoot)).toBe(
      join(projectRoot, '.peaks', '2026-06-03-session-progress01', 'system', 'progress-spawn.json')
    );
  });

  test('writeSpawnRecord + readSpawnRecord round-trip the launcher metadata', () => {
    const written = writeSpawnRecord({
      projectRoot,
      pid: 12345,
      platform: 'darwin',
      command: 'osascript',
      args: ['-e', 'tell application "Terminal" to do script "..."'],
      reason: 'rd-slice started',
      windowTitle: 'peaks-cli: sub-agent progress — rd-slice started'
    });
    expect(written).not.toBeNull();
    expect(written?.version).toBe(1);
    expect(written?.sessionId).toBe('2026-06-03-session-progress01');
    expect(written?.pid).toBe(12345);
    expect(written?.windowTitle).toBe('peaks-cli: sub-agent progress — rd-slice started');

    const result = readSpawnRecord(projectRoot);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(written);
      expect(result.path).toBe(subAgentSpawnPath(projectRoot));
    }
    expect(existsSync(subAgentSpawnPath(projectRoot))).toBe(true);
  });

  test('writeSpawnRecord with no session binding returns null (no on-disk file written)', () => {
    const unbound = realpathSync(mkdtempSync(join(tmpdir(), 'peaks-progress-unbound-')));
    try {
      const written = writeSpawnRecord({
        projectRoot: unbound,
        pid: 1,
        platform: 'linux',
        command: 'xterm',
        args: [],
        windowTitle: 'peaks-cli'
      });
      expect(written).toBeNull();
      // No session binding → no spawn record. The CLI layers
      // surface this as a soft warning (see progress start).
      expect(existsSync(join(unbound, '.peaks', 'unbound', 'system', 'progress-spawn.json'))).toBe(false);
    } finally {
      rmSync(unbound, { recursive: true, force: true });
    }
  });

  test('readSpawnRecord returns no-spawn-record when the file is absent', () => {
    const result = readSpawnRecord(projectRoot);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no-spawn-record');
  });

  test('readSpawnRecord returns invalid-json when the file is corrupt', () => {
    mkdirSync(join(projectRoot, '.peaks', '2026-06-03-session-progress01', 'system'), { recursive: true });
    writeFileSync(subAgentSpawnPath(projectRoot), '{not-valid-json', 'utf8');
    const result = readSpawnRecord(projectRoot);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid-json');
  });

  test('clearSpawnRecord removes the file and is idempotent', () => {
    writeSpawnRecord({
      projectRoot,
      pid: 1,
      platform: 'darwin',
      command: 'osascript',
      args: [],
      windowTitle: 'peaks-cli'
    });
    expect(existsSync(subAgentSpawnPath(projectRoot))).toBe(true);
    expect(clearSpawnRecord(projectRoot)).toBe(true);
    expect(existsSync(subAgentSpawnPath(projectRoot))).toBe(false);
    // Second clear is a no-op and returns false (nothing to
    // clear). This matters because the watch-side auto-close
    // calls clearSpawnRecord on every terminal-phase tick, and
    // a second tick should be silent.
    expect(clearSpawnRecord(projectRoot)).toBe(false);
  });

  test('phaseAutoClosesSpawn: finished and failed close, in-flight phases do NOT', () => {
    // The rule is the user-facing contract for "the watch
    // window closes itself". Only terminal phases close the
    // window; in-flight phases (starting / running /
    // verifying / completing / idle) keep it open.
    expect(phaseAutoClosesSpawn('finished')).toBe(true);
    expect(phaseAutoClosesSpawn('failed')).toBe(true);
    expect(phaseAutoClosesSpawn('starting')).toBe(false);
    expect(phaseAutoClosesSpawn('running')).toBe(false);
    expect(phaseAutoClosesSpawn('verifying')).toBe(false);
    expect(phaseAutoClosesSpawn('completing')).toBe(false);
    expect(phaseAutoClosesSpawn('idle')).toBe(false);
  });
});
