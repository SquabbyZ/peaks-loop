import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TTL_BY_ROLE,
  DEFAULT_TTL_MS,
  deserializeLease,
  finalizeLease,
  generateLeaseId,
  isLeaseActive,
  isLeaseGcEligible,
  leaseFilePath,
  leaseStoreDir,
  listLeasesSync,
  markExpired,
  markGc,
  markReleased,
  recordConsumption,
  renewLease,
  serializeLease,
  ttlForRole,
  worktreePath
} from '../src/lease/store.js';
import type { WorktreeLease, WorktreeLeaseDraft } from '../src/lease/types.js';

const NOW = 1_700_000_000_000;
const THIRTY_MINUTES = 1_800_000;
const RUNTIME_DIR = '/state/sid-1';

function draft(overrides: Partial<WorktreeLeaseDraft> = {}): WorktreeLeaseDraft {
  return {
    leaseId: '0123456789abcdef',
    rid: 'req-001',
    role: 'rd',
    path: `${RUNTIME_DIR}/worktrees/0123456789abcdef`,
    branch: 'req-001',
    createdAt: NOW,
    expiresAt: NOW + THIRTY_MINUTES,
    purpose: 'test lease',
    ...overrides
  };
}

function activeLease(overrides: Partial<WorktreeLease> = {}): WorktreeLease {
  return { ...finalizeLease(draft()), ...overrides };
}

describe('default TTLs', () => {
  it('when consulted by role, should carry the documented durations', () => {
    // given:
    const expected = {
      rd: THIRTY_MINUTES,
      qa: 900_000,
      ui: 3_600_000,
      sc: THIRTY_MINUTES,
      prd: 900_000,
      general: THIRTY_MINUTES
    };
    // when:
    const actual = DEFAULT_TTL_BY_ROLE;
    // then:
    expect(actual).toEqual(expected);
    expect(DEFAULT_TTL_MS).toBe(THIRTY_MINUTES);
  });

  it('when the role is upper-cased, should still match its entry', () => {
    // given:
    const role = 'QA';
    // when:
    const ttlMs = ttlForRole(role);
    // then:
    expect(ttlMs).toBe(900_000);
  });

  it('when the role is unknown, should fall back to the rd default', () => {
    // given:
    const role = 'general-purpose';
    // when:
    const ttlMs = ttlForRole(role);
    // then:
    expect(ttlMs).toBe(DEFAULT_TTL_MS);
  });
});

describe('lease paths', () => {
  it('when composing the store, file, and worktree paths, should nest them under the runtime dir', () => {
    // given:
    const leaseId = '0123456789abcdef';
    // when:
    const storeDir = leaseStoreDir('C:\\state\\sid-1');
    const file = leaseFilePath(RUNTIME_DIR, leaseId);
    const worktree = worktreePath(RUNTIME_DIR, leaseId);
    // then:
    expect(storeDir).toBe('C:/state/sid-1/worktree-leases');
    expect(file).toBe('/state/sid-1/worktree-leases/0123456789abcdef.json');
    expect(worktree).toBe('/state/sid-1/worktrees/0123456789abcdef');
  });
});

describe('generateLeaseId', () => {
  it('when no source is injected, should produce sixteen hex characters', () => {
    // given:
    const pattern = /^[0-9a-f]{16}$/;
    // when:
    const leaseId = generateLeaseId();
    // then:
    expect(leaseId).toMatch(pattern);
  });

  it('when a source is injected, should draw eight bytes from it deterministically', () => {
    // given:
    const sizes: number[] = [];
    const randomBytes = (size: number): Buffer => {
      sizes.push(size);
      return Buffer.alloc(size, 0x0f);
    };
    // when:
    const leaseId = generateLeaseId({ randomBytes });
    // then:
    expect(sizes).toEqual([8]);
    expect(leaseId).toBe('0f0f0f0f0f0f0f0f');
  });
});

