import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readBinding,
  writeBinding,
  registerInstance,
  heartbeat,
  dropInstance,
  dropStale,
  findSidByCaller,
  type Binding
} from '../../../../src/services/session/binding-store.js';

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'peaks-binding-test-'));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('binding-store v2.16.0', () => {
  test('readBinding returns null on empty project', () => {
    expect(readBinding(projectRoot)).toBeNull();
  });

  test('writeBinding + readBinding round-trip', () => {
    const binding: Binding = {
      ownerHint: 'caller-1',
      pid: 12345,
      lastHeartbeat: new Date().toISOString(),
      scope: projectRoot,
      instances: {
        '2026-06-29-session-abc123': {
          startedAt: new Date().toISOString(),
          roles: ['peaks-code'],
          callerId: 'caller-1',
          lastHeartbeat: new Date().toISOString()
        }
      }
    };
    writeBinding(projectRoot, binding);
    const back = readBinding(projectRoot);
    expect(back?.ownerHint).toBe('caller-1');
    expect(back?.instances['2026-06-29-session-abc123']?.roles).toEqual(['peaks-code']);
  });

  test('registerInstance creates a new binding on first call', () => {
    const { binding, sid } = registerInstance(projectRoot, { callerId: 'alice', roles: ['peaks-code'] });
    expect(binding.instances[sid]).toBeDefined();
    expect(binding.instances[sid]?.callerId).toBe('alice');
    expect(binding.instances[sid]?.roles).toEqual(['peaks-code']);
  });

  test('registerInstance same caller resumes existing sid', () => {
    const first = registerInstance(projectRoot, { callerId: 'alice', roles: ['peaks-code'] });
    const second = registerInstance(projectRoot, { callerId: 'alice', roles: ['peaks-rd'] });
    expect(second.sid).toBe(first.sid);
    expect(second.binding.instances[first.sid]?.roles).toEqual(['peaks-code', 'peaks-rd']);
  });

  test('registerInstance different caller gets different sid', () => {
    const alice = registerInstance(projectRoot, { callerId: 'alice', roles: ['peaks-code'] });
    const bob = registerInstance(projectRoot, { callerId: 'bob', roles: ['peaks-code'] });
    expect(alice.sid).not.toBe(bob.sid);
    // After bob joins, the binding has both instances.
    const merged = readBinding(projectRoot);
    expect(Object.keys(merged!.instances)).toHaveLength(2);
  });

  test('registerInstance with existingSid reuses slot (D2 /compact resume)', () => {
    const first = registerInstance(projectRoot, { callerId: 'alice', roles: ['peaks-code'] });
    const second = registerInstance(projectRoot, {
      callerId: 'alice',
      roles: ['peaks-rd', 'peaks-qa'],
      existingSid: first.sid
    });
    expect(second.sid).toBe(first.sid);
    expect(second.binding.instances[first.sid]?.roles).toEqual(['peaks-code', 'peaks-rd', 'peaks-qa']);
  });

  test('heartbeat updates lastHeartbeat', () => {
    const { sid } = registerInstance(projectRoot, { callerId: 'alice', roles: ['peaks-code'] });
    const before = readBinding(projectRoot)!.instances[sid]?.lastHeartbeat;
    // Sleep 10ms to ensure timestamp differs.
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    return wait(10).then(() => {
      const after = heartbeat(projectRoot, sid);
      expect(after?.instances[sid]?.lastHeartbeat).not.toBe(before);
    });
  });

  test('dropInstance removes entry', () => {
    const { sid } = registerInstance(projectRoot, { callerId: 'alice', roles: ['peaks-code'] });
    const after = dropInstance(projectRoot, sid);
    expect(after).toBeNull(); // last instance → null
  });

  test('dropStale prunes only entries older than ttl', () => {
    const { binding, sid } = registerInstance(projectRoot, { callerId: 'alice', roles: ['peaks-code'] });
    // Manually rewrite lastHeartbeat to a stale timestamp.
    const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const inst = binding.instances[sid];
    if (!inst) throw new Error('expected instance to exist');
    inst.lastHeartbeat = stale;
    binding.instances[sid] = inst;
    writeBinding(projectRoot, binding);

    const { binding: after, dropped } = dropStale(projectRoot, 5 * 60 * 1000);
    expect(dropped).toContain(sid);
    expect(after).toBeNull();
  });

  test('findSidByCaller returns the active sid', () => {
    const { sid } = registerInstance(projectRoot, { callerId: 'alice', roles: ['peaks-code'] });
    expect(findSidByCaller(projectRoot, 'alice')).toBe(sid);
    expect(findSidByCaller(projectRoot, 'nobody')).toBeNull();
  });

  test('legacy schema auto-migrates on read', () => {
    // Pre-v2.16.0 binding shape.
    const legacy = {
      sessionId: '2026-06-29-session-legacy1',
      createdAt: '2026-06-29T00:00:00.000Z',
      projectRoot
    };
    const legacyPath = join(projectRoot, '.peaks', '.session.json');
    const { mkdirSync } = require('node:fs') as typeof import('node:fs');
    mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
    writeFileSync(legacyPath, JSON.stringify(legacy));

    const migrated = readBinding(projectRoot);
    expect(migrated).not.toBeNull();
    expect(migrated!.instances['2026-06-29-session-legacy1']).toBeDefined();
    expect(migrated!.instances['2026-06-29-session-legacy1']?.callerId).toBeDefined();
  });

  test('corrupt JSON triggers backup + null return', () => {
    const corruptPath = join(projectRoot, '.peaks', '_runtime', 'session.json');
    const { mkdirSync } = require('node:fs') as typeof import('node:fs');
    mkdirSync(join(projectRoot, '.peaks', '_runtime'), { recursive: true });
    writeFileSync(corruptPath, '{not json');
    const result = readBinding(projectRoot);
    expect(result).toBeNull();
  });
});

