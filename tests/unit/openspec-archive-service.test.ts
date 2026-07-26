import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, normalize as normalizePath } from 'node:path';
import { describe, expect, test } from 'vitest';
import { pathExists } from 'peaks-loop-shared/fs';

import {
  archiveOpenSpecChange,
  OpenSpecArchiveError,
  parseCoverageEvidence,
} from '../../src/services/openspec/openspec-archive-service.js';

async function makeOpenSpecRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'peaks-openspec-archive-'));
  await mkdir(join(root, 'changes'), { recursive: true });
  return root;
}

async function seedChange(root: string, id: string): Promise<void> {
  const changeRoot = join(root, 'changes', id);
  await mkdir(changeRoot, { recursive: true });
  await writeFile(join(changeRoot, 'proposal.md'), `# Change: ${id}\n`, 'utf8');
}

describe('archiveOpenSpecChange (dry-run)', () => {
  test('returns null when the source change does not exist', async () => {
    const root = await makeOpenSpecRoot();

    const result = await archiveOpenSpecChange('nope', { openspecRoot: root });

    expect(result).toBeNull();
  });

  test('returns a preview without moving files when apply is false', async () => {
    const root = await makeOpenSpecRoot();
    await seedChange(root, 'ready-to-archive');

    const result = await archiveOpenSpecChange('ready-to-archive', { openspecRoot: root });

    expect(result?.applied).toBe(false);
    expect(result?.from).toBe(join(root, 'changes', 'ready-to-archive'));
    expect(result?.to).toBe(join(root, 'changes', 'archive', 'ready-to-archive'));
    expect(await pathExists(join(root, 'changes', 'ready-to-archive'))).toBe(true);
    expect(await pathExists(join(root, 'changes', 'archive', 'ready-to-archive'))).toBe(false);
  });

  test('rejects invalid changeIds before touching the filesystem', async () => {
    const root = await makeOpenSpecRoot();

    await expect(
      archiveOpenSpecChange('.hidden', { openspecRoot: root })
    ).rejects.toThrowError(/changeId/);
  });

  test('preserves the byte-for-byte format-error string from rid-009 sub-slice-1', async () => {
    const root = await makeOpenSpecRoot();

    await expect(
      archiveOpenSpecChange('../escape', { openspecRoot: root })
    ).rejects.toThrowError('changeId ../escape does not match [A-Za-z0-9][A-Za-z0-9._-]*');
  });
});

describe('archiveOpenSpecChange (apply)', () => {
  test('moves the change directory under changes/archive/<id>/', async () => {
    const root = await makeOpenSpecRoot();
    await seedChange(root, 'moving');

    const result = await archiveOpenSpecChange('moving', { openspecRoot: root, apply: true });

    expect(result?.applied).toBe(true);
    expect(await pathExists(join(root, 'changes', 'moving'))).toBe(false);
    expect(await pathExists(join(root, 'changes', 'archive', 'moving', 'proposal.md'))).toBe(true);
  });

  test('refuses to overwrite an existing archived entry', async () => {
    const root = await makeOpenSpecRoot();
    await seedChange(root, 'duplicate');
    await mkdir(join(root, 'changes', 'archive', 'duplicate'), { recursive: true });
    await writeFile(join(root, 'changes', 'archive', 'duplicate', 'proposal.md'), 'old', 'utf8');

    await expect(
      archiveOpenSpecChange('duplicate', { openspecRoot: root, apply: true })
    ).rejects.toThrowError(/archive/i);

    expect(await pathExists(join(root, 'changes', 'duplicate'))).toBe(true);
  });

  test('respects a custom archive directory name', async () => {
    const root = await makeOpenSpecRoot();
    await seedChange(root, 'custom-dir');

    const result = await archiveOpenSpecChange('custom-dir', { openspecRoot: root, apply: true, archiveDirName: 'shipped' });

    expect(result?.to).toBe(join(root, 'changes', 'shipped', 'custom-dir'));
    expect(await pathExists(join(root, 'changes', 'shipped', 'custom-dir', 'proposal.md'))).toBe(true);
  });

  test('defaults openspec root to <cwd>/openspec when not provided', async () => {
    const result = await archiveOpenSpecChange('never-existed-default-root');

    expect(result).toBeNull();
  });
});

