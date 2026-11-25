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
  auditSpacing,
  measureSpacing,
  spacingLadder,
  spacingVerdict
} from '../../../src/services/design/audit/audit-spacing.js';
import { buildPavedRoad, type DesignTokenScale } from '../../../src/services/design/paved-road.js';
import { readPavedRoad } from '../../../src/services/design/source-scan/inputs.js';

declareDimensions('tests/unit/design/audit-spacing.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/design/audit');
const CUSTOM = join(FIXTURES, 'custom-scale-project/design');

/** The fixture project's declared scale, read through the same reader the audit uses. */
const custom = readPavedRoad(CUSTOM);
const builtIn: DesignTokenScale = buildPavedRoad({
  pageRoots: ['src/pages'],
  componentEntrypoints: []
}).tokenScale;

function source(name: string): AuditSource {
  return { file: name, source: readFileSync(join(FIXTURES, name), 'utf8') };
}

function run(scale: DesignTokenScale, name: string): AuditFinding[] {
  return auditSpacing({ tokenScale: scale, sources: [source(name)] });
}

/**
 * The line a fixture declares a value on, read from the fixture itself. The
 * assertion stays exact while surviving a runner that prepends a directive to
 * the sandbox copy (Stryker's `@ts-nocheck`).
 */
function lineOf(name: string, needle: string): number {
  const lines = readFileSync(join(FIXTURES, name), 'utf8').split('\n');
  return lines.findIndex((line) => line.includes(needle)) + 1;
}

/**
 * The injection control: the detector's verdict inverted.
 *
 * `auditSpacing` reports OFF-ladder values. This wrapper reuses the same
 * measurement and classifier but keeps the ON-ladder samples, so if the
 * classifier were flipped to "everything is off-ladder" the real detector and
 * this control would stop disagreeing and the calibration below would fail.
 */
function invertedSpacing(input: AuditInput): AuditFinding[] {
  const ladder = spacingLadder(input.tokenScale.space);
  return measureSpacing(input.sources).flatMap((sample): AuditFinding[] =>
    spacingVerdict(sample, ladder).kind !== 'on'
      ? []
      : [
          {
            dimension: 'spacing',
            severity: 'soft',
            file: sample.file,
            line: sample.line,
            value: sample.raw,
            expected: 'off-ladder',
            humanText: `反向检测器把刻度内的 ${sample.raw} 报成了问题。`,
            techText: `${sample.file}:${sample.line} ${sample.property}:${sample.raw} IN tokenScale.space (inverted)`
          }
        ]
  );
}

describe('Scenario: render — a finding carries the documented shape', () => {
  it('when an off-ladder page is audited, should render every finding with all fields', () => {
    // given: the off-ladder fixture judged against the custom declared scale
    // when: the spacing audit runs
    // then: each finding has exactly the documented fields and the spacing dimension
    const findings = run(custom.tokenScale, 'off-ladder-page.tsx');
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
      expect(finding.dimension).toBe('spacing');
      expect(finding.severity).toBe('soft');
      expect(finding.file).toBe('off-ladder-page.tsx');
    }
  });
});

