import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { planMigrate1_4_1, applyMigrate1_4_1 } from '../../../../src/services/workspace/migrate-1-4-1-service.js';

describe('R004 peaks workspace migrate-1-4-1', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'peaks-r004-'));
  });

  afterEach(() => {
    if (existsSync(projectRoot)) rmSync(projectRoot, { recursive: true, force: true });
  });

  // Seed a fake project with:
  //   - 1 session in legacy location (`.peaks/<sid>/<role>/<file>.md`)
  //   - Some files duplicated in canonical (`.peaks/_runtime/<sid>/<role>/<file>.md`)
  //   - Some files only in legacy (will be moved)
  //   - 1 file with content mismatch (will be reported as conflict, NOT moved)
  //   - 1 per-request file (qa/test-cases/<rid>.md) in legacy (will be moved)
  function seed(): void {
    const sid = '2026-05-15-session-r004test';
    const legacyRoot = join(projectRoot, '.peaks', sid);
    const canonicalRoot = join(projectRoot, '.peaks', '_runtime', sid);

    // Legacy per-session files.
    mkdirSync(join(legacyRoot, 'rd'), { recursive: true });
    mkdirSync(join(legacyRoot, 'qa'), { recursive: true });
    writeFileSync(join(legacyRoot, 'rd', 'tech-doc.md'), 'legacy tech-doc\n');
    writeFileSync(join(legacyRoot, 'rd', 'code-review.md'), 'legacy code-review\n');
    mkdirSync(join(legacyRoot, 'qa', 'requests'), { recursive: true });
    mkdirSync(join(legacyRoot, 'qa', 'test-cases'), { recursive: true });
    writeFileSync(join(legacyRoot, 'qa', 'security-findings.md'), 'legacy security\n');
    writeFileSync(join(legacyRoot, 'qa', 'requests', '001-r001.md'), 'state machine\n');
    writeFileSync(join(legacyRoot, 'qa', 'test-cases', 'r001.md'), 'legacy test-cases-r001\n');

    // Canonical copies: identical content for tech-doc + security (will be removed from legacy);
    // DIFFERENT content for code-review (will be reported as conflict, NOT moved).
    mkdirSync(join(canonicalRoot, 'rd'), { recursive: true });
    mkdirSync(join(canonicalRoot, 'qa'), { recursive: true });
    writeFileSync(join(canonicalRoot, 'rd', 'tech-doc.md'), 'legacy tech-doc\n');
    writeFileSync(join(canonicalRoot, 'rd', 'code-review.md'), 'CANONICAL code-review (DIFFERENT)\n');
    writeFileSync(join(canonicalRoot, 'qa', 'security-findings.md'), 'legacy security\n');
    // No canonical copy of test-cases/r001.md → legacy will be moved.
  }

  it('dry-run: reports the plan without modifying any files', () => {
    seed();
    const result = planMigrate1_4_1(projectRoot);
    expect(result.applied).toBe(false);
    expect(result.movedCount).toBe(0);
    expect(result.plan.length).toBeGreaterThan(0);
    // Verify the file is still on disk at the legacy path.
    expect(existsSync(join(projectRoot, '.peaks', '2026-05-15-session-r004test', 'rd', 'tech-doc.md'))).toBe(true);
    // The canonical tech-doc should also still be there (dry-run didn't move it).
    expect(existsSync(join(projectRoot, '.peaks', '_runtime', '2026-05-15-session-r004test', 'rd', 'tech-doc.md'))).toBe(true);
  });

  it('apply: moves legacy-only files to canonical, removes identical-content duplicates from legacy, reports content-mismatch as conflict', () => {
    seed();
    const result = applyMigrate1_4_1(projectRoot);
    expect(result.applied).toBe(true);
    // - test-cases/r001.md was legacy-only → 1 move (movedCount++).
    // - tech-doc had identical content in both → dedup (rmSync on legacy, no count).
    // - security-findings had identical content → dedup (no count).
    // - code-review had content-mismatch → reported as conflict (conflictCount++), source NOT deleted.
    expect(result.movedCount).toBe(1);
    expect(result.conflictCount).toBe(1);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].path).toContain('code-review.md');

    // The legacy session dir was removed (it was the migration target).
    expect(existsSync(join(projectRoot, '.peaks', '2026-05-15-session-r004test'))).toBe(false);
  });

  it('apply: removes empty legacy session dir after all moves', () => {
    // Single-file seed: only 1 file in legacy, gets moved + legacy dir becomes empty.
    const sid = '2026-05-15-session-empty';
    const legacyRoot = join(projectRoot, '.peaks', sid);
    mkdirSync(join(legacyRoot, 'rd'), { recursive: true });
    writeFileSync(join(legacyRoot, 'rd', 'tech-doc.md'), 'x\n');
    // canonical missing → legacy-only
    const result = applyMigrate1_4_1(projectRoot);
    expect(result.movedCount).toBe(1);
    expect(result.deletedEmptyDirs.length).toBe(1);
    expect(result.deletedEmptyDirs[0]).toBe(legacyRoot);
    expect(existsSync(legacyRoot)).toBe(false);
  });

  it('no-op: empty project (no .peaks/ dir) returns empty plan', () => {
    const result = planMigrate1_4_1(projectRoot);
    expect(result.plan).toEqual([]);
    expect(result.movedCount).toBe(0);
  });
});
