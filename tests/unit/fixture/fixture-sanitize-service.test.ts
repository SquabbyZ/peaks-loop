/**
 * v2.14.0 G1 AC-1.5 — Fixture sanitize service unit tests.
 *
 * Covers all 5 sanitize rules + a happy-path non-secret input. Each
 * rule is exercised with ≥1 positive case (redaction applied) and
 * 1 negative case (no redaction needed). The `sanitizeFixtureStrict`
 * variant is tested for the empty-input refusal path.
 */
import { describe, test, expect } from 'vitest';
import {
  sanitizeFixture,
  sanitizeFixtureStrict,
  SANITIZE_RULE_NAMES,
  type SanitizeRuleName
} from '../../../src/services/fixture/fixture-sanitize-service.js';

describe('v2.14.0 G1 fixture-sanitize-service (AC-1.5)', () => {
  test('A: sanitizeFixture applies all 5 rules and returns a passing report', () => {
    const input = [
      'Cookie: session=abc123',
      'Authorization: Bearer ghp_1234567890abcdefghij',
      'See https://login.example.com/cb?code=SECRET',
      'Contact alice@example.com for details.',
      'Path was C:\\Users\\AliceDoe\\projects\\app\\src\\index.ts'
    ].join('\n');
    const { redacted, report } = sanitizeFixture(input);

    expect(report.passed).toBe(true);
    expect(report.rulesApplied).toEqual(SANITIZE_RULE_NAMES);
    expect(redacted).toContain('<REDACTED-cookie>');
    expect(redacted).toContain('<REDACTED-token>');
    expect(redacted).toContain('<REDACTED-sso-url>');
    expect(redacted).toContain('<REDACTED-email>');
    expect(redacted).toContain('<REDACTED-user>');
    expect(report.issues.length).toBeGreaterThanOrEqual(5);
  });

  test('B: cookie-redaction catches both Cookie and Set-Cookie headers', () => {
    const input = 'Cookie: a=1\nSet-Cookie: b=2; Path=/';
    const { redacted, report } = sanitizeFixture(input);
    expect(redacted).not.toContain('a=1');
    expect(redacted).not.toContain('b=2');
    expect(report.issues.filter((i) => i.rule === 'cookie-redaction')).toHaveLength(2);
  });

  test('C: token-redaction catches Bearer + JWT + sk-/ghp_ API-key prefixes', () => {
    const input = [
      'Authorization: Bearer sk-1234567890abcdefghij',
      'JWT: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc',
      'Token ghp_abcdefghijklmnopqrstuvwxyz1234567890',
      'AIzaSyAbc1234567890abcdefghijklmnopqrstuv'
    ].join('\n');
    const { redacted, report } = sanitizeFixture(input);
    expect(redacted).not.toMatch(/sk-\d/);
    expect(redacted).not.toMatch(/ghp_/);
    expect(redacted).not.toMatch(/AIza/);
    expect(redacted).not.toMatch(/eyJ/);
    expect(report.issues.filter((i) => i.rule === 'token-redaction').length).toBeGreaterThanOrEqual(4);
  });

  test('D: sso-url-redaction strips token + code + access_token query params', () => {
    const input = [
      'Callback: https://app.example.com/cb?token=secret123',
      'OAuth: https://idp.example.com/authorize?code=abc&state=ok',
      'Implicit: https://app.example.com/#access_token=xyz'
    ].join('\n');
    const { redacted, report } = sanitizeFixture(input);
    expect(redacted).not.toContain('secret123');
    expect(redacted).not.toContain('code=abc');
    expect(redacted).not.toContain('access_token=xyz');
    expect(report.issues.filter((i) => i.rule === 'sso-url-redaction').length).toBeGreaterThanOrEqual(3);
  });

  test('E: personal-email-redaction catches RFC-shaped addresses', () => {
    const input = 'Authors: alice@example.com, bob.smith+filter@sub.example.co.uk';
    const { redacted, report } = sanitizeFixture(input);
    expect(redacted).toBe('Authors: <REDACTED-email>, <REDACTED-email>');
    expect(report.issues.filter((i) => i.rule === 'personal-email-redaction')).toHaveLength(2);
  });

  test('F: username-path-segment-redaction only redacts the user segment, not the whole path', () => {
    const input = [
      'POSIX: /Users/AliceDoe/projects/app/src/index.ts',
      'Windows: C:\\Users\\BobSmith\\AppData\\Local\\Temp\\x.txt',
      'UNC: \\\\server\\home\\CharlieBrown\\notes.md'
    ].join('\n');
    const { redacted, report } = sanitizeFixture(input);
    expect(redacted).toContain('/Users/<REDACTED-user>/projects/app/src/index.ts');
    expect(redacted).toContain('C:\\Users\\<REDACTED-user>\\AppData');
    expect(redacted).toContain('\\\\server\\home\\<REDACTED-user>\\notes.md');
    expect(report.issues.filter((i) => i.rule === 'username-path-segment-redaction').length).toBeGreaterThanOrEqual(3);
  });

  test('G: negative — clean input with no secrets produces identical output + empty issues', () => {
    const input = '## Summary\nTest envelope for dogfood.\nverdict: pass';
    const { redacted, report } = sanitizeFixture(input);
    expect(redacted).toBe(input);
    expect(report.issues).toHaveLength(0);
    expect(report.passed).toBe(true);
  });

  test('H: sanitizeFixtureStrict refuses empty input (passed: false)', () => {
    const { report } = sanitizeFixtureStrict('');
    expect(report.passed).toBe(false);
  });

  test('I: each rule is reported in `rulesApplied` in the canonical order', () => {
    const { report } = sanitizeFixture('Cookie: a=1; Authorization: Bearer sk-1234567890abcdefghij; /Users/Foo/x.ts; a@b.co; https://x.example.com/?token=t');
    const expected: ReadonlyArray<SanitizeRuleName> = [
      'cookie-redaction',
      'token-redaction',
      'sso-url-redaction',
      'personal-email-redaction',
      'username-path-segment-redaction'
    ];
    expect(report.rulesApplied).toEqual(expected);
  });
});
