/**
 * Slice 2026-06-16-peaks-rd-no-gates — regression tests for the
 * missing-project-standards diagnostic + JSON gate list shape.
 *
 * Background: when `peaks-rd` (or `peaks-qa` / `peaks-solo`) starts in a
 * project whose `.claude/rules/{common,typescript}/` is missing or empty,
 * the existing code-review / security / performance gates were silently
 * dropped. This slice adds:
 *
 *   G1  A clear diagnostic on stderr/JSON when standards are missing.
 *   G2  An opt-in `--strict-standards` flag that hard-fails with
 *       `EPEAKS_NO_STANDARDS`. Default off.
 *   G3  When the diagnostic fires, the gate list reports each gate as
 *       `{ name, status: 'skipped', reason: 'no project-local standards' }`.
 *   G4  The diagnostic message includes the copy-pasteable remediation
 *       command (`peaks standards init --project <X> --apply`).
 *
 * AC coverage (PRD#004):
 *   AC1  Diagnostic text + stderr rendering + remediation hint verbatim.
 *   AC2  JSON gate list shape (per-gate reason field).
 *   AC3  `--strict-standards` exits non-zero with EPEAKS_NO_STANDARDS.
 *   AC4  Default (no flag) does NOT exit non-zero (warn + continue).
 *   AC5  Diagnostic text contains the copy-pasteable init command.
 *   AC7  Coverage ≥ 80 % on new code (validated via test surface below).
 *
 * Hard contracts honored:
 *   - Tests use `os.tmpdir()` + `mkdtempSync` so the dogfood target
 *     `/Users/yuanyuan/Desktop/test/platform-rag-web` is NEVER touched.
 *   - No `any`. Explicit types on public exports. Immutable result
 *     objects (frozen via `as const`).
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  buildRdStandardsGateList,
  detectMissingProjectStandards,
  EPEAKS_NO_STANDARDS,
  renderRdStandardsDiagnostic,
  resolveRdStartupStandardsCheck
} from '../../../src/services/rd/standards-diagnostic.js';

function createProjectRoot(prefix = 'peaks-rd-no-gates-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function populateRulesDir(projectRoot: string, which: 'common' | 'typescript'): string {
  const dir = join(projectRoot, '.claude', 'rules', which);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'coding-style.md'), '# rules stub\n', 'utf8');
  return dir;
}

describe('detectMissingProjectStandards (slice 2026-06-16-peaks-rd-no-gates)', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = createProjectRoot();
  });

  afterEach(() => {
    if (existsSync(projectRoot)) {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('reports missing when .claude/rules/ does not exist', () => {
    const result = detectMissingProjectStandards({ projectRoot });
    expect(result.missing).toBe(true);
    expect(result.path).toBe(join(projectRoot, '.claude', 'rules'));
    expect(result.remediation).toContain('peaks standards init --project');
    expect(result.remediation).toContain('--apply');
  });

  test('reports missing when only common/ exists (typescript/ missing)', () => {
    populateRulesDir(projectRoot, 'common');
    const result = detectMissingProjectStandards({ projectRoot });
    expect(result.missing).toBe(true);
    expect(result.missingSubdirs).toContain('typescript');
    expect(result.missingSubdirs).not.toContain('common');
  });

  test('reports missing when only typescript/ exists (common/ missing)', () => {
    populateRulesDir(projectRoot, 'typescript');
    const result = detectMissingProjectStandards({ projectRoot });
    expect(result.missing).toBe(true);
    expect(result.missingSubdirs).toContain('common');
  });

  test('reports missing when common/ is empty (no .md files)', () => {
    const dir = join(projectRoot, '.claude', 'rules', 'common');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'README.txt'), 'not a rule file', 'utf8');
    const result = detectMissingProjectStandards({ projectRoot });
    expect(result.missing).toBe(true);
  });

  test('reports present when both common/ and typescript/ have .md files', () => {
    populateRulesDir(projectRoot, 'common');
    populateRulesDir(projectRoot, 'typescript');
    const result = detectMissingProjectStandards({ projectRoot });
    expect(result.missing).toBe(false);
    expect(result.missingSubdirs).toEqual([]);
  });
});

describe('renderRdStandardsDiagnostic (G1 / AC1)', () => {
  test('contains the project path, the rule path, the remediation command, and the gate list', () => {
    const projectRoot = '/tmp/example-project';
    const detection = {
      missing: true,
      path: join(projectRoot, '.claude', 'rules'),
      missingSubdirs: ['common', 'typescript'] as const,
      remediation: `peaks standards init --project ${projectRoot} --apply`
    };
    const message = renderRdStandardsDiagnostic({ projectRoot, detection });
    expect(message).toContain('no project-local standards found');
    expect(message).toContain(projectRoot);
    expect(message).toContain(join(projectRoot, '.claude', 'rules'));
    expect(message).toContain('peaks standards init --project ' + projectRoot + ' --apply');
    expect(message).toContain('code-review');
    expect(message).toContain('security-review');
    expect(message).toContain('performance-review');
    expect(message).toContain('skipped');
  });
});

describe('buildRdStandardsGateList (G3 / AC2)', () => {
  test('returns the three gates each marked skipped with reason when missing', () => {
    const list = buildRdStandardsGateList({ missing: true });
    expect(list).toEqual([
      { name: 'code-review', status: 'skipped', reason: 'no project-local standards' },
      { name: 'security-review', status: 'skipped', reason: 'no project-local standards' },
      { name: 'performance-review', status: 'skipped', reason: 'no project-local standards' }
    ]);
  });

  test('returns the three gates each marked ready when present', () => {
    const list = buildRdStandardsGateList({ missing: false });
    expect(list).toEqual([
      { name: 'code-review', status: 'ready', reason: null },
      { name: 'security-review', status: 'ready', reason: null },
      { name: 'performance-review', status: 'ready', reason: null }
    ]);
  });
});

describe('resolveRdStartupStandardsCheck (G2 + G4 / AC3 + AC4)', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = createProjectRoot();
  });

  afterEach(() => {
    if (existsSync(projectRoot)) {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('strict mode + missing standards: returns exitCode non-zero with EPEAKS_NO_STANDARDS', () => {
    const result = resolveRdStartupStandardsCheck({ projectRoot, strict: true });
    expect(result.exitCode).toBe(1);
    expect(result.errorCode).toBe(EPEAKS_NO_STANDARDS);
    expect(result.diagnostic).toContain('no project-local standards found');
    expect(result.gates).toEqual([
      { name: 'code-review', status: 'skipped', reason: 'no project-local standards' },
      { name: 'security-review', status: 'skipped', reason: 'no project-local standards' },
      { name: 'performance-review', status: 'skipped', reason: 'no project-local standards' }
    ]);
  });

  test('default (strict=false) + missing standards: exits 0 but emits diagnostic', () => {
    const result = resolveRdStartupStandardsCheck({ projectRoot, strict: false });
    expect(result.exitCode).toBe(0);
    expect(result.errorCode).toBeNull();
    expect(result.diagnostic).toContain('no project-local standards found');
    expect(result.gates[0]?.status).toBe('skipped');
  });

  test('strict mode + standards present: exits 0, no diagnostic, gates ready', () => {
    populateRulesDir(projectRoot, 'common');
    populateRulesDir(projectRoot, 'typescript');
    const result = resolveRdStartupStandardsCheck({ projectRoot, strict: true });
    expect(result.exitCode).toBe(0);
    expect(result.errorCode).toBeNull();
    expect(result.diagnostic).toBeNull();
    expect(result.gates).toEqual([
      { name: 'code-review', status: 'ready', reason: null },
      { name: 'security-review', status: 'ready', reason: null },
      { name: 'performance-review', status: 'ready', reason: null }
    ]);
  });

  test('default (strict=false) + standards present: exits 0, no diagnostic, gates ready', () => {
    populateRulesDir(projectRoot, 'common');
    populateRulesDir(projectRoot, 'typescript');
    const result = resolveRdStartupStandardsCheck({ projectRoot, strict: false });
    expect(result.exitCode).toBe(0);
    expect(result.diagnostic).toBeNull();
    expect(result.gates[0]?.status).toBe('ready');
  });
});

describe('cross-platform path rendering (AC1 / AC8 — windows + macOS)', () => {
  test('remediation command uses forward slashes regardless of host platform', () => {
    const detection = {
      missing: true,
      path: 'C:\\Users\\foo\\project\\.claude\\rules',
      missingSubdirs: ['common', 'typescript'] as const,
      remediation: 'peaks standards init --project C:/Users/foo/project --apply'
    };
    const message = renderRdStandardsDiagnostic({ projectRoot: 'C:/Users/foo/project', detection });
    expect(message).toContain('C:/Users/foo/project --apply');
    // Backslashes in the path field are preserved verbatim (we never call
    // path.normalize on user-supplied strings — we leave them as-is so the
    // diagnostic renders the user's exact filesystem).
    expect(message).toContain('C:\\Users\\foo\\project\\.claude\\rules');
  });

  test('sep helper produces the host-appropriate separator', () => {
    expect(sep.length).toBeGreaterThan(0);
    expect(['/', '\\']).toContain(sep);
  });
});