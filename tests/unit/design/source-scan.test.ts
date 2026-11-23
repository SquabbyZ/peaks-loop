import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { buildPavedRoad, type PavedRoadFile } from '../../../src/services/design/paved-road.js';
import { buildTokenContract } from '../../../src/services/design/token-contract.js';
import type { DesignFinding } from '../../../src/services/design/source-scan/scan-file.js';
import type * as ScanModule from '../../../src/services/design/source-scan/scan.js';
import type * as ScanFileModule from '../../../src/services/design/source-scan/scan-file.js';

declareDimensions('tests/unit/design/source-scan.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

/**
 * The scan chain is imported per test after a module reset so the scanner's
 * module-level regex constants are initialised INSIDE a test. Under Stryker's
 * per-test coverage a module-scope initialiser executes before any test, so a
 * mutant in it is never scheduled and reads as survived although no test ran.
 */
type ScanChain = {
  scanDesignSources: typeof ScanModule.scanDesignSources;
  scanFile: typeof ScanFileModule.scanFile;
};

async function loadScan(): Promise<ScanChain> {
  vi.resetModules();
  const [scan, file] = await Promise.all([
    import('../../../src/services/design/source-scan/scan.js'),
    import('../../../src/services/design/source-scan/scan-file.js')
  ]);
  return { scanDesignSources: scan.scanDesignSources, scanFile: file.scanFile };
}

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
/** The same road, but importing the design system's own internals directly is banned. */
const BANNED_ROAD = buildPavedRoad({
  pageRoots: ['src/routes'],
  componentEntrypoints: ['@/components/ui'],
  bannedImportSpecifiers: ['@/components/ui']
});

async function scanOne(
  files: Record<string, string>,
  changedFiles: readonly string[],
  road = ROAD
): Promise<Awaited<ReturnType<ScanChain['scanDesignSources']>>> {
  const { scanDesignSources } = await loadScan();
  const root = makeApp(files);
  return scanDesignSources({ appRoot: root, changedFiles, pavedRoad: road, tokens: TOKENS });
}

async function findingsFor(source: string, road: PavedRoadFile = ROAD): Promise<DesignFinding[]> {
  const { scanFile } = await loadScan();
  return scanFile({ file: 'src/routes/a.tsx', source, pavedRoad: road, tokens: TOKENS }).findings;
}

function codes(result: { findings: readonly DesignFinding[] }): string[] {
  return result.findings.map((finding) => finding.code);
}

function codesFor(findings: readonly DesignFinding[], code: string): DesignFinding[] {
  return findings.filter((finding) => finding.code === code);
}

describe('Scenario: behavior — each rule fires on its symptom', () => {
  it('when a page carries each symptom, should fail the rule that names it', async () => {
    // given: an inline style, a hex colour, an arbitrary value and a raw button
    // when: each page is scanned
    // then: the matching rule fires
    const cases: ReadonlyArray<[source: string, code: string]> = [
      ["export const A = () => <div style={{ color: 'red' }} />;", 'DESIGN_INLINE_STYLE'],
      ['export const A = () => <div className="text-[#fff]" />;', 'DESIGN_RAW_COLOR'],
      ['export const A = () => <div className="w-[123px]" />;', 'DESIGN_ARBITRARY_VALUE'],
      ['export const A = () => <button>go</button>;', 'DESIGN_RAW_PRIMITIVE']
    ];
    for (const [source, code] of cases) {
      const result = await scanOne({ 'src/routes/a.tsx': source }, ['src/routes/a.tsx']);
      expect(codes(result), code).toContain(code);
    }
  });

  it('when a paved road downgrades a rule, should report its severity', async () => {
    // given: a road whose inline-style rule is only a warning
    // when: the page is scanned
    // then: the finding carries the road's severity, not the default
    const road: PavedRoadFile = buildPavedRoad({
      pageRoots: ['src/routes'],
      componentEntrypoints: []
    });
    road.rules.DESIGN_INLINE_STYLE = 'warn';
    const findings = await findingsFor('<div style={{ color: 1 }} />', road);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warn');
  });
});

describe('Scenario: behavior — a finding reports its line and its exact message', () => {
  it('when findings sit on different lines, should report each line', async () => {
    // given: a raw colour on line 1 and an inline style on line 3
    // when: the file is scanned
    // then: each finding names the line it starts on
    const findings = await findingsFor(
      "const a = '#fff';\nconst b = 1;\nexport const A = () => <div style={{ color: 'red' }} />;"
    );
    expect(findings.map((finding) => [finding.code, finding.line, finding.message])).toEqual([
      ['DESIGN_INLINE_STYLE', 3, 'inline style attribute'],
      ['DESIGN_RAW_COLOR', 1, 'raw colour literal #fff']
    ]);
  });

  it('when a finding starts exactly at a line start, should count that line', async () => {
    // given: a style attribute as the first characters of line 2
    // when: the file is scanned
    // then: the line lookup is inclusive of the line start
    const findings = await findingsFor('const ok = 1;\nstyle="color: #fff"');
    expect(findings.map((finding) => [finding.code, finding.line, finding.message])).toEqual([
      ['DESIGN_INLINE_STYLE', 2, 'inline style attribute'],
      ['DESIGN_RAW_COLOR', 2, 'raw colour literal #fff']
    ]);
  });

  it('when a raw primitive sits on line 2, should report line 2', async () => {
    // given: a raw button on the second line
    // when: the file is scanned
    // then: the primitive finding names line 2 and the trimmed element
    const findings = await findingsFor('const ok = 1;\n<button>go</button>');
    expect(findings.map((finding) => [finding.code, finding.line, finding.message])).toEqual([
      ['DESIGN_RAW_PRIMITIVE', 2, 'raw primitive <button']
    ]);
  });

  it('when an arbitrary value is in a className, should name its value and label', async () => {
    // given: an arbitrary value in a className attribute
    // when: the file is scanned
    // then: the message names the value and the className label
    const findings = await findingsFor('<div className="gap-[7px]" />');
    expect(findings.map((finding) => finding.message)).toEqual([
      'arbitrary Tailwind value gap-[7px] in className'
    ]);
  });

  it('when an arbitrary value is in a class helper, should name the helper label', async () => {
    // given: an arbitrary value inside cn()
    // when: the file is scanned
    // then: the message names the class-helper label
    const findings = await findingsFor("const cls = cn('gap-[7px]');");
    expect(findings.map((finding) => finding.message)).toEqual([
      'arbitrary Tailwind value gap-[7px] in class helper'
    ]);
  });
});

describe('Scenario: integration — comments and token references do not fire', () => {
  it('when the symptom is inside a comment, should not report it', async () => {
    // given: a comment containing the exact shapes
    // when: it is scanned
    // then: no finding is produced
    const result = await scanOne(
      {
        'src/routes/a.tsx':
          '// style={{ color: \'red\' }} w-[123px]\nexport const A = () => <div className="w-4" />;'
      },
      ['src/routes/a.tsx']
    );
    expect(result.findings).toEqual([]);
  });

  it('when a token variable is used, should count it as covered', async () => {
    // given: a page using var(--color-primary)
    // when: it is scanned
    // then: the value is covered even though the inline-style rule still fires
    const result = await scanOne(
      {
        'src/routes/a.tsx':
          "export const A = () => <div style={{ color: 'var(--color-primary)' }} />;"
      },
      ['src/routes/a.tsx']
    );
    expect(result.coverage.covered).toBe(1);
    expect(result.coverage.ratio).toBe(1);
  });

  it('when an arbitrary-value string is not in className, should not fire', async () => {
    // given: the same shape outside a className attribute
    // when: it is scanned
    // then: only className values are judged
    const result = await scanOne(
      {
        'src/routes/a.tsx':
          'const cls = \'w-[123px]\';\nexport const A = () => <div className="w-4" />;'
      },
      ['src/routes/a.tsx']
    );
    expect(result.findings.map((f) => f.code)).not.toContain('DESIGN_ARBITRARY_VALUE');
  });
});

describe('Scenario: behavior — attribute forms the spec names', () => {
  it('when a template quotes a style attribute, should fail inline style', async () => {
    // given: a .vue double-quoted attribute and a .svelte single-quoted one
    // when: each is scanned
    // then: the inline-style rule fires in both template families
    const vue = await scanOne(
      { 'src/routes/a.vue': '<template><p style="color: red">hi</p></template>' },
      ['src/routes/a.vue']
    );
    expect(codes(vue)).toContain('DESIGN_INLINE_STYLE');
    const svelte = await scanOne({ 'src/routes/b.svelte': "<p style='color: red'>hi</p>" }, [
      'src/routes/b.svelte'
    ]);
    expect(codes(svelte)).toContain('DESIGN_INLINE_STYLE');
  });

  it('when a class helper carries an arbitrary value, should fail it', async () => {
    // given: cn('w-[123px]') outside a className attribute
    // when: it is scanned
    // then: the arbitrary-value rule fires
    const result = await scanOne(
      {
        'src/routes/a.tsx':
          "const cls = cn('w-[123px]');\nexport const A = () => <div className={cls} />;"
      },
      ['src/routes/a.tsx']
    );
    expect(codes(result)).toContain('DESIGN_ARBITRARY_VALUE');
  });

  it('when className wraps a class helper, should report the value once', async () => {
    // given: className={cn('gap-[7px]')}
    // when: it is scanned
    // then: the value is reported exactly once
    const result = await scanOne(
      { 'src/routes/a.tsx': "export const A = () => <div className={cn('gap-[7px]')} />;" },
      ['src/routes/a.tsx']
    );
    expect(codes(result).filter((code) => code === 'DESIGN_ARBITRARY_VALUE')).toHaveLength(1);
  });

  it('when the paved road names no component entrypoint, should not fail a raw element', async () => {
    // given: a raw button and a project with no design system at hand
    // when: it is scanned
    // then: the primitive rule stays silent and adds no phantom finding
    const road = buildPavedRoad({ pageRoots: ['src/routes'], componentEntrypoints: [] });
    const findings = await findingsFor('<button>go</button>', road);
    expect(findings).toEqual([]);
  });

  it('when a string literal mentions a style attribute, should not report it', async () => {
    // given: the quoted and object forms spelled inside a string literal
    // when: each is scanned
    // then: only a real attribute fails
    for (const note of [
      'const note = \'use style="color:red"\';',
      "const note = 'style={{ color: red }}';"
    ]) {
      const result = await scanOne(
        { 'src/routes/a.tsx': `${note}\nexport const A = () => <div className="w-4" />;` },
        ['src/routes/a.tsx']
      );
      expect(codes(result), note).not.toContain('DESIGN_INLINE_STYLE');
    }
  });

  it('when a class helper nests parentheses before the value, should still find it', async () => {
    // given: cn() whose first argument contains a nested call
    // when: it is scanned
    // then: the arbitrary value after the nested call is still found
    const result = await scanOne(
      {
        'src/routes/a.tsx':
          "const cls = cn(fn('x'), 'w-[123px]');\nexport const A = () => <div className={cls} />;"
      },
      ['src/routes/a.tsx']
    );
    expect(codes(result)).toContain('DESIGN_ARBITRARY_VALUE');
  });
});

describe('Scenario: behavior — the inline-style spelling is exact enough', () => {
  it('when style is spelled with whitespace or a bare value, should judge it exactly', async () => {
    // given: the whitespace and character forms the attribute can take
    // when: each is scanned
    // then: whitespace around = is allowed and only an object/quote value counts
    const cases: ReadonlyArray<[source: string, expected: number]> = [
      ['<div style = {{ color: 1 }} />', 1],
      ['<div style= {color: 1} />', 1],
      ['<div style=red />', 0],
      ['<div textStyle={{ color: 1 }} />', 0],
      ['<div style={{ color: 1 }} />', 1]
    ];
    for (const [source, expected] of cases) {
      const findings = await findingsFor(source);
      expect(codesFor(findings, 'DESIGN_INLINE_STYLE'), source).toHaveLength(expected);
    }
  });
});

describe('Scenario: behavior — colour spellings and their messages', () => {
  it('when each colour spelling is scanned, should report the whole literal', async () => {
    // given: hex, rgb, hsl and a non-colour hash
    // when: each is scanned
    // then: the message carries the whole literal and a non-colour stays silent
    const cases: ReadonlyArray<[source: string, messages: string[]]> = [
      ['const a = "#fff";', ['raw colour literal #fff']],
      ['const a = "rgb(1,2,3)";', ['raw colour literal rgb(1,2,3)']],
      ['const a = "hsl(1,2%,3%)";', ['raw colour literal hsl(1,2%,3%)']],
      ['const a = "#zzzzz";', []]
    ];
    for (const [source, messages] of cases) {
      const findings = await findingsFor(source);
      expect(
        findings.map((finding) => finding.message),
        source
      ).toEqual(messages);
    }
  });

  it('when a hash follows an anchor attribute, should only hide an adjacent fragment', async () => {
    // given: four href spellings and a colour far from an earlier link
    // when: each is scanned
    // then: only a window that ends at the fragment hides the colour
    const cases: ReadonlyArray<[source: string, expected: number]> = [
      ['<a href="#fff">go</a>', 0],
      ['<a id="#fff">go</a>', 0],
      ['<a href="foo#abc">go</a>', 1],
      ['<a hrefx="#abc">go</a>', 1],
      ['<a href=#abc>go</a>', 1],
      ['<a href="#ok">go</a><p>#fff</p>', 1]
    ];
    for (const [source, expected] of cases) {
      const findings = await findingsFor(source);
      expect(codesFor(findings, 'DESIGN_RAW_COLOR'), source).toHaveLength(expected);
    }
  });
});

describe('Scenario: behavior — raw primitives need a design system at hand', () => {
  it('when each raw primitive spelling is scanned, should parse the element name', async () => {
    // given: spaced, lookalike and hyphenated tags
    // when: each is scanned
    // then: only a real named primitive is reported, named trimmed
    const cases: ReadonlyArray<[source: string, messages: string[]]> = [
      ['<  button>go</  button>', ['raw primitive <  button']],
      ['<xbutton>go</xbutton>', []],
      ['<div-button>go</div-button>', []],
      ['<table></table>', ['raw primitive <table']]
    ];
    for (const [source, messages] of cases) {
      const findings = await findingsFor(source);
      expect(
        codesFor(findings, 'DESIGN_RAW_PRIMITIVE').map((finding) => finding.message),
        source
      ).toEqual(messages);
    }
  });
});

describe('Scenario: behavior — className value forms', () => {
  it('when className takes each value form, should read the value whole', async () => {
    // given: every quoted form plus lookalike attributes and bare values
    // when: each is scanned
    // then: only a real className with an arbitrary Tailwind value fires
    const cases: ReadonlyArray<[source: string, expected: number]> = [
      ['<div className="gap-[7px]" />', 1],
      ['<div className= "gap-[7px]" />', 1],
      ['<div classNameFoo="gap-[7px]" />', 0],
      ["<div className='gap-[7px]' />", 1],
      ['<div className={`gap-[7px]`} />', 1],
      ["<div className={'gap-[7px]'} />", 1],
      ['<div className="a!-[x]" />', 0],
      ['<div className="w-[ ]" />', 0],
      ['<div className="w-[1]" />', 1],
      ['<div className="w-4" />', 0]
    ];
    for (const [source, expected] of cases) {
      const findings = await findingsFor(source);
      expect(codesFor(findings, 'DESIGN_ARBITRARY_VALUE'), source).toHaveLength(expected);
    }
  });
});

describe('Scenario: behavior — class helper spellings', () => {
  it('when each helper name is scanned, should read only the named helpers', async () => {
    // given: clsx, cva and a lookalike identifier
    // when: each is scanned
    // then: only the exact helper names carry arguments to judge
    const cases: ReadonlyArray<[source: string, expected: number]> = [
      ["const cls = clsx('gap-[7px]');", 1],
      ["const cls = cva('gap-[7px]');", 1],
      ["const cls = cna('gap-[7px]');", 0]
    ];
    for (const [source, expected] of cases) {
      const findings = await findingsFor(source);
      expect(codesFor(findings, 'DESIGN_ARBITRARY_VALUE'), source).toHaveLength(expected);
    }
  });

  it('when a helper is placed beside a className or a sibling call, should judge it once', async () => {
    // given: a helper after a sibling call, after a className, and inside one of two
    // when: each is scanned
    // then: only the helper's own arguments are judged, and a nested helper is skipped
    const sibling = await findingsFor("const cls = cn('w-[1px]') + fn('gap-[2px]');");
    expect(sibling.map((finding) => finding.message)).toEqual([
      'arbitrary Tailwind value w-[1px] in class helper'
    ]);
    const outside = await findingsFor('<div className="a" />;\nconst cls = cn(\'gap-[7px]\');');
    expect(codesFor(outside, 'DESIGN_ARBITRARY_VALUE')).toHaveLength(1);
    const nested = await findingsFor('<div className="a" className={cn(\'gap-[7px]\')} />');
    expect(codesFor(nested, 'DESIGN_ARBITRARY_VALUE')).toHaveLength(1);
  });
});

describe('Scenario: integration — a banned import is a library bypass', () => {
  const cases: ReadonlyArray<[label: string, source: string, expected: number]> = [
    ['named import', "import { Button } from '@/components/ui/button';", 1],
    ['extra spaces', "import  { Button } from '@/components/ui/button';", 1],
    ['type import', "import type { X } from '@/components/ui';", 1],
    ['side-effect import', "import '@/components/ui/styles.css';", 1],
    ['dynamic import', "const x = import('@/components/ui/button');", 1],
    ['dynamic import with spaces', "const y = import( '@/components/ui' );", 1],
    ['exact specifier', "import { y } from '@/components/ui';", 1],
    ['unrelated package', "import { useState } from 'react';", 0],
    ['lookalike prefix', "import B from '@/components/ui-kit/button';", 0]
  ];

  it('when a banned specifier is imported, should report a bypass per form', async () => {
    // given: every textual way an import specifier can be written
    // when: each snippet is scanned
    // then: only specifiers inside the banned package tree are reported
    for (const [label, source, expected] of cases) {
      const findings = await findingsFor(source, BANNED_ROAD);
      expect(codesFor(findings, 'DESIGN_LIBRARY_BYPASS'), label).toHaveLength(expected);
    }
  });

  it('when a banned import is reported, should name the specifier', async () => {
    // given: a named import from the banned tree
    // when: it is scanned
    // then: the message names the full specifier
    const findings = await findingsFor(
      "import { Button } from '@/components/ui/button';",
      BANNED_ROAD
    );
    expect(findings.map((finding) => finding.message)).toEqual([
      'direct library import @/components/ui/button'
    ]);
  });
});

describe('Scenario: integration — the scan stays linear in findings', () => {
  it('when a large page repeats one finding, should finish without rescanning per finding', async () => {
    // given: a 1 MB page carrying five thousand inline styles
    // when: it is scanned once
    // then: the line lookup does not rescan the source for every finding
    const { scanFile } = await loadScan();
    const line = "export const X = () => <div style={{ color: 'red' }} />;\n";
    const source = line.repeat(5000).padEnd(1_000_000, ' ');
    const started = Date.now();
    const result = scanFile({
      file: 'src/routes/a.tsx',
      source,
      pavedRoad: ROAD,
      tokens: TOKENS
    });
    const elapsed = Date.now() - started;
    expect(result.findings.filter((f) => f.code === 'DESIGN_INLINE_STYLE')).toHaveLength(5000);
    expect(elapsed).toBeLessThan(3000);
  });
});
