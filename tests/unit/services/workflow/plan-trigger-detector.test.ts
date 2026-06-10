/**
 * Unit tests for `src/services/workflow/plan-trigger-detector.ts` (slice 025).
 *
 * Covers:
 *   T-010 new top-level dependency → triggered: true, reason: "new-dependency"
 *   T-011 devDependencies change only → triggered: false
 *   T-012 new file under src/services/auth/ → triggered: true, reason: "new-auth-file"
 *   T-013 new *auth*.ts file anywhere → triggered: true, reason: "new-auth-file"
 *   T-014 no structural changes → triggered: false
 *   T-014b manual --refresh flag overrides detector
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectTrigger, type SliceDiff } from '../../../../src/services/workflow/plan-trigger-detector.js';

function makeRepo(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-plan-trigger-'));
}

function writePkg(repo: string, deps: Record<string, string>, devDeps: Record<string, string> = {}): void {
  writeFileSync(join(repo, 'package.json'), JSON.stringify({
    name: 'fixture',
    dependencies: deps,
    devDependencies: devDeps,
    optionalDependencies: {}
  }, null, 2), 'utf8');
}

describe('plan-trigger-detector — detectTrigger', () => {
  let repo: string;
  const sessionId = '2026-06-10-session-c4a2be';

  beforeEach(() => { repo = makeRepo(); });
  afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

  it('T-010: new top-level dependency → triggered: true, reason: "new-dependency"', () => {
    writePkg(repo, { 'jsonwebtoken': '^9.0.0' });
    const diff: SliceDiff = {
      packageJson: {
        dependencies: { added: ['jsonwebtoken'], removed: [], changed: [] },
        optionalDependencies: { added: [], removed: [], changed: [] },
        devDependencies: { added: [], removed: [], changed: [] }
      }
    };
    const r = detectTrigger({ project: repo, rid: 'test-001', sessionId, diff });
    expect(r.data.triggered).toBe(true);
    expect(r.data.reason).toBe('new-dependency');
  });

  it('T-011: devDependencies change only → triggered: false (locked Q1)', () => {
    writePkg(repo, {}, { 'vitest': '^1.0.0' });
    const diff: SliceDiff = {
      packageJson: {
        dependencies: { added: [], removed: [], changed: [] },
        optionalDependencies: { added: [], removed: [], changed: [] },
        devDependencies: { added: ['vitest'], removed: [], changed: [] }
      }
    };
    const r = detectTrigger({ project: repo, rid: 'test-002', sessionId, diff });
    expect(r.data.triggered).toBe(false);
    expect(r.data.reason).toBe('no-triggering-change');
  });

  it('T-012: new file under src/services/auth/ → triggered: true, reason: "auth-surface-added"', () => {
    writePkg(repo, {});
    const diff: SliceDiff = {
      newFiles: [join(repo, 'src', 'services', 'auth', 'oauth-callback.ts')]
    };
    const r = detectTrigger({ project: repo, rid: 'test-003', sessionId, diff });
    expect(r.data.triggered).toBe(true);
    expect(r.data.reason).toBe('auth-surface-added');
  });

  it('T-013: new *auth*.ts file anywhere → triggered: true, reason: "auth-surface-added"', () => {
    writePkg(repo, {});
    const diff: SliceDiff = {
      newFiles: [join(repo, 'src', 'utils', 'auth-helpers.ts')]
    };
    const r = detectTrigger({ project: repo, rid: 'test-004', sessionId, diff });
    expect(r.data.triggered).toBe(true);
    expect(r.data.reason).toBe('auth-surface-added');
  });

  it('T-014: no structural changes → triggered: false', () => {
    writePkg(repo, {});
    const diff: SliceDiff = {
      newFiles: [join(repo, 'rd', 'security-review.md'), join(repo, 'qa', 'test-cases', '001-test.md')]
    };
    const r = detectTrigger({ project: repo, rid: 'test-005', sessionId, diff });
    expect(r.data.triggered).toBe(false);
    expect(r.data.reason).toBe('no-triggering-change');
  });

  it('T-014b: manual --refresh flag overrides detector', () => {
    writePkg(repo, {});
    const r = detectTrigger({ project: repo, rid: 'test-006', sessionId, manualOverride: true });
    expect(r.data.triggered).toBe(true);
    expect(r.data.reason).toBe('manual-override');
  });

  it('fresh scan detects new files on disk (no diff provided)', () => {
    writePkg(repo, {});
    mkdirSync(join(repo, 'src', 'services', 'auth'), { recursive: true });
    writeFileSync(join(repo, 'src', 'services', 'auth', 'new-service.ts'), 'export {};\n', 'utf8');
    const r = detectTrigger({ project: repo, rid: 'test-007', sessionId, diff: null });
    expect(r.data.triggered).toBe(true);
    expect(['auth-surface-added']).toContain(r.data.reason);
  });

  it('F-1 regression: invalid rid (path traversal) returns ok:false, code:INVALID_RID, no throw', () => {
    // Path-traversal payload — was the F-1 reproduction for detect-trigger.
    expect(() => {
      const r = detectTrigger({ project: repo, rid: 'foo/../bar', sessionId });
      expect(r.ok).toBe(false);
      expect(r.code).toBe('INVALID_RID');
      expect(r.data.triggered).toBe(false);
      expect(r.data.reason).toBe('no-triggering-change');
    }).not.toThrow();
    // Separator in payload — also rejected.
    const r2 = detectTrigger({ project: repo, rid: 'sub\\dir', sessionId });
    expect(r2.ok).toBe(false);
    expect(r2.code).toBe('INVALID_RID');
    // Empty rid is rejected.
    const r3 = detectTrigger({ project: repo, rid: '', sessionId });
    expect(r3.ok).toBe(false);
    expect(r3.code).toBe('INVALID_RID');
  });
});
