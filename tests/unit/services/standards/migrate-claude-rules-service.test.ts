/**
 * TDD coverage for the 2.0 standards-migrate .claude/rules/ service.
 * Slice: 2026-06-12-standards-migrate-claude-rules.
 *
 * The service backs up the existing `.claude/rules/` tree,
 * replaces it with a 2-line pointer, and scaffolds the 2.0
 * canonical rules at `.peaks/standards/`.
 *
 * Imports the new service via the compiled source path
 * (the service is a plain TS module under src/services/
 * and is consumed via the standard ESM import).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { migrateClaudeRules } from '../../../../src/services/standards/migrate-claude-rules-service.js';

function makeProjectRoot(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-migrate-rules-'));
}

function makeThickOneXRules(projectRoot: string): void {
  const dir = join(projectRoot, '.claude', 'rules', 'common');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'dev-preference.md'), '# 1.x dev-preference\n\n(202 lines — skill-first / dogfood / commit-trailer)\n', 'utf8');
  writeFileSync(join(dir, 'coding-style.md'), '# 1.x coding-style\n', 'utf8');
  writeFileSync(join(dir, 'code-review.md'), '# 1.x code-review\n', 'utf8');
  writeFileSync(join(dir, 'security.md'), '# 1.x security\n', 'utf8');
  const tsDir = join(projectRoot, '.claude', 'rules', 'typescript');
  mkdirSync(tsDir, { recursive: true });
  writeFileSync(join(tsDir, 'coding-style.md'), '# 1.x typescript coding-style\n', 'utf8');
}

describe('migrateClaudeRules — empty / thick / re-run / readonly / no-existing', () => {
  let projectRoot: string;
  beforeEach(() => {
    projectRoot = makeProjectRoot();
  });
  afterEach(() => {
    if (existsSync(projectRoot)) {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('returns wouldChange=false on an empty .claude/rules/', () => {
    mkdirSync(join(projectRoot, '.claude', 'rules'), { recursive: true });
    const result = migrateClaudeRules({ projectRoot, apply: true });
    expect(result.data.backupPath).toBeNull();
    expect(result.data.thinnedFiles).toEqual([]);
    expect(result.data.scaffoldedFiles).toEqual([]);
    expect(result.data.wouldChange).toBe(false);
    // No thick files → nothing was applied (not even the
    // scaffold step, because there's no 1.x content to
    // migrate from).
    expect(result.data.applied).toBe(false);
  });

  test('backs up a thick 1.x .claude/rules/ and replaces with 2-line pointer', () => {
    makeThickOneXRules(projectRoot);
    const result = migrateClaudeRules({ projectRoot, apply: true });
    expect(result.data.backupPath).not.toBeNull();
    expect(existsSync(result.data.backupPath!)).toBe(true);
    expect(result.data.thinnedFiles.length).toBe(5);
    // Each thinned file should now be a 2-line pointer.
    for (const thinned of result.data.thinnedFiles) {
      const body = readFileSync(thinned, 'utf8');
      expect(body).toContain('.peaks/standards/');
      expect(body.split('\n').filter((l) => l.length > 0).length).toBeLessThanOrEqual(2);
    }
  });

  test('scaffolds .peaks/standards/{common,typescript}/ with 2.0 canonical rules when missing', () => {
    makeThickOneXRules(projectRoot);
    const result = migrateClaudeRules({ projectRoot, apply: true });
    expect(result.data.scaffoldedFiles.length).toBeGreaterThan(0);
    // Normalize to forward-slash for cross-platform substring match
    // (Windows returns backslash-separated paths; POSIX returns
    // forward-slash). The substring "standards/common" is the
    // canonical 2.0 path marker.
    const norm = (f: string): string => f.replace(/\\/g, '/');
    expect(
      result.data.scaffoldedFiles.some((f) => norm(f).includes('standards/common'))
    ).toBe(true);
    expect(
      result.data.scaffoldedFiles.some((f) => norm(f).includes('standards/typescript'))
    ).toBe(true);
    const devPref = join(projectRoot, '.peaks', 'standards', 'common', 'dev-preference.md');
    expect(existsSync(devPref)).toBe(true);
    const body = readFileSync(devPref, 'utf8');
    expect(body).toContain('skill-first');
    expect(body).toContain('dogfood');
  });

  test('idempotent: re-running on an already-migrated project is a no-op (no second backup, no second scaffold)', () => {
    makeThickOneXRules(projectRoot);
    const first = migrateClaudeRules({ projectRoot, apply: true });
    const second = migrateClaudeRules({ projectRoot, apply: true });
    // Second run sees .claude/rules/ is already thinned (2-line pointers)
    // — should report wouldChange=false for the thinning step.
    expect(second.data.thinnedFiles).toEqual([]);
    expect(second.data.scaffoldedFiles).toEqual([]);
    // Backup still exists from the first run.
    expect(existsSync(first.data.backupPath!)).toBe(true);
  });

  test('dry-run mode: reports wouldChange without writing', () => {
    makeThickOneXRules(projectRoot);
    const result = migrateClaudeRules({ projectRoot, apply: false });
    expect(result.data.wouldChange).toBe(true);
    expect(result.data.applied).toBe(false);
    // In dry-run, the backup path is NOT returned (no path
    // is created on disk; reporting the path would be a
    // dry-run leak).
    expect(result.data.backupPath).toBeNull();
    // Original .claude/rules/ files are NOT modified.
    const devPref = join(projectRoot, '.claude', 'rules', 'common', 'dev-preference.md');
    const body = readFileSync(devPref, 'utf8');
    expect(body).toContain('202 lines');
    expect(body).not.toContain('.peaks/standards/');
    // .peaks/standards/ not created in dry-run.
    expect(
      existsSync(join(projectRoot, '.peaks', 'standards'))
    ).toBe(false);
  });

  test('preserves existing .peaks/standards/ content (does not overwrite)', () => {
    makeThickOneXRules(projectRoot);
    // Pre-scaffold .peaks/standards/ with custom content.
    const stdDir = join(projectRoot, '.peaks', 'standards', 'common');
    mkdirSync(stdDir, { recursive: true });
    writeFileSync(
      join(stdDir, 'dev-preference.md'),
      '# user-customized dev-preference — DO NOT OVERWRITE\n',
      'utf8'
    );
    const result = migrateClaudeRules({ projectRoot, apply: true });
    const body = readFileSync(
      join(projectRoot, '.peaks', 'standards', 'common', 'dev-preference.md'),
      'utf8'
    );
    expect(body).toContain('user-customized');
    // scaffoldedFiles should not include the pre-existing file.
    expect(
      result.data.scaffoldedFiles.some(
        (f) => f.endsWith('dev-preference.md')
      )
    ).toBe(false);
  });
});