describe('Scenario: behavior — ladder steps, off-ladder values and unreadable values', () => {
  it('when the clean page is judged against its declared scale, should report nothing', () => {
    // given: a page whose 16/16/16/20 values are all steps of the custom scale
    // when: the spacing audit runs
    // then: no finding is emitted
    expect(run(custom.tokenScale, 'clean-page.tsx')).toEqual([]);
  });

  it('when the same clean page is judged against the built-in scale, should flag the 20px step', () => {
    // given: the clean fixture and the built-in scale, where 20px is absent
    // when: the spacing audit runs
    // then: the p-5 token is the one finding, proving the declared scale was not used
    const findings = run(builtIn, 'clean-page.tsx');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.line).toBe(lineOf('clean-page.tsx', 'p-5'));
    expect(findings[0]?.value).toBe('p-5');
    expect(findings[0]?.expected).toBe('24');
  });

  it('when four off-ladder values are judged, should flag the three that miss every step', () => {
    // given: the 13/15/17/20 fixture and the custom scale that contains 20
    // when: the spacing audit runs
    // then: only 13, 15 and 17 are flagged, each with its nearest ladder step
    const findings = run(custom.tokenScale, 'off-ladder-page.tsx');
    expect(findings.map((finding) => finding.value)).toEqual([
      'gap-[13px]',
      'p-[15px]',
      'p-[17px]'
    ]);
    expect(findings.map((finding) => finding.line)).toEqual([
      lineOf('off-ladder-page.tsx', 'gap-[13px]'),
      lineOf('off-ladder-page.tsx', 'p-[15px]'),
      lineOf('off-ladder-page.tsx', 'p-[17px]')
    ]);
    expect(findings.map((finding) => finding.expected)).toEqual(['12', '16', '16']);
  });

  it('when the built-in scale is used, should flag all four off-ladder values', () => {
    // given: the 13/15/17/20 fixture and the built-in scale, where 20 is also absent
    // when: the spacing audit runs
    // then: four values are flagged and 20 snaps up to 24
    const findings = run(builtIn, 'off-ladder-page.tsx');
    expect(findings).toHaveLength(4);
    expect(findings.map((finding) => finding.expected)).toEqual(['12', '16', '16', '24']);
  });

  it('when a class helper carries the utilities, should read cva and cn arguments', () => {
    // given: a cva() definition holding one on-ladder and one off-ladder utility
    // when: the spacing audit runs against the built-in scale
    // then: only the off-ladder half-step is reported
    const inline: AuditSource = {
      file: 'variants.ts',
      source: "const button = cva('p-4', { variants: { size: { sm: 'gap-1.5' } } });\n"
    };
    const findings = auditSpacing({ tokenScale: builtIn, sources: [inline] });
    expect(findings.map((finding) => finding.value)).toEqual(['gap-1.5']);
    expect(findings[0]?.expected).toBe('8');
  });

  it('when a utility-looking string is not a class value, should ignore it', () => {
    // given: a plain string literal that spell a spacing utility
    // when: the spacing audit runs
    // then: it is not a class context and produces no finding
    const inline: AuditSource = {
      file: 'notes.ts',
      source: "const note = 'gap-[13px]';\nconst RADIUS_KEYWORDS = ['rounded'];\n"
    };
    expect(auditSpacing({ tokenScale: builtIn, sources: [inline] })).toEqual([]);
  });

  it('when a raw px declaration is off-ladder, should compare it in px not as a step', () => {
    // given: an inline style padding of 20px and the built-in scale, which has no 20
    // when: the spacing audit runs
    // then: the value is flagged with the nearest declared value and the mandated technical line
    const inline: AuditSource = {
      file: 'raw.tsx',
      source: "<div style={{ padding: '20px' }} />\n"
    };
    const findings = auditSpacing({ tokenScale: builtIn, sources: [inline] });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.value).toBe('20px');
    expect(findings[0]?.expected).toBe('24');
    expect(findings[0]?.techText).toBe('raw.tsx:1 padding:20px not in tokenScale.space');
  });

  it('when a value needs calc() or a runtime variable, should report it as unmeasured', () => {
    // given: a page whose spacing is calc(), var(--spacing) inline and in a class
    // when: the spacing audit runs
    // then: every finding is unmeasured and none is a violation
    const findings = run(custom.tokenScale, 'unreadable-page.tsx');
    expect(findings).toHaveLength(3);
    expect(findings.every((finding) => finding.severity === 'unmeasured')).toBe(true);
    expect(findings.filter((finding) => finding.techText.includes('--spacing'))).toHaveLength(2);
    expect(findings.some((finding) => finding.techText.includes('calc()'))).toBe(true);
  });

  it('when the detector is inverted, should disagree on both calibration pages', () => {
    // given: the clean and off-ladder pages, and an inverted detector over the same primitives
    // when: both detectors are run against the custom declared scale
    // then: the real detector is silent on the clean page and the inverted one is not
    const clean: AuditInput = {
      tokenScale: custom.tokenScale,
      sources: [source('clean-page.tsx')]
    };
    const bad: AuditInput = {
      tokenScale: custom.tokenScale,
      sources: [source('off-ladder-page.tsx')]
    };
    expect(auditSpacing(clean)).toEqual([]);
    expect(invertedSpacing(clean)).toHaveLength(5);
    expect(auditSpacing(bad)).toHaveLength(3);
    expect(invertedSpacing(bad)).toHaveLength(1);
  });
});

describe('Scenario: integration — the audit reads the contract on disk', () => {
  it('when the fixture project declares a non-default scale, should audit against that scale', () => {
    // given: a paved-road.json whose space ladder contains 20 and a clean 16/16/16/20 page
    // when: the road is read from disk and used as the audit oracle
    // then: the page is clean under the declared scale but not under the built-in one
    expect(custom.tokenScale.space).toEqual(['4', '8', '12', '16', '20', '24']);
    expect(custom.warnings).toBeUndefined();
    expect(run(custom.tokenScale, 'clean-page.tsx')).toEqual([]);
    expect(run(builtIn, 'clean-page.tsx')).toHaveLength(1);
  });
});

describe('Scenario: a11y — the bilingual pair is actionable', () => {
  it('when an off-ladder value is reported, should explain it in Chinese and cite file:line in English', () => {
    // given: the off-ladder page judged against the custom scale
    // when: the spacing audit runs
    // then: the human sentence names the line and the nearest step, and the technical line is grep-able
    const findings = run(custom.tokenScale, 'off-ladder-page.tsx');
    const padding = findings.find((finding) => finding.value === 'p-[15px]');
    const line = lineOf('off-ladder-page.tsx', 'p-[15px]');
    expect(padding?.humanText).toContain(`第 ${line} 行`);
    expect(padding?.humanText).toContain('最近的刻度是 16px');
    expect(padding?.techText).toBe(
      `off-ladder-page.tsx:${line} padding:p-[15px] not in tokenScale.space`
    );
  });

  it('when a value is unreadable, should name the runtime variable it depends on', () => {
    // given: the unreadable fixture
    // when: the spacing audit runs
    // then: both the human and technical lines name --spacing for the two variable values
    const findings = run(custom.tokenScale, 'unreadable-page.tsx');
    const variableFindings = findings.filter((finding) => finding.techText.includes('--spacing'));
    expect(variableFindings).toHaveLength(2);
    for (const finding of variableFindings) {
      expect(finding.humanText).toContain('--spacing');
      expect(finding.techText).toContain('variable --spacing');
    }
  });
});
