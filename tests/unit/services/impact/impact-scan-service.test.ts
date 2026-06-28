/**
 * v2.15.0 follow-up — G13 tests: impact-scan-service.
 */
import { describe, it, expect } from 'vitest';
import {
  runImpactScan,
  matchGlob,
  mustCheckFromReport,
  type MustCheckItem
} from '../../../../src/services/impact/impact-scan-service.js';

describe('matchGlob', () => {
  it('matches ** patterns', () => {
    expect(matchGlob('**/auth/**', 'src/auth/login.ts')).toBe(true);
    expect(matchGlob('**/auth/**', 'src/utils/helper.ts')).toBe(false);
  });
  it('matches single *', () => {
    expect(matchGlob('src/*.ts', 'src/foo.ts')).toBe(true);
    expect(matchGlob('src/*.ts', 'src/foo/bar.ts')).toBe(false);
  });
  it('handles backslashes by normalizing to forward slashes', () => {
    expect(matchGlob('**/auth/**', 'src\\auth\\login.ts')).toBe(true);
  });
});

describe('runImpactScan', () => {
  it('warns when no files are provided', () => {
    const report = runImpactScan({ changedFiles: [] });
    expect(report.warnings.length).toBeGreaterThan(0);
    expect(report.changedFiles).toEqual([]);
  });

  it('identifies affected flows for auth-related changes', () => {
    const report = runImpactScan({ changedFiles: ['src/auth/login.ts'] });
    const flowNames = report.affectedFlows.map((f) => f.name);
    expect(flowNames).toContain('权限校验');
    expect(flowNames).toContain('登录流程');
  });

  it('identifies high risk for auth/schema files', () => {
    const report = runImpactScan({ changedFiles: ['src/auth/login.ts'] });
    expect(report.overallRisk).toBe('high');
  });

  it('generates must-check items for affected flows', () => {
    const report = runImpactScan({ changedFiles: ['src/auth/login.ts', 'src/services/user.ts'] });
    expect(report.mustCheck.length).toBeGreaterThan(0);
    const scenarios = report.mustCheck.map((m) => m.scenario);
    expect(scenarios.some((s) => s.includes('登录'))).toBe(true);
  });

  it('returns empty affected flows for unrelated files', () => {
    const report = runImpactScan({ changedFiles: ['src/random/helper.ts'] });
    expect(report.affectedFlows).toEqual([]);
  });

  it('deduplicates must-check items', () => {
    const report = runImpactScan({
      changedFiles: ['src/auth/login.ts', 'src/auth/session.ts', 'src/auth/middleware.ts']
    });
    const scenarios = report.mustCheck.map((m) => m.scenario);
    const unique = new Set(scenarios);
    expect(scenarios.length).toBe(unique.size);
  });

  it('bump risk to high when > 20 files changed', () => {
    const files = Array.from({ length: 21 }, (_, i) => `src/utils/file${i}.ts`);
    const report = runImpactScan({ changedFiles: files });
    expect(report.overallRisk).toBe('high');
  });

  it('bump risk to high when > 3 affected flows', () => {
    const files = ['src/auth/a.ts', 'src/user/b.ts', 'src/order/c.ts', 'src/api/d.ts', 'src/skill/e.ts'];
    const report = runImpactScan({ changedFiles: files });
    expect(report.overallRisk).toBe('high');
  });

  it('impacted files include siblings of changed files', () => {
    const report = runImpactScan({ changedFiles: ['src/auth/login.ts'] });
    expect(report.impactedFiles.some((f) => f.path.includes('src/auth/index'))).toBe(true);
  });
});

describe('mustCheckFromReport', () => {
  it('returns the same items as report.mustCheck', () => {
    const report = runImpactScan({ changedFiles: ['src/auth/login.ts'] });
    const items: readonly MustCheckItem[] = mustCheckFromReport(report);
    expect(items).toEqual(report.mustCheck);
  });
});
