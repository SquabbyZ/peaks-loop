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

// ─── v2.13.3 AC-1 — real v2.12.0 markdown parse ──────────────────────
//
// Dogfood bug #1 (2.13.2): parseSecurity/Perf only ran JSON.parse. The
// real audit files at `.peaks/_runtime/<sid>/audit/security.md` and
// `audit/perf.md` are YAML frontmatter + markdown body. The CLI
// returned `verdict: warn, violations: []` because its inline parser
// only matched shape A (`- [SEV] dim @ file:line — hint`); the
// 2.13.2 dogfood fixture used shape B (`- HIGH: hint in file:line`).
// These 4 cases pin the fix.
describe('v2.13.3 envelopes.ts (AC-1) — real v2.12.0 markdown parse', () => {
  test('H: parseSecurityEnvelope — real v2.12.0 frontmatter + shape B bullet extracts violations', () => {
    // Copied from .peaks/_runtime/2026-06-27-session-83acf5/audit/security.md
    // (2.13.2 dogfood fixture, rid/sid substituted for portability).
    const md = [
      '---',
      'schemaVersion: 1',
      'artifactKind: security-audit',
      'rid: test-rid',
      'sid: test-sid',
      'handoffHash: deadbeef',
      'templateVersion: 1',
      'generatedAt: 2026-06-27T22:00:00.000Z',
      'verdict: warn',
      'violationsCount: 1',
      '---',
      '## Summary',
      '',
      'Test security envelope for dogfood.',
      '',
      '## Findings',
      '',
      '- HIGH: hardcoded password in src/auth.ts:42',
      '',
      '## Verdict',
      '',
      'verdict: warn',
      'CRITICAL: 0'
    ].join('\n');
    const env = parseSecurityEnvelope(md);
    expect(env).not.toBeNull();
    expect(env?.verdict).toBe('warn');
    expect(env?.violations).toHaveLength(1);
    expect(env?.violations[0]?.severity).toBe('HIGH');
    expect(env?.violations[0]?.file).toBe('src/auth.ts');
    expect(env?.violations[0]?.line).toBe(42);
    expect(env?.violations[0]?.hint).toContain('hardcoded password');
    expect(env?.summary).toContain('Test security envelope');
  });

  test('I: parsePerfEnvelope — real v2.12.0 frontmatter (no violations) returns envelope with empty violations', () => {
    const md = [
      '---',
      'schemaVersion: 1',
      'artifactKind: perf-audit',
      'rid: test-rid',
      'sid: test-sid',
      'handoffHash: deadbeef',
      'templateVersion: 1',
      'generatedAt: 2026-06-27T22:00:00.000Z',
      'verdict: pass',
      'violationsCount: 0',
      '---',
      '## Summary',
      '',
      'Test perf envelope for dogfood.',
      '',
      '## Findings',
      '',
      '- none',
      '',
      '## Verdict',
      '',
      'verdict: pass',
      'CRITICAL: 0'
    ].join('\n');
    const env = parsePerfEnvelope(md);
    expect(env).not.toBeNull();
    expect(env?.verdict).toBe('pass');
    expect(env?.violations).toEqual([]);
  });

  test('J: parseSecurityEnvelope — markdown without frontmatter returns null (not JSON, not v2.12.0)', () => {
    const md = [
      '## Summary',
      '',
      'Some findings without frontmatter.',
      '',
      '## Findings',
      '',
      '- HIGH: hardcoded password in src/auth.ts:42'
    ].join('\n');
    expect(parseSecurityEnvelope(md)).toBeNull();
    expect(parsePerfEnvelope(md)).toBeNull();
  });

  test('K: parseSecurityEnvelope — JSON back-compat path still works (existing test fixtures)', () => {
    // Pre-2.13.3 contract: a JSON string is still accepted. This pins
    // the back-compat path so the v2.13.2 envelopes.test.ts cases
    // (A / B / F-partial) keep passing.
    const md = JSON.stringify({
      verdict: 'warn',
      violations: [{ dimension: 'auth', severity: 'HIGH', file: 'a.ts', line: 1, hint: 'h' }],
      summary: 'one'
    });
    const env = parseSecurityEnvelope(md);
    expect(env).not.toBeNull();
    expect(env?.verdict).toBe('warn');
    expect(env?.violations).toHaveLength(1);
    expect(env?.violations[0]?.dimension).toBe('auth');
  });
});