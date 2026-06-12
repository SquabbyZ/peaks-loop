/**
 * TDD coverage for the 1.x → 2.0 upgrade umbrella service.
 *
 * Closes the test debt recorded in commit ec6f674
 * (fix(upgrade): commit upgrade-service.ts to repair broken HEAD).
 *
 * Strategy: real filesystem + a stub `peaks.js` script that the
 * service spawns. The stub reads its first argv (the sub-command
 * name) and consults env vars to decide whether to exit 0 or 1.
 * No `vi.mock` — matches the pattern in 1x-detector-service.test.ts.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runUpgrade } from '../../../../src/services/upgrade/upgrade-service.js';

const ALL_STEPS = [
  'config-migrate',
  'standards-migrate',
  'memory-extract',
  'hooks-install',
  'skill-sync',
  'audit-verify',
] as const;

// Map sub-step name → first argv that the stub will receive
// (matches the args() functions in upgrade-service.ts STEPS).
const STEP_TO_FIRST_ARGV: Record<string, string> = {
  'config-migrate': 'config',
  'standards-migrate': 'standards',
  'memory-extract': 'memory',
  'hooks-install': 'hooks',
  'skill-sync': 'skill',
  'audit-verify': 'audit',
};

let tmpHome: string;
let tmpProject: string;
let stubPeaksBin: string;
let originalHome: string | undefined;
let originalUserprofile: string | undefined;
let originalStubFail: string | undefined;

/**
 * Seed the project with the three memory-extract artifact shapes
 * the umbrella expects (skills/**\/SKILL.md, CLAUDE.md,
 * .claude/rules/**\/*.md). Tests that exercise the
 * memory-extract step in its "actually runs" mode call this in
 * setup; the "skipped on empty project" test deliberately does
 * not.
 */
function seedMemoryArtifacts(projectRoot: string): void {
  mkdirSync(join(projectRoot, 'skills', 'peaks-solo'), { recursive: true });
  writeFileSync(join(projectRoot, 'skills', 'peaks-solo', 'SKILL.md'), '# stub\n', 'utf8');
  writeFileSync(join(projectRoot, 'CLAUDE.md'), '# stub\n', 'utf8');
  mkdirSync(join(projectRoot, '.claude', 'rules', 'common'), { recursive: true });
  writeFileSync(join(projectRoot, '.claude', 'rules', 'common', 'coding-style.md'), '# stub\n', 'utf8');
}

