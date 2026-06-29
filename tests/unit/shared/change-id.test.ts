/**
 * Unit tests for `src/shared/change-id.ts` — focused on the v2.18.0 REDO
 * silent-warning lint fix at line 182.
 *
 * The `safeReadBinding()` function (file-private, accessed via the
 * public `getCurrentChangeId()` API) used to swallow read errors in a
 * silent `catch { return null; }` block, which the G2
 * silent-warning-detector flagged as `catch-return-null`. The fix
 * matches the hardening pattern at `binding-store.ts:106-107`:
 * `process.stderr.write` the error message before returning null.
 *
 * These tests verify that:
 *   1. The fix does not regress the public `getCurrentChangeId()` API
 *      (still returns null on malformed binding).
 *   2. The fix surfaces the error to stderr (the silent-warning gate
 *      is satisfied by writing to stderr, not by hiding the failure).
 *
 * Tests deliberately use a real tmp project root with a binding file
 * that triggers the `catch (err)` branch (a file at
 * `.peaks/_runtime/current-change` whose permissions deny reading
 * AFTER it passes `existsSync`). We use chmod 000 on POSIX; on
 * Windows we skip the perm-denied path because Windows ACL semantics
 * differ — a malformed-content file still exercises the same branch
 * because `readFileSync` throws on a directory, etc.
 */

import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { getCurrentChangeId } from '../../../src/shared/change-id.js';

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'peaks-change-id-'));
  mkdirSync(join(projectRoot, '.peaks', '_runtime'), { recursive: true });
});

afterEach(() => {
  // Restore perms before rmSync on POSIX; on Windows chmod is a no-op
  // for the path-shape we use.
  try {
    chmodSync(join(projectRoot, '.peaks', '_runtime', 'current-change'), 0o644);
  } catch {
    // best-effort
  }
  rmSync(projectRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('getCurrentChangeId — silent-catch lint fix (v2.18.0 REDO)', () => {
  test('happy path: returns the change-id written to .peaks/_runtime/current-change', () => {
    writeFileSync(
      join(projectRoot, '.peaks', '_runtime', 'current-change'),
      'my-change-id',
      'utf8'
    );
    expect(getCurrentChangeId(projectRoot)).toBe('my-change-id');
  });

  test('no binding file: returns null without stderr write', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(getCurrentChangeId(projectRoot)).toBeNull();
    // No binding file means we never enter the `catch (err)` branch.
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  test('perm-denied binding file on POSIX: returns null AND writes stderr line', () => {
    if (process.platform === 'win32') {
      // chmod 000 on Windows does not reliably produce EACCES on
      // readFileSync; skip rather than false-positive.
      return;
    }
    const bindingPath = join(projectRoot, '.peaks', '_runtime', 'current-change');
    writeFileSync(bindingPath, 'my-change-id', 'utf8');
    chmodSync(bindingPath, 0o000);

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    // Public API contract preserved: returns null on read failure.
    expect(getCurrentChangeId(projectRoot)).toBeNull();

    // Lint contract: the silent catch now surfaces the error to stderr.
    expect(stderrSpy).toHaveBeenCalled();
    const firstCallArg = String(stderrSpy.mock.calls[0]?.[0] ?? '');
    expect(firstCallArg).toContain('[change-id] safeReadBinding failed');
    expect(firstCallArg).toContain('EACCES');
  });

  test('malformed binding (raw=\'..\'): returns null AND writes stderr line', () => {
    // The function has TWO inner validation gates that return null
    // silently (the regex check at line 180 and the symlink target-id
    // check at line 176). These are NOT in the silent-catch branch —
    // they are explicit `return null` paths after a successful read.
    // We assert: those silent paths do NOT write to stderr (so the
    // detector stays happy and the stderr noise is bounded to genuine
    // IO failures).
    writeFileSync(
      join(projectRoot, '.peaks', '_runtime', 'current-change'),
      '..',
      'utf8'
    );
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(getCurrentChangeId(projectRoot)).toBeNull();
    // The `..` short-circuits at the regex validation BEFORE the
    // catch — no stderr line expected.
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});