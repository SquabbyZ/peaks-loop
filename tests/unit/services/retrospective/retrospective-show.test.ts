import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { showRetrospective } from '../../../../src/services/retrospective/retrospective-show.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `peaks-retro-show-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

function seedIndex(entries: unknown): void {
  const peaksDir = join(tmpDir, '.peaks', 'retrospective');
  mkdirSync(peaksDir, { recursive: true });
  writeFileSync(join(peaksDir, 'index.json'), JSON.stringify({ version: 1, updatedAt: '2026-06-09T00:00:00Z', entries }, null, 2));
}

function makeEntry(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: '2026-06-04-workspace-reconcile',
    sessionId: '2026-06-04-session-89f7cb',
    sliceId: '001-2026-06-04-workspace-reconcile',
    type: 'feature',
    title: 'Workspace reconcile',
    summary: 'Adds the new CLI command.',
    outcome: 'shipped',
    keyDecisions: ['Use 4-tier heuristic', 'Idempotent re-run'],
    lessonsLearned: 2,
    artifactPaths: ['.peaks/retrospective/2026-06-04-workspace-reconcile/rd/tech-doc.md'],
    updatedAt: '2026-06-04T12:00:00.000Z',
    ...overrides
  };
}

describe('showRetrospective', () => {
  test('returns the right entry by id (TC-UNIT-SHOW-1)', () => {
    seedIndex([makeEntry()]);
    const result = showRetrospective({ projectRoot: tmpDir, id: '2026-06-04-workspace-reconcile' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entry.id).toBe('2026-06-04-workspace-reconcile');
      expect(result.format).toBe('compact');
      expect(result.body).toContain('Workspace reconcile');
    }
  });

  test('compact body has no triple newlines (TC-UNIT-SHOW-1 compression)', () => {
    seedIndex([makeEntry()]);
    const result = showRetrospective({ projectRoot: tmpDir, id: '2026-06-04-workspace-reconcile' });
    if (result.ok) {
      expect(result.body).not.toMatch(/\n\n\n/);
    }
  });

  test('--pretty returns the same body without compact transform (TC-UNIT-SHOW-2)', () => {
    seedIndex([makeEntry()]);
    const compactResult = showRetrospective({ projectRoot: tmpDir, id: '2026-06-04-workspace-reconcile', format: 'compact' });
    const prettyResult = showRetrospective({ projectRoot: tmpDir, id: '2026-06-04-workspace-reconcile', format: 'pretty' });
    expect(compactResult.ok).toBe(true);
    expect(prettyResult.ok).toBe(true);
    if (compactResult.ok && prettyResult.ok) {
      expect(prettyResult.format).toBe('pretty');
      // Pretty body has at least the title and key metadata.
      expect(prettyResult.body).toContain('Workspace reconcile');
    }
  });

  test('missing id returns NOT_FOUND (TC-UNIT-SHOW-3 / graceful)', () => {
    seedIndex([makeEntry()]);
    const result = showRetrospective({ projectRoot: tmpDir, id: 'does-not-exist' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('NOT_FOUND');
    }
  });

  test('missing index returns INDEX_MISSING (TC-INDEX-5)', () => {
    const result = showRetrospective({ projectRoot: tmpDir, id: 'any' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INDEX_MISSING');
    }
  });

  test('artifact-missing entry returns OK with warning, not crash (TC-UNIT-SHOW-3 artifact-missing variant)', () => {
    seedIndex([makeEntry({ artifactPaths: ['.peaks/retrospective/2026-06-04-workspace-reconcile/rd/tech-doc.md'] })]);
    // The .md file does not exist on disk; show must not throw.
    const result = showRetrospective({ projectRoot: tmpDir, id: '2026-06-04-workspace-reconcile' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.some((w) => w.includes('missing'))).toBe(true);
    }
  });

  test('stale policy is NOT applied to retrospective in R3 (TC-UNIT-SHOW-4)', () => {
    // Entry is intentionally old (60 days). It should still be returned
    // because the stale filter is gated for a future slice.
    const veryOld = '2026-04-01T00:00:00.000Z';
    seedIndex([makeEntry({ id: 'ancient', updatedAt: veryOld })]);
    const result = showRetrospective({ projectRoot: tmpDir, id: 'ancient' });
    expect(result.ok).toBe(true);
  });

  test('empty id returns INVALID_REQUEST', () => {
    seedIndex([makeEntry()]);
    const result = showRetrospective({ projectRoot: tmpDir, id: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INVALID_REQUEST');
    }
  });
});
