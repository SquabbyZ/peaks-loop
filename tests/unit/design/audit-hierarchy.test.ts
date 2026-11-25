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
import {
  auditHierarchy,
  hasHeading,
  markupTypeLevels,
  MIN_TYPE_LEVELS,
  primaryActions
} from '../../../src/services/design/audit/audit-hierarchy.js';
import { markupSources } from '../../../src/services/design/audit/markup-scan.js';
import { runAuditProject } from '../../../src/services/design/audit/audit-project.js';
import { buildPavedRoad, type DesignTokenScale } from '../../../src/services/design/paved-road.js';

declareDimensions('tests/unit/design/audit-hierarchy.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/design/audit');
const scale: DesignTokenScale = buildPavedRoad({
  pageRoots: ['src/pages'],
  componentEntrypoints: []
}).tokenScale;

function source(name: string): AuditSource {
  return { file: name, source: readFileSync(join(FIXTURES, name), 'utf8') };
}

function run(name: string): AuditFinding[] {
  return auditHierarchy({ tokenScale: scale, sources: [source(name)] });
}

function invertedFinding(value: string): AuditFinding {
  return {
    dimension: 'hierarchy',
    severity: 'soft',
    file: 'inverted.tsx',
    line: 1,
    value,
    expected: 'inverted',
    humanText: `反向检测器把 ${value} 报成了问题。`,
    techText: `inverted.tsx:1 ${value} (inverted)`
  };
}

/**
 * The injection control: each hierarchy rule flipped.
 *
 * The real detector reports a MISSING h1, MORE than one primary action and
 * FEWER than three type levels. This wrapper reports the compliant side, so a
 * flipped comparison makes both detectors agree on one fixture and the
 * calibration below fails instead of passing vacuously.
 */
function invertedHierarchy(input: AuditInput): AuditFinding[] {
  const markup = markupSources(input.sources);
  const findings: AuditFinding[] = [];
  if (hasHeading(markup)) findings.push(invertedFinding('heading:h1 present'));
  if (primaryActions(markup).length <= 1) findings.push(invertedFinding('primary-actions:<=1'));
  if (markupTypeLevels(markup).length >= MIN_TYPE_LEVELS) {
    findings.push(invertedFinding('type-levels:>=3'));
  }
  return findings;
}

describe('Scenario: render — a hierarchy finding carries the documented shape', () => {
  it('when the bad hierarchy page is audited, should render three soft findings', () => {
    // given: a page with no h1, two primary buttons and two type levels
    // when: the hierarchy audit runs
    // then: every finding is soft, dimension hierarchy and fully shaped
    const findings = run('hierarchy-bad-page.tsx');
    expect(findings).toHaveLength(3);
    for (const finding of findings) {
      expect(Object.keys(finding).sort()).toEqual([
        'dimension',
        'expected',
        'file',
        'humanText',
        'line',
        'severity',
        'techText',
        'value'
      ]);
      expect(finding.dimension).toBe('hierarchy');
      expect(finding.severity).toBe('soft');
    }
  });
});

describe('Scenario: behavior — heading, primary actions and type levels', () => {
  it('when a page has an h1, one primary action and four levels, should report nothing', () => {
    // given: the clean hierarchy fixture
    // when: the hierarchy audit runs
    // then: no finding is emitted
    expect(run('hierarchy-clean-page.tsx')).toEqual([]);
  });

  it('when a page renders no text, should never fire', () => {
    // given: a markup page whose only child is a self-closing element
    // when: the hierarchy audit runs
    // then: the missing h1 and flat scale are not judged on unrendered text
    expect(run('hierarchy-no-text-page.tsx')).toEqual([]);
  });

  it('when the source is a stylesheet, should never fire', () => {
    // given: a `.css` file, which renders no text and has no `h1`
    // when: the hierarchy audit runs
    // then: no markup finding is emitted
    expect(run('hierarchy-stylesheet.css')).toEqual([]);
  });

  it('when the h1 is missing, should report it once at line one', () => {
    // given: the bad fixture with no `h1`
    // when: the h1 finding is read
    // then: it names the missing heading and cites file:line
    const finding = run('hierarchy-bad-page.tsx').find((entry) => entry.expected === 'h1');
    expect(finding?.techText).toBe('hierarchy-bad-page.tsx:1 heading:h1 missing');
    expect(finding?.humanText).toContain('没有 h1 标题');
  });

  it('when two elements are primary actions, should name both', () => {
    // given: two buttons carrying the primary style
    // when: the primary-action finding is read
    // then: it counts two and names each element with its line
    const finding = run('hierarchy-bad-page.tsx').find((entry) =>
      entry.techText.includes('primary-actions')
    );
    expect(finding?.value).toBe('2');
    expect(finding?.techText).toContain('<button>@hierarchy-bad-page.tsx:5');
    expect(finding?.techText).toContain('<button>@hierarchy-bad-page.tsx:6');
  });

  it('when fewer than three type levels are distinguishable, should report the count', () => {
    // given: two levels (body copy and button text) in the bad fixture
    // when: the level finding is read
    // then: it reports two levels against the minimum of three
    const levels = markupTypeLevels([source('hierarchy-bad-page.tsx')]);
    expect(levels).toHaveLength(2);
    const finding = run('hierarchy-bad-page.tsx').find((entry) =>
      entry.techText.includes('type-levels')
    );
    expect(finding?.value).toBe('2');
    expect(finding?.expected).toBe('>=3');
  });

  it('when the detector is inverted, should disagree on both calibration pages', () => {
    // given: the clean and bad fixtures and an inverted detector over the same measures
    // when: both detectors run
    // then: the real detector is silent on clean and the inverted one is not
    const clean: AuditInput = { tokenScale: scale, sources: [source('hierarchy-clean-page.tsx')] };
    const bad: AuditInput = { tokenScale: scale, sources: [source('hierarchy-bad-page.tsx')] };
    expect(auditHierarchy(clean)).toEqual([]);
    expect(invertedHierarchy(clean)).toHaveLength(3);
    expect(auditHierarchy(bad)).toHaveLength(3);
    expect(invertedHierarchy(bad)).toEqual([]);
  });
});

