import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import type { AuditSource } from '../../../src/services/design/audit/audit-finding.js';
import { auditA11y, auditA11yDimension } from '../../../src/services/design/audit/audit-a11y.js';
import { buildPavedRoad, type DesignTokenScale } from '../../../src/services/design/paved-road.js';

declareDimensions('tests/unit/design/audit-a11y-wiring.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const scale: DesignTokenScale = buildPavedRoad({
  pageRoots: ['src/pages'],
  componentEntrypoints: []
}).tokenScale;

function page(source: string, file = 'page.tsx'): AuditSource {
  return { file, source };
}

function judge(source: string, imports: AuditSource[] = []): ReturnType<typeof auditA11y> {
  return auditA11y({ tokenScale: scale, sources: [page(source)], imports });
}

describe('Scenario: render — an unwired click renders one exact finding', () => {
  it('when a bare div handles a click, should render the documented hard finding', () => {
    // given: a div with onClick but no role, tabIndex or focus style
    // when: the a11y audit runs
    // then: one hard finding names the element and both missing attributes
    const findings = judge('export const A = () => <div onClick={() => undefined}>x</div>;\n');
    expect(findings.filter((entry) => entry.value.includes('onClick'))).toEqual([
      {
        dimension: 'a11y',
        severity: 'hard',
        file: 'page.tsx',
        line: 1,
        value: '<div onClick>',
        expected: 'role + tabIndex',
        humanText:
          '第 1 行的 <div> 绑定了点击事件，但没有 role 也没有 tabIndex，键盘用户无法操作。',
        techText: 'page.tsx:1 <div onClick> missing role/tabIndex'
      }
    ]);
  });

  it('when a click is wired with role or tabIndex, should not report the click', () => {
    // given: one div with role, one with tabIndex, both with a focus style
    // when: each is audited
    // then: neither produces a click finding
    const withRole =
      'export const A = () => <div onClick={() => undefined} role="button" className="focus-visible:ring">x</div>;\n';
    const withTab =
      'export const A = () => <div onClick={() => undefined} tabIndex={0} className="focus-visible:ring">x</div>;\n';
    expect(judge(withRole).filter((entry) => entry.value.includes('onClick'))).toEqual([]);
    expect(judge(withTab).filter((entry) => entry.value.includes('onClick'))).toEqual([]);
  });
});

describe('Scenario: behavior — a custom button is recognised by its role', () => {
  it('when role names a button in any spelling, should treat it as interactive', () => {
    // given: role="button", role="BUTTON", and role=" button " on plain divs
    // when: each page is audited without a focus style
    // then: every spelling yields the missing-focus finding
    const spellings = ['button', 'BUTTON', ' button '];
    for (const role of spellings) {
      const source = `export const A = () => <div role="${role}">x</div>;\n`;
      expect(judge(source).map((entry) => entry.value)).toEqual(['focus-visible']);
    }
  });

  it('when a plain div has neither role nor click, should stay silent and not throw', () => {
    // given: a div with no interactive attribute at all
    // when: the page is audited
    // then: the optional role lookup is safe and the page is clean
    expect(judge('export const A = () => <div>plain</div>;\n')).toEqual([]);
  });

  it('when a native button carries a role, should not demand a custom focus style', () => {
    // given: a native <button role="button"> with no focus class
    // when: the page is audited
    // then: native focus behaviour means no finding
    expect(judge('export const A = () => <button role="button">Go</button>;\n')).toEqual([]);
  });
});

describe('Scenario: integration — a component is judged through its definition', () => {
  it('when a component renders an unwired span, should name the root that fails', () => {
    // given: <Badge onClick> whose definition renders a bare span
    // when: the page is audited with the definition as its closure
    // then: the finding names the usage and the rendered root location
    const badge: AuditSource = {
      file: 'badge.tsx',
      source:
        'export const Badge = ({ onClick }: { onClick?: () => void }) => <span onClick={onClick}>b</span>;\n'
    };
    const findings = judge(
      'export const A = () => <section><Badge onClick={() => undefined} /></section>;\n',
      [badge]
    );
    const custom = findings.find((entry) => entry.value === '<Badge onClick>');
    expect(custom?.techText).toBe(
      'page.tsx:1 <Badge onClick> renders non-interactive root without role/tabIndex ' +
        '(badge.tsx:1 <span>)'
    );
    expect(custom?.humanText).toContain(
      '渲染的是一个没有 role、没有 tabIndex 的非交互元素（badge.tsx:1 <span>）'
    );
  });

  it('when a component definition is outside the read set, should report it unmeasured', () => {
    // given: <Mystery onClick> with no definition among the imports
    // when: the page is audited
    // then: one unmeasured finding names the usage and the unread definition
    const findings = judge(
      'export const A = () => <section><Mystery onClick={() => undefined} /></section>;\n'
    );
    expect(findings).toEqual([
      {
        dimension: 'a11y',
        severity: 'unmeasured',
        file: 'page.tsx',
        line: 1,
        value: '<component onClick>',
        expected: 'focus-visible style',
        humanText:
          '无法判断 <Mystery> 的焦点样式：它在第 1 行接收点击，但它的定义不在本次读取的导入闭包里。',
        techText:
          'page.tsx:1 <Mystery onClick> focus-visible unmeasured (component definition not read)'
      }
    ]);
  });

  it('when a read definition has no focus style, should still demand one', () => {
    // given: <Card onClick> rendering a role="button" div with no focus style
    // when: the page is audited with the definition as its closure
    // then: the focus finding points at the definition's line
    const card: AuditSource = {
      file: 'card.tsx',
      source: 'export const Card = () => <div role="button">c</div>;\n'
    };
    const findings = judge(
      'export const A = () => <section><Card onClick={() => undefined} /></section>;\n',
      [card]
    );
    expect(findings.some((entry) => entry.value === 'focus-visible')).toBe(true);
  });
});

describe('Scenario: a11y — the dimension says when it judged nothing', () => {
  it('when there is no markup page, should report the dimension unjudged', () => {
    // given: an empty source set
    // when: the a11y dimension runs
    // then: it says nothing was judged instead of a silent pass
    expect(auditA11yDimension({ tokenScale: scale, sources: [] })).toEqual({
      findings: [],
      judged: false
    });
  });

  it('when a page is judged, should say so and dedupe identical findings', () => {
    // given: the same unwired click in two source copies with distinct paths
    // when: the page set is audited
    // then: judged is true and each file:line:value appears once
    const dupe = 'export const A = () => <div onClick={() => undefined}>x</div>;\n';
    const result = auditA11yDimension({
      tokenScale: scale,
      sources: [page(dupe, 'a.tsx'), page(dupe, 'b.tsx')]
    });
    expect(result.judged).toBe(true);
    expect(result.findings).toHaveLength(3);
  });
});
