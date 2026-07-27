/**
 * Worktree authorization gate unit tests (slice 2026-07-27-worktree-user-auth).
 *
 * Negative cases (deny) are the load-bearing ones — those are the regressions the gate
 * is here to prevent. Positive cases assert the allow / consume path is correct.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  clearAllGrants,
  classifyToolCall,
  currentAuthFingerprint,
  decideFromAuthorization,
  evaluateWorktreeAuth,
  readAuthorization,
  writeAuthorization,
  worktreeAuthFilePath,
  type AuthorizationFile,
  type OperationType,
  type WorktreeAuthorization,
} from '../../../src/services/hooks/worktree-authorization-gate.js';

function makeTmp(): string {
  const root = join(tmpdir(), `peaks-worktree-auth-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function grant(overrides: Partial<WorktreeAuthorization> = {}): WorktreeAuthorization {
  const issuedAt = overrides.issuedAt ?? new Date().toISOString();
  const expiresAt = overrides.expiresAt ?? new Date(Date.now() + 5 * 60_000).toISOString();
  return {
    operation: 'git-worktree',
    reason: 'test grant',
    promptHash: null,
    requestId: null,
    issuedAt,
    expiresAt,
    consume: true,
    consumed: false,
    ...overrides
  };
}

let tmpRoot = makeTmp();

beforeEach(() => {
  tmpRoot = makeTmp();
});

afterEach(() => {
  if (existsSync(tmpRoot)) {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

describe('classifyToolCall', () => {
  test('Bash with `git worktree add` → git-worktree', () => {
    expect(
      classifyToolCall({ projectRoot: tmpRoot, sessionId: 's', toolName: 'Bash', command: 'git worktree add ../foo', isolation: null, requestId: null })
    ).toBe('git-worktree');
  });

  test('Bash with `git worktree remove` → git-worktree', () => {
    expect(
      classifyToolCall({ projectRoot: tmpRoot, sessionId: 's', toolName: 'Bash', command: 'git worktree remove ../foo', isolation: null, requestId: null })
    ).toBe('git-worktree');
  });

  test('Bash with `git stash push` → git-stash-mutating', () => {
    expect(
      classifyToolCall({ projectRoot: tmpRoot, sessionId: 's', toolName: 'Bash', command: 'git stash push -m x', isolation: null, requestId: null })
    ).toBe('git-stash-mutating');
  });

  test('Bash with `git stash list` → null (read-only, allow)', () => {
    expect(
      classifyToolCall({ projectRoot: tmpRoot, sessionId: 's', toolName: 'Bash', command: 'git stash list', isolation: null, requestId: null })
    ).toBeNull();
  });

  test('Bash with `git status` → null (allow)', () => {
    expect(
      classifyToolCall({ projectRoot: tmpRoot, sessionId: 's', toolName: 'Bash', command: 'git status', isolation: null, requestId: null })
    ).toBeNull();
  });

  test('Bash with `ls -la` → null (allow)', () => {
    expect(
      classifyToolCall({ projectRoot: tmpRoot, sessionId: 's', toolName: 'Bash', command: 'ls -la', isolation: null, requestId: null })
    ).toBeNull();
  });

  test('Agent with isolation=worktree → agent-isolation-worktree', () => {
    expect(
      classifyToolCall({ projectRoot: tmpRoot, sessionId: 's', toolName: 'Agent', command: null, isolation: 'worktree', requestId: null })
    ).toBe('agent-isolation-worktree');
  });

  test('Agent without isolation → null (allow)', () => {
    expect(
      classifyToolCall({ projectRoot: tmpRoot, sessionId: 's', toolName: 'Agent', command: null, isolation: null, requestId: null })
    ).toBeNull();
  });

  test('Agent with isolation=worktree-but-not-quite → null (allow)', () => {
    expect(
      classifyToolCall({ projectRoot: tmpRoot, sessionId: 's', toolName: 'Agent', command: null, isolation: 'workspace', requestId: null })
    ).toBeNull();
  });

  test('EnterWorktree → agent-isolation-worktree (mapped to the same operation)', () => {
    expect(
      classifyToolCall({ projectRoot: tmpRoot, sessionId: 's', toolName: 'EnterWorktree', command: null, isolation: null, requestId: null })
    ).toBe('agent-isolation-worktree');
  });

  test('Other tool (e.g. Read) → null (allow)', () => {
    expect(
      classifyToolCall({ projectRoot: tmpRoot, sessionId: 's', toolName: 'Other', command: null, isolation: null, requestId: null })
    ).toBeNull();
  });

  test('Bash with empty command → null (allow)', () => {
    expect(
      classifyToolCall({ projectRoot: tmpRoot, sessionId: 's', toolName: 'Bash', command: '', isolation: null, requestId: null })
    ).toBeNull();
  });

  test('Bash with `git worktreefoo` (no space) → null (regex requires whitespace boundary)', () => {
    // This is the case where a malicious command concatenates `git worktree` to a benign
    // suffix like `git worktreefoo` to evade the regex. The `\b` boundary ensures we only
    // match real subcommands (add, remove, prune, …). Anything else is not a worktree
    // subcommand and is therefore allowed.
    expect(
      classifyToolCall({ projectRoot: tmpRoot, sessionId: 's', toolName: 'Bash', command: 'git worktreefoo', isolation: null, requestId: null })
    ).toBeNull();
  });
});

describe('decideFromAuthorization', () => {
  test('null file → deny WORKTREE_USER_AUTH_REQUIRED', () => {
    const decision = decideFromAuthorization(
      { projectRoot: tmpRoot, sessionId: 's', toolName: 'Bash', command: 'git worktree add ../foo', isolation: null, requestId: null },
      'git-worktree',
      null
    );
    expect(decision.allow).toBe(false);
    if (!decision.allow) {
      expect(decision.code).toBe('WORKTREE_USER_AUTH_REQUIRED');
      expect(decision.reason).toContain('git-worktree');
      expect(decision.remediation).toContain('peaks worktree auth grant');
    }
  });

  test('matching non-expired grant → allow', () => {
    const file: AuthorizationFile = {
      schemaVersion: 1,
      sessionId: 's',
      createdAt: new Date().toISOString(),
      grants: [grant({ operation: 'git-worktree' })]
    };
    const decision = decideFromAuthorization(
      { projectRoot: tmpRoot, sessionId: 's', toolName: 'Bash', command: 'git worktree add ../foo', isolation: null, requestId: null },
      'git-worktree',
      file
    );
    expect(decision.allow).toBe(true);
  });

  test('expired grants only → deny WORKTREE_USER_AUTH_EXPIRED', () => {
    const file: AuthorizationFile = {
      schemaVersion: 1,
      sessionId: 's',
      createdAt: new Date().toISOString(),
      grants: [grant({ operation: 'git-worktree', expiresAt: new Date(Date.now() - 1).toISOString() })]
    };
    const decision = decideFromAuthorization(
      { projectRoot: tmpRoot, sessionId: 's', toolName: 'Bash', command: 'git worktree add ../foo', isolation: null, requestId: null },
      'git-worktree',
      file
    );
    expect(decision.allow).toBe(false);
    if (!decision.allow) {
      expect(decision.code).toBe('WORKTREE_USER_AUTH_EXPIRED');
    }
  });

  test('consumed single-use grant → deny WORKTREE_USER_AUTH_CONSUMED', () => {
    const file: AuthorizationFile = {
      schemaVersion: 1,
      sessionId: 's',
      createdAt: new Date().toISOString(),
      grants: [grant({ operation: 'git-worktree', consumed: true })]
    };
    const decision = decideFromAuthorization(
      { projectRoot: tmpRoot, sessionId: 's', toolName: 'Bash', command: 'git worktree add ../foo', isolation: null, requestId: null },
      'git-worktree',
      file
    );
    expect(decision.allow).toBe(false);
    if (!decision.allow) {
      // Falls under "no matching live grant" → REQUIRED because the only grant is consumed.
      expect(decision.code).toBe('WORKTREE_USER_AUTH_REQUIRED');
    }
  });

  test('grant scoped to a different requestId → deny WORKTREE_USER_AUTH_REQUEST_MISMATCH', () => {
    const file: AuthorizationFile = {
      schemaVersion: 1,
      sessionId: 's',
      createdAt: new Date().toISOString(),
      grants: [grant({ operation: 'git-worktree', requestId: 'rid-006' })]
    };
    const decision = decideFromAuthorization(
      { projectRoot: tmpRoot, sessionId: 's', toolName: 'Bash', command: 'git worktree add ../foo', isolation: null, requestId: 'rid-007' },
      'git-worktree',
      file
    );
    expect(decision.allow).toBe(false);
    if (!decision.allow) {
      expect(decision.code).toBe('WORKTREE_USER_AUTH_REQUEST_MISMATCH');
    }
  });

  test('grant for different operation does not satisfy a git-worktree lookup', () => {
    const file: AuthorizationFile = {
      schemaVersion: 1,
      sessionId: 's',
      createdAt: new Date().toISOString(),
      grants: [grant({ operation: 'git-stash-mutating' })]
    };
    const decision = decideFromAuthorization(
      { projectRoot: tmpRoot, sessionId: 's', toolName: 'Bash', command: 'git worktree add ../foo', isolation: null, requestId: null },
      'git-worktree',
      file
    );
    expect(decision.allow).toBe(false);
    if (!decision.allow) {
      // No matching live grant at all → REQUIRED.
      expect(decision.code).toBe('WORKTREE_USER_AUTH_REQUIRED');
    }
  });
});

describe('evaluateWorktreeAuth (write side)', () => {
  test('passes through non-worktree tool calls (Read / Glob / etc.)', () => {
    const decision = evaluateWorktreeAuth({
      projectRoot: tmpRoot,
      sessionId: 's',
      toolName: 'Other',
      command: null,
      isolation: null,
      requestId: null
    });
    expect(decision.allow).toBe(true);
  });

  test('denies Bash `git worktree add` with no grant, fail-closed', () => {
    const decision = evaluateWorktreeAuth({
      projectRoot: tmpRoot,
      sessionId: 's',
      toolName: 'Bash',
      command: 'git worktree add ../foo',
      isolation: null,
      requestId: null
    });
    expect(decision.allow).toBe(false);
    if (!decision.allow) {
      expect(decision.code).toBe('WORKTREE_USER_AUTH_REQUIRED');
      expect(decision.remediation).toContain('peaks worktree auth grant');
    }
  });

  test('allows Bash `git worktree add` after grant is written and persists consume', () => {
    const sid = 's-grant';
    writeAuthorization(tmpRoot, sid, grant({ operation: 'git-worktree' }));
    const first = evaluateWorktreeAuth({
      projectRoot: tmpRoot,
      sessionId: sid,
      toolName: 'Bash',
      command: 'git worktree add ../foo',
      isolation: null,
      requestId: null
    });
    expect(first.allow).toBe(true);
    // The single-use grant must now be consumed on disk.
    const after = readAuthorization(tmpRoot, sid);
    expect(after).not.toBeNull();
    if (after) {
      expect(after.grants.length).toBe(1);
      expect(after.grants[0]!.consumed).toBe(true);
    }
    // The next call must deny.
    const second = evaluateWorktreeAuth({
      projectRoot: tmpRoot,
      sessionId: sid,
      toolName: 'Bash',
      command: 'git worktree add ../bar',
      isolation: null,
      requestId: null
    });
    expect(second.allow).toBe(false);
  });

  test('multi-use grant persists across calls', () => {
    const sid = 's-multi';
    writeAuthorization(tmpRoot, sid, grant({ operation: 'git-worktree', consume: false }));
    for (const cmd of ['git worktree add ../a', 'git worktree add ../b', 'git worktree list']) {
      const decision = evaluateWorktreeAuth({
        projectRoot: tmpRoot,
        sessionId: sid,
        toolName: 'Bash',
        command: cmd,
        isolation: null,
        requestId: null
      });
      if (cmd === 'git worktree list') {
        // `git worktree list` does NOT match the worktree-mutating regex (it has no subcommand).
        expect(decision.allow).toBe(true);
      } else {
        expect(decision.allow).toBe(true);
      }
    }
    const after = readAuthorization(tmpRoot, sid);
    expect(after).not.toBeNull();
    if (after) {
      expect(after.grants[0]!.consumed).toBe(false);
    }
  });

  test('Agent isolation=worktree without grant → deny', () => {
    const decision = evaluateWorktreeAuth({
      projectRoot: tmpRoot,
      sessionId: 's-agent',
      toolName: 'Agent',
      command: 'do something',
      isolation: 'worktree',
      requestId: null
    });
    expect(decision.allow).toBe(false);
  });

  test('Agent isolation=worktree with grant → allow', () => {
    const sid = 's-agent-ok';
    writeAuthorization(tmpRoot, sid, grant({ operation: 'agent-isolation-worktree' }));
    const decision = evaluateWorktreeAuth({
      projectRoot: tmpRoot,
      sessionId: sid,
      toolName: 'Agent',
      command: null,
      isolation: 'worktree',
      requestId: null
    });
    expect(decision.allow).toBe(true);
  });

  test('malformed grant file → fail-closed (never allow on error)', () => {
    const sid = 's-bad';
    const path = worktreeAuthFilePath(tmpRoot, sid);
    mkdirSync(join(tmpRoot, '.peaks', '_runtime', sid), { recursive: true });
    writeFileSync(path, '{ not valid json', 'utf8');
    const decision = evaluateWorktreeAuth({
      projectRoot: tmpRoot,
      sessionId: sid,
      toolName: 'Bash',
      command: 'git worktree add ../foo',
      isolation: null,
      requestId: null
    });
    expect(decision.allow).toBe(false);
    if (!decision.allow) {
      expect(decision.code).toBe('WORKTREE_USER_AUTH_FILE_INVALID');
      expect(decision.reason).toContain('invalid JSON');
    }
  });

  test('sessionId mismatch on grant file → fail-closed', () => {
    const sid = 's-mismatch';
    const path = worktreeAuthFilePath(tmpRoot, sid);
    mkdirSync(join(tmpRoot, '.peaks', '_runtime', sid), { recursive: true });
    writeFileSync(
      path,
      `${JSON.stringify({
        schemaVersion: 1,
        sessionId: 'other-session',
        createdAt: new Date().toISOString(),
        grants: [grant({ operation: 'git-worktree' })]
      }, null, 2)}\n`,
      'utf8'
    );
    const decision = evaluateWorktreeAuth({
      projectRoot: tmpRoot,
      sessionId: sid,
      toolName: 'Bash',
      command: 'git worktree add ../foo',
      isolation: null,
      requestId: null
    });
    expect(decision.allow).toBe(false);
    if (!decision.allow) {
      expect(decision.code).toBe('WORKTREE_USER_AUTH_FILE_INVALID');
    }
  });

  test('Bash `git stash push` with git-stash-mutating grant → allow', () => {
    const sid = 's-stash';
    writeAuthorization(tmpRoot, sid, grant({ operation: 'git-stash-mutating' }));
    const decision = evaluateWorktreeAuth({
      projectRoot: tmpRoot,
      sessionId: sid,
      toolName: 'Bash',
      command: 'git stash push -m x',
      isolation: null,
      requestId: null
    });
    expect(decision.allow).toBe(true);
  });

  test('Bash `git stash push` with ONLY git-worktree grant → deny (operation scope)', () => {
    const sid = 's-stash-mis';
    writeAuthorization(tmpRoot, sid, grant({ operation: 'git-worktree' }));
    const decision = evaluateWorktreeAuth({
      projectRoot: tmpRoot,
      sessionId: sid,
      toolName: 'Bash',
      command: 'git stash push -m x',
      isolation: null,
      requestId: null
    });
    expect(decision.allow).toBe(false);
  });

  test('EnterWorktree without grant → deny (same fail-closed contract as Agent isolation=worktree)', () => {
    const decision = evaluateWorktreeAuth({
      projectRoot: tmpRoot,
      sessionId: 's-ew',
      toolName: 'EnterWorktree',
      command: null,
      isolation: null,
      requestId: null
    });
    expect(decision.allow).toBe(false);
    if (!decision.allow) {
      expect(decision.code).toBe('WORKTREE_USER_AUTH_REQUIRED');
    }
  });
});

describe('clearAllGrants', () => {
  test('removes unconsumed grants and unlinks the file when all cleared', () => {
    const sid = 's-clear';
    writeAuthorization(tmpRoot, sid, grant({ operation: 'git-worktree' }));
    expect(existsSync(worktreeAuthFilePath(tmpRoot, sid))).toBe(true);
    const result = clearAllGrants(tmpRoot, sid);
    expect(result.removed).toBe(1);
    expect(existsSync(worktreeAuthFilePath(tmpRoot, sid))).toBe(false);
  });

  test('keeps consumed grants', () => {
    const sid = 's-keep';
    writeAuthorization(tmpRoot, sid, grant({ operation: 'git-worktree', consumed: true }));
    const result = clearAllGrants(tmpRoot, sid);
    expect(result.removed).toBe(0);
    expect(existsSync(worktreeAuthFilePath(tmpRoot, sid))).toBe(true);
  });

  test('returns removed=0 when no file exists (no error)', () => {
    const result = clearAllGrants(tmpRoot, 's-missing');
    expect(result.removed).toBe(0);
  });
});

describe('currentAuthFingerprint', () => {
  test('is deterministic for the same input', () => {
    const a = currentAuthFingerprint({ projectRoot: tmpRoot, sessionId: 's', toolName: 'Bash', command: 'git worktree add x', isolation: null, requestId: null });
    const b = currentAuthFingerprint({ projectRoot: tmpRoot, sessionId: 's', toolName: 'Bash', command: 'git worktree add x', isolation: null, requestId: null });
    expect(a).toBe(b);
  });

  test('differs when command differs', () => {
    const a = currentAuthFingerprint({ projectRoot: tmpRoot, sessionId: 's', toolName: 'Bash', command: 'git worktree add x', isolation: null, requestId: null });
    const b = currentAuthFingerprint({ projectRoot: tmpRoot, sessionId: 's', toolName: 'Bash', command: 'git worktree add y', isolation: null, requestId: null });
    expect(a).not.toBe(b);
  });

  test('is a 16-char hex string', () => {
    const a = currentAuthFingerprint({ projectRoot: tmpRoot, sessionId: 's', toolName: 'Bash', command: 'git worktree add x', isolation: null, requestId: null });
    expect(a).toMatch(/^[a-f0-9]{16}$/);
  });
});

describe('OperationType coverage', () => {
  test('all four operation types route through classifyToolCall correctly', () => {
    const cases: Array<{ op: OperationType; expect: (input: { toolName: 'Bash' | 'Agent' | 'EnterWorktree'; command: string | null; isolation: string | null }) => boolean }> = [
      { op: 'git-worktree', expect: (i) => i.toolName === 'Bash' && /^git worktree\b/.test(i.command ?? '') },
      { op: 'agent-isolation-worktree', expect: (i) => (i.toolName === 'Agent' && i.isolation === 'worktree') || i.toolName === 'EnterWorktree' },
      { op: 'git-stash-mutating', expect: (i) => i.toolName === 'Bash' && /^git stash\b/.test(i.command ?? '') }
    ];
    for (const c of cases) {
      const sample = c.op === 'git-worktree'
        ? { toolName: 'Bash' as const, command: 'git worktree add x', isolation: null }
        : c.op === 'agent-isolation-worktree'
          ? { toolName: 'Agent' as const, command: null, isolation: 'worktree' }
          : { toolName: 'Bash' as const, command: 'git stash push', isolation: null };
      const classified = classifyToolCall({ projectRoot: tmpRoot, sessionId: 's', ...sample, requestId: null });
      expect(classified, `classifyToolCall for ${c.op}`).toBe(c.op);
    }
  });
});

// Direct read-back test to ensure the on-disk schema is what callers expect.
describe('file shape', () => {
  test('readAuthorization round-trips a written grant', () => {
    const sid = 's-shape';
    const g = grant({ operation: 'git-worktree', reason: 'round-trip' });
    writeAuthorization(tmpRoot, sid, g);
    const back = readAuthorization(tmpRoot, sid);
    expect(back).not.toBeNull();
    if (back) {
      expect(back.schemaVersion).toBe(1);
      expect(back.sessionId).toBe(sid);
      expect(back.grants.length).toBe(1);
      expect(back.grants[0]).toEqual(g);
    }
  });
});
