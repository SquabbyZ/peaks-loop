import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import type {
  AuditFinding,
  AuditInput,
  AuditSource
} from '../../../src/services/design/audit/audit-finding.js';
import { runAuditProject } from '../../../src/services/design/audit/audit-project.js';
import {
  auditStates,
  dataEvidence,
  stateEvidence
} from '../../../src/services/design/audit/audit-states.js';
import { readImportClosure } from '../../../src/services/design/audit/import-closure.js';
import { markupSources } from '../../../src/services/design/audit/markup-scan.js';
import { buildPavedRoad, type DesignTokenScale } from '../../../src/services/design/paved-road.js';

declareDimensions('tests/unit/design/audit-states.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/design/audit');
const CLOSURE_TREE = join(FIXTURES, 'closure-tree');
const scale: DesignTokenScale = buildPavedRoad({
  pageRoots: ['src/pages'],
  componentEntrypoints: []
}).tokenScale;

function source(name: string): AuditSource {
  return { file: name, source: readFileSync(join(FIXTURES, name), 'utf8') };
}

/** The line a fixture declares `needle` on, read from the fixture itself. */
function lineOf(name: string, needle: string): number {
  const lines = readFileSync(join(FIXTURES, name), 'utf8').split('\n');
  return lines.findIndex((line) => line.includes(needle)) + 1;
}

function run(name: string, extra: Partial<AuditInput> = {}): AuditFinding[] {
  return auditStates({ tokenScale: scale, sources: [source(name)], ...extra });
}

function dedupe(sources: readonly AuditSource[]): AuditSource[] {
  const seen = new Set<string>();
  return sources.filter((entry) => {
    if (seen.has(entry.file)) return false;
    seen.add(entry.file);
    return true;
  });
}

function invertedFinding(): AuditFinding {
  return {
    dimension: 'states',
    severity: 'hard',
    file: 'inverted.tsx',
    line: 1,
    value: 'empty/error present',
    expected: 'inverted',
    humanText: '反向检测器把带空状态的数据页报成了问题。',
    techText: 'inverted.tsx:1 data-bearing with empty/error branch (inverted)'
  };
}

/**
 * The injection control: the states rule flipped.
 *
 * The real detector reports a data page with NEITHER branch. This wrapper
 * reports a data page that HAS one, so a flipped comparison makes the two agree
 * on one fixture and the calibration below fails instead of passing vacuously.
 */
function invertedStates(input: AuditInput): AuditFinding[] {
  const page = markupSources(input.sources);
  if (page.flatMap((entry) => dataEvidence(entry)).length === 0) return [];
  const context = dedupe([...page, ...markupSources(input.imports ?? [])]);
  const branches = stateEvidence(context);
  return branches.empty.length + branches.error.length === 0 ? [] : [invertedFinding()];
}

/**
 * The pre-6c rule, kept as the inversion control for the evidence change:
 * any `.map(` counts as data. On the static-config fixture it fires where the
 * real detector is silent, so the calibration cannot pass vacuously.
 */
