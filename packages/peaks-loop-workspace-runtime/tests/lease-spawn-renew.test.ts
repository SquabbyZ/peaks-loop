import { describe, expect, it } from 'vitest';

import { runRenew, runSpawn } from '../src/lease/lifecycle.js';
import { serializeLease } from '../src/lease/store.js';
import {
  LEASE_FILE,
  LEASE_ID,
  NOW,
  PROJECT_ROOT,
  SCOPE,
  THIRTY_MINUTES,
  WORKTREE,
  effectsOver,
  lease,
  memoryFs,
  recordingRunGit
} from './_lifecycle-harness.js';

describe('runSpawn', () => {
  it('when the worktree is added, should write the lease and report it', () => {
    // given:
    const io = memoryFs();
    const git = recordingRunGit();
    // when:
    const result = runSpawn(
      { ...SCOPE, rid: 'req-001', role: 'rd', purpose: 'reason' },
      effectsOver(io, git.runGit)
    );
    // then:
    expect(git.calls).toEqual([
      { argv: ['worktree', 'add', WORKTREE, '-b', 'req-001'], cwd: PROJECT_ROOT }
    ]);
    expect(io.writes).toEqual([LEASE_FILE]);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.lease.expiresAt).toBe(NOW + THIRTY_MINUTES);
    expect(io.files.get(LEASE_FILE)).toBe(serializeLease(result.lease));
  });

  it('when git fails, should report the failure and write no lease', () => {
    // given:
    const io = memoryFs();
    const git = recordingRunGit({ ok: false, stdout: '', stderr: 'fatal: branch exists' });
    // when:
    const result = runSpawn(
      { ...SCOPE, rid: 'req-001', role: 'rd', purpose: 'reason' },
      effectsOver(io, git.runGit)
    );
    // then:
    expect(result).toEqual({
      kind: 'failed',
      error: expect.stringContaining('git worktree add failed: fatal: branch exists')
    });
    expect(io.writes).toEqual([]);
  });

  it('when a branch and ttl are supplied, should use them instead of the defaults', () => {
    // given:
    const io = memoryFs();
    const git = recordingRunGit();
    // when:
    const result = runSpawn(
      { ...SCOPE, rid: 'req-001', role: 'qa', purpose: 'reason', branch: 'custom', ttlMs: 1_000 },
      effectsOver(io, git.runGit)
    );
    // then:
    expect(git.calls[0]?.argv).toEqual(['worktree', 'add', WORKTREE, '-b', 'custom']);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.lease.branch).toBe('custom');
    expect(result.lease.expiresAt).toBe(NOW + 1_000);
  });
});

describe('runRenew', () => {
  it('when the lease is active, should extend its expiry and persist the result', () => {
    // given:
    const io = memoryFs({ [LEASE_FILE]: serializeLease(lease()) });
    // when:
    const result = runRenew({ ...SCOPE, leaseId: LEASE_ID }, effectsOver(io));
    // then:
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.lease.expiresAt).toBe(NOW + THIRTY_MINUTES);
    expect(result.previous.expiresAt).toBe(NOW + 60_000);
    expect(io.writes).toEqual([LEASE_FILE]);
  });

  it('when the lease is released, should refuse to renew and write nothing', () => {
    // given:
    const io = memoryFs({ [LEASE_FILE]: serializeLease(lease({ status: 'released' })) });
    // when:
    const result = runRenew({ ...SCOPE, leaseId: LEASE_ID }, effectsOver(io));
    // then:
    expect(result.kind).toBe('not-renewable');
    expect(io.writes).toEqual([]);
  });

  it('when the ttl is not positive, should refuse and write nothing', () => {
    // given:
    const io = memoryFs({ [LEASE_FILE]: serializeLease(lease()) });
    // when:
    const result = runRenew({ ...SCOPE, leaseId: LEASE_ID, ttlMs: 0 }, effectsOver(io));
    // then:
    expect(result.kind).toBe('invalid-ttl');
    expect(io.writes).toEqual([]);
  });

  it('when the lease file is missing or malformed, should report it instead of throwing', () => {
    // given:
    const missing = memoryFs();
    const malformed = memoryFs({ [LEASE_FILE]: '{}' });
    // when:
    const missingResult = runRenew({ ...SCOPE, leaseId: LEASE_ID }, effectsOver(missing));
    const malformedResult = runRenew({ ...SCOPE, leaseId: LEASE_ID }, effectsOver(malformed));
    // then:
    expect(missingResult.kind).toBe('lease-not-found');
    expect(malformedResult).toEqual({
      kind: 'lease-invalid',
      file: LEASE_FILE,
      error: 'leaseId missing'
    });
    expect([...missing.writes, ...malformed.writes]).toEqual([]);
  });
});
