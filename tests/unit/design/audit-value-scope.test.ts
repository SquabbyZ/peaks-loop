import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import type { AuditSource } from '../../../src/services/design/audit/audit-finding.js';
import { runAuditProject } from '../../../src/services/design/audit/audit-project.js';
import {
  buildAuditReport,
  renderAuditMarkdown
} from '../../../src/services/design/audit/audit-report.js';
import { auditSurface } from '../../../src/services/design/audit/audit-surface.js';
import { buildPavedRoad } from '../../../src/services/design/paved-road.js';

declareDimensions('tests/unit/design/audit-value-scope.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/design/audit');
const TREE = join(FIXTURES, 'value-closure-tree');
const scale = buildPavedRoad({ pageRoots: [], componentEntrypoints: [] }).tokenScale;

function audited() {
  const result = runAuditProject({ appRoot: TREE });
  if (result.kind !== 'audited') throw new Error(`unexpected result ${result.kind}`);
  return result;
}

function pageOf(result: ReturnType<typeof audited>, path: string) {
  const page = result.pages.find((entry) => entry.path === path);
  if (page === undefined) throw new Error(`missing page ${path}`);
  return page;
}

function source(file: string, text: string): AuditSource {
  return { file, source: text };
}

describe('Scenario: render — the scope states what the value dimensions read', () => {
  it('when the tree is read, should count the page-plus-closure files and say so', () => {
    // given: two pages that both import `components/Card.tsx`, plus an unimported component
    // when: the project is read
    // then: the scope counts the three files read and names the shared-component rule
    const scope = audited().scope;
    expect(scope.valueFiles).toBe(3);
    expect(scope.note).toContain('read each page plus its import closure');
    expect(scope.note).toContain('3 distinct files');
    expect(scope.note).toContain('a shared component counts once per page that imports it');
  });
});

describe('Scenario: behavior — a value dimension judges the page plus its closure', () => {
  it('when a page renders a component with three off-ladder paddings, should measure all three', () => {
    // given: `pages/one.tsx` imports `components/Card.tsx`, whose only spacing values are off-ladder
    // when: the project is read
    // then: the page measures three values, not zero, and each finding cites the component
    const page = pageOf(audited(), 'pages/one.tsx');
    expect(page.judgements.spacing).toEqual({ measured: 3, onContract: 0 });
    const spacing = page.findings.filter((finding) => finding.dimension === 'spacing');
    expect(spacing.map((finding) => finding.value).sort()).toEqual([
      'gap-[9px]',
      'mt-[15px]',
      'p-[13px]'
    ]);
    expect(spacing.every((finding) => finding.file === 'components/Card.tsx')).toBe(true);
  });

  it('when two pages import the same component, should contribute once to each page', () => {
    // given: both pages import `components/Card.tsx`
    // when: the project is read
    // then: each page measures the component's three values once, never six
    const result = audited();
    for (const path of ['pages/one.tsx', 'pages/two.tsx']) {
      expect(pageOf(result, path).judgements.spacing?.measured).toBe(3);
    }
  });

  it('when a component is imported by no page, should contribute nothing', () => {
    // given: `components/Unused.tsx` carries two off-ladder values and is never imported
    // when: the project is read
    // then: no finding cites it and it is not in the value file count
    const result = audited();
    const cited = result.pages.flatMap((page) =>
      page.findings.filter((finding) => finding.techText.includes('Unused.tsx'))
    );
    expect(cited).toEqual([]);
    expect(result.scope.valueFiles).toBe(3);
  });

  it('when a component carries four radius tiers, should judge radius through the closure', () => {
    // given: `components/Card.tsx` renders four distinct radius tiers (3, 5, 7, 9 px)
    // when: the project is read
    // then: the page's surface row carries the radius finding, anchored in the component
    const page = pageOf(audited(), 'pages/one.tsx');
    const surface = page.findings.filter((finding) => finding.dimension === 'surface');
    expect(surface).toHaveLength(1);
    expect(surface[0]).toMatchObject({ file: 'components/Card.tsx', value: '3/5/7/9' });
  });

  it('when a shared child writes a second primary string, should not count it against the page', () => {
    // given: the page and its child each carry one distinct primary button string
    // when: the surface rule runs with the page-only set and again with the closure
    // then: the page-scope set reports none, and the closure-wide inversion reports one
    const page = source(
      'pages/page.tsx',
      '<button className="bg-primary px-4 rounded-md">Go</button>'
    );
    const child = source(
      'components/Banner.tsx',
      '<button className="rounded-lg px-3 bg-primary">Buy</button>'
    );
    const scoped = auditSurface({ tokenScale: scale, sources: [page, child], pageSources: [page] });
    const closureWide = auditSurface({ tokenScale: scale, sources: [page, child] });
    expect(scoped).toEqual([]);
    expect(
      closureWide.filter((finding) => finding.techText.includes('primary-class-strings'))
    ).toHaveLength(1);
  });
});

describe('Scenario: integration — the report carries the value file count', () => {
  it('when the markdown is rendered, should print the value scope in the scope line', () => {
    // given: the audited tree with its value scope
    // when: the markdown report is rendered
    // then: the value rule and its count appear on the scope line
    const markdown = renderAuditMarkdown(buildAuditReport(audited()), {
      appRoot: 'value-closure-tree',
      generatedAt: '2026-11-25T00:00:00.000Z'
    });
    expect(markdown).toContain('- scope: scored 2 page units under pageRoots pages;');
    expect(markdown).toContain('(3 distinct files;');
  });
});

describe('Scenario: a11y — the scope sentence is readable by a person', () => {
  it('when the scope note is read, should explain the shared-component rule without jargon', () => {
    // given: the audited tree's scope note
    // when: the note is read as one sentence
    // then: it names the value dimensions and says a shared component counts per page that imports it
    const note = audited().scope.note;
    expect(note).toContain('value dimensions (spacing, type, colour, surface)');
    expect(note).toContain('a shared component counts once per page that imports it');
  });
});
