import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { stripViews } from '../../../src/services/design/source-scan/strip-comments.js';
import {
  lineStarts,
  type AuditFinding,
  type AuditInput,
  type AuditSource
} from '../../../src/services/design/audit/audit-finding.js';
import { auditA11y } from '../../../src/services/design/audit/audit-a11y.js';
import {
  hasAttributeOf,
  markupSources,
  scanElements
} from '../../../src/services/design/audit/markup-scan.js';
import { buildPavedRoad, type DesignTokenScale } from '../../../src/services/design/paved-road.js';

declareDimensions('tests/unit/design/audit-a11y.test.ts', [
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

/** Elements the click rule treats as non-interactive without ARIA wiring. */
const NON_INTERACTIVE = new Set(['div', 'span', 'li']);

function source(name: string): AuditSource {
  return { file: name, source: readFileSync(join(FIXTURES, name), 'utf8') };
}

function run(name: string, extra: Partial<AuditInput> = {}): AuditFinding[] {
  return auditA11y({ tokenScale: scale, sources: [source(name)], ...extra });
}

/**
 * The line a fixture declares an element on, read from the fixture itself. The
 * assertion stays exact while surviving a runner that prepends a directive to
 * the sandbox copy (Stryker's `@ts-nocheck`).
 */
function lineOf(name: string, needle: string): number {
  const lines = readFileSync(join(FIXTURES, name), 'utf8').split('\n');
  return lines.findIndex((line) => line.includes(needle)) + 1;
}

function invertedFinding(value: string, line = 1): AuditFinding {
  return {
    dimension: 'a11y',
    severity: 'hard',
    file: 'inverted.tsx',
    line,
    value,
    expected: 'inverted',
    humanText: `反向检测器把 ${value} 报成了问题。`,
    techText: `inverted.tsx:${line} ${value} (inverted)`
  };
}

/**
 * The injection control: both a11y rules flipped.
 *
 * The real detector reports a clickable non-interactive element with NO role /
 * tabIndex and a custom control with NO focus style. This wrapper reports the
 * compliant side — a clickable element that IS wired, and a file set that DOES
 * declare focus — so a flipped comparison makes the two agree on one fixture.
 */
function invertedA11y(input: AuditInput): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const file of markupSources(input.sources)) {
    const view = stripViews(file.source).comments;
    for (const element of scanElements(view, lineStarts(file.source))) {
      if (!NON_INTERACTIVE.has(element.lowerTag)) continue;
      if (!hasAttributeOf(element, ['onClick', 'onclick'])) continue;
      const guarded =
        hasAttributeOf(element, ['role']) || hasAttributeOf(element, ['tabIndex', 'tabindex']);
      if (guarded)
        findings.push(invertedFinding(`<${element.tag}> role/tabIndex present`, element.line));
    }
  }
  const styled = markupSources(input.sources).some((file) => /focus-visible/.test(file.source));
  if (styled) findings.push(invertedFinding('focus-visible present'));
  return findings;
}

describe('Scenario: render — an a11y finding carries the documented shape', () => {
  it('when the bad a11y page is audited, should render three hard findings', () => {
    // given: two unwired click handlers and a custom button with no focus style
    // when: the a11y audit runs
    // then: every finding is hard, dimension a11y and fully shaped
    const findings = run('a11y-bad-page.tsx');
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
      expect(finding.dimension).toBe('a11y');
      expect(finding.severity).toBe('hard');
    }
  });
});

describe('Scenario: behavior — clicks and focus are each judged', () => {
  it('when the element has role and tabIndex, should report nothing', () => {
    // given: a div onClick wired with role and tabIndex and a focus-visible class
    // when: the a11y audit runs
    // then: no finding is emitted
    expect(run('a11y-clean-page.tsx')).toEqual([]);
  });

  it('when the page has no interaction at all, should never fire', () => {
    // given: a static div/span page
    // when: the a11y audit runs
    // then: the never-fires fixture stays silent
    expect(run('a11y-static-page.tsx')).toEqual([]);
  });

  it('when a div and an li carry onClick without role or tabIndex, should name both', () => {
    // given: the bad fixture's two unwired click targets
    // when: the click findings are read
    // then: each names its file:line and both missing attributes
    const clicks = run('a11y-bad-page.tsx').filter((entry) => entry.value.includes('onClick'));
    expect(clicks).toHaveLength(2);
    expect(clicks.map((entry) => entry.line)).toEqual([
      lineOf('a11y-bad-page.tsx', '<div onClick'),
      lineOf('a11y-bad-page.tsx', '<li onClick')
    ]);
    for (const click of clicks) {
      expect(click.techText).toContain('missing role/tabIndex');
      expect(click.humanText).toContain('键盘用户无法操作');
    }
  });

  it('when a custom control has no focus style, should report the missing focus-visible', () => {
    // given: the bad fixture's custom interactive elements and no focus style
    // when: the focus finding is read
    // then: it names the file:line and the missing style
    const focus = run('a11y-bad-page.tsx').find((entry) => entry.value === 'focus-visible');
    expect(focus?.techText).toContain('interactive-without-focus-visible');
    expect(focus?.humanText).toContain('焦点');
  });

  it('when a native button carries onClick, should not demand a custom focus style', () => {
    // given: a native `<button>` with a click handler and no focus class
    // when: the a11y audit runs
    // then: native focus behaviour is respected and no finding is emitted
    const native: AuditSource = {
      file: 'native.tsx',
      source: 'export const A = () => <button onClick={() => undefined}>Go</button>;\n'
    };
    expect(auditA11y({ tokenScale: scale, sources: [native] })).toEqual([]);
  });

  it('when the detector is inverted, should disagree on both calibration pages', () => {
    // given: the clean and bad fixtures and an inverted detector over the same scanner
    // when: both detectors run
    // then: the real detector is silent on clean and the inverted one is not
    const clean: AuditInput = { tokenScale: scale, sources: [source('a11y-clean-page.tsx')] };
    const bad: AuditInput = { tokenScale: scale, sources: [source('a11y-bad-page.tsx')] };
    expect(auditA11y(clean)).toEqual([]);
    expect(invertedA11y(clean)).toHaveLength(2);
    expect(auditA11y(bad)).toHaveLength(3);
    expect(invertedA11y(bad)).toEqual([]);
  });
});