describe('binding-store v2.18.0 — ownerHint collision fix (P0)', () => {
  // These cases simulate multi-process behavior by passing a
  // process-unique callerId (outer-session-id + pid suffix) directly
  // to the API. In production, the v2.18.0 fix has `registerInstance`
  // build the callerId from `getCurrentCallerId()` which appends
  // `process.pid`. Tests drive two "processes" by passing two
  // different pid suffixes inside one Node runtime.
  test('Case A: same env signal, different pid → 2 distinct sids', () => {
    // Simulates two Claude Code windows on the same host. Both
    // share the same outer-session-id env value, but different
    // pids → different callerIds → different sids.
    const a = registerInstance(projectRoot, { callerId: 'shared-env#100', roles: ['peaks-code'] });
    const b = registerInstance(projectRoot, { callerId: 'shared-env#200', roles: ['peaks-code'] });
    expect(a.sid).not.toBe(b.sid);
    const merged = readBinding(projectRoot);
    expect(Object.keys(merged!.instances)).toHaveLength(2);
  });

  test('Case B: same callerId (same env + same pid), multiple calls → 1 sid (auto-resume)', () => {
    // Simulates the same Claude process calling registerInstance
    // multiple times (peaks-code → peaks-rd → peaks-qa). pid is
    // stable across the run, so callerId is stable, so the
    // auto-resume branch returns the same sid.
    const first = registerInstance(projectRoot, { callerId: 'shared-env#100', roles: ['peaks-code'] });
    const second = registerInstance(projectRoot, { callerId: 'shared-env#100', roles: ['peaks-rd'] });
    const third = registerInstance(projectRoot, { callerId: 'shared-env#100', roles: ['peaks-qa'] });
    expect(first.sid).toBe(second.sid);
    expect(second.sid).toBe(third.sid);
    const merged = readBinding(projectRoot);
    expect(Object.keys(merged!.instances)).toHaveLength(1);
    // Roles accumulate across peaks-* skill activations.
    expect(merged!.instances[first.sid]?.roles).toEqual(['peaks-code', 'peaks-rd', 'peaks-qa']);
  });

  test('Case C: same callerId, multiple calls → findSidByCaller returns the same sid (no pid cross-talk)', () => {
    // Even when the surrounding env is identical, the pid suffix
    // baked into the callerId is the real key.
    const a = registerInstance(projectRoot, { callerId: 'shared-env#100', roles: ['peaks-code'] });
    const b = registerInstance(projectRoot, { callerId: 'shared-env#100', roles: ['peaks-code'] });
    expect(a.sid).toBe(b.sid);
    // findSidByCaller with the full pid-suffixed callerId returns the same sid.
    expect(findSidByCaller(projectRoot, 'shared-env#100')).toBe(a.sid);
    // A different pid never matches.
    expect(findSidByCaller(projectRoot, 'shared-env#200')).toBeNull();
  });

  test('Case D: callerId=\'unknown#<pid>\' (CI fallback), different pid → 2 distinct sids (no sentinel collision)', () => {
    // Simulates CI / scripts where both PEAKS_OUTER_SESSION_ID and
    // CLAUDE_CODE_SESSION_ID are unset. v2.17.0's `'unknown'`
    // sentinel caused two such processes to share a sid; v2.18.0
    // appends pid so the values are process-unique.
    const a = registerInstance(projectRoot, { callerId: 'unknown#100', roles: ['peaks-code'] });
    const b = registerInstance(projectRoot, { callerId: 'unknown#200', roles: ['peaks-code'] });
    expect(a.sid).not.toBe(b.sid);
    // findSidByCaller with the matching callerId returns its own sid.
    expect(findSidByCaller(projectRoot, 'unknown#100')).toBe(a.sid);
    expect(findSidByCaller(projectRoot, 'unknown#200')).toBe(b.sid);
    // The bare 'unknown' (no pid) does not match any instance —
    // it would only be a real lookup if a legacy v2.17.0 binding
    // was on disk.
    expect(findSidByCaller(projectRoot, 'unknown')).toBeNull();
  });

  test('findSidByCaller across pid isolation: pid 100 cannot see pid 200 instance', () => {
    registerInstance(projectRoot, { callerId: 'shared-env#100', roles: ['peaks-code'] });
    const b = registerInstance(projectRoot, { callerId: 'shared-env#200', roles: ['peaks-code'] });
    // pid 100's lookup returns pid 100's sid, NOT pid 200's.
    const lookup100 = findSidByCaller(projectRoot, 'shared-env#100');
    expect(lookup100).not.toBe(b.sid);
    expect(lookup100).not.toBeNull();
  });

  test('registerInstance empty callerId defaults to process-unique (no shared sentinel)', () => {
    // v2.18.0 fix: an empty callerId used to fall back to the
    // literal `'unknown'` sentinel, which two callers (e.g. CI
    // scripts) could collide on. Now the fallback is the
    // process-unique `getCurrentCallerId()` (env + pid).
    const a = registerInstance(projectRoot, { callerId: '', roles: ['peaks-code'] });
    expect(a.binding.instances[a.sid]?.callerId).not.toBe('unknown');
    // The fallback callerId includes `process.pid` to disambiguate.
    expect(a.binding.instances[a.sid]?.callerId).toContain(`#${process.pid}`);
  });
});