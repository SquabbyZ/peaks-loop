/**
 * Slice 1.2.b — RD tech-doc template + enforcer § Slice DAG mandatory section.
 *
 * Regression test for AC-6.a / AC-6.b of the 1.1 PRD:
 *   - `skills/peaks-rd/references/mandatory-tech-doc.md` contains a
 *     `## Slice DAG` section, with both visual (mermaid) and text
 *     (markdown table) forms, and the 3 mandatory fields
 *     (id / role / depends-on).
 *   - `src/services/audit/enforcers/tech-doc-mandatory-sections.ts`
 *     exports a `MANDATORY_SLICE_DAG_SECTION` constant containing the
 *     `## Slice DAG` literal, and `checkTechDocMandatorySections` now
 *     refuses tech-doc.md if the section is missing.
 *   - The error message names the Slice DAG surface so RD can find
 *     the contract without reading the enforcer source.
 *   - Slice 2/6 karpathy-enforcement surface (3 sections, error code
 *     constant, gate wiring in request-artifact-service) remains
 *     byte-stable (zero regression guard).
 *
 * Cross-references:
 *   - PRD: .peaks/_runtime/2026-06-17-session-1baf0a/prd/requests/006-2026-06-18-slice-dag-dispatcher-prd.md
 *   - Slice 1.2.a source: src/services/dispatch/slice-dag.ts (hashDag / serializeDag)
 *   - Slice 2 regression: tests/unit/skills/tech-doc-mandatory-sections.test.ts
 */
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import {
  ALL_MANDATORY_TECH_DOC_SECTIONS,
  buildMandatorySectionsErrorMessage,
  checkTechDocMandatorySections,
  MANDATORY_SLICE2_SECTIONS,
  MANDATORY_SLICE_DAG_SECTION,
  TECH_DOC_MANDATORY_SECTIONS_CODE
} from '../../../src/services/audit/enforcers/tech-doc-mandatory-sections.js';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const MANDATORY_TECH_DOC_PATH = resolve(
  REPO_ROOT,
  'skills/peaks-rd/references/mandatory-tech-doc.md'
);
const ENFORCER_PATH = resolve(
  REPO_ROOT,
  'src/services/audit/enforcers/tech-doc-mandatory-sections.ts'
);

let projectRoot = '';
const sessionId = '2026-06-18-slice-dag-template-test';

beforeAll(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'peaks-slice-dag-template-'));
});

