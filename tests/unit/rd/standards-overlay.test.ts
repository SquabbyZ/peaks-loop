/**
 * QA functional test (slice 2026-06-16-peaks-rd-no-gates).
 * Exercises the service-layer wiring (`createRdSwarmPlan` with
 * `projectRoot` + `strictStandards`) end-to-end with a real temp project
 * whose `.claude/rules/` is empty.
 *
 * Hard contract: temp project uses `os.tmpdir()` + `mkdtempSync`. NEVER
 * touches /Users/yuanyuan/Desktop/test/platform-rag-web.
 */
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createRdSwarmPlan } from '../../../src/services/rd/rd-service.js';
import { EPEAKS_NO_STANDARDS } from '../../../src/services/rd/standards-diagnostic.js';

describe('standards overlay — createRdSwarmPlan end-to-end (slice 2026-06-16-peaks-rd-no-gates)', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'qa-peaks-rd-func-'));
  });

  afterEach(() => {
    if (existsSync(projectRoot)) {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('AC1+AC4: missing standards + strict=false → overlay has skipped gates + diagnostic + no error code', () => {
    const plan = createRdSwarmPlan({
      skill: 'rd',
      changeId: '2026-06-16-peaks-rd-no-gates',
      goal: 'qa functional test',
      maxWorkers: 40,
      dryRun: true,
      projectRoot,
      strictStandards: false,
    });

    expect(plan.gateStatus.standardsGates).toEqual([
      { name: 'code-review', status: 'skipped', reason: 'no project-local standards' },
      { name: 'security-review', status: 'skipped', reason: 'no project-local standards' },
      { name: 'performance-review', status: 'skipped', reason: 'no project-local standards' },
    ]);
    expect(plan.gateStatus.standardsDiagnostic).toContain('no project-local standards found');
    // Remediation command renders projectRoot with POSIX slashes (deliberate
    // cross-platform copy-paste; see src/services/rd/standards-diagnostic.ts
    // `buildRemediationCommand`). Tests must compare against the same
    // conversion, not raw `projectRoot`.
    const posixProjectRoot = projectRoot.split('\\').join('/');
    expect(plan.gateStatus.standardsDiagnostic).toContain('peaks standards init --project ' + posixProjectRoot);
    expect(plan.gateStatus.standardsDiagnostic).toContain('--apply');
    expect(plan.gateStatus.standardsDiagnostic).toContain('code-review');
    expect(plan.gateStatus.standardsDiagnostic).toContain('security-review');
    expect(plan.gateStatus.standardsDiagnostic).toContain('performance-review');
    expect(plan.gateStatus.standardsDiagnostic).toContain('skipped');
    expect(plan.gateStatus.standardsErrorCode).toBeUndefined();
  });

  test('AC2+AC3: missing standards + strict=true → overlay has skipped gates + diagnostic + EPEAKS_NO_STANDARDS error code', () => {
    const plan = createRdSwarmPlan({
      skill: 'rd',
      changeId: '2026-06-16-peaks-rd-no-gates',
      goal: 'qa functional test',
      maxWorkers: 40,
      dryRun: true,
      projectRoot,
      strictStandards: true,
    });

    expect(plan.gateStatus.standardsGates?.[0]?.status).toBe('skipped');
    expect(plan.gateStatus.standardsGates?.[0]?.reason).toBe('no project-local standards');
    expect(plan.gateStatus.standardsDiagnostic).toContain('no project-local standards found');
    expect(plan.gateStatus.standardsErrorCode).toBe(EPEAKS_NO_STANDARDS);
  });

  test('P1: omitted projectRoot → overlay is empty (preserved behavior, no regression)', () => {
    const plan = createRdSwarmPlan({
      skill: 'rd',
      changeId: '2026-06-16-peaks-rd-no-gates',
      goal: 'qa functional test',
      maxWorkers: 40,
      dryRun: true,
    });

    expect(plan.gateStatus.standardsGates).toBeUndefined();
    expect(plan.gateStatus.standardsDiagnostic).toBeUndefined();
    expect(plan.gateStatus.standardsErrorCode).toBeUndefined();
  });

  test('regression: standards present + strict=true → gates ready + no diagnostic', () => {
    mkdirSync(join(projectRoot, '.claude', 'rules', 'common'), { recursive: true });
    mkdirSync(join(projectRoot, '.claude', 'rules', 'typescript'), { recursive: true });
    writeFileSync(join(projectRoot, '.claude', 'rules', 'common', 'coding-style.md'), '# stub\n');
    writeFileSync(join(projectRoot, '.claude', 'rules', 'typescript', 'coding-style.md'), '# stub\n');

    const plan = createRdSwarmPlan({
      skill: 'rd',
      changeId: '2026-06-16-peaks-rd-no-gates',
      goal: 'qa functional test',
      maxWorkers: 40,
      dryRun: true,
      projectRoot,
      strictStandards: true,
    });

    expect(plan.gateStatus.standardsGates).toEqual([
      { name: 'code-review', status: 'ready', reason: null },
      { name: 'security-review', status: 'ready', reason: null },
      { name: 'performance-review', status: 'ready', reason: null },
    ]);
    expect(plan.gateStatus.standardsDiagnostic).toBeUndefined();
    expect(plan.gateStatus.standardsErrorCode).toBeUndefined();
  });

  test('AC5: diagnostic includes copy-pasteable peaks standards init --project <X> --apply command', () => {
    const plan = createRdSwarmPlan({
      skill: 'rd',
      changeId: '2026-06-16-peaks-rd-no-gates',
      goal: 'qa functional test',
      maxWorkers: 40,
      dryRun: true,
      projectRoot,
      strictStandards: false,
    });

    const posixProjectRoot = projectRoot.split('\\').join('/');
    const cmd = `peaks standards init --project ${posixProjectRoot} --apply`;
    expect(plan.gateStatus.standardsDiagnostic).toContain(cmd);
  });

  test('CRITICAL guard: temp dir is NOT platform-rag-web', () => {
    expect(projectRoot).not.toContain('platform-rag-web');
    expect(projectRoot.startsWith(tmpdir())).toBe(true);
  });

  // ---- repair cycle 1: overlay regression (Q4 / AC3) ------------------------

  test('repair-1 regression: strict + missing → BOTH diagnostic AND standardsErrorCode surface', () => {
    // The pre-fix overlay returned only `standardsDiagnostic` when
    // `diagnostic !== null`, dropping `standardsErrorCode`. This is the
    // exact regression that QA#4 caught — it must not return.
    const plan = createRdSwarmPlan({
      skill: 'rd',
      changeId: '2026-06-16-peaks-rd-no-gates',
      goal: 'repair-cycle-1 regression',
      maxWorkers: 40,
      dryRun: true,
      projectRoot,
      strictStandards: true,
    });

    expect(plan.gateStatus.standardsErrorCode).toBe(EPEAKS_NO_STANDARDS);
    expect(plan.gateStatus.standardsDiagnostic).toBeDefined();
    expect(plan.gateStatus.standardsDiagnostic).toContain('no project-local standards found');
    // The diagnostic must remain copy-pasteable even when the error code
    // is present — strict mode is additive, not a replacement.
    const posixProjectRoot = projectRoot.split('\\').join('/');
    expect(plan.gateStatus.standardsDiagnostic).toContain('peaks standards init --project ' + posixProjectRoot + ' --apply');
  });

  test('repair-1 regression: strict=false + missing → diagnostic present, error code absent (warn-and-continue)', () => {
    const plan = createRdSwarmPlan({
      skill: 'rd',
      changeId: '2026-06-16-peaks-rd-no-gates',
      goal: 'repair-cycle-1 regression',
      maxWorkers: 40,
      dryRun: true,
      projectRoot,
      strictStandards: false,
    });

    expect(plan.gateStatus.standardsErrorCode).toBeUndefined();
    expect(plan.gateStatus.standardsDiagnostic).toBeDefined();
    expect(plan.gateStatus.standardsDiagnostic).toContain('no project-local standards found');
  });

  test('repair-1 regression: strict=true + standards present → no diagnostic, no error code, gates ready', () => {
    mkdirSync(join(projectRoot, '.claude', 'rules', 'common'), { recursive: true });
    mkdirSync(join(projectRoot, '.claude', 'rules', 'typescript'), { recursive: true });
    writeFileSync(join(projectRoot, '.claude', 'rules', 'common', 'coding-style.md'), '# stub\n');
    writeFileSync(join(projectRoot, '.claude', 'rules', 'typescript', 'coding-style.md'), '# stub\n');

    const plan = createRdSwarmPlan({
      skill: 'rd',
      changeId: '2026-06-16-peaks-rd-no-gates',
      goal: 'repair-cycle-1 regression',
      maxWorkers: 40,
      dryRun: true,
      projectRoot,
      strictStandards: true,
    });

    expect(plan.gateStatus.standardsErrorCode).toBeUndefined();
    expect(plan.gateStatus.standardsDiagnostic).toBeUndefined();
    expect(plan.gateStatus.standardsGates).toEqual([
      { name: 'code-review', status: 'ready', reason: null },
      { name: 'security-review', status: 'ready', reason: null },
      { name: 'performance-review', status: 'ready', reason: null },
    ]);
  });
});
