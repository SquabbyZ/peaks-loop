/**
 * TDD coverage for `peaks standards migrate --from-claude-rules`.
 *
 * Fix #3a of "peaks upgrade --to 2.0" sub-step regressions:
 * the umbrella service expected this flag but the CLI rejected
 * it as 'unknown option'. This test pins the wiring between
 * the new CLI flag and the existing migrateClaudeRules service.
 *
 * Backward compat is asserted in a sibling test in
 * cli-program.core.test.ts (the legacy `peaks standards migrate`
 * without the flag must still call migrateStandards).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { parseJsonOutput, resetCliProgramMocks, runCommand, writeUserConfig } from '../../cli-program-test-utils.js';

interface MigrateClaudeRulesData {
  applied: boolean;
  wouldChange: boolean;
  backupPath: string | null;
  thinnedFiles: readonly string[];
  scaffoldedFiles: readonly string[];
  preservedFiles: readonly string[];
  nextActions: readonly string[];
}

function asData(output: { data: unknown }): MigrateClaudeRulesData {
  return output.data as MigrateClaudeRulesData;
}

let tmpProject: string;

function makeThickOneXRules(projectRoot: string): void {
  const dir = join(projectRoot, '.claude', 'rules', 'common');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'dev-preference.md'), '# 1.x dev-preference\n\n(skill-first / dogfood / commit-trailer)\n', 'utf8');
  writeFileSync(join(dir, 'coding-style.md'), '# 1.x coding-style\n', 'utf8');
  writeFileSync(join(dir, 'code-review.md'), '# 1.x code-review\n', 'utf8');
  writeFileSync(join(dir, 'security.md'), '# 1.x security\n', 'utf8');
  const tsDir = join(projectRoot, '.claude', 'rules', 'typescript');
  mkdirSync(tsDir, { recursive: true });
  writeFileSync(join(tsDir, 'coding-style.md'), '# 1.x ts/coding-style\n', 'utf8');
}

beforeEach(() => {
  process.exitCode = undefined;
  resetCliProgramMocks();
  writeUserConfig();
  tmpProject = mkdtempSync(join(tmpdir(), 'peaks-cli-standards-migrate-'));
});

afterEach(() => {
  try {
    rmSync(tmpProject, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('peaks standards migrate --from-claude-rules', () => {
  test('--apply backs up .claude/rules/ and scaffolds .peaks/standards/', async () => {
    makeThickOneXRules(tmpProject);
    const result = await runCommand([
      'standards', 'migrate', '--from-claude-rules',
      '--project', tmpProject,
      '--apply',
      '--json',
    ]);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('standards.migrate');
    const data = asData(output);
    expect(data.applied).toBe(true);
    expect(data.wouldChange).toBe(true);
    expect(data.backupPath).toMatch(/\.peaks-2\.0-backup-/);
    expect(Array.isArray(data.thinnedFiles)).toBe(true);
    expect(data.thinnedFiles.length).toBeGreaterThan(0);
    expect(Array.isArray(data.scaffoldedFiles)).toBe(true);
    expect(data.scaffoldedFiles.length).toBeGreaterThan(0);

    // Filesystem effect: every thinned file became a 2-line pointer
    const sampleFile = join(tmpProject, '.claude', 'rules', 'common', 'coding-style.md');
    expect(existsSync(sampleFile)).toBe(true);
    const body = readFileSync(sampleFile, 'utf8');
    expect(body).toContain('Canonical peaks-cli 2.0 rules live at');

    // Scaffold present
    expect(existsSync(join(tmpProject, '.peaks', 'standards'))).toBe(true);
  });

  test('default (no --apply) is dry-run: wouldChange=true, applied=false, no filesystem writes', async () => {
    makeThickOneXRules(tmpProject);
    const result = await runCommand([
      'standards', 'migrate', '--from-claude-rules',
      '--project', tmpProject,
      '--json',
    ]);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(true);
    const data = asData(output);
    expect(data.applied).toBe(false);
    expect(data.wouldChange).toBe(true);

    // Filesystem unchanged: original .md file still has its 1.x content
    const sampleFile = join(tmpProject, '.claude', 'rules', 'common', 'dev-preference.md');
    const body = readFileSync(sampleFile, 'utf8');
    expect(body).toContain('1.x dev-preference');
    expect(body).not.toContain('Canonical peaks-cli 2.0 rules live at');

    // No .peaks/standards/ scaffold under dry-run
    expect(existsSync(join(tmpProject, '.peaks', 'standards'))).toBe(false);
  });

  test('on a project with no .claude/rules/, --from-claude-rules is a no-op (wouldChange=false)', async () => {
    const result = await runCommand([
      'standards', 'migrate', '--from-claude-rules',
      '--project', tmpProject,
      '--apply',
      '--json',
    ]);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(true);
    const data = asData(output);
    expect(data.wouldChange).toBe(false);
    expect(data.thinnedFiles).toEqual([]);
  });
});
