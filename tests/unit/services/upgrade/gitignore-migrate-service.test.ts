/**
 * TDD coverage for the .gitignore 1.x → 2.0 migration service.
 *
 * Surfaced by ice-cola dogfood 2026-06-12:
 *   - 1.x consumer's .gitignore ended with `/.peaks/` (wholesale).
 *   - 2.0 expects .peaks/standards/, .peaks/memory/*.md (durable),
 *     .peaks/PROJECT.md to be TRACKED.
 *   - Wholesale ignore silently hid 100% of the 2.0 tracked
 *     artifacts.
 *
 * Service contract: takes a .gitignore content string, returns
 * the migrated content + diff summary. Pure function (no FS).
 * The umbrella calls the FS variant with backup + write.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  migrateGitignoreContent,
  migrateGitignoreFile,
  isStaleWholesalePeaksRule,
  CANONICAL_2_0_PEAKS_BLOCK,
} from '../../../../src/services/upgrade/gitignore-migrate-service.js';

describe('isStaleWholesalePeaksRule', () => {
  test('matches /.peaks/ (leading slash, trailing slash)', () => {
    expect(isStaleWholesalePeaksRule('/.peaks/')).toBe(true);
  });
  test('matches .peaks/ (no leading slash, trailing slash)', () => {
    expect(isStaleWholesalePeaksRule('.peaks/')).toBe(true);
  });
  test('matches .peaks (no slash)', () => {
    expect(isStaleWholesalePeaksRule('.peaks')).toBe(true);
  });
  test('matches /.peaks (leading slash only)', () => {
    expect(isStaleWholesalePeaksRule('/.peaks')).toBe(true);
  });
  test('does NOT match granular sub-paths', () => {
    expect(isStaleWholesalePeaksRule('.peaks/_runtime/')).toBe(false);
    expect(isStaleWholesalePeaksRule('.peaks/preferences.json')).toBe(false);
    expect(isStaleWholesalePeaksRule('.peaks/memory/upgrade-2.0-*.md')).toBe(false);
  });
  test('does NOT match unrelated rules', () => {
    expect(isStaleWholesalePeaksRule('node_modules/')).toBe(false);
    expect(isStaleWholesalePeaksRule('')).toBe(false);
    expect(isStaleWholesalePeaksRule('# .peaks/ comment')).toBe(false);
  });
  test('handles trailing whitespace', () => {
    expect(isStaleWholesalePeaksRule('.peaks/  ')).toBe(true);
    expect(isStaleWholesalePeaksRule('  .peaks/  ')).toBe(true);
  });
});

describe('migrateGitignoreContent', () => {
  test('replaces wholesale /.peaks/ with the canonical 2.0 block', () => {
    const before = 'node_modules/\ncoverage/\n/.peaks/\n';
    const result = migrateGitignoreContent(before);
    expect(result.changed).toBe(true);
    expect(result.removedRules).toContain('/.peaks/');
    expect(result.content).not.toMatch(/^\/?\.peaks\/?\s*$/m);
    expect(result.content).toContain('.peaks/_runtime/');
    expect(result.content).toContain('.peaks/preferences.json');
    expect(result.content).toContain('.peaks/memory/upgrade-2.0-*.md');
    // Non-.peaks rules preserved
    expect(result.content).toContain('node_modules/');
    expect(result.content).toContain('coverage/');
  });

  test('replaces .peaks/ (no leading slash) with the canonical 2.0 block', () => {
    const before = 'node_modules/\n.peaks/\n';
    const result = migrateGitignoreContent(before);
    expect(result.changed).toBe(true);
    expect(result.removedRules).toContain('.peaks/');
    expect(result.content).toContain('.peaks/_runtime/');
  });

  test('replaces bare .peaks (no slash at all) with the canonical 2.0 block', () => {
    const before = '.peaks\n';
    const result = migrateGitignoreContent(before);
    expect(result.changed).toBe(true);
    expect(result.removedRules).toContain('.peaks');
    expect(result.content).toContain('.peaks/_runtime/');
  });

  test('removes multiple wholesale .peaks rules in a single pass', () => {
    const before = '.peaks/\n# stuff\n/.peaks/\nnode_modules/\n.peaks\n';
    const result = migrateGitignoreContent(before);
    expect(result.changed).toBe(true);
    expect(result.removedRules.length).toBe(3);
    expect(result.content).toContain('node_modules/');
    expect(result.content).toContain('# stuff');
  });

  test('is idempotent: re-running on a migrated .gitignore is a no-op', () => {
    const before = 'node_modules/\n/.peaks/\n';
    const first = migrateGitignoreContent(before);
    expect(first.changed).toBe(true);
    const second = migrateGitignoreContent(first.content);
    expect(second.changed).toBe(false);
    expect(second.removedRules).toEqual([]);
    expect(second.content).toBe(first.content);
  });

  test('no-op when .gitignore has no .peaks rules at all', () => {
    const before = 'node_modules/\ncoverage/\n';
    const result = migrateGitignoreContent(before);
    expect(result.changed).toBe(false);
    expect(result.removedRules).toEqual([]);
    expect(result.content).toBe(before);
  });

  test('preserves comments that LOOK like .peaks rules but are commented out', () => {
    const before = 'node_modules/\n# .peaks/ would have been here\n';
    const result = migrateGitignoreContent(before);
    expect(result.changed).toBe(false);
    expect(result.content).toContain('# .peaks/ would have been here');
  });

  test('CANONICAL_2_0_PEAKS_BLOCK exposes the documented ignore set', () => {
    expect(CANONICAL_2_0_PEAKS_BLOCK).toContain('.peaks/_runtime/');
    expect(CANONICAL_2_0_PEAKS_BLOCK).toContain('.peaks/_sub_agents/');
    expect(CANONICAL_2_0_PEAKS_BLOCK).toContain('.peaks/preferences.json');
    expect(CANONICAL_2_0_PEAKS_BLOCK).toContain('.peaks/memory/upgrade-2.0-*.md');
  });

  test('replacement preserves trailing newline / whitespace tolerance', () => {
    const before = 'node_modules/\n/.peaks/';
    const result = migrateGitignoreContent(before);
    expect(result.changed).toBe(true);
    expect(result.content.endsWith('\n')).toBe(true);
  });
});

describe('migrateGitignoreFile', () => {
  let tmpProject: string;

  beforeEach(() => {
    tmpProject = mkdtempSync(join(tmpdir(), 'peaks-gitignore-migrate-'));
  });
  afterEach(() => {
    try {
      rmSync(tmpProject, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  test('returns missing=true and no write when .gitignore does not exist', () => {
    const result = migrateGitignoreFile({ projectRoot: tmpProject, apply: true });
    expect(result.missing).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.appliedWrite).toBe(false);
    expect(result.backupPath).toBeNull();
  });

  test('dry-run: returns diff but does not write the file or backup', () => {
    writeFileSync(join(tmpProject, '.gitignore'), 'node_modules/\n/.peaks/\n', 'utf8');
    const result = migrateGitignoreFile({ projectRoot: tmpProject, apply: false });
    expect(result.changed).toBe(true);
    expect(result.appliedWrite).toBe(false);
    expect(result.backupPath).toBeNull();
    // File on disk is still the original
    expect(readFileSync(join(tmpProject, '.gitignore'), 'utf8')).toContain('/.peaks/');
  });

  test('apply: writes migrated content + creates timestamped backup', () => {
    writeFileSync(join(tmpProject, '.gitignore'), 'node_modules/\n/.peaks/\n', 'utf8');
    const result = migrateGitignoreFile({ projectRoot: tmpProject, apply: true });
    expect(result.changed).toBe(true);
    expect(result.appliedWrite).toBe(true);
    expect(result.backupPath).toMatch(/\.gitignore\.peaks-2\.0-backup-/);
    // File on disk is now migrated
    const after = readFileSync(join(tmpProject, '.gitignore'), 'utf8');
    expect(after).not.toMatch(/^\/?\.peaks\/?\s*$/m);
    expect(after).toContain('.peaks/_runtime/');
    expect(after).toContain('node_modules/');
    // Backup carries the ORIGINAL content
    const backupContent = readFileSync(result.backupPath as string, 'utf8');
    expect(backupContent).toContain('/.peaks/');
    expect(backupContent).not.toContain('.peaks/_runtime/');
  });

  test('apply on an already-migrated file is a no-op (no backup)', () => {
    writeFileSync(join(tmpProject, '.gitignore'), 'node_modules/\ncoverage/\n', 'utf8');
    const result = migrateGitignoreFile({ projectRoot: tmpProject, apply: true });
    expect(result.changed).toBe(false);
    expect(result.appliedWrite).toBe(false);
    expect(result.backupPath).toBeNull();
    // No backup file was created
    const files = readdirSync(tmpProject);
    expect(files.filter((f: string) => f.includes('peaks-2.0-backup')).length).toBe(0);
  });
});