describe('Scenario: integration — the project reader drives the detector', () => {
  it('when a page unit carries one h1 and two levels, should report only the level count', () => {
    // given: the closure fixture page (h1 + table cell, two levels)
    // when: the project is read
    // then: the page has exactly one hierarchy finding, the level count
    const result = runAuditProject({ appRoot: join(FIXTURES, 'closure-tree') });
    if (result.kind !== 'audited') throw new Error(`unexpected result ${result.kind}`);
    const page = result.pages.find((entry) => entry.path === 'pages/list.tsx');
    const hierarchy = page?.findings.filter((finding) => finding.dimension === 'hierarchy') ?? [];
    expect(hierarchy).toHaveLength(1);
    expect(hierarchy[0]?.techText).toContain('type-levels:2');
  });
});

describe('Scenario: integration — the heading and levels are read through the closure', () => {
  const ALIAS_TREE = join(FIXTURES, 'alias-tree');
  const page: AuditSource = {
    file: 'src/pages/list.tsx',
    source: readFileSync(join(ALIAS_TREE, 'src/pages/list.tsx'), 'utf8')
  };
  const rowList: AuditSource = {
    file: 'src/components/RowList.tsx',
    source: readFileSync(join(ALIAS_TREE, 'src/components/RowList.tsx'), 'utf8')
  };

  it('when the h1 lives in an imported child, should treat the heading as satisfied', () => {
    // given: a page with no h1 and a child that renders it
    // when: the page is audited with and without its closure
    // then: the closure satisfies the rule and the single file does not
    const alone = auditHierarchy({ tokenScale: scale, sources: [page] });
    const withChild = auditHierarchy({ tokenScale: scale, sources: [page], imports: [rowList] });
    expect(alone.some((finding) => finding.expected === 'h1')).toBe(true);
    expect(withChild.some((finding) => finding.expected === 'h1')).toBe(false);
  });

  it('when the styled levels live in an imported child, should count them', () => {
    // given: a page with one class level and a child with two more
    // when: the page is audited with its closure
    // then: three levels are measured and no level finding fires
    const withChild = auditHierarchy({ tokenScale: scale, sources: [page], imports: [rowList] });
    expect(withChild.some((finding) => finding.techText.includes('type-levels'))).toBe(false);
    expect(markupTypeLevels([page])).toHaveLength(1);
    expect(markupTypeLevels([page, rowList])).toHaveLength(3);
  });
});

describe('Scenario: a11y — the finding speaks to a person and to an agent', () => {
  it('when the level finding renders, should explain the flat hierarchy in Chinese', () => {
    // given: the bad fixture's level finding
    // when: its bilingual pair is read
    // then: the plain sentence names the minimum and the technical line is greppable
    const finding = run('hierarchy-bad-page.tsx').find((entry) =>
      entry.techText.includes('type-levels')
    );
    expect(finding?.humanText).toContain('少于 3 种');
    expect(finding?.techText).toMatch(/^hierarchy-bad-page\.tsx:1 type-levels:2 < 3/);
  });
});
