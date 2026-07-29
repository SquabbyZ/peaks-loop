/**
 * Slice 2026-07-29-worktree-l2-extended Part 1 — lease store pure helpers.
 *
 * These tests cover the pure-function lease store at
 * `src/services/worktree/worktree-lease.ts`. The CLI command tests
 * (spawn / release) live in `tests/unit/cli/commands/worktree-spawn-commands.test.ts`
 * and cover the IO + execSync side.
 *
 * Coverage targets:
 * - id generation is unique + 16-hex
 * - TTL by role (rd/qa/ui/sc/prd/general + unknown fallback)
 * - path derivation (store dir / file path / worktree path)
 * - lease lifecycle transitions (active → released / expired / gc)
 * - isLeaseActive (status check + expiry check)
 * - recordConsumption (idempotent + append)
 * - serializeLease + deserializeLease round-trip + malformed input rejection
 */
import { describe, expect, test } from 'vitest';
import {
  DEFAULT_TTL_BY_ROLE,
  DEFAULT_TTL_MS,
  deserializeLease,
  finalizeLease,
  generateLeaseId,
  isLeaseActive,
  leaseFilePath,
  leaseStoreDir,
  markExpired,
  markGc,
  markReleased,
  recordConsumption,
  serializeLease,
  ttlForRole,
  worktreePath,
  type WorktreeLease,
  type WorktreeLeaseDraft
} from '../../../../src/services/worktree/worktree-lease.js';

function makeDraft(overrides: Partial<WorktreeLeaseDraft> = {}): WorktreeLeaseDraft {
  return {
    leaseId: 'a1b2c3d4e5f60718',
    rid: 'rid-2026-07-29-test',
    role: 'rd',
    path: '/repo/.peaks/_runtime/sid/worktrees/a1b2c3d4e5f60718',
    branch: 'rid-2026-07-29-test',
    createdAt: 1_700_000_000_000,
    expiresAt: 1_700_000_001_800_000,
    purpose: 'unit test',
    ...overrides
  };
}

