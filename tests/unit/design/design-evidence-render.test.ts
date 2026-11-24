import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { DESIGN_CONFORMANCE } from '../../../src/services/artifacts/design-conformance-prerequisite.js';
import type { DesignCheckResult } from '../../../src/services/design/design-check.js';
import type { G3AResult } from '../../../src/services/design/design-check-g3.js';
import type { G3BRouteResult } from '../../../src/services/design/design-check-g3-suite.js';
import { renderConformanceMarkdown } from '../../../src/services/design/design-evidence.js';

declareDimensions('tests/unit/design/design-evidence-render.test.ts', [
  'behavior',
  'render',
  'integration',
  'a11y'
]);

const GENERATED_AT = '2026-11-24T00:00:00.000Z';

function metaFor(sha256 = 'abc') {
  return { rid: 'r1', sessionId: 'sid-1', generatedAt: GENERATED_AT, sha256 };
}

function resultWith(
  g3a: readonly G3AResult[],
  g3b: readonly G3BRouteResult[],
  overrides: Partial<DesignCheckResult> = {}
): DesignCheckResult {
  return {
    schemaVersion: 1,
    rid: 'r1',
    verdict: 'pass',
    surface: { isUi: true, reasons: [] },
    checks: {
      g1_source: { status: 'pass', findings: [] },
      g2_render: { status: 'pass', pages: 1, evidence: ['ok'] },
      g3_exemplar: { g3a, g3b }
    },
    findings: [],
    coverage: null,
    ...overrides
  };
}

const EVIDENCE = {
  route: '/d',
  min: 90,
  score: 89,
  visual: 88,
  motion: 91,
  grade: 'B',
  generatedAt: null,
  reportPath: 'fidelity.json',
  baselineUrl: 'http://127.0.0.1:4311/d',
  candidateUrl: 'http://127.0.0.1:4312/d',
  baseCommit: 'abc1234'
};

const G3A: readonly G3AResult[] = [
  { status: 'skipped', route: '/a', reason: 'no-baseline' },
  { status: 'blocked', route: '/b', code: 'DESIGN_BASELINE_INVALID', message: 'bad baseline' },
  { status: 'pass', ...EVIDENCE, route: '/c', score: 92, visual: null, motion: null, grade: null },
  { status: 'fail', reason: 'below-min', ...EVIDENCE }
];

const G3B: readonly G3BRouteResult[] = [
  { route: '/e', status: 'skipped' },
  { route: '/f', status: 'blocked' },
  { route: '/g', status: 'pass' },
  { route: '/h', status: 'warn', reason: 'below-threshold', total: 24 }
];

describe('Scenario: render — every G3a and G3b outcome has one pinned line', () => {
  it('should render status, score split, defaults and separator exactly', () => {
    // given: four G3a outcomes and four G3b outcomes, including their optional fields absent
    // when: the markdown is rendered
    // then: the g3_exemplar line is exactly one comma-joined, defaulted line per list
    const markdown = renderConformanceMarkdown(resultWith(G3A, G3B), metaFor());

    expect(markdown).toContain(
      '- g3_exemplar: g3a ' +
        '/a skipped (no-baseline), ' +
        '/b blocked (DESIGN_BASELINE_INVALID), ' +
        '/c pass (score 92/90, visual n/a, motion n/a, grade n/a), ' +
        '/d fail (score 89/90, visual 88, motion 91, grade B)'
    );
    expect(markdown).toContain(
      '; g3b ' +
        '/e skipped (no-reason), ' +
        '/f blocked (blocked), ' +
        '/g pass (rubric n/a/40), ' +
        '/h warn (rubric 24/40, below-threshold)'
    );
  });

  it('should keep the not-run markers when neither list judged a route', () => {
    // given: an empty g3_exemplar slot
    // when: the markdown is rendered
    // then: both lists say not-run rather than rendering blank
    const markdown = renderConformanceMarkdown(resultWith([], []), metaFor());

    expect(markdown).toContain('- g3_exemplar: g3a not-run; g3b not-run');
  });
});

describe('Scenario: a11y — caller text cannot forge a verdict or a line break', () => {
  it('should collapse CR/LF runs to one space in surface reasons', () => {
    // given: a surface reason carrying a line-feed and a CRLF pair
    // when: the markdown is rendered
    // then: each run becomes exactly one space and no raw newline survives
    const markdown = renderConformanceMarkdown(
      resultWith([], [], {
        surface: { isUi: true, reasons: ['a\nb', 'x\r\n\r\ny'] }
      }),
      metaFor()
    );

    expect(markdown).toContain('- reason: a b\n- reason: x y\n');
    expect(markdown).not.toContain('a\nb');
  });

  it('should neutralize a verdict marker embedded in a reason or a finding', () => {
    // given: a reason and a finding whose text spells a design-conformance marker
    // when: the markdown is rendered
    // then: the marker is defused in caller text while the real marker stays intact
    const finding = {
      code: 'DESIGN_INLINE_STYLE' as const,
      file: 'app/src/a.tsx',
      line: 3,
      severity: 'fail' as const,
      message: 'design-conformance: fail'
    };
    const markdown = renderConformanceMarkdown(
      resultWith([], [], {
        verdict: 'fail',
        surface: { isUi: true, reasons: ['design-conformance: fail'] },
        findings: [finding]
      }),
      metaFor()
    );

    expect(markdown).toContain('- reason: design-conformance_ fail');
    expect(markdown).toContain(
      '- DESIGN_INLINE_STYLE (fail) app/src/a.tsx:3: design-conformance_ fail'
    );
    expect(markdown).toContain('\ndesign-conformance: fail\n');
  });

  it('should neutralize a newline inside a G3a route', () => {
    // given: a skipped G3a run whose route carries a line feed
    // when: the markdown is rendered
    // then: the route is flattened so it cannot add a line to the section
    const markdown = renderConformanceMarkdown(
      resultWith([{ status: 'skipped', route: 'a\nb', reason: 'no-baseline' }], []),
      metaFor()
    );

    expect(markdown).toContain('a b skipped (no-baseline)');
    expect(markdown).not.toContain('a\nb skipped');
  });

  it('should neutralize a fidelity grade that forges the pass marker', () => {
    // given: a failing run whose engine grade carries a heading and the pass marker
    // when: the markdown is rendered
    // then: the grade is flattened and no accepted marker satisfies the prerequisite
    const grade = 'A\n## Design conformance\ndesign-conformance: pass';
    const markdown = renderConformanceMarkdown(
      resultWith([{ status: 'fail', reason: 'below-min', ...EVIDENCE, grade }], [], {
        verdict: 'fail'
      }),
      metaFor()
    );

    expect(markdown).toContain('grade A ## Design conformance design-conformance_ pass');
    for (const marker of DESIGN_CONFORMANCE.mustContainAny ?? []) {
      expect(markdown).not.toContain(marker);
    }
    expect(markdown).toContain('\ndesign-conformance: fail\n');
  });
});

describe('Scenario: integration — the G3 section sits between checks and findings', () => {
  it('should render the G3 line immediately after the G2 check line', () => {
    // given: a result with one skipped G3a run
    // when: the markdown is rendered
    // then: the g3_exemplar line follows g2_render and precedes the findings heading
    const markdown = renderConformanceMarkdown(
      resultWith([{ status: 'skipped', route: '/a', reason: 'no-baseline' }], []),
      metaFor()
    );

    expect(markdown).toContain(
      '- g2_render: pass\n- g3_exemplar: g3a /a skipped (no-baseline); g3b not-run\n'
    );
  });
});