function mapOnlyStates(input: AuditInput): AuditFinding[] {
  const page = markupSources(input.sources);
  if (!page.some((entry) => /\b\w+\.map\s*\(/.test(entry.source))) return [];
  const context = dedupe([...page, ...markupSources(input.imports ?? [])]);
  const branches = stateEvidence(context);
  return branches.empty.length + branches.error.length === 0 ? [invertedFinding()] : [];
}

describe('Scenario: render — a states finding carries the documented shape', () => {
  it('when a data page has no empty or error branch, should render one hard finding', () => {
    // given: the bad fixture (a table plus a map over rows)
    // when: the states audit runs
    // then: the finding is hard, dimension states, and fully shaped
    const findings = run('states-bad-page.tsx');
    expect(findings).toHaveLength(1);
    expect(Object.keys(findings[0] ?? {}).sort()).toEqual([
      'dimension',
      'expected',
      'file',
      'humanText',
      'line',
      'severity',
      'techText',
      'value'
    ]);
    expect(findings[0]).toMatchObject({
      dimension: 'states',
      severity: 'hard',
      file: 'states-bad-page.tsx',
      line: lineOf('states-bad-page.tsx', '<table>'),
      value: '<table>'
    });
  });
});

describe('Scenario: behavior — the page must bear data and lack both branches', () => {
  it('when a data page has empty and error branches, should report nothing', () => {
    // given: the clean fixture with `error` and `items.length === 0`
    // when: the states audit runs
    // then: no finding is emitted
    expect(run('states-clean-page.tsx')).toEqual([]);
  });

  it('when a static marketing page renders no data, should never fire', () => {
    // given: a hero page with no iteration and no table
    // when: the states audit runs
    // then: the never-fires fixture stays silent
    expect(run('states-marketing-page.tsx')).toEqual([]);
  });

  it('when the finding fires, should name the evidence that made it data-bearing', () => {
    // given: a page whose only data signal is a table with a body
    // when: the finding's bilingual pair is read
    // then: both the sentence and the technical line name the evidence
    const finding = run('states-bad-page.tsx')[0];
    expect(finding?.humanText).toContain('<table>');
    expect(finding?.techText).toContain('data-bearing (<table>');
  });

  it('when the detector is inverted, should disagree on both calibration pages', () => {
    // given: the clean and bad fixtures and an inverted detector over the same evidence
    // when: both detectors run
    // then: the real detector is silent on clean and the inverted one is not
    const clean: AuditInput = { tokenScale: scale, sources: [source('states-clean-page.tsx')] };
    const bad: AuditInput = { tokenScale: scale, sources: [source('states-bad-page.tsx')] };
    expect(auditStates(clean)).toEqual([]);
    expect(invertedStates(clean)).toHaveLength(1);
    expect(auditStates(bad)).toHaveLength(1);
    expect(invertedStates(bad)).toEqual([]);
  });
});

describe('Scenario: behavior — only a real data source is data', () => {
  it('when a page maps a static config array and nothing else, should stay silent', () => {
    // given: a preset list rendered with `.map(` and no fetch, array prop or table
    // when: the real detector and the pre-6c `.map(` rule both run
    // then: the real one is silent and the old rule fires on the same fixture
    expect(run('states-static-map-page.tsx')).toEqual([]);
    const control = mapOnlyStates({
      tokenScale: scale,
      sources: [source('states-static-map-page.tsx')]
    });
    expect(control).toHaveLength(1);
  });

  it('when a two-value comparison renders a human message, should count it as an empty branch', () => {
    // given: `before === after` returning "No source changes" above a table
    // when: the states audit runs
    // then: the equality branch is recognised and no finding is emitted
    expect(run('states-comparison-page.tsx')).toEqual([]);
  });

  it('when a length guard renders nothing, should count it as an empty branch', () => {
    // given: `domains.length < 2 → null` in a component that renders readable text
    // when: the states audit runs
    // then: the guard is recognised and no finding is emitted
    expect(run('states-guard-page.tsx')).toEqual([]);
  });

  it('when the query lives in an imported child, should read the closure as data-bearing', () => {
    // given: a page whose only data source is `useQuery` in an imported hook
    // when: the page is audited with and without its closure
    // then: the page alone is not data-bearing and the closure makes it fire
    const page = source('states-fetch-closure-page.tsx');
    const hook = source('states-data-hook.tsx');
    expect(auditStates({ tokenScale: scale, sources: [page] })).toEqual([]);
    expect(auditStates({ tokenScale: scale, sources: [page], imports: [hook] })).toHaveLength(1);
  });
});

describe('Scenario: integration — the import closure clears a child-held empty state', () => {
  const page: AuditSource = {
    file: 'pages/list.tsx',
    source: readFileSync(join(CLOSURE_TREE, 'pages/list.tsx'), 'utf8')
  };
  const closure = readImportClosure({
    appRoot: CLOSURE_TREE,
    file: page.file,
    source: page.source
  });

  it('when the empty state lives in an imported child, should read the closure and stay clean', () => {
    // given: a page with a table and a RowList import whose empty state is in RowList
    // when: the page is audited with and without its import closure
    // then: the single file fires and the closure makes it clean
    expect(closure.sources.map((entry) => entry.file)).toEqual(['components/RowList.tsx']);
    expect(auditStates({ tokenScale: scale, sources: [page] })).toHaveLength(1);
    expect(auditStates({ tokenScale: scale, sources: [page], imports: closure.sources })).toEqual(
      []
    );
  });

  it('when the project reader runs, should walk the closure and report no states gap', () => {
    // given: the closure fixture tree with a design contract
    // when: the project is read
    // then: the page has no states finding and the read gaps stay empty
    const result = runAuditProject({ appRoot: CLOSURE_TREE });
    if (result.kind !== 'audited') throw new Error(`unexpected result ${result.kind}`);
    const pageUnit = result.pages.find((entry) => entry.path === 'pages/list.tsx');
    const states = pageUnit?.findings.filter((finding) => finding.dimension === 'states') ?? [];
    expect(states).toEqual([]);
    expect(result.state.readGaps).toEqual([]);
  });

  it('when a TypeScript-ESM import names .js, should resolve the .tsx source', () => {
    // given: an import of ./Leaf.js while only Leaf.tsx exists on disk
    // when: the closure is read
    // then: the emitted name falls back to the source module
    const esm: AuditSource = {
      file: 'components/Chain.tsx',
      source: "import { Leaf } from './Leaf.js';\nexport const x = 1;\n"
    };
    const read = readImportClosure({ appRoot: CLOSURE_TREE, file: esm.file, source: esm.source });
    expect(read.sources.map((entry) => entry.file)).toEqual(['components/Leaf.tsx']);
  });

  it('when the closure hits its file bound, should report truncation', () => {
    // given: a three-module chain and a bound of one file
    // when: the closure is read
    // then: one module is returned and the walk reports it stopped early
    const chain: AuditSource = {
      file: 'components/Chain.tsx',
      source: readFileSync(join(CLOSURE_TREE, 'components/Chain.tsx'), 'utf8')
    };
    const bounded = readImportClosure({
      appRoot: CLOSURE_TREE,
      file: chain.file,
      source: chain.source,
      maxFiles: 1
    });
    expect(bounded.sources.map((entry) => entry.file)).toEqual(['components/Tail.tsx']);
    expect(bounded.truncated).toBe(true);
  });
});

describe('Scenario: integration — path aliases close the read gap', () => {
  const ALIAS_TREE = join(FIXTURES, 'alias-tree');

  it('when a page imports @/components/RowList, should pick up that file’s empty state', () => {
    // given: a page whose only empty state lives behind the `@/` alias
    // when: the project is read
    // then: the alias is followed and the page has no states finding
    const result = runAuditProject({ appRoot: ALIAS_TREE });
    if (result.kind !== 'audited') throw new Error(`unexpected result ${result.kind}`);
    const page = result.pages.find((entry) => entry.path === 'src/pages/list.tsx');
    const states = page?.findings.filter((finding) => finding.dimension === 'states') ?? [];
    expect(states).toEqual([]);
  });

  it('when an alias names no file, should count it in readGaps', () => {
    // given: the same page also imports `@/components/Missing`, which does not exist
    // when: the project is read
    // then: one counted alias gap names the broken import
    const result = runAuditProject({ appRoot: ALIAS_TREE });
    if (result.kind !== 'audited') throw new Error(`unexpected result ${result.kind}`);
    const gaps = result.state.readGaps;
    expect(gaps.some((gap) => gap.startsWith('1 path-alias imports could not be resolved'))).toBe(
      true
    );
    expect(gaps.some((gap) => gap.includes('@/components/Missing'))).toBe(true);
  });
});

describe('Scenario: behavior — the evidence vocabulary is exact (review M2/M3)', () => {
  const scaleFor = scale;

  function pageSource(source: string): AuditSource {
    return { file: 'pages/page.tsx', source };
  }

  function judge(source: string): AuditFinding[] {
    return auditStates({ tokenScale: scaleFor, sources: [pageSource(source)] });
  }

  it('when a prop is a generic Record, should not read it as an array prop', () => {
    // given: a settings page whose config prop is `Record<string, string>`
    // when: the data evidence is read
    // then: no prop evidence is manufactured and the page is not judged
    const source =
      'export function Settings({ options }: { options: Record<string, string> }) {\n' +
      '  return <section><h1>Settings</h1><p>Nothing else here</p></section>;\n' +
      '}\n';
    expect(dataEvidence(pageSource(source))).toEqual([]);
    expect(judge(source)).toEqual([]);
  });

  it('when a prop is a real array, should still read it as data', () => {
    // given: a page whose rows prop is `Row[]` and whose table has no branch
    // when: the states audit runs
    // then: the prop is data and the missing branches are one hard finding
    const source =
      'export function List({ rows }: { rows: Row[] }) {\n' +
      '  return <table><tbody>{rows.map((row) => <tr key={row.id}><td>{row.id}</td></tr>)}</tbody></table>;\n' +
      '}\n';
    expect(dataEvidence(pageSource(source)).map((entry) => entry.kind)).toContain('prop');
    expect(judge(source)).toHaveLength(1);
  });

  it('when the file only catches an error, should not treat it as an error branch', () => {
    // given: a table page whose only `error` is the `catch (error)` binding
    // when: the states audit runs
    // then: the catch does not silence the missing-branch finding
    const source =
      'export function List({ rows }: { rows: Row[] }) {\n' +
      '  try { return <table><tbody>{rows.map((row) => <tr key={row.id}><td>{row.id}</td></tr>)}</tbody></table>; }\n' +
      '  catch (error) { throw error; }\n' +
      '}\n';
    expect(judge(source)).toHaveLength(1);
  });

  it('when a variable is named notEmpty, should not match the empty vocabulary', () => {
    // given: a table page whose only state name is `notEmpty`
    // when: the states audit runs
    // then: the whole-word rule does not read it as an empty branch
    const source =
      'export function List({ rows }: { rows: Row[] }) {\n' +
      '  const notEmpty = rows.length > 0;\n' +
      '  return <table><tbody>{rows.map((row) => <tr key={row.id}><td>{row.id}</td></tr>)}</tbody></table>;\n' +
      '}\n';
    expect(stateEvidence([pageSource(source)]).empty).toEqual([]);
    expect(judge(source)).toHaveLength(1);
  });

  it('when an ErrorBoundary is imported, should not count it as the error branch', () => {
    // given: a table page that merely imports and renders an ErrorBoundary
    // when: the states audit runs
    // then: the import is not error UI and the finding still fires
    const source =
      "import { ErrorBoundary } from './error-boundary';\n" +
      'export function List({ rows }: { rows: Row[] }) {\n' +
      '  return <ErrorBoundary><table><tbody>{rows.map((row) => <tr key={row.id}><td>{row.id}</td></tr>)}</tbody></table></ErrorBoundary>;\n' +
      '}\n';
    expect(stateEvidence([pageSource(source)]).error).toEqual([]);
    expect(judge(source)).toHaveLength(1);
  });

  it('when an isEmpty branch renders a state component, should count it', () => {
    // given: a table page with `isEmpty ? <EmptyState/>` and `if (error)`
    // when: the states audit runs
    // then: both a JSX component and a bare branch name are evidence
    const source =
      'export function List({ rows, isEmpty, error }: { rows: Row[]; isEmpty: boolean; error?: string }) {\n' +
      '  if (error) return <p>Failed</p>;\n' +
      '  if (isEmpty) return <EmptyState />;\n' +
      '  return <table><tbody>{rows.map((row) => <tr key={row.id}><td>{row.id}</td></tr>)}</tbody></table>;\n' +
      '}\n';
    expect(stateEvidence([pageSource(source)]).empty.length).toBeGreaterThan(0);
    expect(stateEvidence([pageSource(source)]).error.length).toBeGreaterThan(0);
    expect(judge(source)).toEqual([]);
  });
});

describe('Scenario: a11y — the finding speaks to a person and to an agent', () => {
  it('when a data page lacks both branches, should explain the risk in Chinese', () => {
    // given: the bad fixture's states finding
    // when: its bilingual pair is read
    // then: the plain sentence names the missing branches and the tech line is greppable
    const finding = run('states-bad-page.tsx')[0];
    expect(finding?.humanText).toContain('没有空状态或错误状态分支');
    expect(finding?.techText).toContain(
      `states-bad-page.tsx:${lineOf('states-bad-page.tsx', '<table>')} data-bearing`
    );
  });
});
