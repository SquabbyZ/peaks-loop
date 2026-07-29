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

/**
 * Part 2.A (slice 2026-07-29-worktree-l2-extended) — pure helpers used by
 * the new `peaks worktree renew | list | gc` commands. CLI IO + git
 * fixture is exercised by the integration test (Part 2.D).
 */
describe('renewLease', () => {
  test('updates expiresAt, preserves all other fields, status=active', () => {
    const lease = finalizeLease(makeDraft({ expiresAt: 1_000 }));
    const renewed = renewLease(lease, 5_000);
    expect(renewed.expiresAt).toBe(5_000);
    expect(renewed.status).toBe('active');
    expect(renewed.leaseId).toBe(lease.leaseId);
    expect(renewed.rid).toBe(lease.rid);
    expect(renewed.role).toBe(lease.role);
    expect(renewed.path).toBe(lease.path);
    expect(renewed.branch).toBe(lease.branch);
    expect(renewed.createdAt).toBe(lease.createdAt);
    expect(renewed.purpose).toBe(lease.purpose);
  });

  test('renewLease of a released lease flips status back to active (cli gates this; helper is pure)', () => {
    // The CLI refuses to renew released/gc leases; the pure helper just
    // sets status='active' unconditionally. Document the contract.
    const released = markReleased(finalizeLease(makeDraft()));
    const renewed = renewLease(released, 9_999);
    expect(renewed.status).toBe('active');
    expect(renewed.expiresAt).toBe(9_999);
  });

  test('does not mutate input', () => {
    const lease = finalizeLease(makeDraft({ expiresAt: 1_000 }));
    const before = JSON.stringify(lease);
    renewLease(lease, 5_000);
    expect(JSON.stringify(lease)).toBe(before);
  });
});

describe('isLeaseGcEligible', () => {
  const now = 10_000;
  test('released → eligible', () => {
    const lease = markReleased(finalizeLease(makeDraft({ expiresAt: now + 60_000 })));
    expect(isLeaseGcEligible(lease, now)).toBe(true);
  });

  test('active + past expiry → eligible (treated as expired candidate)', () => {
    const lease = finalizeLease(makeDraft({ expiresAt: now - 1 }));
    expect(isLeaseGcEligible(lease, now)).toBe(true);
  });

  test('active + future expiry → NOT eligible', () => {
    const lease = finalizeLease(makeDraft({ expiresAt: now + 60_000 }));
    expect(isLeaseGcEligible(lease, now)).toBe(false);
  });

  test('gc → NOT eligible (terminal)', () => {
    const lease = markGc(finalizeLease(makeDraft()));
    expect(isLeaseGcEligible(lease, now)).toBe(false);
  });
});

describe('listLeasesSync', () => {
  function makeFakeFs(files: Record<string, string>): {
    readdir: (p: string) => ReadonlyArray<string>;
    readFile: (p: string) => string;
    existsSync: (p: string) => boolean;
  } {
    const paths = new Set(Object.keys(files));
    return {
      readdir: (p) => Object.keys(files).filter((k) => k.startsWith(p + '/')).map((k) => k.slice(p.length + 1)),
      readFile: (p) => {
        if (!(p in files)) throw new Error(`ENOENT ${p}`);
        return files[p]!;
      },
      existsSync: (p) => paths.has(p) || p === '/store'
    };
  }

  test('returns store-missing when the lease directory does not exist', () => {
    const result = listLeasesSync('/store', {
      readdir: () => [],
      readFile: () => '',
      existsSync: () => false
    });
    expect(result.kind).toBe('store-missing');
    if (result.kind === 'store-missing') {
      expect(result.storeDir).toBe('/store');
    }
  });

  test('returns parsed leases + empty errors when all files are valid', () => {
    const lease = finalizeLease(makeDraft({ leaseId: 'aaaa1111bbbb2222' }));
    const files = { '/store/aaaa1111bbbb2222.json': serializeLease(lease) };
    const result = listLeasesSync('/store', makeFakeFs(files));
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.leases).toHaveLength(1);
      expect(result.errors).toEqual([]);
      expect(result.leases[0]?.leaseId).toBe('aaaa1111bbbb2222');
    }
  });

  test('skips non-json files', () => {
    const result = listLeasesSync('/store', {
      readdir: () => ['aaaa1111bbbb2222.json', 'README.md', '.DS_Store'],
      readFile: () => serializeLease(finalizeLease(makeDraft({ leaseId: 'aaaa1111bbbb2222' }))),
      existsSync: () => true
    });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.leases).toHaveLength(1);
      expect(result.errors).toEqual([]);
    }
  });

  test('surfaces malformed files as errors without aborting the list', () => {
    const valid = serializeLease(finalizeLease(makeDraft({ leaseId: 'aaaa1111bbbb2222' })));
    const files: Record<string, string> = {
      '/store/aaaa1111bbbb2222.json': valid,
      '/store/bad.json': '{"leaseId":"only-this-field"}'
    };
    const result = listLeasesSync('/store', makeFakeFs(files));
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.leases).toHaveLength(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.file).toBe('/store/bad.json');
      expect(result.errors[0]?.error).toMatch(/rid missing/);
    }
  });
});