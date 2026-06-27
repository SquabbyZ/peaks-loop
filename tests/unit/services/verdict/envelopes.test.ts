/**
 * v2.13.2 AC-3 — Envelope unification tests (≥6 cases).
 *
 * Pins 5 parser happy paths + 1 malformed rejection + 1 adapter case.
 */
import { describe, test, expect } from 'vitest';
import {
  parseSecurityEnvelope,
  parsePerfEnvelope,
  parseKarpathyEnvelope,
  parseMutEnvelope,
  parseQaEnvelope,
  envelopesToAggregatorInput,
  type AnyEnvelope
} from '../../../../src/services/verdict/envelopes.js';
import { aggregateVerdict } from '../../../../src/services/verdict/verdict-aggregator.js';

describe('v2.13.2 envelopes.ts (AC-3)', () => {
  test('A: parseSecurityEnvelope — happy path returns a SecurityAuditEnvelope', () => {
    const md = JSON.stringify({
      verdict: 'warn',
      violations: [{ dimension: 'auth', severity: 'HIGH', file: 'a.ts', line: 1, hint: 'h' }],
      summary: 'one'
    });
    const env = parseSecurityEnvelope(md);
    expect(env).not.toBeNull();
    expect(env?.verdict).toBe('warn');
    expect(env?.violations).toHaveLength(1);
  });

  test('B: parsePerfEnvelope — happy path returns a PerfAuditEnvelope', () => {
    const md = JSON.stringify({
      verdict: 'pass',
      violations: [],
      summary: 'clean'
    });
    const env = parsePerfEnvelope(md);
    expect(env).not.toBeNull();
    expect(env?.verdict).toBe('pass');
  });

  test('C: parseKarpathyEnvelope — happy path extracts gateAction + violations', () => {
    const md = [
      'gateAction: warn',
      'passed: false',
      '',
      '## Violations',
      '',
      '- [HIGH] src/x.ts:7 — shared-hint (simplicity-first)',
      '- [MED] src/y.ts:3 — other (surgical-changes)'
    ].join('\n');
    const env = parseKarpathyEnvelope(md);
    expect(env).not.toBeNull();
    expect(env?.gateAction).toBe('warn');
    expect(env?.passed).toBe(false);
    expect(env?.violations).toHaveLength(2);
    expect(env?.violations[0]?.guideline).toBe('simplicity-first');
    expect(env?.violations[0]?.severity).toBe('HIGH');
  });

  test('D: parseMutEnvelope — happy path returns MutEnvelope with killRate', () => {
    const json = {
      passed: true,
      killRate: 0.91,
      weakRate: 0.02,
      violations: []
    };
    const env = parseMutEnvelope(json);
    expect(env).not.toBeNull();
    expect(env?.passed).toBe(true);
    expect(env?.killRate).toBe(0.91);
  });

  test('E: parseQaEnvelope — happy path extracts verdict + reportPath', () => {
    const md = [
      'verdict: return-to-rd',
      'reportPath: qa/test-reports/rid.md'
    ].join('\n');
    const env = parseQaEnvelope(md);
    expect(env).not.toBeNull();
    expect(env?.verdict).toBe('return-to-rd');
    expect(env?.reportPath).toBe('qa/test-reports/rid.md');
  });

  test('F: malformed rejection — parseSecurityEnvelope on garbage returns null', () => {
    expect(parseSecurityEnvelope('not json at all')).toBeNull();
    expect(parseSecurityEnvelope(JSON.stringify({ verdict: 'invalid' }))).toBeNull();
    expect(parsePerfEnvelope('garbage')).toBeNull();
    expect(parseKarpathyEnvelope('no gateAction line')).toBeNull();
    expect(parseMutEnvelope(null)).toBeNull();
    expect(parseQaEnvelope('')).toBeNull();
  });

  test('G: envelopesToAggregatorInput — null entries skipped; full round-trip drives aggregator', () => {
    const list: ReadonlyArray<AnyEnvelope | null> = [
      null,
      {
        kind: 'security',
        envelope: {
          verdict: 'warn',
          violations: [{ dimension: 'auth', severity: 'HIGH', file: 'src/x.ts', line: 1, hint: 'shared' }],
          summary: ''
        }
      },
      {
        kind: 'perf',
        envelope: {
          verdict: 'warn',
          violations: [{ dimension: 'render', severity: 'HIGH', file: 'src/x.ts', line: 1, hint: 'shared' }],
          summary: ''
        }
      },
      null
    ];
    const input = envelopesToAggregatorInput(list);
    const out = aggregateVerdict(input);
    expect(out.verdict).toBe('warn');
    expect(out.reasons).toHaveLength(1);
    expect(out.reasons[0]!.sources).toEqual(['security-audit', 'perf-audit']);
  });
});