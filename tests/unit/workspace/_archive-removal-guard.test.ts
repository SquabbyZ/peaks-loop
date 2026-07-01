/**
 * Regression-prevention fence for `.peaks/_archive/` removal (slice
 * 2026-06-27-archive-feature-removal).
 *
 * After this slice lands, NO source file under `src/` may write to or
 * reference `.peaks/_archive/` as a destination. The directory is
 * removed from peaks-loop: no CLI command creates it, no service path
 * targets it, the .gitignore entry is gone, and the PreToolUse hook
 * no longer allow-lists it.
 *
 * The fence below pins every observable surface so a future regression
 * (someone adding a new archive command, re-introducing a `--invalid`
 * branch, etc.) fails the test suite.
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');

function read(filePath: string): string {
  return readFileSync(join(REPO_ROOT, filePath), 'utf8');
}

describe('archive feature removal — guard fence', () => {
  test('deleted command files are gone', () => {
    expect(existsSync(join(REPO_ROOT, 'src/cli/commands/workspace/archive-command.ts'))).toBe(false);
    expect(existsSync(join(REPO_ROOT, 'src/cli/commands/workspace/consolidate-command.ts'))).toBe(false);
    expect(existsSync(join(REPO_ROOT, 'src/services/retrospective/migrate-from-md.ts'))).toBe(false);
  });

  test('deleted service files are gone', () => {
    expect(existsSync(join(REPO_ROOT, 'src/services/workspace/workspace-archive-service.ts'))).toBe(false);
    expect(existsSync(join(REPO_ROOT, 'src/services/workspace/workspace-consolidate-service.ts'))).toBe(false);
  });

  test('deleted test files are gone', () => {
    expect(existsSync(join(REPO_ROOT, 'tests/unit/workspace-archive-service.test.ts'))).toBe(false);
    expect(existsSync(join(REPO_ROOT, 'tests/unit/workspace-consolidate-service.test.ts'))).toBe(false);
    expect(existsSync(join(REPO_ROOT, 'tests/unit/services/retrospective/migrate-from-md.test.ts'))).toBe(false);
  });

  test('.gitignore no longer excludes .peaks/_archive/', () => {
    const gitignore = read('.gitignore');
    expect(gitignore).not.toMatch(/^\.peaks\/_archive\//m);
    expect(gitignore).not.toMatch(/^\.peaks\/_archive$/m);
  });

  test('workspace-commands.ts no longer registers archive/consolidate', () => {
    const src = read('src/cli/commands/workspace-commands.ts');
    expect(src).not.toContain('registerWorkspaceArchiveCommand');
    expect(src).not.toContain('registerWorkspaceConsolidateCommand');
    expect(src).not.toContain('./workspace/archive-command');
    expect(src).not.toContain('./workspace/consolidate-command');
  });

  test('clean-command.ts no longer offers --invalid or _archive paths', () => {
    const src = read('src/cli/commands/workspace/clean-command.ts');
    expect(src).not.toMatch(/--invalid/);
    expect(src).not.toContain('executeSubAgentClean');
    expect(src).not.toContain('_archive');
  });

  test('workspace-clean-service.ts no longer has SubAgentInvalid or INVALID_ARCHIVE', () => {
    const src = read('src/services/workspace/workspace-clean-service.ts');
    expect(src).not.toContain('INVALID_ARCHIVE');
    expect(src).not.toContain('SubAgentInvalid');
    expect(src).not.toContain('executeSubAgentClean');
    expect(src).not.toContain('invalidSidsArchivePath');
    expect(src).not.toContain('_archive');
  });

  test('retrospective-commands.ts no longer registers migrate subcommand', () => {
    const src = read('src/cli/commands/retrospective-commands.ts');
    expect(src).not.toContain('migrateRetrospectiveFromMd');
    expect(src).not.toMatch(/\.command\(['"]migrate['"]\)/);
    expect(src).not.toContain('_archive');
  });

  test('audit red-lines service no longer skips _archive in audit', () => {
    const src = read('src/services/audit/red-lines-service.ts');
    expect(src).not.toMatch(/entry\s*===\s*['_"]_archive['"]/);
  });

  test('claude settings hook template no longer allow-lists _archive', () => {
    const src = read('src/services/workspace/claude-settings-template.ts');
    expect(src).not.toMatch(/m\[1\]\s*!==\s*['_"]_archive['"]/);
  });

  test('live .claude/settings.local.json no longer allow-lists _archive', () => {
    const src = read('.claude/settings.local.json');
    expect(src).not.toContain('_archive');
  });

  test('sid-naming-guard doc comment no longer references _archive', () => {
    const src = read('src/services/workspace/sid-naming-guard.ts');
    expect(src).not.toContain('_archive');
  });

  test('retrospective migrate fixture doc no longer references _archive', () => {
    const src = read('tests/fixtures/plan-cli-baseline/security-findings-full.md');
    expect(src).not.toContain('_archive');
  });

  test('no source file under src/ contains _archive as a non-comment literal', () => {
    // Spot-check by reading the full source tree listing — this is the
    // outermost fence. If a future file reintroduces _archive, this
    // test fails and forces a deliberate decision.
    const candidates = [
      'src/cli/commands/workspace-commands.ts',
      'src/cli/commands/workspace/clean-command.ts',
      'src/cli/commands/workspace/archive-command.ts',
      'src/cli/commands/workspace/consolidate-command.ts',
      'src/cli/commands/retrospective-commands.ts',
      'src/services/workspace/workspace-clean-service.ts',
      'src/services/workspace/workspace-archive-service.ts',
      'src/services/workspace/workspace-consolidate-service.ts',
      'src/services/retrospective/migrate-from-md.ts',
      'src/services/audit/red-lines-service.ts',
      'src/services/workspace/sid-naming-guard.ts',
      'src/services/workspace/claude-settings-template.ts'
    ];
    for (const rel of candidates) {
      const abs = join(REPO_ROOT, rel);
      if (!existsSync(abs)) continue; // deleted files are fine
      const content = readFileSync(abs, 'utf8');
      expect(content, `${rel} must not reference _archive`).not.toContain('_archive');
    }
  });
});