describe('parseCoverageEvidence', () => {
  test('returns present=false when the proposal lacks the heading', async () => {
    const root = await makeOpenSpecRoot();
    const changeRoot = join(root, 'changes', 'no-heading');
    await mkdir(changeRoot, { recursive: true });
    await writeFile(join(changeRoot, 'proposal.md'), '# Change: no-heading\n\n## Acceptance Criteria\n\n- nothing\n', 'utf8');

    const evidence = await parseCoverageEvidence(join(changeRoot, 'proposal.md'));

    expect(evidence).toEqual({
      rows: [],
      present: false,
      capabilityRows: [],
      summaryStatus: 'unavailable',
      capabilityValidation: 'not-enforced',
      staleFiles: [],
      mismatches: [],
    });
  });

  test('extracts rows from a Coverage Evidence table', async () => {
    const root = await makeOpenSpecRoot();
    const changeRoot = join(root, 'changes', 'with-table');
    await mkdir(changeRoot, { recursive: true });
    await writeFile(
      join(changeRoot, 'proposal.md'),
      [
        '# Change: with-table',
        '',
        '## Coverage Evidence',
        '',
        '| capability | requirement | status | testAnchor |',
        '| --- | --- | --- | --- |',
        '| quality-gates | 100% coverage for included modules | covered | tests/unit/quality-gates.test.ts |',
        '| quality-gates | MVP implementation verification commands | partial | tests/unit/quality-gates.test.ts |',
        ''
      ].join('\n'),
      'utf8'
    );

    const evidence = await parseCoverageEvidence(join(changeRoot, 'proposal.md'));

    expect(evidence.present).toBe(true);
    expect(evidence.rows).toHaveLength(2);
    expect(evidence.rows[0]).toMatchObject({
      capability: 'quality-gates',
      requirement: '100% coverage for included modules',
      status: 'covered',
      testAnchor: 'tests/unit/quality-gates.test.ts',
      line: 7,
    });
    expect(evidence.rows[1]?.status).toBe('partial');
  });

  test('throws OPENSPEC_COVERAGE_EVIDENCE_MALFORMED when the heading exists but no rows do', async () => {
    const root = await makeOpenSpecRoot();
    const changeRoot = join(root, 'changes', 'malformed');
    await mkdir(changeRoot, { recursive: true });
    await writeFile(
      join(changeRoot, 'proposal.md'),
      '# Change: malformed\n\n## Coverage Evidence\n\nNo table here.\n',
      'utf8'
    );

    await expect(parseCoverageEvidence(join(changeRoot, 'proposal.md'))).rejects.toBeInstanceOf(
      OpenSpecArchiveError
    );
  });
});

