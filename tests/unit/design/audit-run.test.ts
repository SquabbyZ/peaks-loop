import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import type { AuditSource } from '../../../src/services/design/audit/audit-finding.js';
import {
  auditColor,
  chromaticFamilies,
  chromaticSpellings
} from '../../../src/services/design/audit/audit-color.js';
import { measureColor } from '../../../src/services/design/audit/color-measure.js';
import { runAuditProject } from '../../../src/services/design/audit/audit-project.js';
import { buildAuditReport } from '../../../src/services/design/audit/audit-report.js';
import { MAX_SOURCE_BYTES } from '../../../src/services/design/file-cap.js';
import { buildPavedRoad } from '../../../src/services/design/paved-road.js';
import { readPavedRoad } from '../../../src/services/design/source-scan/inputs.js';

declareDimensions('tests/unit/design/audit-run.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/design/audit');
const TREE = join(FIXTURES, 'three-page-tree');
const scale = buildPavedRoad({ pageRoots: [], componentEntrypoints: [] }).tokenScale;

type Tokens = { color?: Record<string, { $value: string }> };

const tokens = JSON.parse(readFileSync(join(FIXTURES, 'tokens-color.json'), 'utf8')) as Tokens;

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

/** A minimal UI tree with its contract; `files` are written over the defaults. */
function makeContractTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-audit-cap-'));
  roots.push(root);
  mkdirSync(join(root, 'design'), { recursive: true });
  mkdirSync(join(root, 'pages'), { recursive: true });
  writeFileSync(
    join(root, 'design', 'paved-road.json'),
    JSON.stringify({ schemaVersion: 1, pageRoots: ['pages'], componentEntrypoints: [] }),
    'utf8'
  );
  writeFileSync(join(root, 'design', 'tokens.json'), '{}', 'utf8');
  writeFileSync(
    join(root, 'pages', 'page.tsx'),
    'export function Page() { return <h1>Page</h1>; }\n'
  );
  for (const [name, body] of Object.entries(files)) writeFileSync(join(root, name), body, 'utf8');
  return root;
}

const OVERSIZE = 'x'.repeat(MAX_SOURCE_BYTES + 1);

function css(file: string): AuditSource {
  return { file, source: readFileSync(join(FIXTURES, file), 'utf8') };
}

function colorOf(file: string) {
  return auditColor({ tokenScale: scale, sources: [css(file)], tokens });
}

describe('Scenario: render — a CSS colour declaration becomes a finding with file:line', () => {
  it('when a stylesheet declares a raw colour, should render its line and technical text', () => {
    // given: a `.css` `color: #ff00aa` with no matching token
    // when: the colour audit runs over the stylesheet
    // then: the finding is hard and names the file, line and property
    const theme = css('three-page-tree/pages/theme.css');
    const findings = auditColor({ tokenScale: scale, sources: [theme], tokens });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      dimension: 'color',
      severity: 'hard',
      file: 'three-page-tree/pages/theme.css',
      line: 3,
      value: '#ff00aa'
    });
    expect(findings[0]?.techText).toContain('color:#ff00aa raw colour not a declared token');
  });
});

describe('Scenario: behavior — a CSS colour that matches a token is counted under it', () => {
  it('when a stylesheet uses a declared token value, should not report a raw literal', () => {
    // given: a `.css` `color: #c81e1e`, declared as `danger-500`
    // when: the colour audit runs
    // then: it is not a finding, and the family is named by the token
    expect(colorOf('css-token-colour.css')).toEqual([]);
    const samples = measureColor([css('css-token-colour.css')]);
    expect(chromaticSpellings(samples, tokens)).toEqual(['--danger-500']);
    expect(chromaticFamilies(samples, tokens).map((family) => family.label)).toEqual(['红']);
  });
});

