import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { buildPavedRoad } from '../../../src/services/design/paved-road.js';
import { buildTokenContract } from '../../../src/services/design/token-contract.js';
import { scanDesignSources } from '../../../src/services/design/source-scan/scan.js';

declareDimensions('tests/unit/design/source-scan.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true });
});

function makeApp(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-design-scan-'));
  roots.push(root);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), body, 'utf8');
  }
  return root;
}

const ROAD = buildPavedRoad({
  pageRoots: ['src/routes'],
  componentEntrypoints: ['@/components/ui']
});
const TOKENS = buildTokenContract([
  { name: '--color-primary', value: '#0f62fe', source: 'theme.css' }
]);

describe('Scenario: behavior — each rule fires on its symptom', () => {
  it('when a page hardcodes a style object, should fail inline style', async () => {
    // given: a page with an inline style
    // when: it is scanned
    // then: the inline-style rule fires
    const root = makeApp({
      'src/routes/a.tsx': "export const A = () => <div style={{ color: 'red' }} />;"
    });
    const result = await scanDesignSources({
      appRoot: root,
      changedFiles: ['src/routes/a.tsx'],
      pavedRoad: ROAD,
      tokens: TOKENS
    });
    expect(result.findings.map((f) => f.code)).toContain('DESIGN_INLINE_STYLE');
  });

  it('when a page hardcodes a hex colour, should fail raw colour', async () => {
    // given: a page with a hardcoded colour
    // when: it is scanned
    // then: the raw-colour rule fires
    const root = makeApp({
      'src/routes/a.tsx': 'export const A = () => <div className="text-[#fff]" />;'
    });
    const result = await scanDesignSources({
      appRoot: root,
      changedFiles: ['src/routes/a.tsx'],
      pavedRoad: ROAD,
      tokens: TOKENS
    });
    expect(result.findings.map((f) => f.code)).toContain('DESIGN_RAW_COLOR');
  });

  it('when a page uses an arbitrary Tailwind value, should fail it', async () => {
    // given: an arbitrary value in className
    // when: it is scanned
    // then: the arbitrary-value rule fires
    const root = makeApp({
      'src/routes/a.tsx': 'export const A = () => <div className="w-[123px]" />;'
    });
    const result = await scanDesignSources({
      appRoot: root,
      changedFiles: ['src/routes/a.tsx'],
      pavedRoad: ROAD,
      tokens: TOKENS
    });
    expect(result.findings.map((f) => f.code)).toContain('DESIGN_ARBITRARY_VALUE');
  });

  it('when a page uses a raw button, should fail the primitive rule', async () => {
    // given: a raw button
    // when: it is scanned
    // then: the primitive rule fires
    const root = makeApp({
      'src/routes/a.tsx': 'export const A = () => <button>go</button>;'
    });
    const result = await scanDesignSources({
      appRoot: root,
      changedFiles: ['src/routes/a.tsx'],
      pavedRoad: ROAD,
      tokens: TOKENS
    });
    expect(result.findings.map((f) => f.code)).toContain('DESIGN_RAW_PRIMITIVE');
  });
});

describe('Scenario: integration — comments and token references do not fire', () => {
  it('when the symptom is inside a comment, should not report it', async () => {
    // given: a comment containing the exact shapes
    // when: it is scanned
    // then: no finding is produced
    const root = makeApp({
      'src/routes/a.tsx':
        '// style={{ color: \'red\' }} w-[123px]\nexport const A = () => <div className="w-4" />;'
    });
    const result = await scanDesignSources({
      appRoot: root,
      changedFiles: ['src/routes/a.tsx'],
      pavedRoad: ROAD,
      tokens: TOKENS
    });
    expect(result.findings).toEqual([]);
  });

  it('when a token variable is used, should count it as covered', async () => {
    // given: a page using var(--color-primary)
    // when: it is scanned
    // then: the value is covered even though the inline-style rule still fires
    const root = makeApp({
      'src/routes/a.tsx':
        "export const A = () => <div style={{ color: 'var(--color-primary)' }} />;"
    });
    const result = await scanDesignSources({
      appRoot: root,
      changedFiles: ['src/routes/a.tsx'],
      pavedRoad: ROAD,
      tokens: TOKENS
    });
    expect(result.coverage.covered).toBe(1);
    expect(result.coverage.ratio).toBe(1);
  });

  it('when an arbitrary-value string is not in className, should not fire', async () => {
    // given: the same shape outside a className attribute
    // when: it is scanned
    // then: only className values are judged
    const root = makeApp({
      'src/routes/a.tsx':
        'const cls = \'w-[123px]\';\nexport const A = () => <div className="w-4" />;'
    });
    const result = await scanDesignSources({
      appRoot: root,
      changedFiles: ['src/routes/a.tsx'],
      pavedRoad: ROAD,
      tokens: TOKENS
    });
    expect(result.findings.map((f) => f.code)).not.toContain('DESIGN_ARBITRARY_VALUE');
  });
});