describe('archiveOpenSpecChange (Pre-cond 2 coverage gate)', () => {
  async function seedChangeWithSpecs(root: string, id: string, coverageBlock?: string | string[]): Promise<void> {
    const changeRoot = join(root, 'changes', id);
    await mkdir(join(changeRoot, 'specs', 'quality-gates'), { recursive: true });
    const evidenceLines = coverageBlock !== undefined
      ? (Array.isArray(coverageBlock) ? coverageBlock : coverageBlock.split('\n'))
      : [
          '| capability | requirement | status | testAnchor |',
          '| --- | --- | --- | --- |',
          '| quality-gates | 100% coverage for included modules | covered | tests/unit/quality-gates.test.ts |'
        ];
    await writeFile(
      join(changeRoot, 'proposal.md'),
      [
        `# Change: ${id}`,
        '',
        '## Acceptance Criteria',
        '',
        '- behavior',
        '',
        '## Coverage Evidence',
        '',
        ...evidenceLines,
        '',
        '## Capability Mapping',
        '',
        '| capability | source | testAnchor |',
        '| --- | --- | --- |',
        '| quality-gates | src/services/openspec/openspec-archive-service.ts | tests/unit/openspec-archive-service.test.ts |',
        ''
      ].join('\n'),
      'utf8'
    );
    await writeFile(
      join(changeRoot, 'specs', 'quality-gates', 'spec.md'),
      '# Spec Delta: quality-gates\n\n## ADDED Requirements\n\n### Requirement: 100% coverage for included modules\n',
      'utf8'
    );

    // Default to a clean coverage-summary.json so Fix-6B passes for the
    // Fix-6A tests; individual tests can override via seedProject() helpers.
    const coverageDir = join(root, '..', 'coverage');
    await mkdir(coverageDir, { recursive: true });
    const cleanSummary = JSON.stringify({
      total: { lines: { pct: 100, covered: 1, total: 1 }, statements: { pct: 100, covered: 1, total: 1 }, branches: { pct: 100, covered: 1, total: 1 }, functions: { pct: 100, covered: 1, total: 1 } },
      'src/services/openspec/openspec-archive-service.ts': {
        lines: { pct: 100, covered: 5, total: 5 },
        statements: { pct: 100, covered: 5, total: 5 },
        branches: { pct: 100, covered: 1, total: 1 },
        functions: { pct: 100, covered: 1, total: 1 }
      }
    });
    await writeFile(join(coverageDir, 'coverage-summary.json'), cleanSummary, 'utf8');
  }

  test('apply refuses with OPENSPEC_COVERAGE_GATE_FAILED when no evidence block exists', async () => {
    const root = await makeOpenSpecRoot();
    const changeRoot = join(root, 'changes', 'no-evidence');
    await mkdir(join(changeRoot, 'specs', 'quality-gates'), { recursive: true });
    await writeFile(join(changeRoot, 'proposal.md'), '# Change: no-evidence\n', 'utf8');
    await writeFile(join(changeRoot, 'specs', 'quality-gates', 'spec.md'), '# Spec Delta: quality-gates\n', 'utf8');

    await expect(archiveOpenSpecChange('no-evidence', { openspecRoot: root, apply: true })).rejects.toMatchObject({
      code: 'OPENSPEC_COVERAGE_GATE_FAILED',
      detail: expect.objectContaining({ reason: 'no-coverage-evidence-block' }),
    });
    expect(await pathExists(join(root, 'changes', 'no-evidence'))).toBe(true);
  });

  test('apply refuses with OPENSPEC_COVERAGE_GATE_PARTIAL when any row is uncovered', async () => {
    const root = await makeOpenSpecRoot();
    await seedChangeWithSpecs(root, 'partial', [
      '| capability | requirement | status | testAnchor |',
      '| --- | --- | --- | --- |',
      '| quality-gates | 100% coverage for included modules | uncovered | (none) |'
    ]);

    await expect(archiveOpenSpecChange('partial', { openspecRoot: root, apply: true })).rejects.toMatchObject({
      code: 'OPENSPEC_COVERAGE_GATE_PARTIAL',
      detail: expect.objectContaining({
        reason: 'requirement-not-fully-covered',
        failing: expect.arrayContaining([
          expect.objectContaining({ requirement: '100% coverage for included modules', status: 'uncovered' })
        ]),
      }),
    });
    expect(await pathExists(join(root, 'changes', 'partial'))).toBe(true);
  });

  test('apply succeeds when every Coverage Evidence row is covered', async () => {
    const root = await makeOpenSpecRoot();
    await seedChangeWithSpecs(root, 'fully-covered');

    const result = await archiveOpenSpecChange('fully-covered', { openspecRoot: root, apply: true });

    expect(result?.applied).toBe(true);
    expect(result?.coverage?.present).toBe(true);
    expect(await pathExists(join(root, 'changes', 'archive', 'fully-covered'))).toBe(true);
  });

  test('apply with --force bypasses partial gate and marks coverageGateBypassed', async () => {
    const root = await makeOpenSpecRoot();
    await seedChangeWithSpecs(root, 'forced', [
      '| capability | requirement | status | testAnchor |',
      '| --- | --- | --- | --- |',
      '| quality-gates | 100% coverage for included modules | partial | (none) |'
    ]);

    const result = await archiveOpenSpecChange('forced', { openspecRoot: root, apply: true, force: true });

    expect(result?.applied).toBe(true);
    expect(result?.coverageGateBypassed).toBe(true);
    expect(await pathExists(join(root, 'changes', 'archive', 'forced'))).toBe(true);
  });

  test('dry-run never blocks even when evidence is missing', async () => {
    const root = await makeOpenSpecRoot();
    const changeRoot = join(root, 'changes', 'dry-no-evidence');
    await mkdir(join(changeRoot, 'specs', 'quality-gates'), { recursive: true });
    await writeFile(join(changeRoot, 'proposal.md'), '# Change: dry-no-evidence\n', 'utf8');
    await writeFile(join(changeRoot, 'specs', 'quality-gates', 'spec.md'), '# Spec Delta: quality-gates\n', 'utf8');

    const result = await archiveOpenSpecChange('dry-no-evidence', { openspecRoot: root });

    expect(result?.applied).toBe(false);
    expect(await pathExists(join(root, 'changes', 'dry-no-evidence'))).toBe(true);
  });
});

