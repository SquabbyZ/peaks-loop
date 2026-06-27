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
import {
  appendAuditSchemaVariant,
  appendBusinessConcept,
  appendPerfPattern,
  appendSecurityPattern,
} from '../../../../src/services/prd/project-scan-sediment.js';
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

// ─────────────────────────────────────────────────────────────────────
// Slice v2.12.0 Group C Tier 6 — peaks-txt sediment extension
//   appendSecurityPattern / appendPerfPattern / appendAuditSchemaVariant
//   append to the audit-template inventory tables (5-column markdown,
//   auto-incremented `#`, idempotent on `(value, sourceRid)`).
//
// Pins:
//   1. file-absent → created with the row as #1 (replaces placeholder)
//   2. file-exists with placeholder → first append replaces the
//      `| (empty) |` row with the real row at the next auto-incremented
//      index
//   3. file-exists with prior rows → appends the new row after the last
//      table line (preserves surrounding prose + frontmatter verbatim)
//   4. same (value, sourceRid) tuple → idempotent skip
//   5. pipe characters in `value` are escaped
//   6. frontmatter (templateKind / capturedAt / appliesTo) is preserved
//      verbatim across appends
//   7. each of the 3 audit-inventory appenders targets its own
//      template file (cross-cutting isolation)
// ─────────────────────────────────────────────────────────────────────

const SECURITY_ROW_RISK_XSS = {
  value: 'Reflected XSS in error-message path',
  sourceRid: '001-v2-12-sec',
  source: '.peaks/memory/2026-06-27-v2-12-sec-xss.md',
  status: 'active'
};

const SECURITY_ROW_RISK_XSS_RESEDIMENT = {
  value: 'Reflected XSS in error-message path (re-classified)',
  sourceRid: '001-v2-12-sec',
  source: '.peaks/memory/2026-06-27-v2-12-sec-xss.md',
  status: 'active'
};

const SECURITY_ROW_RISK_PATH_TRAVERSAL = {
  value: 'Path traversal via unsanitized join()',
  sourceRid: '002-v2-12-sec',
  source: '.peaks/memory/2026-06-27-v2-12-sec-path.md',
  status: 'active'
};

const PERF_ROW_BASELINE_COLD_START = {
  value: 'CLI cold-start baseline = 180ms (M2 / Node 24)',
  sourceRid: '001-v2-12-perf',
  source: '.peaks/memory/2026-06-27-v2-12-perf-coldstart.md',
  status: 'active'
};

const PERF_ROW_BASELINE_HEAP = {
  value: 'Heap-after-1000-slices baseline = 96MB',
  sourceRid: '002-v2-12-perf',
  source: '.peaks/memory/2026-06-27-v2-12-perf-heap.md',
  status: 'active'
};

const SCHEMA_ROW_VARIANT_HARD_GATE = {
  value: 'Required-frontmatter `degradationNote` (fallback marker)',
  sourceRid: '001-v2-12-audit',
  source: '.peaks/memory/2026-06-27-v2-12-audit-fallback.md',
  status: 'active'
};

const SCHEMA_ROW_VARIANT_PARENT_RID = {
  value: 'Required-frontmatter `parentRid` (re-run chaining)',
  sourceRid: '002-v2-12-audit',
  source: '.peaks/memory/2026-06-27-v2-12-audit-parent.md',
  status: 'active'
};

const SECURITY_TEMPLATE_REL = join('.peaks', 'project-scan', 'security-template.md');
const PERF_TEMPLATE_REL = join('.peaks', 'project-scan', 'perf-template.md');
const AUDIT_OUTPUT_SCHEMA_REL = join('.peaks', 'project-scan', 'audit-output-schema.md');

describe('appendSecurityPattern — file absent (creates with row #1)', () => {
  it('creates a new file with the row as #1 and the 5-column audit-template table', async () => {
    const result = await appendSecurityPattern({
      projectRoot: root,
      row: SECURITY_ROW_RISK_XSS
    });
    expect(result.written).toBe(true);
    expect(result.created).toBe(true);
    expect(result.assignedIndex).toBe(1);
    expect(result.totalRows).toBe(1);

    const absPath = join(root, SECURITY_TEMPLATE_REL);
    expect(existsSync(absPath)).toBe(true);
    const raw = readFileSync(absPath, 'utf8');
    expect(raw).toContain('templateKind: security-audit');
    expect(raw).toContain('appliesTo: peaks-security-audit skill');
    expect(raw).toContain('## Known risks inventory');
    expect(raw).toContain('| # | Risk pattern | First introduced (rid) | Source | Status |');
    expect(raw).toContain(
      '| 1 | Reflected XSS in error-message path | 001-v2-12-sec | .peaks/memory/2026-06-27-v2-12-sec-xss.md | active |'
    );
    // The bootstrap placeholder must NOT survive in a freshly created file.
    expect(raw).not.toContain('| (empty) |');
  });
});

