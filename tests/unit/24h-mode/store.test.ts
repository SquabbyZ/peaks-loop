/**
 * rid-020a — 24h mode persistence: round-trip + atomic write + coercion guards.
 *
 * AC-A2: store.ts persists + restores state + attempts map atomically.
 * Verifies the snapshot round-trips through write24hState → read24hState,
 * that the temp-file + rename pattern never leaves a partial file, and
 * that malformed JSON is rejected with a 24H_STATE_INVALID code.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  emptySnapshot,
  read24hState,
  write24hState
} from '../../../src/services/24h-mode/store.js';
import {
  emptyAttempts,
  type State24hSnapshot
} from '../../../src/services/24h-mode/state.js';

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-loop-24h-store-'));
}

describe('rid-020a: 24h-mode/store', () => {
  let projectRoot: string;
  const sid = '2026-07-28-session-6984fe';

  beforeEach(() => {
    projectRoot = makeProject();
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('read24hState returns emptySnapshot when the file is absent (default IDLE)', () => {
    const snap = read24hState(projectRoot, sid);
    expect(snap.state).toBe('IDLE');
    expect(snap.enteredFrom).toBeNull();
    expect(snap.activeSlices).toEqual([]);
    expect(snap.attempts).toEqual(emptyAttempts());
  });

  it('write24hState + read24hState round-trips the full snapshot (AC-A2)', () => {
    const original: State24hSnapshot = {
      state: '24H_ACTIVE',
      enteredAt: '2026-07-28T15:00:00.000Z',
      enteredFrom: 'USER_CONFIRM',
      activeSlices: ['rid-020a', 'rid-020b'],
      monotonicGuards: 2,
      autoCompactCount: 1,
      checkpoints: 3,
      lastCheckpointAt: '2026-07-28T15:30:00.000Z',
      attempts: { ...emptyAttempts(), runtime_or_shared_version_mismatch: 1 },
      exitCondition: null
    };
    const { path } = write24hState(projectRoot, sid, original);
    expect(existsSync(path)).toBe(true);
    const restored = read24hState(projectRoot, sid);
    expect(restored).toEqual(original);
  });

  it('write24hState does not leave a stray .tmp file (atomicity check)', () => {
    write24hState(projectRoot, sid, emptySnapshot());
    const dir = join(projectRoot, '.peaks', '_runtime', sid);
    const entries = readdirSync(dir);
    const tmps = entries.filter((e) => e.includes('.tmp-'));
    expect(tmps).toEqual([]);
    expect(entries).toContain('24h-state.json');
  });

  it('two consecutive writes preserve the second snapshot (last-write-wins)', () => {
    const a: State24hSnapshot = { ...emptySnapshot(), state: 'BRAINSTORM' };
    const b: State24hSnapshot = { ...emptySnapshot(), state: '24H_ACTIVE', enteredFrom: 'BRAINSTORM' };
    write24hState(projectRoot, sid, a);
    write24hState(projectRoot, sid, b);
    expect(read24hState(projectRoot, sid).state).toBe('24H_ACTIVE');
  });

  it('read24hState rejects malformed JSON with 24H_STATE_INVALID (coercion guard)', () => {
    const dir = join(projectRoot, '.peaks', '_runtime', sid);
    require('node:fs').mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '24h-state.json'), '{ "state": "BOGUS" }', 'utf8');
    expect(() => read24hState(projectRoot, sid)).toThrow(/24H_STATE_INVALID/);
  });

  it('read24hState rejects attempts map with unknown key', () => {
    const dir = join(projectRoot, '.peaks', '_runtime', sid);
    require('node:fs').mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, '24h-state.json'),
      JSON.stringify({
        state: 'IDLE',
        enteredAt: '2026-07-28T00:00:00.000Z',
        enteredFrom: null,
        activeSlices: [],
        monotonicGuards: 0,
        autoCompactCount: 0,
        checkpoints: 0,
        lastCheckpointAt: null,
        attempts: { bogus_key: 1 },
        exitCondition: null
      }),
      'utf8'
    );
    expect(() => read24hState(projectRoot, sid)).toThrow(/unknown key bogus_key/);
  });

  it('snapshot JSON file is human-readable (2-space indent + trailing newline)', () => {
    write24hState(projectRoot, sid, emptySnapshot());
    const raw = readFileSync(
      join(projectRoot, '.peaks', '_runtime', sid, '24h-state.json'),
      'utf8'
    );
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw).toContain('  "state": "IDLE"');
  });

  it('persists under .peaks/_runtime/<sessionId>/24h-state.json (path contract)', () => {
    const { path } = write24hState(projectRoot, sid, emptySnapshot());
    expect(path.replace(/\\/g, '/')).toBe(
      `${projectRoot.replace(/\\/g, '/')}/.peaks/_runtime/${sid}/24h-state.json`
    );
  });
});