describe('Scenario: integration — the project reader builds page units from source files', () => {
  it('when the three-page tree is read, should list one unit per markup file and stylesheet', () => {
    // given: the fixture tree with two markup pages and one stylesheet
    // when: the project is read
    // then: every unit is present once, sorted, and the clean page has no finding
    const result = runAuditProject({ appRoot: TREE });
    if (result.kind !== 'audited') throw new Error(`unexpected result ${result.kind}`);
    expect(result.pages.map((page) => page.path)).toEqual([
      'pages/clean.tsx',
      'pages/spacing.tsx',
      'pages/theme.css'
    ]);
    expect(result.pages[0]?.findings).toHaveLength(1);
    expect(result.pages[0]?.findings[0]).toMatchObject({
      dimension: 'hierarchy',
      severity: 'soft',
      techText: 'pages/clean.tsx:1 heading:h1 missing'
    });
    // S8 adds one fixed global row — the overflow gap — and nothing else for a
    // tree with no captures; unmeasured is a gap, never a finding.
    expect(result.globalFindings.map((finding) => finding.dimension)).toEqual(['overflow']);
    expect(result.globalFindings.every((finding) => finding.severity === 'unmeasured')).toBe(true);
    expect(result.contract).toEqual({
      tokens: 'design/tokens.json',
      pavedRoad: 'design/paved-road.json'
    });
  });

  it('when a stylesheet resolves through a state-dependent variable, should report unmeasured', () => {
    // given: the state-tree whose `--spacing` differs per density block
    // when: the project is read
    // then: the value is unmeasured and both state names travel to the report
    const result = runAuditProject({ appRoot: join(FIXTURES, 'state-tree') });
    if (result.kind !== 'audited') throw new Error('state-tree must be a UI project');
    const gap = result.pages[0]?.findings.find((finding) => finding.severity === 'unmeasured');
    expect(gap?.techText).toContain('state-dependent');
    expect(result.state.skipped).toEqual(["[data-density='compact']"]);
  });
});

describe('Scenario: integration — an over-cap contract input is refused, not parsed', () => {
  it('when tokens.json is past the byte cap, should refuse the contract by name', () => {
    // given: a UI tree whose tokens.json is one byte past the cap
    // when: the project is read
    // then: the read is a named refusal carrying the file and its measured size
    const result = runAuditProject({
      appRoot: makeContractTree({ 'design/tokens.json': OVERSIZE })
    });
    expect(result.kind).toBe('contract-too-large');
    if (result.kind !== 'contract-too-large') return;
    expect(result.files).toEqual([{ path: 'design/tokens.json', bytes: MAX_SOURCE_BYTES + 1 }]);
  });

  it('when paved-road.json is past the byte cap, should refuse the contract itself', () => {
    // given: a paved-road.json one byte past the cap
    // when: the project is read
    // then: the audit refuses instead of judging against built-in defaults
    const result = runAuditProject({
      appRoot: makeContractTree({ 'design/paved-road.json': OVERSIZE })
    });
    expect(result.kind).toBe('contract-too-large');
  });

  it('when tsconfig.json is past the byte cap, should name the skip and still audit', () => {
    // given: a UI tree whose tsconfig.json is past the cap
    // when: the project is read
    // then: no alias is read, the skip is named, and the run is still audited
    const result = runAuditProject({ appRoot: makeContractTree({ 'tsconfig.json': OVERSIZE }) });
    if (result.kind !== 'audited') throw new Error(`unexpected result ${result.kind}`);
    expect(result.state.readGaps).toContain(
      `tsconfig.json (larger than ${MAX_SOURCE_BYTES} bytes; path aliases not read)`
    );
    expect(buildAuditReport(result).data.knownGaps.map((gap) => gap.id)).toContain(
      'alias-config-oversize'
    );
  });
});

describe('Scenario: behavior — the G1 paved-road reader refuses an over-cap contract', () => {
  it('when paved-road.json is past the cap, should warn and use the defaults', () => {
    // given: a design directory whose paved-road.json is past the cap
    // when: the reader reads it
    // then: the refusal is named and the built-in defaults are used
    const designRoot = mkdtempSync(join(tmpdir(), 'peaks-audit-paved-cap-'));
    roots.push(designRoot);
    writeFileSync(join(designRoot, 'paved-road.json'), OVERSIZE, 'utf8');
    const paved = readPavedRoad(designRoot);
    expect(paved.warnings?.[0]?.code).toBe('contract-too-large');
    expect(paved.warnings?.[0]?.message).toContain(`${MAX_SOURCE_BYTES}-byte cap`);
    expect(paved.pageRoots).toEqual([]);
  });
});

describe('Scenario: a11y — the CSS finding is readable by a person and by an agent', () => {
  it('when the raw CSS colour is judged, should explain it in Chinese and cite the line', () => {
    // given: the raw `.css` colour the contract does not declare
    // when: the finding's bilingual pair is read
    // then: the plain sentence says what to do and the technical line is greppable
    const finding = colorOf('three-page-tree/pages/theme.css')[0];
    expect(finding?.humanText).toContain('应该改用 token');
    expect(finding?.techText).toMatch(/^three-page-tree\/pages\/theme\.css:3 /);
  });
});
