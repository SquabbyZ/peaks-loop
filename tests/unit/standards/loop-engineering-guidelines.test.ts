import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  lintLoopEngineeringGuidelines,
  EXPECTED_RED_LINE_IDS,
  REQUIRED_SECTIONS,
} from '../../../src/services/standards/loop-engineering-lint.js';

const GUIDELINES_PATH = join(
  process.cwd(),
  '.peaks',
  'standards',
  'loop-engineering-guidelines.md'
);

const raw = readFileSync(GUIDELINES_PATH, 'utf8');

describe('loop-engineering-guidelines.md (M0 source of truth)', () => {
  it('is a non-empty markdown file', () => {
    expect(raw.length).toBeGreaterThan(1000);
    expect(raw).toMatch(/^#\s+Loop Engineering Guidelines/m);
  });

  it('mentions every expected red line id', () => {
    for (const id of EXPECTED_RED_LINE_IDS) {
      expect(raw, `missing red line id ${id}`).toMatch(new RegExp(`^##\\s+${id}\\b`, 'm'));
    }
  });
});

describe('lintLoopEngineeringGuidelines (M0 harness)', () => {
  it('returns ok=true for the committed guideline file', () => {
    const result = lintLoopEngineeringGuidelines(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      // helpful failure trace
      // eslint-disable-next-line no-console
      console.error(result.findings);
    }
  });

  it('lists every expected red line id in the report', () => {
    const result = lintLoopEngineeringGuidelines(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const foundIds = new Set(result.redLines.map((r) => r.id));
      for (const id of EXPECTED_RED_LINE_IDS) {
        expect(foundIds.has(id), `red line ${id} not detected`).toBe(true);
      }
    }
  });

  it('rejects an empty document', () => {
    const result = lintLoopEngineeringGuidelines('');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.findings.length).toBeGreaterThan(0);
    }
  });

  it('rejects a red line that is missing one of the 4 required sections', () => {
    const broken = [
      '# Loop Engineering Guidelines',
      '',
      '## RL-1 — Human-NL-Choice-Only',
      '',
      '## Failure modes',
      '- user is asked to hand-fill JSON',
      '',
      // missing Rewrite, Self-check, Out-of-scope on purpose
    ].join('\n');
    const result = lintLoopEngineeringGuidelines(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const hasMissingSection = result.findings.some((f) =>
        f.includes('RL-1') && REQUIRED_SECTIONS.some((s) => f.includes(s))
      );
      expect(hasMissingSection).toBe(true);
    }
  });
});