describe('Fix-6B coverage-evidence-mismatch gate', () => {
  /**
   * Seed a project layout matching what archiveOpenSpecChange expects:
   *   <projectRoot>/openspec/changes/<id>/{proposal.md,specs/<cap>/spec.md}
   *   <projectRoot>/coverage/coverage-summary.json (optional)
   *
   * projectRoot in this test is the parent of openspec/, which is the default
   * the gate resolves via `resolve(openspecRoot, '..')`.
   */
  async function seedProject(opts: {
    coverageSummary?: Record<string, unknown> | null; // null = do not write
    coverageSummaryAtProjectCoverage?: Record<string, unknown> | null;
    coverageBlock?: string[];
    capabilityBlock?: string[];
    staleSpec?: boolean;
  }): Promise<{ projectRoot: string; changeId: string; coverageSummaryPath?: string }> {
    const projectRoot = await mkdtemp(join(tmpdir(), 'peaks-openspec-6b-'));
    const openspecRoot = join(projectRoot, 'openspec');
    const changeId = 'fix-6b-test';
    const changeRoot = join(openspecRoot, 'changes', changeId);

    await mkdir(join(changeRoot, 'specs', 'quality-gates'), { recursive: true });

    const evidenceLines = opts.coverageBlock ?? [
      '| capability | requirement | status | testAnchor |',
      '| --- | --- | --- | --- |',
      '| quality-gates | 100% coverage for included modules | covered | tests/unit/quality-gates.test.ts |'
    ];
    const capabilityLines = opts.capabilityBlock ?? [
      '| capability | source | testAnchor |',
      '| --- | --- | --- |',
      '| quality-gates | src/services/openspec/openspec-archive-service.ts | tests/unit/openspec-archive-service.test.ts |'
    ];
    await writeFile(
      join(changeRoot, 'proposal.md'),
      [
        `# Change: ${changeId}`,
        '',
        '## Acceptance Criteria',
        '',
        '- behavior',
        '',
        '## Coverage Evidence',
        '',
        ...evidenceLines,
        '',
        '## Capability Mapping',
        '',
        ...capabilityLines,
        ''
      ].join('\n'),
      'utf8'
    );
    await writeFile(
      join(changeRoot, 'specs', 'quality-gates', 'spec.md'),
      '# Spec Delta: quality-gates\n\n## ADDED Requirements\n\n### Requirement: 100% coverage for included modules\n',
      'utf8'
    );

    let coverageSummaryPath: string | undefined;
    if (opts.coverageSummary !== undefined && opts.coverageSummary !== null) {
      const dir = join(projectRoot, 'coverage');
      await mkdir(dir, { recursive: true });
      coverageSummaryPath = join(dir, 'coverage-summary.json');
      await writeFile(coverageSummaryPath, JSON.stringify(opts.coverageSummary), 'utf8');
    }

    if (opts.staleSpec === true) {
      // Make the spec file's mtime 1 minute in the future relative to the
      // summary file (which we just wrote).
      const future = new Date(Date.now() + 60_000);
      await utimes(join(changeRoot, 'specs', 'quality-gates', 'spec.md'), future, future);
    }

    return { projectRoot, changeId, ...(coverageSummaryPath !== undefined ? { coverageSummaryPath } : {}) };
  }

  const cleanSummary = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    total: { lines: { pct: 100, covered: 1, total: 1 }, statements: { pct: 100, covered: 1, total: 1 }, branches: { pct: 100, covered: 1, total: 1 }, functions: { pct: 100, covered: 1, total: 1 } },
    'src/services/openspec/openspec-archive-service.ts': {
      lines: { pct: 100, covered: 5, total: 5 },
      statements: { pct: 100, covered: 5, total: 5 },
      branches: { pct: 100, covered: 1, total: 1 },
      functions: { pct: 100, covered: 1, total: 1 }
    },
    ...overrides
  });

  test('apply refuses with OPENSPEC_COVERAGE_EVIDENCE_MISSING when no coverage-summary.json exists', async () => {
    const { projectRoot, changeId } = await seedProject({ coverageSummary: null });

    await expect(archiveOpenSpecChange(changeId, { openspecRoot: join(projectRoot, 'openspec'), apply: true })).rejects.toMatchObject({
      code: 'OPENSPEC_COVERAGE_EVIDENCE_MISSING'
    });
  });

  test('apply discovers coverage-summary.json under <projectRoot>/coverage/', async () => {
    const { projectRoot, changeId, coverageSummaryPath } = await seedProject({ coverageSummary: cleanSummary() });

    const result = await archiveOpenSpecChange(changeId, { openspecRoot: join(projectRoot, 'openspec'), apply: true });

    expect(result?.applied).toBe(true);
    expect(normalizePath(result?.coverage?.summaryPath ?? '')).toBe(normalizePath(coverageSummaryPath ?? ''));
    expect(await pathExists(join(projectRoot, 'openspec', 'changes', 'archive', changeId))).toBe(true);
  });

  test('--coverage-summary <path> overrides discovery', async () => {
    const { projectRoot, changeId } = await seedProject({ coverageSummary: null });
    const altDir = join(projectRoot, 'alt');
    await mkdir(altDir, { recursive: true });
    const altPath = join(altDir, 'summary.json');
    await writeFile(altPath, JSON.stringify(cleanSummary()), 'utf8');

    const result = await archiveOpenSpecChange(changeId, {
      openspecRoot: join(projectRoot, 'openspec'),
      apply: true,
      coverageSummaryPath: altPath
    });

    expect(result?.applied).toBe(true);
    expect(normalizePath(result?.coverage?.summaryPath ?? '')).toBe(normalizePath(altPath));
  });

  test('apply refuses with OPENSPEC_COVERAGE_EVIDENCE_STALE when spec file mtime > summary mtime', async () => {
    const { projectRoot, changeId } = await seedProject({ coverageSummary: cleanSummary(), staleSpec: true });

    await expect(archiveOpenSpecChange(changeId, { openspecRoot: join(projectRoot, 'openspec'), apply: true })).rejects.toMatchObject({
      code: 'OPENSPEC_COVERAGE_EVIDENCE_STALE',
      detail: expect.objectContaining({
        staleFiles: expect.arrayContaining([
          expect.stringMatching(/openspec\/changes\/fix-6b-test\/specs\/quality-gates\/spec\.md/)
        ])
      })
    });
  });

  test('apply refuses with OPENSPEC_COVERAGE_GATE_FAILED (reason: no-capability-mapping-block) when mapping is missing', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'peaks-openspec-6b-'));
    const openspecRoot = join(projectRoot, 'openspec');
    const changeId = 'no-mapping';
    const changeRoot = join(openspecRoot, 'changes', changeId);
    await mkdir(join(changeRoot, 'specs', 'quality-gates'), { recursive: true });
    await writeFile(
      join(changeRoot, 'proposal.md'),
      [
        '# Change: no-mapping',
        '',
        '## Coverage Evidence',
        '',
        '| capability | requirement | status | testAnchor |',
        '| --- | --- | --- | --- |',
        '| quality-gates | 100% coverage for included modules | covered | tests/unit/quality-gates.test.ts |'
      ].join('\n'),
      'utf8'
    );
    await writeFile(join(changeRoot, 'specs', 'quality-gates', 'spec.md'), '# Spec Delta: quality-gates\n', 'utf8');
    const coverageDir = join(projectRoot, 'coverage');
    await mkdir(coverageDir, { recursive: true });
    await writeFile(join(coverageDir, 'coverage-summary.json'), JSON.stringify(cleanSummary()), 'utf8');

    await expect(archiveOpenSpecChange(changeId, { openspecRoot, apply: true })).rejects.toMatchObject({
      code: 'OPENSPEC_COVERAGE_GATE_FAILED',
      detail: expect.objectContaining({ reason: 'no-capability-mapping-block' })
    });
  });

  test('apply refuses with OPENSPEC_COVERAGE_EVIDENCE_MISMATCH when capability source file is missing from c8 summary', async () => {
    const { projectRoot, changeId } = await seedProject({
      coverageSummary: cleanSummary(), // does not include 'src/services/x/missing.ts'
      capabilityBlock: [
        '| capability | source | testAnchor |',
        '| --- | --- | --- |',
        '| ghost | src/services/x/missing.ts | tests/unit/ghost.test.ts |'
      ]
    });

    await expect(archiveOpenSpecChange(changeId, { openspecRoot: join(projectRoot, 'openspec'), apply: true })).rejects.toMatchObject({
      code: 'OPENSPEC_COVERAGE_EVIDENCE_MISMATCH',
      detail: expect.objectContaining({
        mismatches: expect.arrayContaining([
          expect.objectContaining({
            capability: 'ghost',
            failingFiles: expect.arrayContaining([
              expect.objectContaining({ path: 'src/services/x/missing.ts', reason: 'missing-from-summary' })
            ])
          })
        ])
      })
    });
  });

  test('apply refuses with OPENSPEC_COVERAGE_EVIDENCE_MISMATCH when capability file has statements.pct < 100', async () => {
    const partial = cleanSummary({
      'src/services/openspec/openspec-archive-service.ts': {
        lines: { pct: 100, covered: 5, total: 5 },
        statements: { pct: 92, covered: 46, total: 50 },
        branches: { pct: 100, covered: 1, total: 1 },
        functions: { pct: 100, covered: 1, total: 1 }
      }
    });
    const { projectRoot, changeId } = await seedProject({ coverageSummary: partial });

    await expect(archiveOpenSpecChange(changeId, { openspecRoot: join(projectRoot, 'openspec'), apply: true })).rejects.toMatchObject({
      code: 'OPENSPEC_COVERAGE_EVIDENCE_MISMATCH',
      detail: expect.objectContaining({
        mismatches: expect.arrayContaining([
          expect.objectContaining({
            capability: 'quality-gates',
            failingFiles: expect.arrayContaining([
              expect.objectContaining({
                path: 'src/services/openspec/openspec-archive-service.ts',
                reason: 'below-threshold',
                actual: expect.objectContaining({ statements: 92 })
              })
            ])
          })
        ])
      })
    });
  });

  test('apply succeeds when every capability passes all four metrics at 100%', async () => {
    const { projectRoot, changeId } = await seedProject({ coverageSummary: cleanSummary() });

    const result = await archiveOpenSpecChange(changeId, { openspecRoot: join(projectRoot, 'openspec'), apply: true });

    expect(result?.applied).toBe(true);
    expect(result?.coverage?.capabilityValidation).toBe('ok');
  });

  test('--force bypasses MISMATCH and marks coverageMismatchBypassed: true', async () => {
    const partial = cleanSummary({
      'src/services/openspec/openspec-archive-service.ts': {
        lines: { pct: 100, covered: 5, total: 5 },
        statements: { pct: 80, covered: 40, total: 50 },
        branches: { pct: 100, covered: 1, total: 1 },
        functions: { pct: 100, covered: 1, total: 1 }
      }
    });
    const { projectRoot, changeId } = await seedProject({ coverageSummary: partial });

    const result = await archiveOpenSpecChange(changeId, {
      openspecRoot: join(projectRoot, 'openspec'),
      apply: true,
      force: true
    });

    expect(result?.applied).toBe(true);
    expect(result?.coverageMismatchBypassed).toBe(true);
    expect(await pathExists(join(projectRoot, 'openspec', 'changes', 'archive', changeId))).toBe(true);
  });

  test('dry-run never blocks even when coverage summary is missing', async () => {
    const { projectRoot, changeId } = await seedProject({ coverageSummary: null });

    const result = await archiveOpenSpecChange(changeId, { openspecRoot: join(projectRoot, 'openspec') });

    expect(result?.applied).toBe(false);
    expect(await pathExists(join(projectRoot, 'openspec', 'changes', changeId))).toBe(true);
  });

  test('dry-run never blocks even when capability mismatches (no --apply)', async () => {
    const partial = cleanSummary({
      'src/services/openspec/openspec-archive-service.ts': {
        lines: { pct: 100, covered: 5, total: 5 },
        statements: { pct: 50, covered: 25, total: 50 },
        branches: { pct: 100, covered: 1, total: 1 },
        functions: { pct: 100, covered: 1, total: 1 }
      }
    });
    const { projectRoot, changeId } = await seedProject({ coverageSummary: partial });

    const result = await archiveOpenSpecChange(changeId, { openspecRoot: join(projectRoot, 'openspec') });

    expect(result?.applied).toBe(false);
  });

  test('spec-less change skips both Fix-6A and Fix-6B gates', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'peaks-openspec-6b-'));
    const openspecRoot = join(projectRoot, 'openspec');
    const changeRoot = join(openspecRoot, 'changes', 'specless');
    await mkdir(changeRoot, { recursive: true });
    await writeFile(join(changeRoot, 'proposal.md'), '# Change: specless\n', 'utf8');
    // No specs/*/spec.md; no coverage-summary.json. Both gates should skip.

    const result = await archiveOpenSpecChange('specless', { openspecRoot, apply: true });

    expect(result?.applied).toBe(true);
    expect(result?.coverage?.summaryStatus).toBe('unavailable');
    expect(result?.coverage?.capabilityValidation).toBe('not-enforced');
  });

  test('parses Capability Mapping table from proposal.md', async () => {
    const { projectRoot, changeId } = await seedProject({ coverageSummary: cleanSummary() });
    const result = await archiveOpenSpecChange(changeId, { openspecRoot: join(projectRoot, 'openspec'), apply: true });
    expect(result?.coverage?.capabilityRows.length).toBeGreaterThan(0);
    expect(result?.coverage?.capabilityRows[0]).toMatchObject({
      capability: 'quality-gates',
      source: 'src/services/openspec/openspec-archive-service.ts'
    });
  });
});
