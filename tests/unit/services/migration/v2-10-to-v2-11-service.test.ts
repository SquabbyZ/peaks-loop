/**
 * TDD coverage for the v2.11.0 Tier 8 migration service
 * (`src/services/migration/v2-10-to-v2-11-service.ts`).
 *
 * Covers:
 *   - `enumerateTechDocs` over a synthesized multi-session fixture
 *   - `planV2ToV11Migration`: counts for will-deprecate / already-deprecated / not-a-tech-doc
 *   - `applyV2ToV11Migration`: writes banner, idempotent re-run, errors propagate
 *   - `dryRunV2ToV11Migration`: applied=false, writtenCount=0
 *   - Banner shape: YAML frontmatter + unchanged body
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  applyV2ToV11Migration,
  dryRunV2ToV11Migration,
  enumerateTechDocs,
  planV2ToV11Migration
} from '../../../../src/services/migration/v2-10-to-v2-11-service.js';
import { DEPRECATION_BANNER } from '../../../../src/services/migration/v2-10-to-v2-11-types.js';

const TECH_DOC_BODY = [
  '# Tech doc',
  '',
  '## Architecture',
  '',
  'Module split: A / B / C',
  '',
  '## Component',
  '',
  '- Component X',
  '- Component Y',
  ''
].join('\n');

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'peaks-v2-to-v11-'));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function writeSessionTechDoc(sid: string, body: string): string {
  const dir = join(workDir, '.peaks', sid, 'rd');
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, 'tech-doc.md');
  writeFileSync(filePath, body, 'utf8');
  return filePath;
}

function writeAlreadyDeprecated(sid: string): string {
  return writeSessionTechDoc(sid, DEPRECATION_BANNER + TECH_DOC_BODY);
}

function writeNonTechDoc(sid: string): string {
  return writeSessionTechDoc(sid, '# Random notes\n\nno markers here\n');
}

function writeWithExistingFrontmatter(sid: string): string {
  return writeSessionTechDoc(sid, '---\nauthor: someone\n---\n\n# Tech doc\n\n## Architecture\n\nstuff\n');
}

describe('enumerateTechDocs — multi-session fixture', () => {
  test('returns one entry per session that has rd/tech-doc.md', () => {
    writeSessionTechDoc('2026-06-25-session-aaaa', TECH_DOC_BODY);
    writeSessionTechDoc('2026-06-25-session-bbbb', TECH_DOC_BODY);
    const result = enumerateTechDocs(workDir);
    expect(result.length).toBe(2);
    expect(result.map((e) => e.sessionId).sort()).toEqual([
      '2026-06-25-session-aaaa',
      '2026-06-25-session-bbbb'
    ]);
  });

  test('skips sessions without rd/tech-doc.md', () => {
    writeSessionTechDoc('2026-06-25-session-aaaa', TECH_DOC_BODY);
    mkdirSync(join(workDir, '.peaks', '2026-06-25-session-no-tech', 'rd'), { recursive: true });
    const result = enumerateTechDocs(workDir);
    expect(result.length).toBe(1);
  });

  test('returns empty array when .peaks does not exist', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'peaks-empty-'));
    try {
      expect(enumerateTechDocs(emptyDir).length).toBe(0);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  test('skips non-session dirs (memory, _runtime, etc.)', () => {
    writeSessionTechDoc('2026-06-25-session-aaaa', TECH_DOC_BODY);
    mkdirSync(join(workDir, '.peaks', 'memory'), { recursive: true });
    mkdirSync(join(workDir, '.peaks', '_runtime'), { recursive: true });
    mkdirSync(join(workDir, '.peaks', 'retrospective'), { recursive: true });
    const result = enumerateTechDocs(workDir);
    expect(result.length).toBe(1);
  });
});

describe('planV2ToV11Migration — verdict buckets', () => {
  test('classifies one each: will-deprecate / already-deprecated / not-a-tech-doc', () => {
    writeSessionTechDoc('2026-06-25-session-fresh', TECH_DOC_BODY);
    writeAlreadyDeprecated('2026-06-25-session-done');
    writeNonTechDoc('2026-06-25-session-other');
    const plan = planV2ToV11Migration(workDir);
    expect(plan.willDeprecateCount).toBe(1);
    expect(plan.alreadyDeprecatedCount).toBe(1);
    expect(plan.notTechDocCount).toBe(1);
    expect(plan.entries.length).toBe(3);
  });

  test('will-deprecate entries carry a different fromHash and toHash', () => {
    const filePath = writeSessionTechDoc('2026-06-25-session-x', TECH_DOC_BODY);
    const plan = planV2ToV11Migration(workDir);
    const entry = plan.entries.find((e) => e.filePath === filePath);
    expect(entry).toBeDefined();
    expect(entry?.reason).toBe('will-deprecate');
    expect(entry?.fromHash).not.toBe(entry?.toHash);
  });

  test('already-deprecated entries have identical fromHash and toHash', () => {
    const filePath = writeAlreadyDeprecated('2026-06-25-session-y');
    const plan = planV2ToV11Migration(workDir);
    const entry = plan.entries.find((e) => e.filePath === filePath);
    expect(entry?.reason).toBe('already-deprecated');
    expect(entry?.fromHash).toBe(entry?.toHash);
  });

  test('files with existing user-authored YAML frontmatter are skipped as not-a-tech-doc', () => {
    const filePath = writeWithExistingFrontmatter('2026-06-25-session-z');
    const plan = planV2ToV11Migration(workDir);
    const entry = plan.entries.find((e) => e.filePath === filePath);
    expect(entry?.reason).toBe('not-a-tech-doc');
  });
});

describe('applyV2ToV11Migration — write + idempotence', () => {
  test('writes banner prepended; body content preserved after banner', () => {
    const filePath = writeSessionTechDoc('2026-06-25-session-write', TECH_DOC_BODY);
    const plan = planV2ToV11Migration(workDir);
    const result = applyV2ToV11Migration(plan);
    expect(result.applied).toBe(true);
    expect(result.writtenCount).toBe(1);
    const newBody = readFileSync(filePath, 'utf8');
    expect(newBody.startsWith(DEPRECATION_BANNER)).toBe(true);
    expect(newBody.includes('## Architecture')).toBe(true);
    expect(newBody.includes('Module split: A / B / C')).toBe(true);
  });

  test('idempotent: re-plan after apply reports all entries as already-deprecated', () => {
    writeSessionTechDoc('2026-06-25-session-idem-a', TECH_DOC_BODY);
    writeSessionTechDoc('2026-06-25-session-idem-b', TECH_DOC_BODY);
    const plan1 = planV2ToV11Migration(workDir);
    applyV2ToV11Migration(plan1);
    const plan2 = planV2ToV11Migration(workDir);
    expect(plan2.willDeprecateCount).toBe(0);
    expect(plan2.alreadyDeprecatedCount).toBe(2);
    expect(plan2.notTechDocCount).toBe(0);
  });

  test('idempotent: re-apply after apply writes nothing (writtenCount = 0)', () => {
    writeSessionTechDoc('2026-06-25-session-idem-c', TECH_DOC_BODY);
    const plan1 = planV2ToV11Migration(workDir);
    applyV2ToV11Migration(plan1);
    const plan2 = planV2ToV11Migration(workDir);
    const result = applyV2ToV11Migration(plan2);
    expect(result.writtenCount).toBe(0);
  });

  test('skips non-tech-doc files (does not modify them)', () => {
    const filePath = writeNonTechDoc('2026-06-25-session-skip');
    const original = readFileSync(filePath, 'utf8');
    const plan = planV2ToV11Migration(workDir);
    applyV2ToV11Migration(plan);
    const after = readFileSync(filePath, 'utf8');
    expect(after).toBe(original);
  });

  test('captures per-entry errors when file IO fails (file deleted between plan and apply)', () => {
    const filePath = writeSessionTechDoc('2026-06-25-session-flaky', TECH_DOC_BODY);
    const plan = planV2ToV11Migration(workDir);
    rmSync(filePath, { force: true });
    const result = applyV2ToV11Migration(plan);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]?.path).toBe(filePath);
    expect(result.writtenCount).toBe(0);
  });
});

describe('dryRunV2ToV11Migration — non-destructive default', () => {
  test('reports applied=false and writtenCount=0 even when files would be deprecated', () => {
    writeSessionTechDoc('2026-06-25-session-dry-a', TECH_DOC_BODY);
    writeSessionTechDoc('2026-06-25-session-dry-b', TECH_DOC_BODY);
    const result = dryRunV2ToV11Migration(workDir);
    expect(result.applied).toBe(false);
    expect(result.writtenCount).toBe(0);
    expect(result.plan.willDeprecateCount).toBe(2);
  });

  test('does NOT modify any files on disk', () => {
    const filePath = writeSessionTechDoc('2026-06-25-session-dry-noop', TECH_DOC_BODY);
    const original = readFileSync(filePath, 'utf8');
    dryRunV2ToV11Migration(workDir);
    const after = readFileSync(filePath, 'utf8');
    expect(after).toBe(original);
  });
});
