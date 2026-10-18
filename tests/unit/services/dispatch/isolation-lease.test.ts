// tests/unit/services/dispatch/isolation-lease.test.ts
//
// Unit tests for the isolation-lease spawners in
// src/services/dispatch/isolation-lease.ts. The child-process seam is
// injected, so no real CLI or docker runs here: the fake child emits the
// same stdout/stderr/close sequence Node emits.
//
// Dimensions covered:
//   - behavior:    envelope parsing, leaseId resolution, nonzero exit and
//                  unparseable stdout reject instead of succeeding empty
//   - integration: the child-process boundary — `unref()` must not run
//                  before `close`, or the parent event loop empties before
//                  the buffered stdout drains (backlog §11.4)
//   - a11y:        the rejection message carries the exit code and stderr
//
// Omitted:
//   - render: no stdout/JSON surface; the envelope is parsed, not printed

import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  spawnContainerLease,
  spawnWorktreeLease
} from '~/src/services/dispatch/isolation-lease';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/dispatch/isolation-lease.test.ts',
  ['behavior', 'integration', 'a11y'],
  [{ dim: 'render', reason: 'no stdout/JSON surface; the envelope is parsed, not rendered' }]
);

interface FakeChildScript {
  stdout?: string;
  stderr?: string;
  code: number | null;
}

/**
 * A ChildProcess-shaped fake that emits data then close on the next
 * macrotask, and records whether the child was already closed at the
 * moment `unref()` was called.
 */
function fakeSpawn(script: FakeChildScript): {
  spawnImpl: (...args: unknown[]) => ChildProcess;
  unrefAfterClose: boolean[];
} {
  const unrefAfterClose: boolean[] = [];
  let closed = false;
  const spawnImpl = (): ChildProcess => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      unref: () => void;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.unref = () => {
      unrefAfterClose.push(closed);
    };
    setImmediate(() => {
      if (script.stdout) child.stdout.emit('data', Buffer.from(script.stdout));
      if (script.stderr) child.stderr.emit('data', Buffer.from(script.stderr));
      closed = true;
      child.emit('close', script.code);
    });
    return child as unknown as ChildProcess;
  };
  return { spawnImpl, unrefAfterClose };
}

const containerArgs = {
  projectRoot: '/repo',
  sessionId: 'sid-1',
  rid: 'rid-1',
  role: 'rd',
  purpose: 'test'
};

describe('(behavior) spawnContainerLease', () => {
  it('resolves the leaseId from a non-empty envelope', async () => {
    const envelope = JSON.stringify({ ok: true, data: { lease: { leaseId: 'lease-42' } } });
    const { spawnImpl } = fakeSpawn({ stdout: envelope, code: 0 });

    await expect(
      spawnContainerLease(containerArgs, spawnImpl as never)
    ).resolves.toEqual({ leaseId: 'lease-42' });
  });

  it('rejects a nonzero container spawn instead of succeeding empty', async () => {
    const { spawnImpl } = fakeSpawn({ stderr: 'cannot connect to daemon', code: 1 });

    await expect(spawnContainerLease(containerArgs, spawnImpl as never)).rejects.toThrow(
      /exited 1/
    );
  });

  it('rejects unparseable stdout instead of returning an empty envelope', async () => {
    const { spawnImpl } = fakeSpawn({ stdout: 'not json', code: 0 });

    await expect(spawnContainerLease(containerArgs, spawnImpl as never)).rejects.toThrow(
      /unparseable JSON/
    );
  });
});

describe('(integration) child-process boundary', () => {
  it('does not unref the container child before close', async () => {
    const envelope = JSON.stringify({ ok: true, data: { lease: { leaseId: 'lease-42' } } });
    const { spawnImpl, unrefAfterClose } = fakeSpawn({ stdout: envelope, code: 0 });

    await spawnContainerLease(containerArgs, spawnImpl as never);
    await new Promise((resolve) => setImmediate(resolve));

    expect(unrefAfterClose).toEqual([true]);
  });

  it('does not unref the worktree child before close', async () => {
    const envelope = JSON.stringify({
      ok: true,
      data: {
        lease: { leaseId: 'lease-7', path: '/repo/wt', branch: 'peaks/wt', expiresAt: 1 }
      }
    });
    const { spawnImpl, unrefAfterClose } = fakeSpawn({ stdout: envelope, code: 0 });

    await spawnWorktreeLease(containerArgs, spawnImpl as never);
    await new Promise((resolve) => setImmediate(resolve));

    expect(unrefAfterClose).toEqual([true]);
  });
});

describe('(a11y) rejection messages', () => {
  it('carries the exit code and the child stderr', async () => {
    const { spawnImpl } = fakeSpawn({ stderr: 'No such image: node:22-slim', code: 125 });

    await expect(spawnContainerLease(containerArgs, spawnImpl as never)).rejects.toThrow(
      /exited 125; stderr: No such image: node:22-slim/
    );
  });
});
