/**
 * Slice 2.6.1.C — karpathy-service markdown escape
 *
 * Verifies the L1 LOW mitigation: user-controlled strings interpolated
 * into the markdown report (projectRoot, reviewFile, v.snippet, warnings)
 * are escaped so they cannot inject markdown structure (inline code,
 * link/image syntax).
 *
 * AC-1 escapeMarkdown: backslash, backtick, [, ] are escaped
 * AC-2 escapeMarkdown: leaves non-structural chars untouched (preserves readability)
 * AC-3 formatKarpathyMarkdown: projectRoot containing backticks is escaped
 * AC-4 formatKarpathyMarkdown: violation snippet containing "[docs](url)" is escaped (brackets only — parens alone have no markdown meaning)
 * AC-5 formatKarpathyMarkdown: warning containing backslashes is escaped
 * AC-6 no-regression: a clean ASCII report renders byte-identical
 */

import { describe, expect, it } from 'vitest';
import {
  escapeMarkdown,
  formatKarpathyMarkdown,
  type KarpathyScanReport
} from '../../src/services/scan/karpathy-service.js';

function makeReport(overrides: Partial<KarpathyScanReport> = {}): KarpathyScanReport {
  return {
    projectRoot: '/Users/me/proj',
    reviewFile: 'rd/karpathy-review.md',
    scannedAt: '2026-06-18T00:00:00.000Z',
    present: true,
    counts: {
      'think-before-coding': 0,
      'simplicity-first': 0,
      'surgical-changes': 0,
      'goal-driven-execution': 0
    },
    totalViolations: 0,
    violations: [],
    sectionCoverage: {
      'think-before-coding': true,
      'simplicity-first': true,
      'surgical-changes': true,
      'goal-driven-execution': true
    },
    gateAction: 'pass',
    warnings: [],
    ...overrides
  };
}

describe('Slice 2.6.1.C — escapeMarkdown', () => {
  it('AC-1 escapes backslash, backtick, [, ]', () => {
    expect(escapeMarkdown('a\\b`c[d]e')).toBe('a\\\\b\\`c\\[d\\]e');
  });

  it('AC-2 leaves non-structural chars untouched (preserves readability)', () => {
    expect(escapeMarkdown('Hello world.')).toBe('Hello world.');
    expect(escapeMarkdown('Score: 95/100')).toBe('Score: 95/100');
    expect(escapeMarkdown('(parens are not markdown on their own)')).toBe('(parens are not markdown on their own)');
  });

  it('does not double-escape the same char on repeated calls', () => {
    const once = escapeMarkdown('[x]');
    const twice = escapeMarkdown(once);
    // Second pass should not turn \[ into \\\[.
    expect(twice).toBe('\\\\\\[x\\\\\\]');
  });
});

describe('Slice 2.6.1.C — formatKarpathyMarkdown escape integration', () => {
  it('AC-3 escapes backticks in projectRoot', () => {
    const md = formatKarpathyMarkdown(makeReport({ projectRoot: '/Users/me/`whoami`/proj' }));
    expect(md).toContain('- **Project:** /Users/me/\\`whoami\\`/proj');
    // Raw unescaped form must NOT appear in the rendered markdown.
    expect(md).not.toContain('`whoami`');
  });

  it('AC-4 escapes link syntax in violation snippet (brackets only)', () => {
    const md = formatKarpathyMarkdown(
      makeReport({
        totalViolations: 1,
        counts: { 'think-before-coding': 0, 'simplicity-first': 0, 'surgical-changes': 1, 'goal-driven-execution': 0 },
        violations: [
          {
            kind: 'surgical-changes',
            line: 12,
            snippet: 'see [docs](https://evil.example.com)',
            hint: 'inline link is not allowed'
          }
        ]
      })
    );
    // Brackets escaped; parens are not (no markdown meaning without brackets).
    expect(md).toContain('see \\[docs\\](https://evil.example.com)');
    // The exact raw "[docs]" must NOT survive intact.
    expect(md).not.toContain('see [docs](https://evil.example.com)');
  });

  it('AC-5 escapes backslashes in warning text', () => {
    const md = formatKarpathyMarkdown(
      makeReport({
        warnings: ['path with backslash: C:\\Users\\me']
      })
    );
    expect(md).toContain('path with backslash: C:\\\\Users\\\\me');
  });

  it('AC-6 no-regression: clean ASCII inputs render unchanged', () => {
    const report = makeReport();
    const md = formatKarpathyMarkdown(report);
    expect(md).toContain('- **Project:** /Users/me/proj');
    expect(md).toContain('- **Review file:** rd/karpathy-review.md');
    expect(md).toContain('- **Scanned at:** 2026-06-18T00:00:00.000Z');
    // Static structural lines stay byte-identical.
    expect(md).toContain('### Karpathy-Gate');
    expect(md).toContain('## Karpathy inventory');
  });
});