describe('generateLeaseId', () => {
  test('returns a 16-hex string', () => {
    const id = generateLeaseId();
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  test('two consecutive calls return different ids', () => {
    const a = generateLeaseId();
    const b = generateLeaseId();
    expect(a).not.toBe(b);
  });
});

describe('DEFAULT_TTL_BY_ROLE', () => {
  test('rd=30min, qa=15min, ui=1h', () => {
    expect(DEFAULT_TTL_BY_ROLE.rd).toBe(30 * 60 * 1_000);
    expect(DEFAULT_TTL_BY_ROLE.qa).toBe(15 * 60 * 1_000);
    expect(DEFAULT_TTL_BY_ROLE.ui).toBe(60 * 60 * 1_000);
  });

  test('DEFAULT_TTL_MS aliases rd default', () => {
    expect(DEFAULT_TTL_MS).toBe(DEFAULT_TTL_BY_ROLE.rd);
  });
});

describe('ttlForRole', () => {
  test('returns the per-role TTL for known roles', () => {
    expect(ttlForRole('rd')).toBe(DEFAULT_TTL_BY_ROLE.rd);
    expect(ttlForRole('qa')).toBe(DEFAULT_TTL_BY_ROLE.qa);
    expect(ttlForRole('ui')).toBe(DEFAULT_TTL_BY_ROLE.ui);
  });

  test('returns the default for unknown roles', () => {
    expect(ttlForRole('made-up-role')).toBe(DEFAULT_TTL_MS);
  });

  test('is case-insensitive', () => {
    expect(ttlForRole('RD')).toBe(DEFAULT_TTL_BY_ROLE.rd);
    expect(ttlForRole('QA')).toBe(DEFAULT_TTL_BY_ROLE.qa);
  });
});

describe('path derivation', () => {
  test('leaseStoreDir returns <runtime>/worktree-leases', () => {
    expect(leaseStoreDir('/repo/.peaks/_runtime/sid')).toBe('/repo/.peaks/_runtime/sid/worktree-leases');
  });

  test('leaseFilePath returns <store-dir>/<leaseId>.json', () => {
    expect(leaseFilePath('/repo/.peaks/_runtime/sid', 'abc123'))
      .toBe('/repo/.peaks/_runtime/sid/worktree-leases/abc123.json');
  });

  test('worktreePath returns <runtime>/worktrees/<leaseId>', () => {
    expect(worktreePath('/repo/.peaks/_runtime/sid', 'abc123'))
      .toBe('/repo/.peaks/_runtime/sid/worktrees/abc123');
  });
});

describe('lifecycle transitions', () => {
  test('finalizeLease sets status=active + empty consumption log', () => {
    const lease = finalizeLease(makeDraft());
    expect(lease.status).toBe('active');
    expect(lease.consumedBySubAgents).toEqual([]);
  });

  test('markReleased transitions active → released', () => {
    const lease = finalizeLease(makeDraft());
    expect(markReleased(lease).status).toBe('released');
  });

  test('markExpired transitions active → expired', () => {
    const lease = finalizeLease(makeDraft());
    expect(markExpired(lease).status).toBe('expired');
  });

  test('markGc transitions any status → gc', () => {
    const lease = finalizeLease(makeDraft());
    expect(markGc(markReleased(lease)).status).toBe('gc');
  });

  test('all transitions are pure (do not mutate input)', () => {
    const lease = finalizeLease(makeDraft());
    const before = JSON.stringify(lease);
    markReleased(lease);
    markExpired(lease);
    markGc(lease);
    expect(JSON.stringify(lease)).toBe(before);
  });
});

describe('isLeaseActive', () => {
  test('active + future expiry → true', () => {
    const lease = finalizeLease(makeDraft({ expiresAt: Date.now() + 60_000 }));
    expect(isLeaseActive(lease)).toBe(true);
  });

  test('active + past expiry → false (time-based expiry without status change)', () => {
    const lease = finalizeLease(makeDraft({ expiresAt: Date.now() - 1 }));
    expect(isLeaseActive(lease)).toBe(false);
  });

  test('released → false regardless of expiry', () => {
    const lease = markReleased(finalizeLease(makeDraft({ expiresAt: Date.now() + 60_000 })));
    expect(isLeaseActive(lease)).toBe(false);
  });

  test('expired → false regardless of expiry time', () => {
    const lease = markExpired(finalizeLease(makeDraft({ expiresAt: Date.now() + 60_000 })));
    expect(isLeaseActive(lease)).toBe(false);
  });

  test('explicit now parameter for deterministic testing', () => {
    const lease = finalizeLease(makeDraft({ expiresAt: 1000 }));
    expect(isLeaseActive(lease, 500)).toBe(true);
    expect(isLeaseActive(lease, 1500)).toBe(false);
  });
});

describe('recordConsumption', () => {
  test('appends a sub-agent id to the log', () => {
    const lease = finalizeLease(makeDraft());
    const consumed = recordConsumption(lease, 'batch-001');
    expect(consumed.consumedBySubAgents).toEqual(['batch-001']);
  });

  test('is idempotent on duplicate ids', () => {
    const lease = finalizeLease(makeDraft());
    const once = recordConsumption(lease, 'batch-001');
    const twice = recordConsumption(once, 'batch-001');
    expect(twice.consumedBySubAgents).toEqual(['batch-001']);
  });

  test('appends multiple distinct ids in order', () => {
    const lease = finalizeLease(makeDraft());
    const consumed = recordConsumption(recordConsumption(lease, 'batch-001'), 'batch-002');
    expect(consumed.consumedBySubAgents).toEqual(['batch-001', 'batch-002']);
  });

  test('does not mutate input', () => {
    const lease = finalizeLease(makeDraft());
    const before = JSON.stringify(lease);
    recordConsumption(lease, 'batch-001');
    expect(JSON.stringify(lease)).toBe(before);
  });
});

describe('serializeLease / deserializeLease round-trip', () => {
  test('serialize produces pretty-printed JSON', () => {
    const lease = finalizeLease(makeDraft());
    const raw = serializeLease(lease);
    expect(raw).toContain('\n');
    expect(raw.trim().endsWith('}')).toBe(true);
  });

  test('round-trip preserves all fields', () => {
    const lease = finalizeLease(makeDraft());
    const raw = serializeLease(lease);
    const parsed = deserializeLease(raw);
    expect(parsed).toEqual(lease);
  });

  test('round-trip preserves consumption log + status transitions', () => {
    const consumed = recordConsumption(recordConsumption(finalizeLease(makeDraft()), 'b1'), 'b2');
    const released = markReleased(consumed);
    const raw = serializeLease(released);
    const parsed = deserializeLease(raw);
    expect(parsed).toEqual(released);
    expect(parsed.status).toBe('released');
    expect(parsed.consumedBySubAgents).toEqual(['b1', 'b2']);
  });

  test('deserialize throws on non-object input', () => {
    expect(() => deserializeLease('"hello"')).toThrow();
    expect(() => deserializeLease('123')).toThrow();
    expect(() => deserializeLease('null')).toThrow();
  });

  test('deserialize throws when required fields are missing', () => {
    const bad = JSON.stringify({ leaseId: 'x' });
    expect(() => deserializeLease(bad)).toThrow(/rid missing/);
  });

  test('deserialize throws when consumedBySubAgents is not an array', () => {
    const bad = JSON.stringify({
      leaseId: 'x', rid: 'r', role: 'rd', path: '/p', branch: 'b',
      createdAt: 1, expiresAt: 2, purpose: 'p', status: 'active',
      consumedBySubAgents: 'not-an-array'
    });
    expect(() => deserializeLease(bad)).toThrow(/consumedBySubAgents missing/);
  });

  test('round-trip is type-stable: deserializeLease returns WorktreeLease', () => {
    const lease: WorktreeLease = finalizeLease(makeDraft());
    const parsed: WorktreeLease = deserializeLease(serializeLease(lease));
    // TS guarantees this; runtime check is the equality above.
    expect(parsed.leaseId).toBe(lease.leaseId);
    expect(parsed.rid).toBe(lease.rid);
    expect(parsed.role).toBe(lease.role);
    expect(parsed.path).toBe(lease.path);
    expect(parsed.branch).toBe(lease.branch);
    expect(parsed.createdAt).toBe(lease.createdAt);
    expect(parsed.expiresAt).toBe(lease.expiresAt);
    expect(parsed.purpose).toBe(lease.purpose);
    expect(parsed.status).toBe(lease.status);
    expect(parsed.consumedBySubAgents).toEqual(lease.consumedBySubAgents);
  });
});