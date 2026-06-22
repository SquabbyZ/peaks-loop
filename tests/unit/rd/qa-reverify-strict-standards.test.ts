/**
 * QA cycle-2 functional test (slice 2026-06-16-peaks-rd-no-gates).
 * QA reverify: confirm strict + missing surfaces EPEAKS_NO_STANDARDS end-to-end.
 * Temp project under os.tmpdir() — NEVER touches platform-rag-web.
 */
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { createRdSwarmPlan } from '../../../src/services/rd/rd-service.js';
import { EPEAKS_NO_STANDARDS } from '../../../src/services/rd/standards-diagnostic.js';

describe('QA cycle-2 re-verification — strict-standards end-to-end', () => {
  let projectRoot: string;
  beforeEach(() => { projectRoot = mkdtempSync(join(tmpdir(), 'qa-reverify-r4-')); });
  afterEach(() => { if (existsSync(projectRoot)) rmSync(projectRoot, { recursive: true, force: true }); });

  test('strict + missing standards surfaces BOTH diagnostic AND EPEAKS_NO_STANDARDS', () => {
    const plan = createRdSwarmPlan({
      skill: 'rd', changeId: '2026-06-16-peaks-rd-no-gates', goal: 'qa cycle-2 reverify',
      maxWorkers: 40, dryRun: true, projectRoot, strictStandards: true,
    });
    expect(plan.gateStatus.standardsErrorCode).toBe(EPEAKS_NO_STANDARDS);
    expect(plan.gateStatus.standardsErrorCode).toBe('EPEAKS_NO_STANDARDS');
    expect(plan.gateStatus.standardsDiagnostic).toContain('no project-local standards found');
    expect(plan.gateStatus.standardsDiagnostic).toContain(
      `peaks standards init --project ${projectRoot.split(sep).join('/')} --apply`
    );
    expect(plan.gateStatus.standardsGates).toEqual([
      { name: 'code-review', status: 'skipped', reason: 'no project-local standards' },
      { name: 'security-review', status: 'skipped', reason: 'no project-local standards' },
      { name: 'performance-review', status: 'skipped', reason: 'no project-local standards' },
    ]);
  });

  test('strict=false + missing → warn-and-continue (no error code)', () => {
    const plan = createRdSwarmPlan({
      skill: 'rd', changeId: '2026-06-16-peaks-rd-no-gates', goal: 'qa cycle-2 reverify',
      maxWorkers: 40, dryRun: true, projectRoot, strictStandards: false,
    });
    expect(plan.gateStatus.standardsErrorCode).toBeUndefined();
    expect(plan.gateStatus.standardsDiagnostic).toContain('no project-local standards found');
    expect(plan.gateStatus.standardsGates?.[0]?.status).toBe('skipped');
  });

  test('omitted projectRoot → overlay empty (no regression)', () => {
    const plan = createRdSwarmPlan({
      skill: 'rd', changeId: '2026-06-16-peaks-rd-no-gates', goal: 'qa cycle-2 reverify',
      maxWorkers: 40, dryRun: true,
    });
    expect(plan.gateStatus.standardsGates).toBeUndefined();
    expect(plan.gateStatus.standardsDiagnostic).toBeUndefined();
    expect(plan.gateStatus.standardsErrorCode).toBeUndefined();
  });

  test('CRITICAL guard: temp dir is NOT the dogfood project', () => {
    expect(projectRoot).not.toContain('platform-rag-web');
    expect(projectRoot.startsWith(tmpdir())).toBe(true);
  });
});