describe('appendSecurityPattern — file exists with placeholder', () => {
  it('replaces the | (empty) | placeholder row with the first real row at #1', async () => {
    bootstrapDir();
    writeFileSync(join(root, SECURITY_TEMPLATE_REL), SECURITY_TEMPLATE_BOOTSTRAP, 'utf8');

    const result = await appendSecurityPattern({
      projectRoot: root,
      row: SECURITY_ROW_RISK_XSS
    });
    expect(result.written).toBe(true);
    expect(result.created).toBe(false);
    expect(result.assignedIndex).toBe(1);
    expect(result.totalRows).toBe(1);

    const raw = readFileSync(join(root, SECURITY_TEMPLATE_REL), 'utf8');
    // Placeholder replaced with the real row at #1.
    expect(raw).not.toContain('| (empty) |');
    expect(raw).toContain(
      '| 1 | Reflected XSS in error-message path | 001-v2-12-sec | .peaks/memory/2026-06-27-v2-12-sec-xss.md | active |'
    );
  });
});

describe('appendSecurityPattern — file exists with prior rows (no placeholder)', () => {
  it('appends the new row after the last table line at the next auto-incremented index', async () => {
    bootstrapDir();
    writeFileSync(join(root, SECURITY_TEMPLATE_REL), SECURITY_TEMPLATE_BOOTSTRAP, 'utf8');
    // First append: replaces placeholder with #1.
    await appendSecurityPattern({ projectRoot: root, row: SECURITY_ROW_RISK_XSS });
    // Second append: should be #2 (no placeholder, no more create).
    const result = await appendSecurityPattern({
      projectRoot: root,
      row: SECURITY_ROW_RISK_PATH_TRAVERSAL
    });
    expect(result.written).toBe(true);
    expect(result.created).toBe(false);
    expect(result.assignedIndex).toBe(2);
    expect(result.totalRows).toBe(2);

    const raw = readFileSync(join(root, SECURITY_TEMPLATE_REL), 'utf8');
    // Both rows present, in insertion order, indices 1 then 2.
    const xssIndex = raw.indexOf('| 1 | Reflected XSS');
    const traversalIndex = raw.indexOf('| 2 | Path traversal');
    expect(xssIndex).toBeGreaterThan(0);
    expect(traversalIndex).toBeGreaterThan(xssIndex);
    // Surrounding frontmatter preserved verbatim (fixture uses
    // `security-audit` to match the on-disk real bootstrap).
    expect(raw).toContain('templateKind: security-audit');
    expect(raw).toContain('appliesTo: peaks-security-audit skill');
  });

  it('is idempotent on (value, sourceRid) — re-appending the same tuple is a no-op', async () => {
    bootstrapDir();
    writeFileSync(join(root, SECURITY_TEMPLATE_REL), SECURITY_TEMPLATE_BOOTSTRAP, 'utf8');
    await appendSecurityPattern({ projectRoot: root, row: SECURITY_ROW_RISK_XSS });
    // Same (value, sourceRid) tuple, even with a different `status`
    // (status transition) → skip. The (value, sourceRid) tuple is the
    // idempotency key; status transitions are tracked by appending a
    // new row with a different sourceRid (re-classification).
    const result = await appendSecurityPattern({
      projectRoot: root,
      row: {
        value: SECURITY_ROW_RISK_XSS.value,
        sourceRid: SECURITY_ROW_RISK_XSS.sourceRid,
        source: SECURITY_ROW_RISK_XSS.source,
        status: 'mitigated'
      }
    });
    expect(result.written).toBe(false);
    expect(result.created).toBe(false);
    expect(result.assignedIndex).toBe(1);
    expect(result.totalRows).toBe(1);

    const raw = readFileSync(join(root, SECURITY_TEMPLATE_REL), 'utf8');
    // Original `active` status preserved (NOT overwritten by `mitigated`).
    expect(raw).toContain('Reflected XSS in error-message path | 001-v2-12-sec | .peaks/memory/2026-06-27-v2-12-sec-xss.md | active |');
    expect(raw).not.toContain('mitigated');
  });
});

describe('appendSecurityPattern — output format', () => {
  it('escapes pipe characters in the value cell', async () => {
    const rowWithPipe = {
      ...SECURITY_ROW_RISK_XSS,
      value: 'Pipe-in-value | here (must be escaped)'
    };
    await appendSecurityPattern({ projectRoot: root, row: rowWithPipe });
    const raw = readFileSync(join(root, SECURITY_TEMPLATE_REL), 'utf8');
    expect(raw).toContain('Pipe-in-value \\| here (must be escaped)');
  });
});

