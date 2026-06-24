/**
 * Unit tests for `src/services/workflow/plan-reader.ts` (slice 025).
 *
 * Covers:
 *   T-001 read security plan returns full envelope when plan exists
 *   T-002 read security plan returns exists:false when missing; no throw
 *   T-003 read perf plan returns same envelope shape
 *   T-004 back-compat: falls back to legacy `.peaks/_runtime/<planFile>` when
 *        PEAKS_PLAN_LEGACY_FALLBACK=1 and legacy path exists
 *   T-004b back-compat: when BACK_COMPAT_FLAG !== "1", legacy is not consumed
 *   F-1 regression: invalid sessionId returns ok:false / INVALID_SESSION_ID
 *   F-2 regression: symlink-escape at canonical path returns ok:false / SYMLINK_ESCAPE
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, realpathSync, symlinkSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { BACK_COMPAT_FLAG, hashNormalizedBody, normalizePlanBody, readPlan } from '../../../../src/services/workflow/plan-reader.js';

function makeRepo(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-plan-reader-'));
}

function makePlanFile(repo: string, sessionId: string, file: string, body: string): string {
  const qaDir = join(repo, '.peaks', '_runtime', sessionId, 'qa');
  mkdirSync(qaDir, { recursive: true });
  const path = join(qaDir, file);
  writeFileSync(path, body, 'utf8');
  // Pin mtime for deterministic refreshedAt.
  const t = new Date('2026-06-10T07:00:00Z');
  utimesSync(path, t, t);
  return path;
}

describe('plan-reader — normalizePlanBody + hashNormalizedBody', () => {
  it('sorts sections and collapses blank lines', () => {
    const body = ['## B', '', '  beta  ', '## A', 'alpha'].join('\n');
    const normalized = normalizePlanBody(body);
    expect(normalized).toBe(['## A', '## B', 'alpha', 'beta'].join('\n'));
  });
  it('hashNormalizedBody is sha256[0:12] of the normalized body', () => {
    const a = hashNormalizedBody(['## A', 'alpha', '## B', 'beta'].join('\n'));
    const b = hashNormalizedBody(['## B', '  beta  ', '## A', 'alpha'].join('\n'));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe('plan-reader — readPlan', () => {
  let repo: string;
  const sessionId = '2026-06-10-session-c4a2be';
  const originalFlag = process.env[BACK_COMPAT_FLAG];

  beforeEach(() => {
    repo = makeRepo();
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
    if (originalFlag === undefined) {
      delete process.env[BACK_COMPAT_FLAG];
    } else {
      process.env[BACK_COMPAT_FLAG] = originalFlag;
    }
  });

  it('T-001: read security plan returns full envelope when plan exists', () => {
    const body = ['# Security Test Plan', '## Threat Model', 'auth boundary', '## Test Matrix', 'per-slice scan'].join('\n');
    makePlanFile(repo, sessionId, 'security-test-plan.md', body);
    const result = readPlan({ type: 'security', project: repo, sessionId });
    expect(result.ok).toBe(true);
    expect(result.data.exists).toBe(true);
    expect(result.data.path).toBe(join(repo, '.peaks', '_runtime', sessionId, 'qa', 'security-test-plan.md'));
    expect(result.data.hash).toMatch(/^[0-9a-f]{12}$/);
    expect(result.data.refreshedAt).toBe('2026-06-10T07:00:00.000Z');
    expect(result.data.source).toBe('canonical');
  });

  it('T-002: read security plan returns exists:false when missing; no throw', () => {
    const result = readPlan({ type: 'security', project: repo, sessionId });
    expect(result.ok).toBe(true);
    expect(result.data.exists).toBe(false);
    expect(result.data.path).toBe(join(repo, '.peaks', '_runtime', sessionId, 'qa', 'security-test-plan.md'));
    expect(result.data.hash).toBeNull();
    expect(result.data.refreshedAt).toBeNull();
    expect(result.data.source).toBe('missing');
  });

  it('T-003: read perf plan returns same envelope shape', () => {
    const body = ['# Performance Baseline', '## CLI Command Inventory', 'peaks plan read perf'].join('\n');
    makePlanFile(repo, sessionId, 'perf-baseline.md', body);
    const result = readPlan({ type: 'perf', project: repo, sessionId });
    expect(result.ok).toBe(true);
    expect(result.data.exists).toBe(true);
    expect(result.data.path).toBe(join(repo, '.peaks', '_runtime', sessionId, 'qa', 'perf-baseline.md'));
    expect(result.data.hash).toMatch(/^[0-9a-f]{12}$/);
    expect(result.data.source).toBe('canonical');
  });

  it('T-004: back-compat falls back to legacy .peaks/_runtime/<planFile> when BACK_COMPAT_FLAG=1', () => {
    const body = ['# Legacy Security Plan', '## Threat Model', 'auth boundary'].join('\n');
    const legacyPath = join(repo, '.peaks', 'security-test-plan.md');
    mkdirSync(join(repo, '.peaks'), { recursive: true });
    writeFileSync(legacyPath, body, 'utf8');
    const t = new Date('2026-06-10T07:00:00Z');
    utimesSync(legacyPath, t, t);
    process.env[BACK_COMPAT_FLAG] = '1';
    const result = readPlan({ type: 'security', project: repo, sessionId });
    expect(result.ok).toBe(true);
    expect(result.data.exists).toBe(true);
    expect(result.data.path).toBe(legacyPath);
    expect(result.data.source).toBe('legacy');
  });

  it('T-004b: without BACK_COMPAT_FLAG the legacy path is NOT consumed', () => {
    delete process.env[BACK_COMPAT_FLAG];
    const body = ['# Legacy Security Plan'].join('\n');
    const legacyPath = join(repo, '.peaks', 'security-test-plan.md');
    mkdirSync(join(repo, '.peaks'), { recursive: true });
    writeFileSync(legacyPath, body, 'utf8');
    const result = readPlan({ type: 'security', project: repo, sessionId });
    expect(result.data.exists).toBe(false);
    expect(result.data.source).toBe('missing');
  });

  /**
   * Slice 2026-06-13-repair-pre-existing-test-failures: on macOS the
   * OS exposes /tmp and /var/folders/... as symlinks to /private/tmp
   * and /private/var/folders/.... `mkdtempSync` returns the
   * unresolved form (/var/folders/...); the realpath of the temp dir
   * is /private/var/folders/.... `readPlan` previously called
   * `realpathSync` on the canonical/legacy *file* but NOT on the
   * `expectedBase`, so the prefix check rejected the resolved file
   * as "escaping" the unresolved base. The fix is to realpath
   * `expectedBase` too (symmetric resolution). This test reproduces
   * the macOS-only failure by forcing `repo` to the unresolved
   * tmpdir form (which the platform returns by default).
   */
  it('macOS-realpath regression: legacy path under tmpdir is accepted when BACK_COMPAT_FLAG=1', () => {
    delete process.env[BACK_COMPAT_FLAG];
    const body = ['# Legacy Plan'].join('\n');
    const legacyPath = join(repo, '.peaks', 'security-test-plan.md');
    mkdirSync(join(repo, '.peaks'), { recursive: true });
    writeFileSync(legacyPath, body, 'utf8');
    // Sanity: confirm the platform actually has a realpath delta
    // (otherwise the regression is a no-op and this test is a no-op).
    const realRepo = realpathSync(repo);
    if (realRepo === repo) {
      // Linux: no symlink delta. Skip to keep this test focused on macOS.
      return;
    }
    process.env[BACK_COMPAT_FLAG] = '1';
    const result = readPlan({ type: 'security', project: repo, sessionId });
    expect(result.ok).toBe(true);
    expect(result.data.exists).toBe(true);
    expect(result.data.source).toBe('legacy');
  });

  it('F-1 regression: invalid sessionId returns ok:false, code:INVALID_SESSION_ID, no throw', () => {
    // Path-traversal payload — was the F-1 reproduction.
    expect(() => {
      const result = readPlan({ type: 'security', project: repo, sessionId: '../../etc/passwd' });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('INVALID_SESSION_ID');
      expect(result.data.exists).toBe(false);
      expect(result.data.source).toBe('missing');
    }).not.toThrow();
    // Absolute path payload — also rejected by the pattern.
    const r2 = readPlan({ type: 'perf', project: repo, sessionId: '/etc/passwd' });
    expect(r2.ok).toBe(false);
    expect(r2.code).toBe('INVALID_SESSION_ID');
    // Empty slug — rejected.
    const r3 = readPlan({ type: 'security', project: repo, sessionId: '2026-06-10-' });
    expect(r3.ok).toBe(false);
    expect(r3.code).toBe('INVALID_SESSION_ID');
  });

  it('F-2 regression: symlink escape at canonical path returns ok:false, code:SYMLINK_ESCAPE', () => {
    // Build a fixture: a sibling directory outside `.peaks/_runtime/<sid>/`
    // containing a real plan body, then symlink the canonical session
    // qa dir to that sibling. The canonical path resolves through the
    // symlink to the sibling, whose real path is NOT under the session
    // dir → SYMLINK_ESCAPE.
    const sibling = mkdtempSync(join(tmpdir(), 'peaks-plan-reader-sibling-'));
    try {
      const targetDir = join(sibling, 'qa');
      mkdirSync(targetDir, { recursive: true });
      const targetFile = join(targetDir, 'security-test-plan.md');
      writeFileSync(targetFile, '# Escaped Security Plan\n## Threat Model\nsibling', 'utf8');
      const t = new Date('2026-06-10T07:00:00Z');
      utimesSync(targetFile, t, t);

      const sessionDir = join(repo, '.peaks', '_runtime', sessionId);
      mkdirSync(sessionDir, { recursive: true });
      // Place a symlink at <sessionDir>/qa pointing outside the session dir.
      try {
        symlinkSync(targetDir, join(sessionDir, 'qa'), 'dir');
      } catch (err) {
        // On Windows without admin/dev-mode, symlinks are not creatable.
        // The F-2 protection is still in the source; this test is a
        // best-effort guard, not a hard requirement on Windows.
        if ((err as NodeJS.ErrnoException).code === 'EPERM' || (err as NodeJS.ErrnoException).code === 'EACCES') return;
        throw err;
      }

      const result = readPlan({ type: 'security', project: repo, sessionId });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('SYMLINK_ESCAPE');
      expect(result.data.exists).toBe(false);
      expect(result.data.source).toBe('missing');
    } finally {
      rmSync(sibling, { recursive: true, force: true });
    }
  });

  it('F-2 regression: file-level symlink escape (symlink file -> outside) also returns SYMLINK_ESCAPE', () => {
    // File-level symlink: the qa dir is real, but the security-test-plan.md
    // inside it points to a file outside `.peaks/_runtime/<sid>/`.
    const outside = mkdtempSync(join(tmpdir(), 'peaks-plan-reader-outside-'));
    try {
      const outsidePlan = join(outside, 'outside-security.md');
      writeFileSync(outsidePlan, '# Outside\n## Threat Model\nexternal', 'utf8');

      const qaDir = join(repo, '.peaks', '_runtime', sessionId, 'qa');
      mkdirSync(qaDir, { recursive: true });
      try {
        symlinkSync(outsidePlan, join(qaDir, 'security-test-plan.md'), 'file');
      } catch (err) {
        // On Windows without admin/dev-mode, symlinks are not creatable.
        if ((err as NodeJS.ErrnoException).code === 'EPERM' || (err as NodeJS.ErrnoException).code === 'EACCES') return;
        throw err;
      }

      const result = readPlan({ type: 'security', project: repo, sessionId });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('SYMLINK_ESCAPE');
      // Real-path does NOT start with the expected session dir prefix.
      const expectedPrefix = join(repo, '.peaks', '_runtime', sessionId) + sep;
      expect(result.message ?? '').toMatch(new RegExp(expectedPrefix.replace(/[\\]/g, '\\\\')));
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
