import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import type { AuditFinding } from '../../../src/services/design/audit/audit-finding.js';
import { topFixes, unmeasuredItems } from '../../../src/services/design/audit/audit-fixes.js';
import { runAuditProject } from '../../../src/services/design/audit/audit-project.js';
import {
  AUDIT_COST_DIMENSIONS,
  AUDIT_DIMENSIONS,
  AUDIT_DIMENSIONS_EXHAUSTIVE,
  AUDIT_RATIO_DIMENSIONS,
  BASE_SCORE,
  DIMENSION_RULES,
  scoreDimension,
  type DimensionScore,
  type PageAudit
} from '../../../src/services/design/audit/audit-scoring.js';
import { scoreAudit } from '../../../src/services/design/audit/audit-score-table.js';

declareDimensions('tests/unit/design/audit-scoring.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/design/audit');
const TREE = join(FIXTURES, 'three-page-tree');

function finding(overrides: Partial<AuditFinding> = {}): AuditFinding {
  return {
    dimension: 'spacing',
    severity: 'soft',
    file: 'pages/page.tsx',
    line: 1,
    value: 'p-[13px]',
    expected: '12',
    humanText: '第 1 行的 padding 是 p-[13px]，不在设计刻度上。',
    techText: 'pages/page.tsx:1 padding:p-[13px] not in tokenScale.space',
    ...overrides
  };
}

function page(
  path: string,
  findings: AuditFinding[],
  judgements: PageAudit['judgements'] = {}
): PageAudit {
  return { path, findings, judgements };
}

/**
 * The injection control: a page's dimensions AVERAGED instead of minimised.
 *
 * The real page score is the minimum of its reported dimension scores. This
 * wrapper takes the mean, so a page whose spacing is 80 and colour is 60 scores
 * 60 for real and 70 here — the assertion below fails if the rule is inverted.
 */
