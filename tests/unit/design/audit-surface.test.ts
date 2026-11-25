import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  classTokens,
  classValueSpans,
  type AuditFinding,
  type AuditInput,
  type AuditSource
} from '../../../src/services/design/audit/audit-finding.js';
import {
  auditSurface,
  distinctPrimaryStrings,
  MAX_RADIUS_TIERS,
  measureRadius,
  measureShadows,
  primaryClassSamples,
  radiusTiers
} from '../../../src/services/design/audit/audit-surface.js';
import { isPrimaryToken } from '../../../src/services/design/audit/primary-measure.js';
import { stripViews } from '../../../src/services/design/source-scan/strip-comments.js';
import { buildPavedRoad, type DesignTokenScale } from '../../../src/services/design/paved-road.js';

declareDimensions('tests/unit/design/audit-surface.test.ts', [
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
  return auditSurface({ tokenScale: scale, sources: [source(name)] });
}

/**
 * The pre-6c primary rule, kept as the inversion control: any class context
 * carrying a primary token counts, regardless of the element. On the
 * link/card/icon fixture it counts three where the real rule counts none.
 */
function tokenOnlyPrimary(name: string): number {
  const file = source(name);
  const view = stripViews(file.source).comments;
  return classValueSpans(view).filter((span) =>
    classTokens(span).some((entry) => isPrimaryToken(entry.token))
  ).length;
}

/**
 * The RETIRED 12 px shadow threshold, moved here from the detector (S7 final
 * review): the contract declares no shadow scale, so the real rule reports an
 * `unmeasured` gap. The number survives only as the inversion control below, so
 * a regression back to judging against it makes the two detectors disagree.
 */
const MAX_SHADOW_BLUR_PX = 12;

function invertedFinding(value: string, line = 1): AuditFinding {
  return {
    dimension: 'surface',
    severity: 'soft',
    file: 'inverted.tsx',
    line,
    value,
    expected: 'inverted',
    humanText: `反向检测器把 ${value} 报成了问题。`,
    techText: `inverted.tsx:${line} ${value} (inverted)`
  };
}

/**
 * The injection control: the surface verdicts flipped.
 *
 * `auditSurface` reports MORE than three radius tiers, MORE than one primary
 * string, and — since the shadow scale is undeclared — an UNMEASURED gap for a
 * shadow instead of the retired 12 px soft finding. This wrapper reports the
 * compliant side of the radius/primary rules and the RETIRED threshold for the
 * shadow, so a regression to the invented 12 px rule makes both detectors agree
 * and the calibration below fails rather than passing vacuously.
 */
function invertedSurface(input: AuditInput): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const tiers = radiusTiers(measureRadius(input.sources));
  if (tiers.length <= MAX_RADIUS_TIERS)
    findings.push(invertedFinding(`radius-tiers:${tiers.length}`));
  for (const shadow of measureShadows(input.sources)) {
    if (shadow.blurPx !== null && shadow.blurPx > MAX_SHADOW_BLUR_PX) {
      findings.push(invertedFinding(`blur:${shadow.blurPx}`, shadow.line));
    }
  }
  const strings = distinctPrimaryStrings(primaryClassSamples(input.sources));
  if (strings.length <= 1)
    findings.push(invertedFinding(`primary-class-strings:${strings.length}`));
  return findings;
}

describe('Scenario: render — a surface finding carries the documented shape', () => {
  it('when the bad surface page is audited, should render findings with every field', () => {
    // given: a page with five radius tiers, a 16px shadow and two primary strings
    // when: the surface audit runs
    // then: the radius/primary findings are soft, the shadow is an unmeasured gap
    const findings = run('surface-bad-page.tsx');
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
      expect(finding.dimension).toBe('surface');
      expect(['soft', 'unmeasured']).toContain(finding.severity);
      expect(finding.file).toBe('surface-bad-page.tsx');
    }
    expect(findings.filter((finding) => finding.severity === 'soft')).toHaveLength(2);
  });
});

