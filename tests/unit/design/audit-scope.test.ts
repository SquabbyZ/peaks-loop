import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { runAuditProject } from '../../../src/services/design/audit/audit-project.js';
import { isRouteEntry } from '../../../src/services/design/audit/audit-scope.js';
import {
  buildAuditReport,
  renderAuditMarkdown
} from '../../../src/services/design/audit/audit-report.js';

declareDimensions('tests/unit/design/audit-scope.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/design/audit');
const CLOSURE_TREE = join(FIXTURES, 'closure-tree');
const TREE = join(FIXTURES, 'three-page-tree');
const HYGIENE_TREE = join(FIXTURES, 'hygiene-tree');
const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

/** A writable copy of the three-page tree with `pageRoots` emptied. */
function withoutPageRoots(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-audit-scope-'));
  roots.push(root);
  cpSync(TREE, root, { recursive: true });
  const roadPath = join(root, 'design', 'paved-road.json');
  const road = JSON.parse(readFileSync(roadPath, 'utf8')) as Record<string, unknown>;
  road.pageRoots = [];
  writeFileSync(roadPath, `${JSON.stringify(road, null, 2)}\n`, 'utf8');
  return root;
}

describe('Scenario: render — the scope is part of the audited result', () => {
  it('when a declared-root tree is read, should carry the documented scope fields', () => {
    // given: the three-page tree whose paved road declares `pages`
    // when: the project is read
    // then: the scope names the roots and counts scored versus context sources
    const result = runAuditProject({ appRoot: TREE });
    if (result.kind !== 'audited') throw new Error(`unexpected result ${result.kind}`);
    expect(Object.keys(result.scope).sort()).toEqual([
      'context',
      'note',
      'pageRoots',
      'pageRootsDeclared',
      'scored',
      'valueFiles'
    ]);
    expect(result.scope).toMatchObject({
      pageRoots: ['pages'],
      pageRootsDeclared: true,
      scored: 3,
      context: 0
    });
    expect(result.scope.note).toContain('under pageRoots pages');
  });
});

describe('Scenario: behavior — a component outside the page roots is not scored', () => {
  it('when a page imports a component outside its root, should score the page only', () => {
    // given: closure-tree, where `components/RowList.tsx` sits outside `pages`
    // when: the project is read
    // then: the component is context (reported, read by the closure), never a page
    const result = runAuditProject({ appRoot: CLOSURE_TREE });
    if (result.kind !== 'audited') throw new Error(`unexpected result ${result.kind}`);
    expect(result.pages.map((page) => page.path)).toEqual(['pages/list.tsx']);
    expect(result.scope.scored).toBe(1);
    expect(result.scope.context).toBe(1);
    expect(result.scope.valueFiles).toBe(2);
    expect(result.scope.note).toContain('read only through the import closure (not scored)');
  });
});

describe('Scenario: behavior — a declared root cannot paint the scope line', () => {
  it('when a paved-road root carries ESC and an unbounded path, should sanitise the note', () => {
    // given: a copy of the three-page tree whose contract adds an ESC root of 400+ chars
    // when: the project is read and the markdown rendered
    // then: neither the control sequence nor the full root reaches a persisted line
    const root = mkdtempSync(join(tmpdir(), 'peaks-audit-scope-root-'));
    roots.push(root);
    cpSync(TREE, root, { recursive: true });
    const roadPath = join(root, 'design', 'paved-road.json');
    const road = JSON.parse(readFileSync(roadPath, 'utf8')) as Record<string, unknown>;
    road.pageRoots = ['pages', `evil\u001b[2J${'r/'.repeat(200)}`];
    writeFileSync(roadPath, `${JSON.stringify(road, null, 2)}\n`, 'utf8');
    const result = runAuditProject({ appRoot: root });
    if (result.kind !== 'audited') throw new Error(`unexpected result ${result.kind}`);
    expect(result.scope.note).not.toContain('\u001b');
    expect(result.scope.note).not.toContain('[2J');
    expect(result.scope.note).toContain('evil');
    expect(result.scope.note).not.toContain('r/'.repeat(200));
    const markdown = renderAuditMarkdown(buildAuditReport(result), {
      appRoot: 'esc-root-tree',
      generatedAt: '2026-11-25T00:00:00.000Z'
    });
    expect(markdown).not.toContain('\u001b');
    expect(markdown).not.toContain('[2J');
  });
});

