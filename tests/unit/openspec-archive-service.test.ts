import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

    expect(evidence).toEqual({ rows: [], present: false });
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
        ''
      ].join('\n'),
      'utf8'
    );
    await writeFile(
      join(changeRoot, 'specs', 'quality-gates', 'spec.md'),
      '# Spec Delta: quality-gates\n\n## ADDED Requirements\n\n### Requirement: 100% coverage for included modules\n',
      'utf8'
    );
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
