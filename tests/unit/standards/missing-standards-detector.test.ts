/**
 * Slice 2026-06-16-peaks-code-auto-scaffold (RD#7) — missing-standards-detector tests.
 *
 * The detector is the building block for the diagnostic emitted by
 * `peaks workspace init` and (downstream) peaks-code bootstrap. It MUST
 *   - return `missing: true` when `.peaks/standards/common/` and
 *     `.peaks/standards/<language>/` are absent OR empty (no .md files),
 *   - return `missing: false` when both are populated,
 *   - emit a copy-pasteable remediation hint,
 *   - render paths with the platform-native separator on win32,
 *   - work on POSIX (default for tests).
 *
 * The detector is the TDD unit; integration with `initWorkspace` is
 * exercised in tests/unit/workspace/.
 *
 * Slice 2026-07-15: detector switched from `.claude/rules/` to the
 * 2.0 canonical `.peaks/standards/` (matching `peaks standards init`
 * and `peaks standards update`).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep as pathSep } from 'node:path';

import { detectMissingProjectStandards } from '../../../src/services/standards/missing-standards-detector.js';

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-rd7-detector-'));
}

describe('detectMissingProjectStandards — slice 2026-06-16-peaks-code-auto-scaffold (2.0 path)', () => {
  let project: string;
  beforeEach(() => {
    project = makeProject();
  });
  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  test('returns missing=true when .peaks/standards/ does not exist at all', () => {
    const result = detectMissingProjectStandards(project, 'typescript');

    expect(result.missing).toBe(true);
    expect(result.language).toBe('typescript');
    expect(result.path).toContain('.peaks');
    expect(result.path).toContain('standards');
    // Remediation MUST be copy-pasteable and reference the actual project path.
    expect(result.remediation).toContain('peaks standards init');
    expect(result.remediation).toContain('--apply');
    expect(result.remediation).toContain(project);
  });

  test('returns missing=true when .peaks/standards/ exists but is empty', () => {
    mkdirSync(join(project, '.peaks', 'standards'), { recursive: true });
    const result = detectMissingProjectStandards(project, 'typescript');

    expect(result.missing).toBe(true);
    expect(result.remediation).toContain('peaks standards init');
  });

  test('returns missing=true when only common/ is populated (language dir empty)', () => {
    mkdirSync(join(project, '.peaks', 'standards', 'common'), { recursive: true });
    writeFileSync(join(project, '.peaks', 'standards', 'common', 'coding-style.md'), '# existing');
    mkdirSync(join(project, '.peaks', 'standards', 'typescript'), { recursive: true });
    const result = detectMissingProjectStandards(project, 'typescript');

    expect(result.missing).toBe(true);
    expect(result.language).toBe('typescript');
  });

  test('returns missing=true when only typescript/ is populated (common dir empty)', () => {
    mkdirSync(join(project, '.peaks', 'standards', 'typescript'), { recursive: true });
    writeFileSync(join(project, '.peaks', 'standards', 'typescript', 'coding-style.md'), '# existing');
    mkdirSync(join(project, '.peaks', 'standards', 'common'), { recursive: true });
    const result = detectMissingProjectStandards(project, 'typescript');

    expect(result.missing).toBe(true);
  });

  test('returns missing=false when both common/ and <language>/ are populated with .md content', () => {
    mkdirSync(join(project, '.peaks', 'standards', 'common'), { recursive: true });
    writeFileSync(join(project, '.peaks', 'standards', 'common', 'coding-style.md'), '# common rules');
    writeFileSync(join(project, '.peaks', 'standards', 'common', 'code-review.md'), '# review');
    mkdirSync(join(project, '.peaks', 'standards', 'typescript'), { recursive: true });
    writeFileSync(join(project, '.peaks', 'standards', 'typescript', 'coding-style.md'), '# ts rules');

    const result = detectMissingProjectStandards(project, 'typescript');
    expect(result.missing).toBe(false);
    expect(result.language).toBe('typescript');
    // Remediation is still emitted as a hint for the operator, but missing=false wins.
    expect(result.remediation).toContain('peaks standards init');
  });

  test('treats generic language as "no language-specific dir required" — only common/ matters', () => {
    mkdirSync(join(project, '.peaks', 'standards', 'common'), { recursive: true });
    writeFileSync(join(project, '.peaks', 'standards', 'common', 'coding-style.md'), '# common rules');

    const result = detectMissingProjectStandards(project, 'generic');
    expect(result.missing).toBe(false);
  });

  test('remediation mentions the detected language so the user knows what scaffold would be generated (AC5)', () => {
    const result = detectMissingProjectStandards(project, 'typescript');
    expect(result.remediation).toMatch(/typescript/i);
  });

  test('renders paths with the platform-native separator (AC6 / win32 mock)', () => {
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');

    try {
      const result = detectMissingProjectStandards(project, 'typescript');
      expect(result.path).toContain('\\');
      const expectedNativeProject = project.replace(/\//g, '\\');
      expect(result.remediation).toContain(expectedNativeProject);
    } finally {
      platformSpy.mockRestore();
    }

    if (process.platform !== 'win32') {
      const posixResult = detectMissingProjectStandards(project, 'typescript');
      expect(posixResult.path).toContain('/');
      expect(pathSep).toBe('/');
    }
  });

  test('does not require .claude/rules/ to exist — that legacy 1.x tree is orthogonal (R3)', () => {
    // The detector only inspects the 2.0 canonical location
    // (`.peaks/standards/`). A legacy `.claude/rules/` may exist (1.x
    // install footprint) but does NOT satisfy the check.
    mkdirSync(join(project, '.claude', 'rules', 'common'), { recursive: true });
    writeFileSync(join(project, '.claude', 'rules', 'common', 'coding-style.md'), '# 1.x');
    mkdirSync(join(project, '.claude', 'rules', 'typescript'), { recursive: true });
    writeFileSync(join(project, '.claude', 'rules', 'typescript', 'coding-style.md'), '# 1.x ts');
    // No .peaks/standards/ at all.
    const result = detectMissingProjectStandards(project, 'typescript');
    expect(result.missing).toBe(true);
  });

  test('detects when a sub-directory exists but contains no .md files (R2 edge case)', () => {
    mkdirSync(join(project, '.peaks', 'standards', 'common'), { recursive: true });
    mkdirSync(join(project, '.peaks', 'standards', 'typescript'), { recursive: true });
    const result = detectMissingProjectStandards(project, 'typescript');
    expect(result.missing).toBe(true);
  });

  test('path is absolute (consumer projects always pass an absolute --project root)', () => {
    const result = detectMissingProjectStandards(project, 'typescript');
    expect(result.path).toContain('.peaks');
    expect(result.path).toContain('standards');
    expect(result.path.startsWith('.')).toBe(false);
  });

  test('handles pre-existing .peaks/standards/<other-lang>/ without false-positive', () => {
    mkdirSync(join(project, '.peaks', 'standards', 'zh'), { recursive: true });
    writeFileSync(join(project, '.peaks', 'standards', 'zh', 'coding-style.md'), '# zh rules');
    mkdirSync(join(project, '.peaks', 'standards', 'common'), { recursive: true });

    const result = detectMissingProjectStandards(project, 'typescript');
    expect(result.missing).toBe(true);
  });

  test('remediation includes the explicit --init-standards opt-in hint (AC3)', () => {
    const result = detectMissingProjectStandards(project, 'typescript');
    expect(result.remediation).toMatch(/--init-standards|init-standards/);
  });

  test('result shape is the documented envelope', () => {
    const result = detectMissingProjectStandards(project, 'python');
    expect(result).toEqual({
      missing: expect.any(Boolean),
      path: expect.any(String),
      remediation: expect.any(String),
      language: expect.any(String)
    });
    expect(['generic', 'typescript', 'javascript', 'python', 'go', 'rust']).toContain(result.language);
  });
});