describe('appendPerfPattern + appendAuditSchemaVariant — cross-file isolation', () => {
  it('each audit-inventory appender targets its own template file', async () => {
    bootstrapDir();

    const perf = await appendPerfPattern({
      projectRoot: root,
      row: PERF_ROW_BASELINE_COLD_START
    });
    expect(perf.written).toBe(true);
    expect(perf.created).toBe(true);
    expect(perf.assignedIndex).toBe(1);

    const variant = await appendAuditSchemaVariant({
      projectRoot: root,
      row: SCHEMA_ROW_VARIANT_HARD_GATE
    });
    expect(variant.written).toBe(true);
    expect(variant.created).toBe(true);
    expect(variant.assignedIndex).toBe(1);

    // Each file got its own row, in its own file.
    const perfRaw = readFileSync(join(root, PERF_TEMPLATE_REL), 'utf8');
    const schemaRaw = readFileSync(join(root, AUDIT_OUTPUT_SCHEMA_REL), 'utf8');
    expect(perfRaw).toContain('templateKind: perf-audit');
    expect(perfRaw).toContain('## Known baselines inventory');
    expect(perfRaw).toContain(
      '| 1 | CLI cold-start baseline = 180ms (M2 / Node 24) | 001-v2-12-perf | .peaks/memory/2026-06-27-v2-12-perf-coldstart.md | active |'
    );
    expect(schemaRaw).toContain('templateKind: audit-output-schema');
    expect(schemaRaw).toContain('## Known schema variants');
    expect(schemaRaw).toContain(
      '| 1 | Required-frontmatter `degradationNote` (fallback marker) | 001-v2-12-audit | .peaks/memory/2026-06-27-v2-12-audit-fallback.md | active |'
    );
    // Cross-bleed check: the perf row is NOT in the schema file, the
    // schema row is NOT in the perf file, neither is in the security
    // file (security was not appended in this test).
    expect(perfRaw).not.toContain('Required-frontmatter `degradationNote`');
    expect(schemaRaw).not.toContain('CLI cold-start baseline');
    expect(existsSync(join(root, SECURITY_TEMPLATE_REL))).toBe(false);
  });

  it('preserves frontmatter verbatim across appends', async () => {
    bootstrapDir();
    writeFileSync(join(root, PERF_TEMPLATE_REL), PERF_TEMPLATE_BOOTSTRAP, 'utf8');
    await appendPerfPattern({ projectRoot: root, row: PERF_ROW_BASELINE_COLD_START });
    await appendPerfPattern({ projectRoot: root, row: PERF_ROW_BASELINE_HEAP });

    const raw = readFileSync(join(root, PERF_TEMPLATE_REL), 'utf8');
    // All 3 frontmatter fields preserved (no YAML reparse round-trip).
    expect(raw).toContain('schemaVersion: 1');
    expect(raw).toContain('templateKind: perf-audit');
    expect(raw).toContain('capturedAt: 2026-06-27T00:00:00.000Z');
    expect(raw).toContain('appliesTo: peaks-perf-audit skill');
  });
});

// ── fixtures: copies of the real audit-template bootstraps committed
//    in Group A (Tier 1) under .peaks/project-scan/. We inline them
//    here so the test does not depend on the on-disk bootstrap being
//    present in the temporary root.
// ─────────────────────────────────────────────────────────────────────

const SECURITY_TEMPLATE_BOOTSTRAP = [
  '---',
  'schemaVersion: 1',
  'templateKind: security-audit',
  'capturedAt: 2026-06-27T00:00:00.000Z',
  'appliesTo: peaks-security-audit skill',
  '---',
  '',
  '# Security Audit Template (peaks-cli v2.12.0)',
  '',
  '> Bootstrap template excerpt used by sediment tests.',
  '',
  '## Threat model dimensions',
  '',
  '> 8 dimensions per security-template.',
  '',
  '## Known risks inventory',
  '',
  '> This section is **append-only**. peaks-txt sediment step appends new',
  '> rows when a security audit surfaces a recurring risk pattern.',
  '',
  '| # | Risk pattern | First introduced (rid) | Source | Status |',
  '|---|---|---|---|---|',
  '| (empty) | — | — | — | — |',
  ''
].join('\n');

const PERF_TEMPLATE_BOOTSTRAP = [
  '---',
  'schemaVersion: 1',
  'templateKind: perf-audit',
  'capturedAt: 2026-06-27T00:00:00.000Z',
  'appliesTo: peaks-perf-audit skill',
  '---',
  '',
  '# Performance Audit Template (peaks-cli v2.12.0)',
  '',
  '> Bootstrap template excerpt used by sediment tests.',
  '',
  '## Perf dimensions',
  '',
  '> 6 dimensions per perf-template.',
  '',
  '## Known baselines inventory',
  '',
  '> This section is **append-only**.',
  '',
  '| # | Baseline | First established (rid) | Source | Status |',
  '|---|---|---|---|---|',
  '| (empty) | — | — | — | — |',
  ''
].join('\n');