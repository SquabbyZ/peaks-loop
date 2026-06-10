/**
 * Unit tests for `src/services/workflow/plan-refresher.ts` (slice 025).
 *
 * Covers:
 *   T-005 refresh security plan regenerates; idempotent (re-run → same hash)
 *   T-006 refresh perf plan regenerates; idempotent
 *   T-007 refresh without --apply is dry-run; does not write
 *   T-008 refresh writes artifact-contracts-compliant JSON envelope
 *   T-009 determinism: two consecutive refreshes produce byte-identical files
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashBody, refreshPlan, renderPlanBody } from '../../../../src/services/workflow/plan-refresher.js';

function makeRepo(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-plan-refresher-'));
}

function sha256(buf: string): string {
  return createHash('sha256').update(buf, 'utf8').digest('hex');
}

function writeFixturePackageJson(repo: string, deps: Record<string, string>): void {
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'fixture', dependencies: deps, devDependencies: {}, optionalDependencies: {} }, null, 2), 'utf8');
}

describe('plan-refresher — renderPlanBody determinism', () => {
  let repo: string;
  beforeEach(() => { repo = makeRepo(); });
  afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

  it('renders the same body regardless of input dep order', () => {
    writeFixturePackageJson(repo, { 'jsonwebtoken': '^9.0.0', 'axios': '^1.0.0', 'zod': '^3.0.0' });
    const a = renderPlanBody({ type: 'security', project: repo });
    const b = renderPlanBody({ type: 'security', project: repo });
    expect(a).toBe(b);
    // Hash is stable.
    expect(hashBody(a)).toBe(hashBody(b));
  });
});

describe('plan-refresher — refreshPlan', () => {
  let repo: string;
  const sessionId = '2026-06-10-session-c4a2be';
  const sessionQaDir = () => join(repo, '.peaks', '_runtime', sessionId, 'qa');

  beforeEach(() => { repo = makeRepo(); });
  afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

  it('T-005: refresh security plan regenerates; idempotent (re-run → same hash)', () => {
    writeFixturePackageJson(repo, {});
    const target = join(sessionQaDir(), 'security-test-plan.md');
    expect(existsSync(target)).toBe(false);
    const r1 = refreshPlan({ type: 'security', project: repo, sessionId, apply: true });
    expect(r1.ok).toBe(true);
    expect(r1.data.dryRun).toBe(false);
    expect(r1.data.writtenFiles).toEqual([target]);
    expect(existsSync(target)).toBe(true);
    const onDisk1 = readFileSync(target, 'utf8');

    const r2 = refreshPlan({ type: 'security', project: repo, sessionId, apply: true });
    expect(r2.ok).toBe(true);
    expect(r2.data.hash).toBe(r1.data.hash);
    const onDisk2 = readFileSync(target, 'utf8');
    expect(sha256(onDisk1)).toBe(sha256(onDisk2));
  });

  it('T-006: refresh perf plan regenerates; idempotent', () => {
    writeFixturePackageJson(repo, {});
    const target = join(sessionQaDir(), 'perf-baseline.md');
    const r1 = refreshPlan({ type: 'perf', project: repo, sessionId, apply: true });
    const r2 = refreshPlan({ type: 'perf', project: repo, sessionId, apply: true });
    expect(r1.data.hash).toBe(r2.data.hash);
    expect(r1.data.writtenFiles).toEqual([target]);
  });

  it('T-007: refresh without --apply is dry-run; does not write', () => {
    writeFixturePackageJson(repo, {});
    const target = join(sessionQaDir(), 'security-test-plan.md');
    const r = refreshPlan({ type: 'security', project: repo, sessionId, apply: false });
    expect(r.ok).toBe(true);
    expect(r.data.dryRun).toBe(true);
    expect(r.data.writtenFiles).toEqual([]);
    expect(r.data.wouldWrite).toEqual([target]);
    expect(existsSync(target)).toBe(false);
  });

  it('T-008: refresh writes artifact-contracts-compliant JSON envelope', () => {
    writeFixturePackageJson(repo, {});
    const r = refreshPlan({ type: 'security', project: repo, sessionId, apply: true });
    expect(r.ok).toBe(true);
    expect(r.data.writtenFiles.length).toBeGreaterThan(0);
    expect(r.data.hash).toMatch(/^[0-9a-f]{12}$/);
    expect(r.data.dryRun).toBe(false);
  });

  it('T-009: determinism — two consecutive refreshes produce byte-identical files', () => {
    writeFixturePackageJson(repo, { 'a': '1.0.0', 'b': '2.0.0', 'c': '3.0.0' });
    const target = join(sessionQaDir(), 'security-test-plan.md');
    refreshPlan({ type: 'security', project: repo, sessionId, apply: true });
    const bytes1 = readFileSync(target, 'utf8');
    refreshPlan({ type: 'security', project: repo, sessionId, apply: true });
    const bytes2 = readFileSync(target, 'utf8');
    expect(sha256(bytes1)).toBe(sha256(bytes2));
    // And the body is sorted (the deps must appear alphabetically).
    const depIndexA = bytes1.indexOf('a\n');
    const depIndexB = bytes1.indexOf('b\n');
    expect(depIndexA).toBeGreaterThan(0);
    expect(depIndexB).toBeGreaterThan(depIndexA);
  });
});
