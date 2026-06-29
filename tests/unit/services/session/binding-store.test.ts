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
          roles: ['peaks-solo'],
          callerId: 'caller-1',
          lastHeartbeat: new Date().toISOString()
        }
      }
    };
    writeBinding(projectRoot, binding);
    const back = readBinding(projectRoot);
    expect(back?.ownerHint).toBe('caller-1');
    expect(back?.instances['2026-06-29-session-abc123']?.roles).toEqual(['peaks-solo']);
  });

  test('registerInstance creates a new binding on first call', () => {
    const { binding, sid } = registerInstance(projectRoot, { callerId: 'alice', roles: ['peaks-solo'] });
    expect(binding.instances[sid]).toBeDefined();
    expect(binding.instances[sid]?.callerId).toBe('alice');
    expect(binding.instances[sid]?.roles).toEqual(['peaks-solo']);
  });

  test('registerInstance same caller resumes existing sid', () => {
    const first = registerInstance(projectRoot, { callerId: 'alice', roles: ['peaks-solo'] });
    const second = registerInstance(projectRoot, { callerId: 'alice', roles: ['peaks-rd'] });
    expect(second.sid).toBe(first.sid);
    expect(second.binding.instances[first.sid]?.roles).toEqual(['peaks-solo', 'peaks-rd']);
  });

  test('registerInstance different caller gets different sid', () => {
    const alice = registerInstance(projectRoot, { callerId: 'alice', roles: ['peaks-solo'] });
    const bob = registerInstance(projectRoot, { callerId: 'bob', roles: ['peaks-solo'] });
    expect(alice.sid).not.toBe(bob.sid);
    // After bob joins, the binding has both instances.
    const merged = readBinding(projectRoot);
    expect(Object.keys(merged!.instances)).toHaveLength(2);
  });

  test('registerInstance with existingSid reuses slot (D2 /compact resume)', () => {
    const first = registerInstance(projectRoot, { callerId: 'alice', roles: ['peaks-solo'] });
    const second = registerInstance(projectRoot, {
      callerId: 'alice',
      roles: ['peaks-rd', 'peaks-qa'],
      existingSid: first.sid
    });
    expect(second.sid).toBe(first.sid);
    expect(second.binding.instances[first.sid]?.roles).toEqual(['peaks-solo', 'peaks-rd', 'peaks-qa']);
  });

  test('heartbeat updates lastHeartbeat', () => {
    const { sid } = registerInstance(projectRoot, { callerId: 'alice', roles: ['peaks-solo'] });
    const before = readBinding(projectRoot)!.instances[sid]?.lastHeartbeat;
    // Sleep 10ms to ensure timestamp differs.
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    return wait(10).then(() => {
      const after = heartbeat(projectRoot, sid);
      expect(after?.instances[sid]?.lastHeartbeat).not.toBe(before);
    });
  });

  test('dropInstance removes entry', () => {
    const { sid } = registerInstance(projectRoot, { callerId: 'alice', roles: ['peaks-solo'] });
    const after = dropInstance(projectRoot, sid);
    expect(after).toBeNull(); // last instance → null
  });

  test('dropStale prunes only entries older than ttl', () => {
    const { binding, sid } = registerInstance(projectRoot, { callerId: 'alice', roles: ['peaks-solo'] });
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
    const { sid } = registerInstance(projectRoot, { callerId: 'alice', roles: ['peaks-solo'] });
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