describe('Scenario: behavior — only route entries inside a declared root are scored', () => {
  it('when a path is classified, should separate route entries from fragments', () => {
    // given: the pilot's shapes (routes, feature entry module, component, section)
    // when: the route-entry rule runs
    // then: only the route and the entry module are entries
    const roots = ['src/routes', 'src/features'];
    expect(isRouteEntry('src/routes/_authenticated/keys/index.tsx', roots)).toBe(true);
    expect(isRouteEntry('src/features/index.tsx', roots)).toBe(true);
    expect(isRouteEntry('src/features/about/index.tsx', roots)).toBe(false);
    expect(isRouteEntry('src/features/about/components/row.tsx', roots)).toBe(false);
    expect(isRouteEntry('src/features/home/components/sections/security.tsx', roots)).toBe(false);
  });

  it('when a feature root holds a component and test modules, should score the entry module only', () => {
    // given: hygiene-tree — an entry module, a component, a test and a mock
    // when: the project is read
    // then: one page is scored, the test files never are, and the note states the rule
    const result = runAuditProject({ appRoot: HYGIENE_TREE });
    if (result.kind !== 'audited') throw new Error(`unexpected result ${result.kind}`);
    expect(result.pages.map((page) => page.path)).toEqual(['src/features/index.tsx']);
    expect(result.scope.scored).toBe(1);
    expect(result.scope.note).toContain('route entries only');
  });

  it('when the entry imports a test mock that holds an empty state, should not borrow it', () => {
    // given: the page's only "No data yet" string lives in `__mocks__/rows.tsx`
    // when: the project is read
    // then: the mock is excluded from the closure and the states finding stands
    const result = runAuditProject({ appRoot: HYGIENE_TREE });
    if (result.kind !== 'audited') throw new Error(`unexpected result ${result.kind}`);
    const page = result.pages[0];
    const states = page?.findings.filter((finding) => finding.dimension === 'states') ?? [];
    expect(states).toHaveLength(1);
  });
});

describe('Scenario: integration — no declared page roots keeps the wider scope', () => {
  it('when the contract declares no pageRoots, should score every UI source and say so', () => {
    // given: the three-page tree with `pageRoots: []`
    // when: the project is read and rendered
    // then: all three units are scored and the report names the undeclared scope
    const result = runAuditProject({ appRoot: withoutPageRoots() });
    if (result.kind !== 'audited') throw new Error(`unexpected result ${result.kind}`);
    expect(result.pages).toHaveLength(3);
    expect(result.scope.pageRootsDeclared).toBe(false);
    expect(result.scope.pageRoots).toEqual([]);
    expect(result.scope.note).toContain('pageRoots not declared — every UI source scored');
  });
});

describe('Scenario: a11y — the report prints the scope, not just the data', () => {
  it('when the markdown is rendered, should show the scope as a readable line', () => {
    // given: an audited tree with its scope
    // when: the markdown report is rendered
    // then: the scope line appears so a person knows what was scored
    const result = runAuditProject({ appRoot: CLOSURE_TREE });
    if (result.kind !== 'audited') throw new Error(`unexpected result ${result.kind}`);
    const markdown = renderAuditMarkdown(buildAuditReport(result), {
      appRoot: 'closure-tree',
      generatedAt: '2026-11-25T00:00:00.000Z'
    });
    expect(markdown).toContain('- scope: scored 1 page units under pageRoots pages;');
  });
});
