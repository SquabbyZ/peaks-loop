/**
 * Slice 2026-06-16-peaks-solo-auto-scaffold (RD#7) — missing-standards-detector tests.
 *
 * The detector is the building block for the diagnostic emitted by
 * `peaks workspace init` and (downstream) peaks-solo bootstrap. It MUST
 *   - return `missing: true` when `.claude/rules/common/` and
 *     `.claude/rules/<language>/` are absent OR empty (no .md files),
 *   - return `missing: false` when both are populated,
 *   - emit a copy-pasteable remediation hint,
 *   - render paths with the platform-native separator on win32,
 *   - work on POSIX (default for tests).
 *
 * The detector is the TDD unit; integration with `initWorkspace` is
 * exercised in tests/unit/workspace/.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep as pathSep } from 'node:path';

import { detectMissingProjectStandards } from '../../../src/services/standards/missing-standards-detector.js';

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-rd7-detector-'));
}

describe('detectMissingProjectStandards — slice 2026-06-16-peaks-solo-auto-scaffold', () => {
  let project: string;
  beforeEach(() => {
    project = makeProject();
  });
  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  test('returns missing=true when .claude/rules/ does not exist at all', () => {
    const result = detectMissingProjectStandards(project, 'typescript');

    expect(result.missing).toBe(true);
    expect(result.language).toBe('typescript');
    expect(result.path).toContain('.claude');
    expect(result.path).toContain('rules');
    // Remediation MUST be copy-pasteable and reference the actual project path.
    expect(result.remediation).toContain('peaks standards init');
    expect(result.remediation).toContain('--apply');
    expect(result.remediation).toContain(project);
  });

  test('returns missing=true when .claude/rules/ exists but is empty', () => {
    mkdirSync(join(project, '.claude', 'rules'), { recursive: true });
    const result = detectMissingProjectStandards(project, 'typescript');

    expect(result.missing).toBe(true);
    expect(result.remediation).toContain('peaks standards init');
  });

  test('returns missing=true when only common/ is populated (language dir empty)', () => {
    mkdirSync(join(project, '.claude', 'rules', 'common'), { recursive: true });
    writeFileSync(join(project, '.claude', 'rules', 'common', 'coding-style.md'), '# existing');
    mkdirSync(join(project, '.claude', 'rules', 'typescript'), { recursive: true });
    const result = detectMissingProjectStandards(project, 'typescript');

    expect(result.missing).toBe(true);
    expect(result.language).toBe('typescript');
  });

  test('returns missing=true when only typescript/ is populated (common dir empty)', () => {
    mkdirSync(join(project, '.claude', 'rules', 'typescript'), { recursive: true });
    writeFileSync(join(project, '.claude', 'rules', 'typescript', 'coding-style.md'), '# existing');
    mkdirSync(join(project, '.claude', 'rules', 'common'), { recursive: true });
    const result = detectMissingProjectStandards(project, 'typescript');

    expect(result.missing).toBe(true);
  });

  test('returns missing=false when both common/ and <language>/ are populated with .md content', () => {
    mkdirSync(join(project, '.claude', 'rules', 'common'), { recursive: true });
    writeFileSync(join(project, '.claude', 'rules', 'common', 'coding-style.md'), '# common rules');
    writeFileSync(join(project, '.claude', 'rules', 'common', 'code-review.md'), '# review');
    mkdirSync(join(project, '.claude', 'rules', 'typescript'), { recursive: true });
    writeFileSync(join(project, '.claude', 'rules', 'typescript', 'coding-style.md'), '# ts rules');

    const result = detectMissingProjectStandards(project, 'typescript');
    expect(result.missing).toBe(false);
    expect(result.language).toBe('typescript');
    // Remediation is still emitted as a hint for the operator, but missing=false wins.
    expect(result.remediation).toContain('peaks standards init');
  });

  test('treats generic language as "no language-specific dir required" — only common/ matters', () => {
    mkdirSync(join(project, '.claude', 'rules', 'common'), { recursive: true });
    writeFileSync(join(project, '.claude', 'rules', 'common', 'coding-style.md'), '# common rules');

    const result = detectMissingProjectStandards(project, 'generic');
    expect(result.missing).toBe(false);
  });

  test('remediation mentions the detected language so the user knows what scaffold would be generated (AC5)', () => {
    const result = detectMissingProjectStandards(project, 'typescript');
    expect(result.remediation).toMatch(/typescript/i);
  });

  test('renders paths with the platform-native separator (AC6 / win32 mock)', () => {
    // Mutate process.platform via vi.spyOn so the win32 branch fires.
    // On win32, the rendered path MUST use the native separator (\).
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');

    try {
      const result = detectMissingProjectStandards(project, 'typescript');
      expect(result.path).toContain('\\');
      // Remediation also uses the native separator for the project path.
      const expectedNativeProject = project.replace(/\//g, '\\');
      expect(result.remediation).toContain(expectedNativeProject);
    } finally {
      platformSpy.mockRestore();
    }

    // Sanity: when we restore POSIX, the path uses '/'.
    // TODO(plan-3a-task-4): this branch only makes sense on a POSIX test
    // host — on Windows the real `process.platform === 'win32'`, so
    // `detectMissingProjectStandards` keeps rendering backslashes after
    // the mock is restored (and `project` itself is backslash-formatted
    // on Windows, so even a hypothetical POSIX branch would never see a
    // '/' in the path). Gated to POSIX CI per the d4 contract; the
    // mocked win32 branch above still verifies the production logic on
    // every host.
    if (process.platform !== 'win32') {
      const posixResult = detectMissingProjectStandards(project, 'typescript');
      expect(posixResult.path).toContain('/');
      expect(pathSep).toBe('/');
    }
  });

  test('does not require .peaks/standards/ to exist — that pointer system is orthogonal (R3)', () => {
    // .peaks/standards/ may exist (peaks-cli 2.0 pointer) but the detector
    // must ONLY look at .claude/rules/. Create the pointer system and verify
    // the detector still reports missing when .claude/rules/ is empty.
    mkdirSync(join(project, '.peaks', 'standards'), { recursive: true });
    writeFileSync(join(project, '.peaks', 'standards', 'pointer.md'), '# pointer');
    // No .claude/rules/ at all.
    const result = detectMissingProjectStandards(project, 'typescript');
    expect(result.missing).toBe(true);
  });

  test('detects when a sub-directory exists but contains no .md files (R2 edge case)', () => {
    mkdirSync(join(project, '.claude', 'rules', 'common'), { recursive: true });
    mkdirSync(join(project, '.claude', 'rules', 'typescript'), { recursive: true });
    // No .md files inside either dir.
    const result = detectMissingProjectStandards(project, 'typescript');
    expect(result.missing).toBe(true);
  });

  test('path is absolute (consumer projects always pass an absolute --project root)', () => {
    const result = detectMissingProjectStandards(project, 'typescript');
    // The path contains the .claude/rules segments.
    expect(result.path).toContain('.claude');
    expect(result.path).toContain('rules');
    // The path must NOT start with '.' (i.e. must not be a bare relative path).
    expect(result.path.startsWith('.')).toBe(false);
  });

  test('handles pre-existing .claude/rules/<other-lang>/ without false-positive', () => {
    // User has .claude/rules/zh/ (Chinese) but NOT common/ or typescript/.
    // Per R2: detection rule says common + detected-language must both be present.
    mkdirSync(join(project, '.claude', 'rules', 'zh'), { recursive: true });
    writeFileSync(join(project, '.claude', 'rules', 'zh', 'coding-style.md'), '# zh rules');
    mkdirSync(join(project, '.claude', 'rules', 'common'), { recursive: true });

    const result = detectMissingProjectStandards(project, 'typescript');
    expect(result.missing).toBe(true);
  });

  test('remediation includes the explicit --init-standards opt-in hint (AC3)', () => {
    const result = detectMissingProjectStandards(project, 'typescript');
    // The remediation message must hint at the opt-in auto-apply flag.
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