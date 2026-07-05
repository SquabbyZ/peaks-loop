import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { existsSync, mkdtempSync, openSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { readFileSync as readFile } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readBinding,
  writeBinding,
  rebuildBindingFromLegacy,
  type Binding
} from '../../../../src/services/session/binding-store.js';

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'peaks-binding-rebuild-'));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

/**
 * v2.18.2 PATCH — `rebuildBindingFromLegacy` unit tests
 * (follow-up issue #1: legacy v2.16.0 / v2.17.0 callerId migration).
 *
 * The function rewrites the on-disk binding in place so every
 * pre-v2.18.0 callerId (raw env signal, no `#${pid}` suffix) gets
 * the canonical pid suffix. Existing v2.18.0+ bindings are preserved
 * unchanged; concurrent invocations are guarded by a file lock.
 */
describe('rebuildBindingFromLegacy — v2.18.2 PATCH (issue #1)', () => {
  test('rewrites v2.16.0-shape binding (callerId without #pid) with the suffix', () => {
    const binding: Binding = {
      ownerHint: 'shared-env',
      pid: 4242,
      lastHeartbeat: new Date().toISOString(),
      scope: projectRoot,
      instances: {
        '2026-06-29-session-aaaaaa': {
          startedAt: new Date().toISOString(),
          roles: ['peaks-code'],
          callerId: 'shared-env',
          lastHeartbeat: new Date().toISOString()
        }
      }
    };
    writeBinding(projectRoot, binding);

    const result = rebuildBindingFromLegacy(projectRoot);
    expect(result.rewritten).toBe(1);
    expect(result.preserved).toBe(0);
    expect(result.errors).toEqual([]);

    const after = readBinding(projectRoot);
    expect(after).not.toBeNull();
    const inst = after!.instances['2026-06-29-session-aaaaaa'];
    expect(inst?.callerId).toBe('shared-env#4242');
    // ownerHint is also normalized to the v2.18.0+ shape.
    expect(after!.ownerHint).toBe('shared-env#4242');
  });

  test('preserves v2.18.0+ binding (callerId with #pid) — no double-suffix', () => {
    const binding: Binding = {
      ownerHint: 'shared-env#100',
      pid: 100,
      lastHeartbeat: new Date().toISOString(),
      scope: projectRoot,
      instances: {
        '2026-06-29-session-bbbbbb': {
          startedAt: new Date().toISOString(),
          roles: ['peaks-rd'],
          callerId: 'shared-env#100',
          lastHeartbeat: new Date().toISOString()
        }
      }
    };
    writeBinding(projectRoot, binding);

    const result = rebuildBindingFromLegacy(projectRoot);
    expect(result.rewritten).toBe(0);
    expect(result.preserved).toBe(1);
    expect(result.noop).toBe(true);

    const after = readBinding(projectRoot);
    expect(after!.instances['2026-06-29-session-bbbbbb']?.callerId).toBe('shared-env#100');
  });

  test('missing binding file returns graceful noop', () => {
    const result = rebuildBindingFromLegacy(projectRoot);
    expect(result).toEqual({ rewritten: 0, preserved: 0, errors: [], noop: true });
  });

  test('skips and reports callerId="unknown" (CI fallback, no pid source)', () => {
    const binding: Binding = {
      ownerHint: 'unknown',
      pid: 7777,
      lastHeartbeat: new Date().toISOString(),
      scope: projectRoot,
      instances: {
        '2026-06-29-session-cccccc': {
          startedAt: new Date().toISOString(),
          roles: [],
          callerId: 'unknown',
          lastHeartbeat: new Date().toISOString()
        }
      }
    };
    writeBinding(projectRoot, binding);

    const result = rebuildBindingFromLegacy(projectRoot);
    // 'unknown' is NOT rewritten (it has no identity to preserve),
    // so rewritten is 0 and the instance stays as-is.
    expect(result.rewritten).toBe(0);
    expect(result.preserved).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/unknown.*no pid suffix/);
    // The 'unknown' callerId is NOT corrupted with `#${pid}`.
    const after = readBinding(projectRoot);
    expect(after!.instances['2026-06-29-session-cccccc']?.callerId).toBe('unknown');
  });

  test('mixed binding: some legacy, some v2.18.0+ — only legacy is rewritten', () => {
    const binding: Binding = {
      ownerHint: 'shared-env',
      pid: 9000,
      lastHeartbeat: new Date().toISOString(),
      scope: projectRoot,
      instances: {
        '2026-06-29-session-aaaaaa': {
          startedAt: new Date().toISOString(),
          roles: ['peaks-code'],
          callerId: 'shared-env',
          lastHeartbeat: new Date().toISOString()
        },
        '2026-06-29-session-bbbbbb': {
          startedAt: new Date().toISOString(),
          roles: ['peaks-rd'],
          callerId: 'shared-env#100',
          lastHeartbeat: new Date().toISOString()
        }
      }
    };
    writeBinding(projectRoot, binding);

    const result = rebuildBindingFromLegacy(projectRoot);
    expect(result.rewritten).toBe(1);
    expect(result.preserved).toBe(1);

    const after = readBinding(projectRoot);
    expect(after!.instances['2026-06-29-session-aaaaaa']?.callerId).toBe('shared-env#9000');
    expect(after!.instances['2026-06-29-session-bbbbbb']?.callerId).toBe('shared-env#100');
  });

  test('concurrent invocation guard: holding the lock returns a noop with error', () => {
    const binding: Binding = {
      ownerHint: 'shared-env',
      pid: 5555,
      lastHeartbeat: new Date().toISOString(),
      scope: projectRoot,
      instances: {
        '2026-06-29-session-dddddd': {
          startedAt: new Date().toISOString(),
          roles: ['peaks-code'],
          callerId: 'shared-env',
          lastHeartbeat: new Date().toISOString()
        }
      }
    };
    writeBinding(projectRoot, binding);

    // Hold the rebuild lock manually to simulate a concurrent
    // invocation. The second rebuild call must return a noop with an
    // explanatory error.
    const lockPath = join(projectRoot, '.peaks', '_runtime', '.rebuild-binding.lock');
    mkdirSync(join(projectRoot, '.peaks', '_runtime'), { recursive: true });
    openSync(lockPath, 'w');
    expect(existsSync(lockPath)).toBe(true);

    const result = rebuildBindingFromLegacy(projectRoot);
    expect(result.rewritten).toBe(0);
    expect(result.noop).toBe(true);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/lock held/);
  });

  test('idempotency: re-running on an already-rebuilt file is a noop', () => {
    const binding: Binding = {
      ownerHint: 'shared-env',
      pid: 2000,
      lastHeartbeat: new Date().toISOString(),
      scope: projectRoot,
      instances: {
        '2026-06-29-session-eeeeee': {
          startedAt: new Date().toISOString(),
          roles: ['peaks-code'],
          callerId: 'shared-env',
          lastHeartbeat: new Date().toISOString()
        }
      }
    };
    writeBinding(projectRoot, binding);

    const first = rebuildBindingFromLegacy(projectRoot);
    expect(first.rewritten).toBe(1);
    expect(first.noop).toBe(false);

    // Second pass: every callerId is already in v2.18.0+ shape, so
    // rebuilt is 0 and the noop flag is set.
    const second = rebuildBindingFromLegacy(projectRoot);
    expect(second.rewritten).toBe(0);
    expect(second.preserved).toBe(1);
    expect(second.noop).toBe(true);

    const after = readBinding(projectRoot);
    expect(after!.instances['2026-06-29-session-eeeeee']?.callerId).toBe('shared-env#2000');
  });

  test('writes a tmp file and renames atomically (no torn write)', () => {
    const binding: Binding = {
      ownerHint: 'shared-env',
      pid: 3000,
      lastHeartbeat: new Date().toISOString(),
      scope: projectRoot,
      instances: {
        '2026-06-29-session-ffffff': {
          startedAt: new Date().toISOString(),
          roles: ['peaks-code'],
          callerId: 'shared-env',
          lastHeartbeat: new Date().toISOString()
        }
      }
    };
    writeBinding(projectRoot, binding);

    rebuildBindingFromLegacy(projectRoot);

    // The canonical binding file exists, and the on-disk shape is
    // the rewritten v2.18.0+ form.
    const canonical = join(projectRoot, '.peaks', '_runtime', 'session.json');
    expect(existsSync(canonical)).toBe(true);
    const body = JSON.parse(readFile(canonical, 'utf8'));
    expect(body.instances['2026-06-29-session-ffffff'].callerId).toBe('shared-env#3000');
    // No leftover .tmp file (rename is synchronous in Node, so the
    // tmp file MUST be gone after a successful rebuild).
    const tmpFiles = readdirSync(join(projectRoot, '.peaks', '_runtime'))
      .filter((n: string) => n.startsWith('session.json.tmp.'));
    expect(tmpFiles).toEqual([]);
  });
});