describe('Scenario: integration — only the rendering file can satisfy focus', () => {
  it('when a project stylesheet declares :focus-visible, should NOT clear the focus finding', () => {
    // given: the bad page and a stylesheet with a focus-visible rule
    // when: the a11y audit runs with the stylesheet in its file set
    // then: a style elsewhere in the project is not the page's focus ring
    const findings = run('a11y-bad-page.tsx', { styles: [source('a11y-focus.css')] });
    expect(findings).toHaveLength(3);
    expect(findings.some((entry) => entry.value === 'focus-visible')).toBe(true);
  });

  it('when the rendering file declares a focus class, should clear the focus finding', () => {
    // given: a custom button wired with role, tabIndex and focus-visible
    // when: the a11y audit runs
    // then: the focus style is on the element that renders, and nothing fires
    const focused: AuditSource = {
      file: 'focused.tsx',
      source:
        'export const A = () => <div onClick={() => undefined} role="button" tabIndex={0} className="focus-visible:ring-2">x</div>;\n'
    };
    expect(auditA11y({ tokenScale: scale, sources: [focused] })).toEqual([]);
  });
});

describe('Scenario: integration — a custom component is read through its definition', () => {
  it('when a click lands on an unwired span rendered by a component, should report it', () => {
    // given: `<StatusBadge onClick>` whose definition renders a bare span
    // when: the page is audited with the component's source as its closure
    // then: the custom component's span is named as the hard finding
    const page = source('a11y-badge-page.tsx');
    const badge = source('a11y-status-badge.tsx');
    const findings = auditA11y({ tokenScale: scale, sources: [page], imports: [badge] });
    const custom = findings.find((entry) => entry.value === '<StatusBadge onClick>');
    expect(custom?.severity).toBe('hard');
    expect(custom?.techText).toContain(
      `a11y-status-badge.tsx:${lineOf('a11y-status-badge.tsx', 'data-slot="status-badge"')} <span>`
    );
    expect(custom?.humanText).toContain('键盘用户无法操作');
  });

  it('when the component renders a native button with focus, should stay silent', () => {
    // given: `<IconButton onClick>` whose definition renders a button with focus-visible
    // when: the page is audited with the component's source as its closure
    // then: no finding fires, because the native button is keyboard-reachable
    const page = source('a11y-badge-clean-page.tsx');
    const button = source('a11y-icon-button.tsx');
    expect(auditA11y({ tokenScale: scale, sources: [page], imports: [button] })).toEqual([]);
  });

  it('when the component definition is not read, should report the focus question unmeasured', () => {
    // given: a page whose `<StatusBadge onClick>` has no definition in its closure
    // when: the a11y audit runs
    // then: the dimension says it cannot judge instead of passing
    const findings = auditA11y({ tokenScale: scale, sources: [source('a11y-badge-page.tsx')] });
    const gap = findings.find((entry) => entry.severity === 'unmeasured');
    expect(gap?.value).toBe('<component onClick>');
    expect(gap?.techText).toContain('component definition not read');
  });
});

describe('Scenario: a11y — the finding speaks to a person and to an agent', () => {
  it('when an unwired click is reported, should explain it in Chinese and cite file:line', () => {
    // given: the bad fixture's outer div
    // when: the click finding is read
    // then: the plain sentence names the line and the technical line is greppable
    const line = lineOf('a11y-bad-page.tsx', '<div onClick');
    const click = run('a11y-bad-page.tsx').find((entry) => entry.line === line);
    expect(click?.humanText).toContain(`第 ${line} 行`);
    expect(click?.humanText).toContain('role');
    expect(click?.techText).toBe(`a11y-bad-page.tsx:${line} <div onClick> missing role/tabIndex`);
  });
});