function averageDimensionScore(dimensions: readonly DimensionScore[]): number {
  const scores = dimensions.flatMap((entry) => (entry.score === null ? [] : [entry.score]));
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

describe('Scenario: render — a ranked fix and an unmeasured item keep their shape', () => {
  it('when findings are ranked, should render top fixes and unmeasured items with every field', () => {
    // given: one hard finding, one soft finding and one unmeasured gap
    // when: the fix and gap lists are built
    // then: each entry carries the documented fields and the bilingual pair
    const hard = finding({ dimension: 'color', severity: 'hard', value: '#ff00aa' });
    const soft = finding();
    const gap = finding({ severity: 'unmeasured', expected: '', value: 'calc(4px * 2)' });
    const fixes = topFixes([hard, soft, gap]);
    expect(Object.keys(fixes[0] ?? {}).sort()).toEqual([
      'count',
      'dimension',
      'humanText',
      'severity',
      'sites',
      'techText'
    ]);
    expect(fixes[0]?.humanText.length).toBeGreaterThan(0);
    expect(fixes[0]?.techText).toContain('pages/page.tsx:1');
    expect(unmeasuredItems([hard, soft, gap])).toEqual([
      {
        dimension: 'spacing',
        file: 'pages/page.tsx',
        line: 1,
        humanText: gap.humanText,
        techText: gap.techText
      }
    ]);
  });
});

describe('Scenario: behavior — the severity table is exhaustive and pinned', () => {
  it('when the dimension union is walked, should find one row per dimension', () => {
    // given: the compile-time exhaustiveness rail and the runtime table
    // when: every listed dimension is looked up
    // then: each row exists and uses only the documented vocabulary
    expect(AUDIT_DIMENSIONS_EXHAUSTIVE).toBe(true);
    expect(Object.keys(DIMENSION_RULES).sort()).toEqual([...AUDIT_DIMENSIONS].sort());
    for (const dimension of AUDIT_DIMENSIONS) {
      const rule = DIMENSION_RULES[dimension];
      expect(['hard', 'soft', 'unmeasured']).toContain(rule.severity);
      expect(['ratio', 'cost']).toContain(rule.kind);
      expect(rule.cost).toBeGreaterThanOrEqual(0);
    }
  });

  it('when the table is read, should split ratio from cost and pin the classes', () => {
    // given: the severity-inversion failure the plan names as review focus
    // when: each dimension's class, kind and cost is read
    // then: value dimensions are ratios, boolean ones are cost, classes stay pinned
    expect([...AUDIT_RATIO_DIMENSIONS].sort()).toEqual(['color', 'spacing', 'type']);
    expect([...AUDIT_COST_DIMENSIONS].sort()).toEqual([
      'a11y',
      'contrast',
      'hierarchy',
      'states',
      'surface'
    ]);
    for (const dimension of AUDIT_RATIO_DIMENSIONS) {
      expect(DIMENSION_RULES[dimension].kind).toBe('ratio');
      expect(DIMENSION_RULES[dimension].cost).toBe(0);
    }
    for (const dimension of AUDIT_COST_DIMENSIONS) {
      expect(DIMENSION_RULES[dimension].kind).toBe('cost');
      expect(DIMENSION_RULES[dimension].cost).toBeGreaterThan(0);
    }
    expect(DIMENSION_RULES.spacing.severity).toBe('soft');
    expect(DIMENSION_RULES.type.severity).toBe('soft');
    expect(DIMENSION_RULES.color.severity).toBe('hard');
    expect(DIMENSION_RULES.contrast.severity).toBe('hard');
    expect(DIMENSION_RULES.surface.severity).toBe('soft');
    expect(DIMENSION_RULES.hierarchy.severity).toBe('soft');
    expect(DIMENSION_RULES.a11y.severity).toBe('hard');
    expect(DIMENSION_RULES.states.severity).toBe('hard');
    expect(DIMENSION_RULES.color.cost).toBe(0);
    expect(DIMENSION_RULES.a11y.cost).toBeGreaterThan(DIMENSION_RULES.surface.cost);
  });
});

describe('Scenario: integration — value dimensions are on-contract shares', () => {
  it('when 20 of 100 judged spacing values are off-ladder, should score 80', () => {
    // given: a page whose judged values are 80 on-contract and 20 off-ladder
    // when: the ratio dimension is scored
    // then: the score is the share, not a per-finding collapse
    const scored = scoreDimension('spacing', [], { measured: 100, onContract: 80 });
    expect(scored.score).toBe(80);
    expect(scored.measured).toBe(100);
    expect(scored.onContract).toBe(80);
  });

  it('when every judged value is on-contract, should score 100', () => {
    // given: a clean page's judged values
    // when: the ratio dimension is scored
    // then: a page that follows its contract scores full
    expect(scoreDimension('spacing', [], { measured: 100, onContract: 100 }).score).toBe(100);
  });

  it('when every value is unmeasured, should report null and never a default 100', () => {
    // given: a page whose only value is a runtime variable
    // when: the ratio dimension is scored
    // then: the score is null, and the gap is visible in the unmeasured count
    const scored = scoreDimension('spacing', [finding({ severity: 'unmeasured' })], {
      measured: 0,
      onContract: 0
    });
    expect(scored.score).toBeNull();
    expect(scored.unmeasured).toBe(1);
    expect(scored.score).not.toBe(BASE_SCORE);
  });
});

describe('Scenario: integration — boolean dimensions keep a documented cost', () => {
  it('when findings pile up, should start at 100, lose cost per finding and floor at 0', () => {
    // given: 3 soft hierarchy findings and an unbounded pile of them
    // when: the cost dimension is scored
    // then: cost is applied per finding and the result never goes below zero
    expect(
      scoreDimension('hierarchy', [
        finding({ dimension: 'hierarchy' }),
        finding({ dimension: 'hierarchy' }),
        finding({ dimension: 'hierarchy' })
      ]).score
    ).toBe(85);
    expect(
      scoreDimension(
        'hierarchy',
        Array.from({ length: 40 }, () => finding({ dimension: 'hierarchy' }))
      ).score
    ).toBe(0);
    expect(scoreDimension('hierarchy', [])).toMatchObject({
      dimension: 'hierarchy',
      score: BASE_SCORE,
      measured: 0,
      onContract: 0,
      hard: 0,
      soft: 0,
      unmeasured: 0
    });
  });

  it('when every finding is unmeasured, should leave the cost score at 100', () => {
    // given: two gaps the audit could not judge
    // when: the cost dimension is scored
    // then: "not judged" costs nothing, but the gaps stay visible
    const gaps = [
      finding({ dimension: 'a11y', severity: 'unmeasured' }),
      finding({ dimension: 'a11y', severity: 'unmeasured' })
    ];
    const scored = scoreDimension('a11y', gaps);
    expect(scored.score).toBe(100);
    expect(scored.unmeasured).toBe(2);
  });
});

describe('Scenario: integration — a page score is the minimum, never an average', () => {
  it('when two dimensions report 80 and 60, should score the page 60 and fail an average', () => {
    // given: a page with an 80 spacing score and a 60 colour score
    // when: the page is scored
    // then: the page score is the minimum; the average injection control disagrees
    const scored = scoreAudit([
      page('pages/page.tsx', [], {
        spacing: { measured: 100, onContract: 80 },
        color: { measured: 100, onContract: 60 }
      })
    ]);
    const dimensions = scored.pages[0]?.dimensions ?? [];
    expect(scored.pages[0]?.score).toBe(60);
    expect(averageDimensionScore(dimensions)).toBe(70);
    expect(scored.pages[0]?.score).not.toBe(averageDimensionScore(dimensions));
  });

  it('when a clean page joins a bad one, should not raise the score (average is the control)', () => {
    // given: a page with an all-off-contract colour ratio and a clean page
    // when: the audit is scored by the real worst-page rule
    // then: adding the clean page leaves the number unchanged, while an average would rise
    const bad = page('pages/bad.tsx', [], { color: { measured: 20, onContract: 0 } });
    const clean = page('pages/clean.tsx', [], { color: { measured: 10, onContract: 10 } });
    const alone = scoreAudit([bad]);
    const withClean = scoreAudit([bad, clean]);
    expect(alone.overall).toBe(0);
    expect(withClean.overall).toBe(alone.overall);
  });

  it('when a ratio judged one value and none on-contract, should flag low sample and not drive overall', () => {
    // given: the pilot artefact — a single off-ladder literal sets a page to 0
    // when: the page and the audit are scored
    // then: the ratio is still reported (0) with lowSample, and overall stays at base
    const scored = scoreDimension('spacing', [], { measured: 1, onContract: 0 });
    expect(scored).toMatchObject({ score: 0, measured: 1, lowSample: true });
    const audit = scoreAudit([
      page('pages/tiny.tsx', [], { spacing: { measured: 1, onContract: 0 } })
    ]);
    expect(audit.pages[0]?.dimensions[0]).toMatchObject({ score: 0, lowSample: true });
    expect(audit.pages[0]?.score).toBe(BASE_SCORE);
    expect(audit.overall).toBe(BASE_SCORE);
  });

  it('when a ratio judged twenty values and none on-contract, should still drive overall to 0', () => {
    // given: a page with a real denominator that is entirely off-contract
    // when: the page and the audit are scored
    // then: the same 0 now counts, because the sample is large enough to mean it
    const scored = scoreDimension('spacing', [], { measured: 20, onContract: 0 });
    expect(scored).toMatchObject({ score: 0, measured: 20 });
    expect(scored.lowSample).toBeUndefined();
    const audit = scoreAudit([
      page('pages/big.tsx', [], { spacing: { measured: 20, onContract: 0 } })
    ]);
    expect(audit.pages[0]?.score).toBe(0);
    expect(audit.overall).toBe(0);
  });

  it('when a ratio judges exactly five values, should not be low sample', () => {
    // given: the boundary value of the low-sample rule
    // when: a five-value ratio is scored
    // then: it is a real sample, so its ratio may set the page score
    const audit = scoreAudit([
      page('pages/five.tsx', [], { spacing: { measured: 5, onContract: 0 } })
    ]);
    expect(audit.pages[0]?.dimensions[0]).toMatchObject({ score: 0 });
    expect(audit.pages[0]?.dimensions[0]?.lowSample).toBeUndefined();
    expect(audit.overall).toBe(0);
  });

  it('when a page has only unmeasured values, should not drag its score down', () => {
    // given: a page whose spacing values all depend on runtime variables
    // when: the page is scored
    // then: the dimension is null and the page stays at its base score
    const scored = scoreAudit([
      page('pages/page.tsx', [finding({ severity: 'unmeasured' })], {
        spacing: { measured: 0, onContract: 0 }
      })
    ]);
    expect(scored.pages[0]?.score).toBe(BASE_SCORE);
    expect(scored.pages[0]?.dimensions[0]).toMatchObject({ dimension: 'spacing', score: null });
  });

  it('when the fixture tree is audited, should score the worst page and its counts', () => {
    // given: the three-page fixture (clean / spacing / hard colour)
    // when: the project is read and scored
    // then: the hard colour sets the page and the overall, and "judged" is explicit
    const result = runAuditProject({ appRoot: TREE });
    if (result.kind !== 'audited') throw new Error(`unexpected result ${result.kind}`);
    const score = scoreAudit(result.pages, result.globalFindings, { contrast: true });
    expect(score.pages.map((entry) => [entry.path, entry.score])).toEqual([
      ['pages/clean.tsx', 95],
      ['pages/spacing.tsx', 95],
      ['pages/theme.css', 0]
    ]);
    // Review M1: a low-sample ratio that carries a HARD finding always sets the
    // page and the overall; the flag only suppresses a soft low sample.
    expect(score.overall).toBe(0);
    expect(score.dimensions).toEqual([
      {
        dimension: 'spacing',
        score: 67,
        judged: true,
        distinctSites: 2,
        hard: 0,
        soft: 3,
        unmeasured: 1,
        measured: 9,
        onContract: 6
      },
      {
        dimension: 'type',
        score: 100,
        judged: true,
        distinctSites: 0,
        hard: 0,
        soft: 0,
        unmeasured: 0,
        measured: 15,
        onContract: 15
      },
      {
        dimension: 'color',
        score: 0,
        judged: true,
        distinctSites: 1,
        hard: 1,
        soft: 0,
        unmeasured: 0,
        measured: 1,
        onContract: 0,
        lowSample: true
      },
      {
        dimension: 'contrast',
        score: 100,
        judged: true,
        distinctSites: 0,
        hard: 0,
        soft: 0,
        unmeasured: 0,
        measured: 0,
        onContract: 0
      },
      {
        dimension: 'surface',
        score: 100,
        judged: true,
        distinctSites: 0,
        hard: 0,
        soft: 0,
        unmeasured: 0,
        measured: 0,
        onContract: 0
      },
      {
        dimension: 'hierarchy',
        score: 95,
        judged: true,
        distinctSites: 2,
        hard: 0,
        soft: 2,
        unmeasured: 0,
        measured: 0,
        onContract: 0
      },
      {
        dimension: 'a11y',
        score: 100,
        judged: true,
        distinctSites: 0,
        hard: 0,
        soft: 0,
        unmeasured: 0,
        measured: 0,
        onContract: 0
      },
      {
        dimension: 'states',
        score: null,
        judged: false,
        distinctSites: 0,
        hard: 0,
        soft: 0,
        unmeasured: 0,
        measured: 0,
        onContract: 0
      }
    ]);
  });
});

describe('Scenario: a11y — severity ranks before hit count', () => {
  it('when a hard finding competes with a frequent soft one, should rank the hard first', () => {
    // given: three identical soft findings and one hard finding
    // when: the top fixes are ranked
    // then: the accessibility finding leads and the list is capped at three
    const soft = finding();
    const hard = finding({ dimension: 'color', severity: 'hard', value: '#ff00aa' });
    const fixes = topFixes([soft, soft, soft, hard, finding({ value: 'gap-[9px]' })]);
    expect(fixes).toHaveLength(3);
    expect(fixes[0]?.severity).toBe('hard');
    expect(fixes[1]).toMatchObject({ severity: 'soft', count: 3, dimension: 'spacing' });
  });
});
