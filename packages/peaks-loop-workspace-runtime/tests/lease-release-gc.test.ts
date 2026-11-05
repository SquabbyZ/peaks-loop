import { describe, expect, it } from 'vitest';

import { runGc, runRelease } from '../src/lease/lifecycle.js';
import { serializeLease } from '../src/lease/store.js';
import {
  LEASE_FILE,
  LEASE_ID,
  NOW,
  OTHER_FILE,
  OTHER_ID,
  OTHER_WORKTREE,
  PROJECT_ROOT,
  SCOPE,
  WORKTREE,
  effectsOver,
  lease,
  memoryFs,
  recordingRunGit
} from './_lifecycle-harness.js';

describe('runRelease', () => {
  it('when the lease is active, should remove the worktree and mark it released', () => {
    // given:
    const io = memoryFs({ [LEASE_FILE]: serializeLease(lease()) });
    const git = recordingRunGit();
    // when:
    const result = runRelease({ ...SCOPE, leaseId: LEASE_ID }, effectsOver(io, git.runGit));
    // then:
    expect(git.calls).toEqual([
      { argv: ['worktree', 'remove', '--force', WORKTREE], cwd: PROJECT_ROOT }
    ]);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.lease.status).toBe('released');
    expect(io.files.get(LEASE_FILE)).toBe(serializeLease(result.lease));
  });

  it('when the lease is already released, should report it without a git call or a write', () => {
    // given:
    const io = memoryFs({ [LEASE_FILE]: serializeLease(lease({ status: 'released' })) });
    const git = recordingRunGit();
    // when:
    const result = runRelease({ ...SCOPE, leaseId: LEASE_ID }, effectsOver(io, git.runGit));
    // then:
    expect(result.kind).toBe('already-released');
    expect(git.calls).toEqual([]);
    expect(io.writes).toEqual([]);
  });

  it('when git removal fails, should still mark the lease released and report the failure', () => {
    // given:
    const io = memoryFs({ [LEASE_FILE]: serializeLease(lease()) });
    const git = recordingRunGit({ ok: false, stdout: '', stderr: 'fatal: not a worktree' });
    // when:
    const result = runRelease({ ...SCOPE, leaseId: LEASE_ID }, effectsOver(io, git.runGit));
    // then:
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.gitWorktreeRemoveFailed).toBe(true);
    expect(result.lease.status).toBe('released');
  });
});

describe('runGc', () => {
  it('when the lease store is missing, should report it and touch nothing', () => {
    // given:
    const io = memoryFs();
    const git = recordingRunGit();
    // when:
    const result = runGc({ ...SCOPE }, effectsOver(io, git.runGit));
    // then:
    expect(result.kind).toBe('store-missing');
    expect(git.calls).toEqual([]);
    expect(io.writes).toEqual([]);
  });

  it('when only one lease id is named, should sweep that released lease alone', () => {
    // given:
    const io = memoryFs({
      [LEASE_FILE]: serializeLease(lease({ status: 'released' })),
      [OTHER_FILE]: serializeLease(
        lease({ leaseId: OTHER_ID, path: OTHER_WORKTREE, status: 'released' })
      )
    });
    const git = recordingRunGit();
    // when:
    const result = runGc({ ...SCOPE, leaseId: LEASE_ID }, effectsOver(io, git.runGit));
    // then:
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.swept.map((entry) => entry.leaseId)).toEqual([LEASE_ID]);
    expect(git.calls).toEqual([
      { argv: ['worktree', 'remove', '--force', WORKTREE], cwd: PROJECT_ROOT },
      { argv: ['worktree', 'prune'], cwd: PROJECT_ROOT }
    ]);
    expect(io.files.get(LEASE_FILE)).toBe(serializeLease(lease({ status: 'gc' })));
  });

  it('when a lease is active but expired, should mark it expired then gc', () => {
    // given:
    const io = memoryFs({ [LEASE_FILE]: serializeLease(lease({ expiresAt: NOW })) });
    // when:
    const result = runGc({ ...SCOPE }, effectsOver(io));
    // then:
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.swept[0]?.previousStatus).toBe('active');
    expect(io.files.get(LEASE_FILE)).toBe(serializeLease(lease({ status: 'gc', expiresAt: NOW })));
  });

  it('when dry-run is set, should report the sweep and mutate nothing', () => {
    // given:
    const io = memoryFs({ [LEASE_FILE]: serializeLease(lease({ status: 'released' })) });
    const git = recordingRunGit();
    // when:
    const result = runGc({ ...SCOPE, dryRun: true }, effectsOver(io, git.runGit));
    // then:
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.candidates).toBe(1);
    expect(result.swept).toHaveLength(1);
    expect(git.calls).toEqual([]);
    expect(io.writes).toEqual([]);
  });

  it('when a lease file is malformed, should surface the error alongside the sweep', () => {
    // given:
    const io = memoryFs({
      [LEASE_FILE]: serializeLease(lease({ status: 'released' })),
      [OTHER_FILE]: '{}'
    });
    // when:
    const result = runGc({ ...SCOPE }, effectsOver(io));
    // then:
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.swept.map((entry) => entry.leaseId)).toEqual([LEASE_ID]);
    expect(result.errors).toEqual([{ file: OTHER_FILE, error: 'leaseId missing' }]);
  });
});