afterAll(() => {
  if (projectRoot && existsSync(projectRoot)) {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

function writeTechDoc(body: string): void {
  const dir = join(projectRoot, '.peaks', '_runtime', sessionId, 'rd');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'tech-doc.md'), body, 'utf8');
}

describe('AC-6.a: ## Slice DAG section exists in mandatory-tech-doc.md', () => {
  test('the template file exists and contains the ## Slice DAG section header', () => {
    expect(existsSync(MANDATORY_TECH_DOC_PATH), `template must exist at ${MANDATORY_TECH_DOC_PATH}`).toBe(true);
    const body = readFileSync(MANDATORY_TECH_DOC_PATH, 'utf8');
    expect(body, 'template must contain ## Slice DAG').toContain('## Slice DAG');
  });

  test('the section is positioned as the 7th numbered item (after § Dependencies)', () => {
    const body = readFileSync(MANDATORY_TECH_DOC_PATH, 'utf8');
    const lines = body.split('\n');
    const dagIdx = lines.findIndex((l) => l.includes('## Slice DAG'));
    const depsIdx = lines.findIndex((l) => l.startsWith('6. **Dependencies**'));
    const inventoryIdx = lines.findIndex((l) => l.startsWith('8. **Existing API / Component Inventory**'));
    expect(dagIdx, '## Slice DAG must exist').toBeGreaterThanOrEqual(0);
    expect(depsIdx, '§ Dependencies (6.) must exist').toBeGreaterThanOrEqual(0);
    expect(inventoryIdx, '§ Existing API (8.) must exist').toBeGreaterThanOrEqual(0);
    expect(dagIdx, '## Slice DAG must come AFTER § Dependencies').toBeGreaterThan(depsIdx);
    expect(dagIdx, '## Slice DAG must come BEFORE § Existing API / Component Inventory').toBeLessThan(inventoryIdx);
  });

  test('the section directs RD to include both visual (mermaid) and text (table) forms', () => {
    const body = readFileSync(MANDATORY_TECH_DOC_PATH, 'utf8');
    const startIdx = body.indexOf('## Slice DAG');
    expect(startIdx, '## Slice DAG must exist').toBeGreaterThanOrEqual(0);
    const after = body.slice(startIdx);
    const stopMatch = after.match(/\n##\s|\n\*\*Mandatory self-check sections/);
    const stopIdx = stopMatch && stopMatch.index !== undefined ? startIdx + stopMatch.index : body.length;
    const block = body.slice(startIdx, stopIdx);

    // The template is a contract document: it tells RD what to write, it
    // does not itself contain example blocks. So we assert on directive
    // keywords the RD must follow.
    expect(block, 'template must direct RD to use a mermaid visual block').toMatch(/mermaid/);
    expect(block, 'template must direct RD to use a flowchart / graph').toMatch(/flowchart|graph/);

    // Text table column directives
    expect(block, 'template must direct RD to include the id column').toMatch(/\bid\b/);
    expect(block, 'template must direct RD to include the role column').toMatch(/\brole\b/);
    expect(block, 'template must direct RD to include the depends-on column').toMatch(/depends-on/);
    expect(block, 'template must direct RD to include the contractHash column').toMatch(/contractHash/);
  });

  test('the section declares the 3 mandatory fields per row (id, role, depends-on)', () => {
    const body = readFileSync(MANDATORY_TECH_DOC_PATH, 'utf8');
    const startIdx = body.indexOf('## Slice DAG');
    const after = body.slice(startIdx);
    const stopMatch = after.match(/\n##\s|\n\*\*Mandatory self-check sections/);
    const stopIdx = stopMatch && stopMatch.index !== undefined ? startIdx + stopMatch.index : body.length;
    const block = body.slice(startIdx, stopIdx);

    // Mandatory fields must explicitly call out id, role, depends-on.
    expect(block, 'must call out id as mandatory').toMatch(/\bid\b/);
    expect(block, 'must call out role as mandatory').toMatch(/\brole\b/);
    expect(block, 'must call out depends-on as mandatory').toMatch(/depends-on/);
  });

  test('the section references the dag hash cross-reference contract (dagHash: <64-hex>)', () => {
    const body = readFileSync(MANDATORY_TECH_DOC_PATH, 'utf8');
    const startIdx = body.indexOf('## Slice DAG');
    const after = body.slice(startIdx);
    const stopMatch = after.match(/\n##\s|\n\*\*Mandatory self-check sections/);
    const stopIdx = stopMatch && stopMatch.index !== undefined ? startIdx + stopMatch.index : body.length;
    const block = body.slice(startIdx, stopIdx);
    expect(block, 'must reference the dagHash cross-reference').toContain('dagHash');
    expect(block, 'must cite the hashDag function from src/services/dispatch/slice-dag.ts').toContain('hashDag');
  });
});

describe('AC-6.b: enforcer wires ## Slice DAG into the missing-section check', () => {
  test('enforcer exports MANDATORY_SLICE_DAG_SECTION as the literal `## Slice DAG`', () => {
    expect(Array.isArray(MANDATORY_SLICE_DAG_SECTION)).toBe(true);
    expect([...MANDATORY_SLICE_DAG_SECTION]).toEqual(['## Slice DAG']);
  });

  test('enforcer exposes ALL_MANDATORY_TECH_DOC_SECTIONS as the 4-section union', () => {
    expect([...ALL_MANDATORY_TECH_DOC_SECTIONS]).toEqual([
      '## Existing API / Component Inventory',
      '## Simplicity self-check',
      '## Reuse / Consolidate plan',
      '## Slice DAG'
    ]);
  });

  test('reports missing when ## Slice DAG is absent (slice-2 sections present)', () => {
    writeTechDoc(
      [
        '# tech-doc',
        '',
        '## Existing API / Component Inventory',
        'OK',
        '',
        '## Simplicity self-check',
        'OK',
        '',
        '## Reuse / Consolidate plan',
        'OK'
      ].join('\n')
    );
    const r = checkTechDocMandatorySections({ projectRoot, sessionId });
    expect(r.exists).toBe(true);
    expect(r.missing).toEqual(['## Slice DAG']);
  });

  test('reports missing when slice-2 sections are absent (## Slice DAG present)', () => {
    writeTechDoc(['# tech-doc', '', '## Slice DAG', 'OK'].join('\n'));
    const r = checkTechDocMandatorySections({ projectRoot, sessionId });
    expect(r.exists).toBe(true);
    expect(r.missing).toEqual([
      '## Existing API / Component Inventory',
      '## Simplicity self-check',
      '## Reuse / Consolidate plan'
    ]);
  });

  test('reports empty missing when all 4 sections present', () => {
    writeTechDoc(
      [
        '# tech-doc',
        '',
        '## Existing API / Component Inventory',
        'OK',
        '',
        '## Simplicity self-check',
        'OK',
        '',
        '## Reuse / Consolidate plan',
        'OK',
        '',
        '## Slice DAG',
        'OK'
      ].join('\n')
    );
    const r = checkTechDocMandatorySections({ projectRoot, sessionId });
    expect(r.exists).toBe(true);
    expect(r.missing).toEqual([]);
  });

  test('reports all 4 missing when tech-doc.md does not exist', () => {
    const dir = join(projectRoot, '.peaks', '_runtime', 'never-created-session', 'rd');
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    const r = checkTechDocMandatorySections({ projectRoot, sessionId: 'never-created-session' });
    expect(r.exists).toBe(false);
    expect(r.missing).toEqual([...ALL_MANDATORY_TECH_DOC_SECTIONS]);
  });

  test('error message names the Slice DAG surface so RD can locate the contract', () => {
    const msg = buildMandatorySectionsErrorMessage(['## Slice DAG']);
    expect(msg, 'error message must mention Slice DAG').toContain('Slice DAG');
    expect(msg, 'error message must mention the enforcer source contract path').toContain(
      'mandatory-tech-doc.md'
    );
  });

  test('error message preserves the Slice 2 karpathy-guidelines citation when only slice-2 sections missing', () => {
    const msg = buildMandatorySectionsErrorMessage(['## Simplicity self-check']);
    expect(msg, 'error message must still cite karpathy-guidelines').toContain('karpathy-guidelines');
    expect(msg, 'error message must cite §1 Think Before Coding').toContain('§1 Think Before Coding');
    expect(msg, 'error message must cite §2 Simplicity First').toContain('§2 Simplicity First');
  });
});

describe('Slice 2/6 zero-regression guard (byte-stable)', () => {
  test('MANDATORY_SLICE2_SECTIONS still exports the original 3 literals exactly', () => {
    expect([...MANDATORY_SLICE2_SECTIONS]).toEqual([
      '## Existing API / Component Inventory',
      '## Simplicity self-check',
      '## Reuse / Consolidate plan'
    ]);
  });

  test('TECH_DOC_MANDATORY_SECTIONS_CODE constant remains byte-stable', () => {
    expect(TECH_DOC_MANDATORY_SECTIONS_CODE).toBe('TECH_DOC_MANDATORY_SECTIONS_MISSING');
    // Also check the enforcer source contains the literal so the runtime
    // gate and the test stay in lockstep.
    const body = readFileSync(ENFORCER_PATH, 'utf8');
    expect(body).toContain("'TECH_DOC_MANDATORY_SECTIONS_MISSING'");
  });
});