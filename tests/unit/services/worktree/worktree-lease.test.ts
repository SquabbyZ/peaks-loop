// tests/unit/services/worktree/worktree-lease.test.ts
//
// 4-dimension unit test for src/services/worktree/worktree-lease.ts.
// The module is mostly pure (status transitions, expiry checks,
// TTL-by-role table, ID/path composition) plus one fs-injected
// `listLeasesSync` helper. We pin the public surface as documented
// in the source's header comment, not from any legacy assertion.
//
// Dimensions covered:
//   - render:    path / id / TTL constants documented shape
//   - behavior:  pure status transitions, isLeaseActive/isLeaseGcEligible,
//                ttlForRole fallback, recordConsumption dedup,
//                finalizeLease defaults, renewLease preserves other fields
//   - integration: listLeasesSync over an injected fs (no real disk)
//   - a11y:      not applicable (no user-facing text surface)
//
// Run with: pnpm vitest run tests/unit/services/worktree/worktree-lease.test.ts

import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';

declareDimensions(
  'tests/unit/services/worktree/worktree-lease.test.ts',
  ['render', 'behavior', 'integration'],
  [{ dim: 'a11y', reason: 'no user-facing text or exit code' }],
);

import {
  DEFAULT_TTL_BY_ROLE,
  DEFAULT_TTL_MS,
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
  ttlForRole,
  worktreePath,
  type WorktreeLease,
  type WorktreeLeaseDraft,
} from '~/src/services/worktree/worktree-lease';

function makeDraft(overrides: Partial<WorktreeLeaseDraft> = {}): WorktreeLeaseDraft {
  return {
    leaseId: 'abcd1234abcd1234',
    rid: 'rid-001',
    role: 'rd',
    path: '/tmp/worktrees/abcd1234abcd1234',
    branch: 'peaks/rid-001',
    createdAt: 1_700_000_000_000,
    expiresAt: 1_700_001_800_000, // 30 min later
    purpose: 'test',
    ...overrides,
  };
}

describe("Scenario: render — constants and path helpers", () => {
  withTmpWorkspacePerTest();

  it("when invoked, should DEFAULT_TTL_BY_ROLE is frozen and has the 6 documented roles", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(Object.isFrozen(DEFAULT_TTL_BY_ROLE)).toBe(true);
    expect(Object.keys(DEFAULT_TTL_BY_ROLE).sort()).toEqual(
      ['general', 'prd', 'qa', 'rd', 'sc', 'ui'],
    );
  });

  it("when invoked, should DEFAULT_TTL_MS equals DEFAULT_TTL_BY_ROLE.rd", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(DEFAULT_TTL_MS).toBe(DEFAULT_TTL_BY_ROLE.rd);
  });

  it("when invoked, should TTL values match the documented per-role minutes", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(DEFAULT_TTL_BY_ROLE.rd).toBe(30 * 60 * 1_000);
    expect(DEFAULT_TTL_BY_ROLE.qa).toBe(15 * 60 * 1_000);
    expect(DEFAULT_TTL_BY_ROLE.ui).toBe(60 * 60 * 1_000);
    expect(DEFAULT_TTL_BY_ROLE.sc).toBe(30 * 60 * 1_000);
    expect(DEFAULT_TTL_BY_ROLE.prd).toBe(15 * 60 * 1_000);
    expect(DEFAULT_TTL_BY_ROLE.general).toBe(30 * 60 * 1_000);
  });

  it("when invoked, should leaseStoreDir composes <sessionRuntimeDir>/worktree-leases", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(leaseStoreDir('/r')).toBe('/r/worktree-leases');
  });

  it("when invoked, should leaseFilePath composes <storeDir>/<leaseId>.json", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(leaseFilePath('/r', 'abcd')).toBe('/r/worktree-leases/abcd.json');
  });

  it("when invoked, should worktreePath composes <sessionRuntimeDir>/worktrees/<leaseId>", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(worktreePath('/r', 'abcd')).toBe('/r/worktrees/abcd');
  });

  it("when invoked, should generateLeaseId returns a 16-character lowercase hex string", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const id = generateLeaseId();
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    // Two consecutive IDs differ.
    expect(generateLeaseId()).not.toBe(id);
  });
});