describe('Scenario: behavior — tiers, blur and primary strings are each judged', () => {
  it('when a page declares a shadow but no shadow scale, should report one unmeasured gap', () => {
    // given: one radius tier, an 8px shadow and one primary class string
    // when: the surface audit runs
    // then: only the shadow is a gap — there is no declared ladder to judge it
    const findings = run('surface-clean-page.tsx');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ dimension: 'surface', severity: 'unmeasured' });
    expect(findings[0]?.techText).toContain('no shadow scale declared');
  });

  it('when the page has no surface decisions at all, should report nothing', () => {
    // given: a page with text but no radius, shadow or primary button
    // when: the surface audit runs
    // then: the never-fires fixture stays silent
    expect(run('surface-empty-page.tsx')).toEqual([]);
  });

  it('when five radius tiers are used, should name the crowded set once', () => {
    // given: rounded, rounded-md, rounded-lg, rounded-xl and rounded-full
    // when: the surface audit runs
    // then: one soft finding lists every tier and expects at most three
    const finding = run('surface-bad-page.tsx').find((entry) =>
      entry.techText.includes('radius-tiers')
    );
    expect(finding?.expected).toBe('<=3');
    expect(finding?.value.split('/')).toHaveLength(5);
  });

  it('when a shadow is declared, should report the measured blur as unmeasured', () => {
    // given: the 16px-blur shadow in the bad fixture
    // when: the surface audit runs
    // then: no invented threshold fires; the measured blur stays in the evidence
    const finding = run('surface-bad-page.tsx').find((entry) =>
      entry.techText.includes('box-shadow')
    );
    expect(finding?.severity).toBe('unmeasured');
    expect(finding?.value).toBe('16px');
    expect(finding?.techText).toContain('blur=16px');
    expect(finding?.techText).toContain('no shadow scale declared');
    expect(finding?.techText).not.toContain('> 12px');
    expect(finding?.humanText).toContain('16px');
  });

  it('when the primary button has two spellings, should name both strings', () => {
    // given: the two distinct primary class strings in the bad fixture
    // when: the surface audit runs
    // then: the "主按钮被复制成几套" finding names both
    const finding = run('surface-bad-page.tsx').find((entry) =>
      entry.techText.includes('primary-class-strings')
    );
    expect(finding?.humanText).toContain('主按钮样式被写成了 2 套');
    expect(finding?.value).toContain('bg-primary');
  });

  it('when the detector is inverted, should disagree on both calibration pages', () => {
    // given: the clean and bad fixtures and an inverted detector over the same measurements
    // when: both detectors run against the built-in scale
    // then: the real shadow verdict is unmeasured where the retired rule fires soft
    const clean: AuditInput = { tokenScale: scale, sources: [source('surface-clean-page.tsx')] };
    const bad: AuditInput = { tokenScale: scale, sources: [source('surface-bad-page.tsx')] };
    expect(auditSurface(clean)).toHaveLength(1);
    expect(invertedSurface(clean)).toHaveLength(2);
    expect(auditSurface(bad)).toHaveLength(3);
    expect(invertedSurface(bad)).toHaveLength(1);
  });
});

describe('Scenario: behavior — only a real button carries a primary action', () => {
  it('when a link, a selected card and an icon use the primary token, should not count them', () => {
    // given: `text-primary` on an <a>, `data-selected:border-primary` on a card, a `text-primary` icon
    // when: the surface audit runs
    // then: none of them is a primary button and no finding is emitted
    expect(run('surface-primary-page.tsx')).toEqual([]);
    expect(primaryClassSamples([source('surface-primary-page.tsx')])).toEqual([]);
  });

  it('when a button, a role=button and a bg-primary pill each carry a primary style, should name the evidence', () => {
    // given: three primary-looking elements with different button semantics
    // when: the surface audit runs
    // then: each string counts and the finding says what made it count
    const findings = run('surface-button-evidence-page.tsx');
    const finding = findings.find((entry) => entry.techText.includes('primary-class-strings'));
    expect(finding?.value.split(' | ')).toHaveLength(3);
    expect(finding?.techText).toContain('[button]');
    expect(finding?.techText).toContain('[role=button]');
    expect(finding?.techText).toContain('[bg-primary+padding+radius]');
  });

  it('when the button-semantics rule is inverted, should disagree on the token-only fixture', () => {
    // given: the link/card/icon fixture and the three-button fixture
    // when: a token-only detector (the pre-6c rule) runs beside the real one
    // then: the real rule is silent on the first and the token-only rule is not
    expect(run('surface-primary-page.tsx')).toEqual([]);
    expect(tokenOnlyPrimary('surface-primary-page.tsx')).toBeGreaterThan(0);
    expect(run('surface-button-evidence-page.tsx').length).toBeGreaterThan(0);
    expect(tokenOnlyPrimary('surface-button-evidence-page.tsx')).toBeGreaterThan(0);
  });
});

describe('Scenario: integration — stylesheet declarations are judged too', () => {
  it('when a CSS file declares four radii and a deep shadow, should report both', () => {
    // given: a `.css` fixture with four border-radius values and a 20px blur
    // when: the surface audit runs over the stylesheet source
    // then: one radius finding and one shadow finding are emitted
    const findings = run('surface-page.css');
    expect(findings).toHaveLength(2);
    expect(findings.some((entry) => entry.techText.includes('radius-tiers'))).toBe(true);
    expect(findings.some((entry) => entry.techText.includes('blur=20px'))).toBe(true);
  });
});

describe('Scenario: a11y — the bilingual pair is actionable', () => {
  it('when a tier set is crowded, should explain it in Chinese and cite file:line', () => {
    // given: the crowded-radius fixture
    // when: the tier finding is read
    // then: the plain sentence names the count and the technical line is greppable
    const finding = run('surface-bad-page.tsx').find((entry) =>
      entry.techText.includes('radius-tiers')
    );
    expect(finding?.humanText).toContain('超过 3 种');
    expect(finding?.techText).toMatch(/^surface-bad-page\.tsx:\d+ radius-tiers:/);
  });
});
