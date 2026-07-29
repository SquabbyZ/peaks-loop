/**
 * Slice 2026-07-29-worktree-l2-extended Part 35 (L4 VM runtime).
 * vm-lease pure-function tests — parallel to worktree-lease /
 * container-lease.
 */

import { describe, expect, test } from 'vitest';
import {
  DEFAULT_TTL_BY_ROLE,
  DEFAULT_VM_IMAGE,
  VM_HYPERVISORS,
  deserializeVmLease,
  finalizeVmLease,
  generateVmLeaseId,
  isVmLeaseActive,
  markVmExpired,
  markVmGc,
  markVmReleased,
  recordVmConsumption,
  serializeVmLease,
  ttlForVmRole,
  vmLeaseFilePath,
  vmLeaseStoreDir
} from '../../../../src/services/vm/vm-lease.js';

function makeDraft(overrides: Partial<Parameters<typeof finalizeVmLease>[0]> = {}): Parameters<typeof finalizeVmLease>[0] {
  return {
    leaseId: 'a1b2c3d4e5f60718',
    rid: 'rid-2026-07-29-vm',
    role: 'rd',
    path: '/repo',
    hypervisor: 'kvm',
    image: DEFAULT_VM_IMAGE,
    vmId: 'vm-abc-123',
    createdAt: Date.now(),
    expiresAt: Date.now() + 30 * 60_000,
    purpose: 'part 35 e2e',
    ...overrides
  };
}

describe('generateVmLeaseId', () => {
  test('returns a 16-hex string', () => {
    const id = generateVmLeaseId();
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });
  test('two calls return different ids', () => {
    const a = generateVmLeaseId();
    const b = generateVmLeaseId();
    expect(a).not.toBe(b);
  });
});

describe('DEFAULT_TTL_BY_ROLE', () => {
  test('rd=30m, qa=15m, ui=1h', () => {
    expect(DEFAULT_TTL_BY_ROLE.rd).toBe(30 * 60_000);
    expect(DEFAULT_TTL_BY_ROLE.qa).toBe(15 * 60_000);
    expect(DEFAULT_TTL_BY_ROLE.ui).toBe(60 * 60_000);
  });
  test('DEFAULT_TTL_MS aliases rd default', () => {
    expect(DEFAULT_TTL_BY_ROLE.rd).toBeDefined();
  });
  test('ttlForVmRole is case-insensitive and falls back to rd', () => {
    expect(ttlForVmRole('RD')).toBe(DEFAULT_TTL_BY_ROLE.rd);
    expect(ttlForVmRole('made-up')).toBe(DEFAULT_TTL_BY_ROLE.rd);
  });
});

describe('VM_HYPERVISORS', () => {
  test('is the locked source of truth (3 hypervisors)', () => {
    expect(VM_HYPERVISORS).toEqual(['kvm', 'hyperkit', 'hyperv']);
  });
});

describe('path derivation', () => {
  test('vmLeaseStoreDir nests under <runtime>/vm-leases', () => {
    expect(vmLeaseStoreDir('/repo/.peaks/_runtime/s1')).toBe('/repo/.peaks/_runtime/s1/vm-leases');
  });
  test('vmLeaseFilePath appends <leaseId>.json', () => {
    expect(vmLeaseFilePath('/repo/.peaks/_runtime/s1', 'a1b2c3d4e5f60718'))
      .toBe('/repo/.peaks/_runtime/s1/vm-leases/a1b2c3d4e5f60718.json');
  });
});

describe('lifecycle transitions', () => {
  test('finalizeVmLease sets status=active + empty consumption log', () => {
    const lease = finalizeVmLease(makeDraft());
    expect(lease.status).toBe('active');
    expect(lease.consumedBySubAgents).toEqual([]);
  });
  test('markVmReleased transitions active → released', () => {
    expect(markVmReleased(finalizeVmLease(makeDraft())).status).toBe('released');
  });
  test('markVmExpired transitions active → expired', () => {
    expect(markVmExpired(finalizeVmLease(makeDraft())).status).toBe('expired');
  });
  test('markVmGc transitions any status → gc', () => {
    expect(markVmGc(finalizeVmLease(makeDraft())).status).toBe('gc');
  });
  test('all transitions are pure (do not mutate input)', () => {
    const lease = finalizeVmLease(makeDraft());
    const before = JSON.stringify(lease);
    markVmReleased(lease);
    markVmExpired(lease);
    markVmGc(lease);
    expect(JSON.stringify(lease)).toBe(before);
  });
});

describe('recordVmConsumption', () => {
  test('appends a sub-agent id to the log', () => {
    const lease = recordVmConsumption(finalizeVmLease(makeDraft()), 'batch-1');
    expect(lease.consumedBySubAgents).toEqual(['batch-1']);
  });
  test('is idempotent on duplicate ids', () => {
    const once = recordVmConsumption(finalizeVmLease(makeDraft()), 'batch-1');
    const twice = recordVmConsumption(once, 'batch-1');
    expect(twice.consumedBySubAgents).toEqual(['batch-1']);
  });
});

describe('isVmLeaseActive', () => {
  test('active + future expiry → true', () => {
    expect(isVmLeaseActive(finalizeVmLease(makeDraft({ expiresAt: Date.now() + 60_000 })))).toBe(true);
  });
  test('active + past expiry → false', () => {
    expect(isVmLeaseActive(finalizeVmLease(makeDraft({ expiresAt: Date.now() - 1 })))).toBe(false);
  });
  test('released → false regardless of expiry', () => {
    expect(isVmLeaseActive(markVmReleased(finalizeVmLease(makeDraft({ expiresAt: Date.now() + 60_000 }))))).toBe(false);
  });
});

describe('serializeVmLease / deserializeVmLease', () => {
  test('round-trip preserves all fields', () => {
    const lease = finalizeVmLease(makeDraft());
    const parsed = deserializeVmLease(serializeVmLease(lease));
    expect(parsed).toEqual(lease);
  });
  test('rejects non-object input', () => {
    expect(() => deserializeVmLease('"hello"')).toThrow();
    expect(() => deserializeVmLease('123')).toThrow();
  });
  test('rejects missing required field', () => {
    expect(() => deserializeVmLease('{"leaseId":"a"}')).toThrow(/missing.*rid/);
  });
  test('rejects invalid hypervisor', () => {
    const raw = serializeVmLease(finalizeVmLease(makeDraft()));
    const bad = raw.replace('"kvm"', '"qemu-wrong"');
    expect(() => deserializeVmLease(bad)).toThrow(/hypervisor invalid/);
  });
  test('DEFAULT_VM_IMAGE is the documented default', () => {
    expect(DEFAULT_VM_IMAGE).toBe('peaks-base:22-slim');
  });
});