describe("Scenario: behavior — pure status transitions + helpers", () => {
  it("when invoked, should finalizeLease sets status=active and consumedBySubAgents=[]", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const draft = makeDraft();
    const out = finalizeLease(draft);
    expect(out.status).toBe('active');
    expect(out.consumedBySubAgents).toEqual([]);
    // The other draft fields are preserved.
    expect(out.leaseId).toBe(draft.leaseId);
    expect(out.rid).toBe(draft.rid);
  });

  it("when invoked, should markReleased / markExpired / markGc return a NEW lease with the new status", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const draft = finalizeLease(makeDraft());
    const released = markReleased(draft);
    expect(released.status).toBe('released');
    expect(released).not.toBe(draft);
    const expired = markExpired(released);
    expect(expired.status).toBe('expired');
    expect(expired).not.toBe(released);
    const gc = markGc(expired);
    expect(gc.status).toBe('gc');
    expect(gc).not.toBe(expired);
  });

  it("when invoked, should recordConsumption appends a new sub-agent id (returns a new lease)", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const draft = finalizeLease(makeDraft());
    const consumed = recordConsumption(draft, 'sub-1');
    expect(consumed.consumedBySubAgents).toEqual(['sub-1']);
    expect(consumed).not.toBe(draft);
  });

  it("when invoked, should recordConsumption is idempotent on a duplicate sub-agent id", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const draft = finalizeLease(makeDraft());
    const a = recordConsumption(draft, 'sub-1');
    const b = recordConsumption(a, 'sub-1');
    // Same reference returned; not a new object.
    expect(b).toBe(a);
    expect(b.consumedBySubAgents).toEqual(['sub-1']);
  });

  it("when invoked, should recordConsumption supports multiple distinct sub-agent ids", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const draft = finalizeLease(makeDraft());
    const a = recordConsumption(draft, 'sub-1');
    const b = recordConsumption(a, 'sub-2');
    const c = recordConsumption(b, 'sub-3');
    expect(c.consumedBySubAgents).toEqual(['sub-1', 'sub-2', 'sub-3']);
  });

  it("when invoked, should isLeaseActive: true only when status===active AND expiresAt > now", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const draft = finalizeLease(makeDraft({ expiresAt: 1_000 }));
    expect(isLeaseActive(draft, 500)).toBe(true);
    expect(isLeaseActive(draft, 999)).toBe(true);
    expect(isLeaseActive(draft, 1_000)).toBe(false); // expiresAt > now is false at equality
    expect(isLeaseActive(draft, 1_001)).toBe(false);
  });

  it("when invoked, should isLeaseActive: false for any non-active status, regardless of expiry", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const draft = finalizeLease(makeDraft({ expiresAt: 1_000_000 }));
    expect(isLeaseActive(markReleased(draft), 500)).toBe(false);
    expect(isLeaseActive(markExpired(draft), 500)).toBe(false);
    expect(isLeaseActive(markGc(draft), 500)).toBe(false);
  });

  it("when invoked, should isLeaseGcEligible: false for status=gc (do not double-gc)", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const draft = finalizeLease(makeDraft({ expiresAt: 0 }));
    expect(isLeaseGcEligible(markGc(draft), 1)).toBe(false);
  });

  it("when invoked, should isLeaseGcEligible: true for status=released at any time", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const draft = markReleased(finalizeLease(makeDraft()));
    expect(isLeaseGcEligible(draft, 0)).toBe(true);
  });

  it("when invoked, should isLeaseGcEligible: true for status=active when expiresAt <= now", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const draft = finalizeLease(makeDraft({ expiresAt: 100 }));
    expect(isLeaseGcEligible(draft, 100)).toBe(true);
    expect(isLeaseGcEligible(draft, 101)).toBe(true);
    // expiresAt > now → not eligible.
    expect(isLeaseGcEligible(draft, 99)).toBe(false);
  });

  it("when invoked, should renewLease returns a new lease with the new expiresAt and preserved other fields", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const draft = finalizeLease(makeDraft({ expiresAt: 100 }));
    const renewed = renewLease(draft, 500);
    expect(renewed.expiresAt).toBe(500);
    expect(renewed.leaseId).toBe(draft.leaseId);
    expect(renewed.rid).toBe(draft.rid);
    expect(renewed.role).toBe(draft.role);
    expect(renewed.status).toBe('active');
    expect(renewed.consumedBySubAgents).toEqual([]);
    expect(renewed).not.toBe(draft);
  });

  it("when invoked, should ttlForRole returns the documented value for known roles", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(ttlForRole('rd')).toBe(DEFAULT_TTL_BY_ROLE.rd);
    expect(ttlForRole('qa')).toBe(DEFAULT_TTL_BY_ROLE.qa);
    expect(ttlForRole('ui')).toBe(DEFAULT_TTL_BY_ROLE.ui);
  });

  it("when invoked, should ttlForRole is case-insensitive", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(ttlForRole('RD')).toBe(DEFAULT_TTL_BY_ROLE.rd);
    expect(ttlForRole('Qa')).toBe(DEFAULT_TTL_BY_ROLE.qa);
  });

  it("when invoked, should ttlForRole falls back to DEFAULT_TTL_MS for unknown roles", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(ttlForRole('not-a-real-role')).toBe(DEFAULT_TTL_MS);
    expect(ttlForRole('')).toBe(DEFAULT_TTL_MS);
  });
});

