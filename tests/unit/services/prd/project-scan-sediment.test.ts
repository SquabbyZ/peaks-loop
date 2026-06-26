/**
 * v2.11.0 Group C — D3 project-scan sediment writer tests (Tier 5).
 *
 * Pins:
 *   - file-absent → created with the concept as the first row
 *   - file-exists → appended as a new row (preserves prior rows)
 *   - same (concept, sourceRid) tuple → idempotent skip
 *   - same concept + different sourceRid → appended (re-definition from new source)
 *   - output is parseable by readBusinessKnowledge (round-trip)
 *   - the markdown table format is preserved (5 columns, header + separator)
 *   - escaping: pipe characters in definition are escaped
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendBusinessConcept } from '../../../../src/services/prd/project-scan-sediment.js';
import { readBusinessKnowledge } from '../../../../src/services/prd/project-scan-reader.js';

const CONCEPT_D1 = {
  concept: 'D1',
  definition: 'Immutable sha256-locked handoff.',
  sourceRid: '001-v2-11',
  decidedAt: '2026-06-26T03:05:30Z',
  evidence: '.peaks/memory/2026-06-26-v2-11-rm-rd-techdoc-immutable-handoff.md'
};

const CONCEPT_D1_RESEDIMENT = {
  concept: 'D1',
  definition: 'Immutable sha256-locked handoff (updated definition).',
  sourceRid: '001-v2-11',
  decidedAt: '2026-06-26T05:00:00Z',
  evidence: '.peaks/memory/2026-06-26-v2-11-rm-rd-techdoc-immutable-handoff.md'
};

const CONCEPT_D1_FROM_NEW_SOURCE = {
  concept: 'D1',
  definition: 'Refined by audit findings.',
  sourceRid: '002-v2-11-audit',
  decidedAt: '2026-06-26T06:00:00Z',
  evidence: '.peaks/memory/audit.md'
};

const CONCEPT_D2 = {
  concept: 'D2',
  definition: 'Half-white-box merged audit output.',
  sourceRid: '001-v2-11',
  decidedAt: '2026-06-26T03:05:30Z',
  evidence: '.peaks/memory/2026-06-26-v2-11-rm-rd-techdoc-immutable-handoff.md'
};

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-project-scan-sediment-'));
});

afterEach(() => {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
});

function bootstrapDir(): void {
  mkdirSync(join(root, '.peaks', 'project-scan'), { recursive: true });
}

describe('appendBusinessConcept — file absent', () => {
  it('creates a new file with the concept as the first row', async () => {
    const result = await appendBusinessConcept({ projectRoot: root, concept: CONCEPT_D1 });
    expect(result.written).toBe(true);
    expect(result.created).toBe(true);
    expect(result.totalConcepts).toBe(1);

    const absPath = join(root, '.peaks', 'project-scan', 'business-knowledge.md');
    expect(existsSync(absPath)).toBe(true);
    const raw = readFileSync(absPath, 'utf8');
    expect(raw).toContain('schemaVersion: 1');
    expect(raw).toContain('| Concept | Definition | Source | Decided | Evidence |');
    expect(raw).toContain('| D1 | Immutable sha256-locked handoff. | 001-v2-11 | 2026-06-26T03:05:30Z | .peaks/memory/2026-06-26-v2-11-rm-rd-techdoc-immutable-handoff.md |');

    // Round-trip via the reader
    const knowledge = await readBusinessKnowledge(root);
    expect(knowledge).not.toBeNull();
    expect(knowledge!.concepts).toHaveLength(1);
    expect(knowledge!.concepts[0]).toEqual(CONCEPT_D1);
  });
});

describe('appendBusinessConcept — file exists', () => {
  it('appends the concept as a new row and preserves prior rows', async () => {
    bootstrapDir();
    writeFileSync(
      join(root, '.peaks', 'project-scan', 'business-knowledge.md'),
      [
        '---',
        'schemaVersion: 1',
        '---',
        '',
        '# Business Knowledge',
        '',
        '| Concept | Definition | Source | Decided | Evidence |',
        '|---|---|---|---|---|',
        `| ${CONCEPT_D1.concept} | ${CONCEPT_D1.definition} | ${CONCEPT_D1.sourceRid} | ${CONCEPT_D1.decidedAt} | ${CONCEPT_D1.evidence} |`,
        ''
      ].join('\n'),
      'utf8'
    );

    const result = await appendBusinessConcept({ projectRoot: root, concept: CONCEPT_D2 });
    expect(result.written).toBe(true);
    expect(result.created).toBe(false);
    expect(result.totalConcepts).toBe(2);

    const knowledge = await readBusinessKnowledge(root);
    expect(knowledge).not.toBeNull();
    expect(knowledge!.concepts).toHaveLength(2);
    expect(knowledge!.concepts[0]).toEqual(CONCEPT_D1);
    expect(knowledge!.concepts[1]).toEqual(CONCEPT_D2);
  });

  it('is idempotent on (concept, sourceRid) — re-appending the same tuple is a no-op', async () => {
    bootstrapDir();
    writeFileSync(
      join(root, '.peaks', 'project-scan', 'business-knowledge.md'),
      [
        '---',
        'schemaVersion: 1',
        '---',
        '',
        '# Business Knowledge',
        '',
        '| Concept | Definition | Source | Decided | Evidence |',
        '|---|---|---|---|---|',
        `| ${CONCEPT_D1.concept} | ${CONCEPT_D1.definition} | ${CONCEPT_D1.sourceRid} | ${CONCEPT_D1.decidedAt} | ${CONCEPT_D1.evidence} |`,
        ''
      ].join('\n'),
      'utf8'
    );

    // Same (concept, sourceRid) tuple, even with a different definition → skip.
    const result = await appendBusinessConcept({
      projectRoot: root,
      concept: CONCEPT_D1_RESEDIMENT
    });
    expect(result.written).toBe(false);
    expect(result.created).toBe(false);
    expect(result.totalConcepts).toBe(1);

    // Original definition preserved (NOT overwritten).
    const knowledge = await readBusinessKnowledge(root);
    expect(knowledge!.concepts[0]!.definition).toBe(CONCEPT_D1.definition);
  });

  it('appends when concept matches but sourceRid differs (re-definition from new source)', async () => {
    bootstrapDir();
    writeFileSync(
      join(root, '.peaks', 'project-scan', 'business-knowledge.md'),
      [
        '---',
        'schemaVersion: 1',
        '---',
        '',
        '# Business Knowledge',
        '',
        '| Concept | Definition | Source | Decided | Evidence |',
        '|---|---|---|---|---|',
        `| ${CONCEPT_D1.concept} | ${CONCEPT_D1.definition} | ${CONCEPT_D1.sourceRid} | ${CONCEPT_D1.decidedAt} | ${CONCEPT_D1.evidence} |`,
        ''
      ].join('\n'),
      'utf8'
    );

    const result = await appendBusinessConcept({
      projectRoot: root,
      concept: CONCEPT_D1_FROM_NEW_SOURCE
    });
    expect(result.written).toBe(true);
    expect(result.created).toBe(false);
    expect(result.totalConcepts).toBe(2);

    const knowledge = await readBusinessKnowledge(root);
    expect(knowledge!.concepts).toHaveLength(2);
    expect(knowledge!.concepts[0]!.sourceRid).toBe('001-v2-11');
    expect(knowledge!.concepts[1]!.sourceRid).toBe('002-v2-11-audit');
  });
});

describe('appendBusinessConcept — output format', () => {
  it('escapes pipe characters in definition cells', async () => {
    const conceptWithPipe = {
      ...CONCEPT_D1,
      definition: 'A or B (escape | here).'
    };
    await appendBusinessConcept({ projectRoot: root, concept: conceptWithPipe });
    const raw = readFileSync(
      join(root, '.peaks', 'project-scan', 'business-knowledge.md'),
      'utf8'
    );
    // Pipe character escaped as \| inside the table cell.
    expect(raw).toContain('A or B (escape \\| here).');
  });

  it('preserves the 5-column markdown table format (header + separator + rows)', async () => {
    await appendBusinessConcept({ projectRoot: root, concept: CONCEPT_D1 });
    await appendBusinessConcept({ projectRoot: root, concept: CONCEPT_D2 });
    const raw = readFileSync(
      join(root, '.peaks', 'project-scan', 'business-knowledge.md'),
      'utf8'
    );
    expect(raw).toContain('| Concept | Definition | Source | Decided | Evidence |');
    expect(raw).toContain('|---|---|---|---|---|');
    // Both rows present, in insertion order.
    const d1Index = raw.indexOf('| D1 |');
    const d2Index = raw.indexOf('| D2 |');
    expect(d1Index).toBeGreaterThan(0);
    expect(d2Index).toBeGreaterThan(d1Index);
  });
});

describe('appendBusinessConcept — error paths', () => {
  it('throws when existing file has malformed frontmatter', async () => {
    bootstrapDir();
    writeFileSync(
      join(root, '.peaks', 'project-scan', 'business-knowledge.md'),
      'no frontmatter block at all',
      'utf8'
    );
    await expect(
      appendBusinessConcept({ projectRoot: root, concept: CONCEPT_D1 })
    ).rejects.toThrow(/frontmatter/);
  });
});