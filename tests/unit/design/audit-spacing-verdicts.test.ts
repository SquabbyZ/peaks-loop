import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import type { AuditSource } from '../../../src/services/design/audit/audit-finding.js';
import {
  auditSpacing,
  auditSpacingDimension,
  spacingLadder
} from '../../../src/services/design/audit/audit-spacing.js';
import {
  buildVariableTable,
  type CssVariableDefinition
} from '../../../src/services/design/audit/css-variables.js';
import { buildPavedRoad, type DesignTokenScale } from '../../../src/services/design/paved-road.js';

declareDimensions('tests/unit/design/audit-spacing-verdicts.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

/** The audit's default ladder (4/8/12/16/20/24) as the reader builds it. */
const scale: DesignTokenScale = buildPavedRoad({
  pageRoots: ['src/pages'],
  componentEntrypoints: []
}).tokenScale;

function css(source: string): AuditSource {
  return { file: 'page.css', source };
}

function definition(
  name: string,
  value: string,
  selector: string,
  state: string | null
): CssVariableDefinition {
  return { name, value, selector, state, file: 'theme.css', line: 1 };
}

describe('Scenario: render — the ladder keeps only numeric positive steps', () => {
  it('when entries are unsorted, non-numeric or zero, should build the numeric ladder', () => {
    // given: 8px, 4px, a zero and a non-number in input order
    // when: the ladder is built
    // then: only 4 and 8 remain, ascending, expressed as steps of the base
    expect(spacingLadder(['8px', '4px', '0', 'bad'])).toEqual({ values: [4, 8], steps: [1, 2] });
    expect(spacingLadder([])).toEqual({ values: [], steps: [] });
  });
});

describe('Scenario: behavior — a value is judged against its nearest declared step', () => {
  it('when a px value falls below the first step, should cite the first step', () => {
    // given: 5px, one above the 4px base and three below 8px
    // when: the spacing audit runs
    // then: the nearest declared value is 4, not a later step
    const findings = auditSpacing({ tokenScale: scale, sources: [css('.a { padding: 5px; }')] });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.expected).toBe('4');
  });

  it('when a value is zero, should treat it as convention and report nothing', () => {
    // given: a 0px declaration and a p-0 utility
    // when: the spacing audit runs
    // then: zero is a deliberate reset, not an off-ladder finding
    expect(auditSpacing({ tokenScale: scale, sources: [css('.a { padding: 0px; }')] })).toEqual([]);
    const utility = 'export const A = () => <div className="p-0">x</div>;\n';
    expect(
      auditSpacing({ tokenScale: scale, sources: [{ file: 'a.tsx', source: utility }] })
    ).toEqual([]);
  });

  it('when an unreadable value is judged, should keep it unmeasured with its reason', () => {
    // given: a non-unit value, a variable without a table, and an auto keyword
    // when: the spacing audit runs
    // then: only the two unreadable values are reported, each naming its reason
    const findings = auditSpacing({
      tokenScale: scale,
      sources: [css('.a { padding: 5q; }\n.b { padding: var(--missing); }\n.c { padding: auto; }')]
    });
    expect(findings.map((entry) => entry.severity)).toEqual(['unmeasured', 'unmeasured']);
    expect(findings[0]?.techText).toBe('page.css:1 padding:5q unmeasured (unrecognised unit)');
    expect(findings[0]?.humanText).toContain('它用了 unrecognised unit');
    expect(findings[1]?.techText).toBe(
      'page.css:2 padding:var(--missing) unmeasured (variable --missing)'
    );
    expect(findings[1]?.humanText).toContain('它依赖运行时的 CSS 变量 --missing');
  });

  it('when the declared ladder is empty, should say the scale has no numeric step', () => {
    // given: a token scale whose space list is empty
    // when: a 16px value is judged
    // then: it is unmeasured with the empty-scale reason, never an off-ladder finding
    const findings = auditSpacing({
      tokenScale: { ...scale, space: [] },
      sources: [css('.a { padding: 16px; }')]
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('unmeasured');
    expect(findings[0]?.techText).toBe(
      'page.css:1 padding:16px unmeasured (tokenScale.space declares no numeric step)'
    );
  });

  it('when no variable table is supplied, should not attach a resolution note', () => {
    // given: a 13px declaration judged without a stylesheet table
    // when: the finding is read
    // then: the technical line carries no variable provenance
    const finding = auditSpacing({ tokenScale: scale, sources: [css('.a { padding: 13px; }')] })[0];
    expect(finding?.techText).toBe('page.css:1 padding:13px not in tokenScale.space');
    expect(finding?.humanText).toBe(
      '第 1 行的 padding 间距是 13px，不在设计刻度上，最近的刻度是 12px。'
    );
  });
});

describe('Scenario: integration — a variable resolution travels with its finding', () => {
  it('when one definition resolves off-ladder, should name the variable and its state', () => {
    // given: --gap = 13px under one state selector
    // when: a padding using it is judged
    // then: the finding cites the resolution and the scored state in both languages
    const variables = buildVariableTable([definition('--gap', '13px', '[data-a]', '[data-a]')]);
    const finding = auditSpacing({
      tokenScale: scale,
      sources: [css('.a { padding: var(--gap); }')],
      variables
    })[0];
    expect(finding?.value).toBe('var(--gap)');
    expect(finding?.expected).toBe('12');
    expect(finding?.techText).toBe(
      'page.css:1 padding:var(--gap) (--gap = 13px, state [data-a]) not in tokenScale.space'
    );
    expect(finding?.humanText).toContain('（由 CSS 变量解析：--gap = 13px，状态 [data-a]）');
  });

  it('when definitions disagree, should stay unmeasured and list every state', () => {
    // given: --gap = 8px under [data-a] and 12px under [data-b]
    // when: a padding using it is judged
    // then: no value is invented and the finding lists both definitions
    const variables = buildVariableTable([
      definition('--gap', '8px', '[data-a]', '[data-a]'),
      definition('--gap', '12px', '[data-b]', '[data-b]')
    ]);
    const finding = auditSpacing({
      tokenScale: scale,
      sources: [css('.a { padding: var(--gap); }')],
      variables
    })[0];
    expect(finding?.severity).toBe('unmeasured');
    expect(finding?.techText).toBe(
      'page.css:1 padding:var(--gap) unmeasured (variable --gap state-dependent: ' +
        '8px @[data-a] (theme.css:1); 12px @[data-b] (theme.css:1))'
    );
    expect(finding?.humanText).toContain('8px @[data-a]');
    expect(finding?.humanText).toContain('12px @[data-b]');
  });

  it('when one definition resolves on-ladder, should report nothing and count it', () => {
    // given: --gutter = 16px at :root, a p-4 utility, and a 13px declaration
    // when: the dimension is audited
    // then: the variable resolves on-ladder and the judgement counts on and off values
    const variables = buildVariableTable([definition('--gutter', '16px', ':root', null)]);
    const source = css('.a { padding: var(--gutter); }\n.b { padding: 13px; }');
    const utility = 'export const A = () => <div className="p-4">x</div>;\n';
    const result = auditSpacingDimension({
      tokenScale: scale,
      sources: [source, { file: 'a.tsx', source: utility }],
      variables
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.value).toBe('13px');
    expect(result.judgement).toEqual({ measured: 3, onContract: 2 });
  });
});

describe('Scenario: a11y — the unmeasured sentence names its variable or reason', () => {
  it('when an unreadable value is explained, should name the variable for a reader', () => {
    // given: a var() with no definition
    // when: the finding is read aloud
    // then: the Chinese sentence names the variable and says the source cannot judge it
    const finding = auditSpacing({
      tokenScale: scale,
      sources: [css('.a { padding: var(--missing); }')]
    })[0];
    expect(finding?.humanText).toBe(
      '第 1 行的 padding 是 var(--missing)，它依赖运行时的 CSS 变量 --missing，源码里无法判断是否在刻度上。'
    );
  });
});