describe("Scenario: integration — listLeasesSync over an injected fs", () => {
  it("when invoked, should returns store-missing when existsSync reports false", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = listLeasesSync('/nope', {
      existsSync: () => false,
      readdir: () => [],
      readFile: () => { throw new Error('should not be called'); },
    });
    expect(out.kind).toBe('store-missing');
    if (out.kind === 'store-missing') {
      expect(out.storeDir).toBe('/nope');
    }
  });

  it("when invoked, should returns ok + empty leases + no errors when dir is empty", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = listLeasesSync('/r', {
      existsSync: () => true,
      readdir: () => [],
      readFile: () => '',
    });
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') {
      expect(out.leases).toEqual([]);
      expect(out.errors).toEqual([]);
    }
  });

  it("when invoked, should returns ok + filtered list when dir has only .json files", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const draft: WorktreeLease = finalizeLease(makeDraft({ leaseId: 'aaaaaaaa' }));
    const json = JSON.stringify(draft);
    const out = listLeasesSync('/r', {
      existsSync: () => true,
      readdir: () => ['aaaaaaaa.json', 'note.txt'],
      readFile: (p) => {
        if (p.endsWith('aaaaaaaa.json')) return json;
        throw new Error(`unexpected read of ${p}`);
      },
    });
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') {
      expect(out.leases).toHaveLength(1);
      expect(out.leases[0]?.leaseId).toBe('aaaaaaaa');
      expect(out.errors).toEqual([]);
    }
  });

  it("when invoked, should surfaces malformed files as LeaseReadError without aborting the rest", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const good: WorktreeLease = finalizeLease(makeDraft({ leaseId: 'good0001' }));
    const out = listLeasesSync('/r', {
      existsSync: () => true,
      readdir: () => ['good0001.json', 'bad00001.json'],
      readFile: (p) => {
        if (p.endsWith('good0001.json')) return JSON.stringify(good);
        if (p.endsWith('bad00001.json')) return 'not valid json';
        throw new Error(`unexpected read of ${p}`);
      },
    });
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') {
      expect(out.leases).toHaveLength(1);
      expect(out.errors).toHaveLength(1);
      expect(out.errors[0]?.file).toMatch(/bad00001\.json$/);
    }
  });
});
