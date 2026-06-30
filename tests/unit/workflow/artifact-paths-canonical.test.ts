/**
 * v2.18.1 — artifact-paths path-axis update.
 *
 * Pins the contract that `resolveSecurityFindingsPath` /
 * `resolvePerformanceFindingsPath` resolve the v2.17.0 canonical
 * session-axis path `.peaks/_runtime/<sessionId>/qa/` and fall back
 * to the legacy forms:
 *   - `.peaks/_runtime/change/<sessionId>/qa/` (v2.16.0/v2.17.0-era)
 *   - `.peaks/<sessionId>/qa/` (pre-1.3.0 misplaced)
 * during the 1-minor-release deprecation window. When a fallback
 * fires, the form is tagged `'legacy'` so Gate C can surface the
 * `DEPRECATION_LEGACY_PATH_USED` warning.
 *
 * The pre-v2.18.1 canonical path
 * `.peaks/_runtime/change/<sessionId>/qa/` is now itself a legacy
 * fallback (v2.17.0 hard-killed the change-id axis as filesystem
 * scope; it survives only as a back-compat read target).
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  resolveSecurityFindingsPath,
  resolvePerformanceFindingsPath,
  SECURITY_FINDINGS_SUFFIXED,
  PERFORMANCE_FINDINGS_SUFFIXED
} from '../../../src/services/workflow/artifact-paths.js';

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'peaks-artifact-paths-'));
  mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('artifact-paths — v2.18.1 session-axis update', () => {
  it('resolves canonical suffixed security-findings under session axis', () => {
    const sessionId = 'canonical-sec';
    const dir = join(projectRoot, '.peaks', '_runtime', sessionId, 'qa');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, SECURITY_FINDINGS_SUFFIXED('001-test')), '# sec');

    const result = resolveSecurityFindingsPath({ projectRoot, sessionId: sessionId, rid: '001-test' });
    expect(result.path).toBe(join(dir, SECURITY_FINDINGS_SUFFIXED('001-test')));
    expect(result.form).toBe('suffixed');
  });

  it('falls back to legacy misplaced .peaks/<id>/qa/ form', () => {
    const sessionId = 'legacy-misplaced-sec';
    const dir = join(projectRoot, '.peaks', sessionId, 'qa');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, SECURITY_FINDINGS_SUFFIXED('001-test')), '# sec');

    const result = resolveSecurityFindingsPath({ projectRoot, sessionId, rid: '001-test' });
    expect(result.form).toBe('legacy');
    expect(result.path).toBe(join(dir, SECURITY_FINDINGS_SUFFIXED('001-test')));
  });

  it('falls back to v2.16.0 change-axis .peaks/_runtime/change/<id>/qa/ form', () => {
    const sessionId = 'change-axis-sec';
    const dir = join(projectRoot, '.peaks', '_runtime', 'change', sessionId, 'qa');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, PERFORMANCE_FINDINGS_SUFFIXED('001-test')), '# perf');

    const result = resolvePerformanceFindingsPath({ projectRoot, sessionId, rid: '001-test' });
    expect(result.form).toBe('legacy');
    expect(result.path).toBe(join(dir, PERFORMANCE_FINDINGS_SUFFIXED('001-test')));
  });

  it('reports would-be canonical (session-axis) path when nothing on disk', () => {
    const sessionId = 'absent-perf';
    const result = resolvePerformanceFindingsPath({ projectRoot, sessionId, rid: '001-test' });
    expect(result.path).toBe(
      join(projectRoot, '.peaks', '_runtime', sessionId, 'qa', PERFORMANCE_FINDINGS_SUFFIXED('001-test'))
    );
    expect(result.form).toBe('suffixed');
  });
});