function writeStubPeaks(failArgvCsv: string = ''): string {
  const stubDir = mkdtempSync(join(tmpdir(), 'peaks-stub-'));
  const stubPath = join(stubDir, 'peaks.js');
  // The service spawns `node peaks.js <argv...>` when peaksBin
  // contains a path separator. The stub exits 1 when its first
  // argv matches one of the names in process.env.STUB_FAIL_ARGVS
  // (comma-separated), else exits 0.
  const stub = `#!/usr/bin/env node
const argv = process.argv.slice(2);
const first = argv[0] ?? '';
const failList = (process.env.STUB_FAIL_ARGVS || '').split(',').filter(Boolean);
if (failList.includes(first)) {
  process.stderr.write('stub: simulated failure for ' + first + '\\n');
  process.exit(1);
}
process.stdout.write(JSON.stringify({ ok: true, argv: argv }));
process.exit(0);
`;
  writeFileSync(stubPath, stub, 'utf8');
  if (failArgvCsv.length > 0) {
    process.env['STUB_FAIL_ARGVS'] = failArgvCsv;
  } else {
    delete process.env['STUB_FAIL_ARGVS'];
  }
  return stubPath;
}

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'peaks-upgrade-home-'));
  tmpProject = mkdtempSync(join(tmpdir(), 'peaks-upgrade-project-'));
  originalHome = process.env['HOME'];
  originalUserprofile = process.env['USERPROFILE'];
  originalStubFail = process.env['STUB_FAIL_ARGVS'];
  // Both Unix HOME and Windows USERPROFILE need to point at the
  // stub home; upgrade-service.read1xVersion checks them in
  // that order via process.env.HOME ?? process.env.USERPROFILE.
  process.env['HOME'] = tmpHome;
  process.env['USERPROFILE'] = tmpHome;
  stubPeaksBin = writeStubPeaks();
});

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env['HOME'];
  } else {
    process.env['HOME'] = originalHome;
  }
  if (originalUserprofile === undefined) {
    delete process.env['USERPROFILE'];
  } else {
    process.env['USERPROFILE'] = originalUserprofile;
  }
  if (originalStubFail === undefined) {
    delete process.env['STUB_FAIL_ARGVS'];
  } else {
    process.env['STUB_FAIL_ARGVS'] = originalStubFail;
  }
  try {
    rmSync(tmpHome, { recursive: true, force: true });
  } catch {
    // ignore
  }
  try {
    rmSync(tmpProject, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('runUpgrade', () => {
  test('returns an UpgradeResult with the full documented shape', () => {
    seedMemoryArtifacts(tmpProject);
    const result = runUpgrade({ projectRoot: tmpProject, peaksBin: stubPeaksBin });
    expect(result).toMatchObject({
      applied: expect.any(Boolean),
      fromVersion: null,
      toVersion: '2.0.0',
      projectRoot: tmpProject,
      passedCount: expect.any(Number),
      failedCount: expect.any(Number),
      skippedCount: expect.any(Number),
      nextActions: expect.any(Array),
      warnings: expect.any(Array),
    });
    expect(result.steps).toHaveLength(ALL_STEPS.length);
    for (const step of result.steps) {
      expect(ALL_STEPS).toContain(step.name);
      expect(['pass', 'fail', 'skipped']).toContain(step.status);
      expect(typeof step.durationMs).toBe('number');
    }
  });

  test('all 6 sub-steps pass when the stub returns 0 → applied=true, passedCount=6', () => {
    seedMemoryArtifacts(tmpProject);
    const result = runUpgrade({ projectRoot: tmpProject, peaksBin: stubPeaksBin });
    expect(result.applied).toBe(true);
    expect(result.passedCount).toBe(6);
    expect(result.failedCount).toBe(0);
    expect(result.skippedCount).toBe(0);
    for (const step of result.steps) {
      expect(step.status).toBe('pass');
      expect(step.exitCode).toBe(0);
    }
  });

  test('all 6 sub-steps fail when the stub returns 1 for every command → applied=false', () => {
    seedMemoryArtifacts(tmpProject);
    // Fail every first-argv (config, standards, memory, hooks, skill, audit)
    writeStubPeaks(Object.values(STEP_TO_FIRST_ARGV).join(','));
    const result = runUpgrade({ projectRoot: tmpProject, peaksBin: stubPeaksBin });
    expect(result.applied).toBe(false);
    expect(result.passedCount).toBe(0);
    expect(result.failedCount).toBe(6);
    expect(result.nextActions.some((a) => a.includes('6 sub-step(s) failed'))).toBe(true);
    for (const step of result.steps) {
      expect(step.status).toBe('fail');
      expect(step.exitCode).toBe(1);
      expect(step.stderr.length).toBeGreaterThan(0);
    }
  });

  test('mixed pass/fail: failing only standards + memory keeps passedCount=4, failedCount=2', () => {
    seedMemoryArtifacts(tmpProject);
    writeStubPeaks('standards,memory');
    const result = runUpgrade({ projectRoot: tmpProject, peaksBin: stubPeaksBin });
    expect(result.applied).toBe(false);
    expect(result.passedCount).toBe(4);
    expect(result.failedCount).toBe(2);
    const failedNames = result.steps.filter((s) => s.status === 'fail').map((s) => s.name).sort();
    expect(failedNames).toEqual(['memory-extract', 'standards-migrate']);
    expect(result.warnings.some((w) => w.startsWith('standards-migrate failed'))).toBe(true);
    expect(result.warnings.some((w) => w.startsWith('memory-extract failed'))).toBe(true);
  });

  test('writes the upgrade record to .peaks/memory/upgrade-2.0-YYYY-MM-DD.md', () => {
    seedMemoryArtifacts(tmpProject);
    const result = runUpgrade({ projectRoot: tmpProject, peaksBin: stubPeaksBin });
    expect(result.upgradeRecordPath).not.toBeNull();
    expect(result.upgradeRecordPath).toMatch(/upgrade-2\.0-\d{4}-\d{2}-\d{2}\.md$/);
    expect(existsSync(result.upgradeRecordPath as string)).toBe(true);
    const body = readFileSync(result.upgradeRecordPath as string, 'utf8');
    expect(body).toContain('# Upgrade to peaks-cli 2.0');
    expect(body).toContain('| step | status | exitCode | durationMs |');
    // Each of the 6 step names appears as a table row
    for (const stepName of ALL_STEPS) {
      expect(body).toContain(`| ${stepName} |`);
    }
    // Audit snapshot section is present (empty project → zero counts, but section still emitted)
    expect(body).toContain('## Audit snapshot');
  });

  test('captures auditBefore and auditAfter as { totalRedLines, cliBacked }', () => {
    const result = runUpgrade({ projectRoot: tmpProject, peaksBin: stubPeaksBin });
    expect(result.auditBefore).not.toBeNull();
    expect(result.auditAfter).not.toBeNull();
    expect(typeof (result.auditBefore as { totalRedLines: number }).totalRedLines).toBe('number');
    expect(typeof (result.auditBefore as { cliBacked: number }).cliBacked).toBe('number');
    expect(typeof (result.auditAfter as { totalRedLines: number }).totalRedLines).toBe('number');
    expect(typeof (result.auditAfter as { cliBacked: number }).cliBacked).toBe('number');
  });

  test('auto: false (default) includes the "Run peaks audit red-lines" next action', () => {
    const result = runUpgrade({ projectRoot: tmpProject, peaksBin: stubPeaksBin });
    expect(result.nextActions.some((a) => a.includes('peaks audit red-lines'))).toBe(true);
  });

  test('auto: true suppresses the manual audit next action', () => {
    const result = runUpgrade({ projectRoot: tmpProject, peaksBin: stubPeaksBin, auto: true });
    expect(result.nextActions.every((a) => !a.includes('peaks audit red-lines'))).toBe(true);
  });

  test('fromVersion is null when global ~/.peaks/config.json is absent', () => {
    const result = runUpgrade({ projectRoot: tmpProject, peaksBin: stubPeaksBin });
    expect(result.fromVersion).toBeNull();
  });

  test('fromVersion is read from global ~/.peaks/config.json when present', () => {
    mkdirSync(join(tmpHome, '.peaks'), { recursive: true });
    writeFileSync(
      join(tmpHome, '.peaks', 'config.json'),
      JSON.stringify({ version: '1.4.2' }),
      'utf8'
    );
    const result = runUpgrade({ projectRoot: tmpProject, peaksBin: stubPeaksBin });
    expect(result.fromVersion).toBe('1.4.2');
    // The record body should also carry the From version line.
    const body = readFileSync(result.upgradeRecordPath as string, 'utf8');
    expect(body).toContain('**From version**: 1.4.2');
  });

  test('fromVersion survives a malformed global config (does not throw)', () => {
    mkdirSync(join(tmpHome, '.peaks'), { recursive: true });
    writeFileSync(join(tmpHome, '.peaks', 'config.json'), '{not valid json', 'utf8');
    expect(() => runUpgrade({ projectRoot: tmpProject, peaksBin: stubPeaksBin })).not.toThrow();
    const result = runUpgrade({ projectRoot: tmpProject, peaksBin: stubPeaksBin });
    expect(result.fromVersion).toBeNull();
  });

  test('always emits a "see docs/UPGRADING-2.0.md" hint, regardless of pass/fail', () => {
    const pass = runUpgrade({ projectRoot: tmpProject, peaksBin: stubPeaksBin });
    writeStubPeaks(Object.values(STEP_TO_FIRST_ARGV).join(','));
    const fail = runUpgrade({ projectRoot: tmpProject, peaksBin: stubPeaksBin });
    expect(pass.nextActions.some((a) => a.includes('docs/UPGRADING-2.0.md'))).toBe(true);
    expect(fail.nextActions.some((a) => a.includes('docs/UPGRADING-2.0.md'))).toBe(true);
  });

  test('record is written even on partial failure (forensic artifact guarantee)', () => {
    writeStubPeaks('standards');
    const result = runUpgrade({ projectRoot: tmpProject, peaksBin: stubPeaksBin });
    expect(result.applied).toBe(false);
    expect(result.upgradeRecordPath).not.toBeNull();
    expect(existsSync(result.upgradeRecordPath as string)).toBe(true);
    const body = readFileSync(result.upgradeRecordPath as string, 'utf8');
    expect(body).toContain('| standards-migrate | fail | 1 |');
  });

  test('memory-extract is skipped (status=skipped) when no artifact files exist in the project', () => {
    // tmpProject is empty (no skills/, no CLAUDE.md, no .claude/rules/)
    const result = runUpgrade({ projectRoot: tmpProject, peaksBin: stubPeaksBin });
    const memStep = result.steps.find((s) => s.name === 'memory-extract');
    expect(memStep).toBeDefined();
    expect(memStep?.status).toBe('skipped');
    expect(result.skippedCount).toBeGreaterThanOrEqual(1);
  });

  test('memory-extract receives the expanded literal file list when artifacts exist', () => {
    // Create the three artifact shapes the umbrella expands
    mkdirSync(join(tmpProject, 'skills', 'peaks-solo'), { recursive: true });
    writeFileSync(join(tmpProject, 'skills', 'peaks-solo', 'SKILL.md'), '# peaks-solo\n', 'utf8');
    mkdirSync(join(tmpProject, '.claude', 'rules', 'common'), { recursive: true });
    writeFileSync(join(tmpProject, '.claude', 'rules', 'common', 'coding-style.md'), '# coding\n', 'utf8');
    writeFileSync(join(tmpProject, 'CLAUDE.md'), '# project\n', 'utf8');

    const result = runUpgrade({ projectRoot: tmpProject, peaksBin: stubPeaksBin });
    const memStep = result.steps.find((s) => s.name === 'memory-extract');
    expect(memStep?.status).toBe('pass');
    // The stub echoes its argv as JSON; the umbrella must have
    // passed literal file paths (NOT the literal '**' glob string).
    expect(memStep?.stdout).not.toContain('**');
    // And the three files we created should each appear in argv
    expect(memStep?.stdout).toContain('SKILL.md');
    expect(memStep?.stdout).toContain('coding-style.md');
    expect(memStep?.stdout).toContain('CLAUDE.md');
  });

  test('memory-extract receives --apply so it actually writes (not dry-run)', () => {
    // Real bug surfaced by ice-cola dogfood 2026-06-12: the
    // umbrella was calling memory-extract without --apply, so
    // memory-service ran in dry-run mode and wrote nothing.
    seedMemoryArtifacts(tmpProject);
    const result = runUpgrade({ projectRoot: tmpProject, peaksBin: stubPeaksBin });
    const memStep = result.steps.find((s) => s.name === 'memory-extract');
    expect(memStep?.status).toBe('pass');
    // The stub echoes argv as JSON — '--apply' must be present
    expect(memStep?.stdout).toContain('--apply');
  });

  test('expandMemoryArtifacts walks .claude/skills/ in addition to skills/ at root', () => {
    // Real bug surfaced by ice-cola dogfood 2026-06-12: the
    // consumer's skills lived at .claude/skills/<name>/SKILL.md,
    // not <root>/skills/<name>/SKILL.md. The umbrella missed
    // 100+ SKILL.md files entirely.
    mkdirSync(join(tmpProject, '.claude', 'skills', 'agent-sort'), { recursive: true });
    writeFileSync(join(tmpProject, '.claude', 'skills', 'agent-sort', 'SKILL.md'), '# stub\n', 'utf8');
    mkdirSync(join(tmpProject, '.claude', 'skills', 'blueprint'), { recursive: true });
    writeFileSync(join(tmpProject, '.claude', 'skills', 'blueprint', 'SKILL.md'), '# stub\n', 'utf8');

    const result = runUpgrade({ projectRoot: tmpProject, peaksBin: stubPeaksBin });
    const memStep = result.steps.find((s) => s.name === 'memory-extract');
    expect(memStep?.status).toBe('pass'); // not skipped — artifacts found
    expect(memStep?.stdout).toContain('agent-sort');
    expect(memStep?.stdout).toContain('blueprint');
  });

  test('ensures .peaks/preferences.json exists after upgrade (graduates project out of 1.x)', () => {
    // Real bug surfaced by ice-cola dogfood 2026-06-12: the
    // upgrade ran with 6/6 pass, but afterwards `peaks upgrade
    // --detect-1x` still returned isOneX=true because the detector
    // keys off `.peaks/preferences.json` existence and nothing in
    // the umbrella created the file when config-migrate said
    // "alreadyAtV2" + skipped.
    expect(existsSync(join(tmpProject, '.peaks', 'preferences.json'))).toBe(false);
    runUpgrade({ projectRoot: tmpProject, peaksBin: stubPeaksBin });
    const prefsPath = join(tmpProject, '.peaks', 'preferences.json');
    expect(existsSync(prefsPath)).toBe(true);
    const body = JSON.parse(readFileSync(prefsPath, 'utf8'));
    expect(body.schema_version).toBe('2.0.0');
  });

  test('preferences.json is preserved if it already exists (no overwrite)', () => {
    mkdirSync(join(tmpProject, '.peaks'), { recursive: true });
    writeFileSync(
      join(tmpProject, '.peaks', 'preferences.json'),
      JSON.stringify({ schema_version: '2.0.0', economyMode: false, customMarker: true }, null, 2),
      'utf8'
    );
    runUpgrade({ projectRoot: tmpProject, peaksBin: stubPeaksBin });
    const body = JSON.parse(readFileSync(join(tmpProject, '.peaks', 'preferences.json'), 'utf8'));
    // User's economyMode=false override survived; the file was not clobbered with defaults.
    expect(body.economyMode).toBe(false);
  });
});