describe('lease transitions', () => {
  it('when a draft is finalized, should start active with no consumers', () => {
    // given:
    const input = draft();
    // when:
    const lease = finalizeLease(input);
    // then:
    expect(lease.status).toBe('active');
    expect(lease.consumedBySubAgents).toEqual([]);
  });

  it('when each status transition runs, should return a new lease and leave the input alone', () => {
    // given:
    const lease = activeLease();
    // when:
    const released = markReleased(lease);
    const expired = markExpired(lease);
    const gc = markGc(lease);
    // then:
    expect([released.status, expired.status, gc.status]).toEqual(['released', 'expired', 'gc']);
    expect(lease.status).toBe('active');
  });

  it('when the same sub-agent is recorded twice, should keep one entry', () => {
    // given:
    const lease = activeLease();
    // when:
    const once = recordConsumption(lease, 'batch-1');
    const twice = recordConsumption(once, 'batch-1');
    // then:
    expect(once.consumedBySubAgents).toEqual(['batch-1']);
    expect(twice.consumedBySubAgents).toEqual(['batch-1']);
  });

  it('when renewing, should move the expiry and return the status to active', () => {
    // given:
    const lease = activeLease({ status: 'expired' });
    // when:
    const renewed = renewLease(lease, NOW + 60_000);
    // then:
    expect(renewed.expiresAt).toBe(NOW + 60_000);
    expect(renewed.status).toBe('active');
    expect(renewed.leaseId).toBe(lease.leaseId);
  });
});

describe('lease predicates', () => {
  it('when the lease is active and unexpired, should read as active', () => {
    // given:
    const lease = activeLease();
    // when:
    const beforeExpiry = isLeaseActive(lease, NOW);
    const afterExpiry = isLeaseActive(lease, NOW + THIRTY_MINUTES);
    // then:
    expect(beforeExpiry).toBe(true);
    expect(afterExpiry).toBe(false);
  });

  it('when the lease is released, should not read as active', () => {
    // given:
    const lease = markReleased(activeLease());
    // when:
    const active = isLeaseActive(lease, NOW);
    // then:
    expect(active).toBe(false);
  });

  it('when the lease is released or past expiry, should read as gc-eligible', () => {
    // given:
    const released = markReleased(activeLease());
    const expiredActive = activeLease({ expiresAt: NOW });
    const liveActive = activeLease({ expiresAt: NOW + 60_000 });
    // when:
    const verdicts = [released, expiredActive, liveActive].map((lease) =>
      isLeaseGcEligible(lease, NOW)
    );
    // then:
    expect(verdicts).toEqual([true, true, false]);
  });

  it('when the lease is already marked gc, should not read as gc-eligible again', () => {
    // given:
    const lease = markGc(activeLease());
    // when:
    const eligible = isLeaseGcEligible(lease, NOW);
    // then:
    expect(eligible).toBe(false);
  });
});

describe('lease serialization', () => {
  it('when a lease round-trips through JSON, should come back identical', () => {
    // given:
    const lease = activeLease();
    // when:
    const roundTripped = deserializeLease(serializeLease(lease));
    // then:
    expect(roundTripped).toEqual(lease);
  });

  it('when serialized, should use two-space indentation and end with a newline', () => {
    // given:
    const lease = activeLease();
    // when:
    const raw = serializeLease(lease);
    // then:
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw).toBe(`${JSON.stringify(lease, null, 2)}\n`);
  });

  it('when a field is missing, should throw instead of guessing', () => {
    // given:
    const raw = JSON.stringify({ leaseId: 'x' });
    // when:
    const run = (): WorktreeLease => deserializeLease(raw);
    // then:
    expect(run).toThrowError(/rid missing/);
  });

  it('when the payload is not an object, should throw', () => {
    // given:
    const raw = JSON.stringify(null);
    // when:
    const run = (): WorktreeLease => deserializeLease(raw);
    // then:
    expect(run).toThrowError(/lease file must contain a JSON object/);
  });
});

describe('listLeasesSync', () => {
  const storeDir = '/state/sid-1/worktree-leases';

  it('when the store directory is missing, should report it instead of failing', () => {
    // given:
    const fs = { existsSync: () => false, readdir: () => [], readFile: () => '' };
    // when:
    const result = listLeasesSync(storeDir, fs);
    // then:
    expect(result).toEqual({ kind: 'store-missing', storeDir });
  });

  it('when one lease is valid and one is malformed, should surface both without throwing', () => {
    // given:
    const valid = serializeLease(activeLease());
    const fs = {
      existsSync: () => true,
      readdir: () => ['0123456789abcdef.json', 'broken.json', 'notes.txt'],
      readFile: (file: string) => (file.endsWith('broken.json') ? '{}' : valid)
    };
    // when:
    const result = listLeasesSync(storeDir, fs);
    // then:
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.leases).toHaveLength(1);
    expect(result.errors).toEqual([{ file: `${storeDir}/broken.json`, error: 'leaseId missing' }]);
  });
});
