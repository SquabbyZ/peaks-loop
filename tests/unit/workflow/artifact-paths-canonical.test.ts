/**
 * Slice 2026-06-28-solo-mode-bypass-fix (defect #3).
 *
 * Pins the contract that `resolveSecurityFindingsPath` /
 * `resolvePerformanceFindingsPath` resolve the canonical
 * `.peaks/_runtime/change/<changeId>/qa/` path and fall back to the
 * legacy misplaced forms (`/peaks/<changeId>/qa/`,
 * `/peaks/_runtime/<changeId>/qa/`) during the deprecation window.
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

describe('artifact-paths — slice 2026-06-28-solo-mode-bypass-fix', () => {
  it('resolves canonical suffixed security-findings', () => {
    const changeId = 'canonical-sec';
    const dir = join(projectRoot, '.peaks', '_runtime', 'change', changeId, 'qa');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, SECURITY_FINDINGS_SUFFIXED('001-test')), '# sec');

    const result = resolveSecurityFindingsPath({ projectRoot, changeId, rid: '001-test' });
    expect(result.path).toBe(join(dir, SECURITY_FINDINGS_SUFFIXED('001-test')));
    expect(result.form).toBe('suffixed');
  });

  it('falls back to legacy misplaced path', () => {
    const changeId = 'legacy-misplaced-sec';
    const dir = join(projectRoot, '.peaks', changeId, 'qa');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, SECURITY_FINDINGS_SUFFIXED('001-test')), '# sec');

    const result = resolveSecurityFindingsPath({ projectRoot, changeId, rid: '001-test' });
    expect(result.form).toBe('legacy');
    expect(result.path).toBe(join(dir, SECURITY_FINDINGS_SUFFIXED('001-test')));
  });

  it('falls back to legacy top-level .peaks/_runtime/<id>/qa/ form', () => {
    const changeId = 'legacy-top-sec';
    const dir = join(projectRoot, '.peaks', '_runtime', changeId, 'qa');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, PERFORMANCE_FINDINGS_SUFFIXED('001-test')), '# perf');

    const result = resolvePerformanceFindingsPath({ projectRoot, changeId, rid: '001-test' });
    expect(result.form).toBe('legacy');
    expect(result.path).toBe(join(dir, PERFORMANCE_FINDINGS_SUFFIXED('001-test')));
  });

  it('reports would-be canonical path when nothing on disk', () => {
    const changeId = 'absent-perf';
    const result = resolvePerformanceFindingsPath({ projectRoot, changeId, rid: '001-test' });
    expect(result.path).toBe(
      join(projectRoot, '.peaks', '_runtime', 'change', changeId, 'qa', PERFORMANCE_FINDINGS_SUFFIXED('001-test'))
    );
    expect(result.form).toBe('suffixed');
  });
});