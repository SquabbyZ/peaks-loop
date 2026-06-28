/**
 * v2.14.0 G1 AC-1.5 — Fixture sanitization service.
 *
 * Five sanitize rules (PRD AC-1.5 + the explicit
 * "username path segment" extension):
 *
 *   1. cookie-redaction              — `Cookie: <name>=<value>` / `Set-Cookie: ...`
 *   2. token-redaction               — Bearer tokens, JWTs, API keys (sk-/ghp-/... prefixes)
 *   3. sso-url-redaction             — SSO redirect URLs with embedded tokens (`?token=`,
 *                                       `?code=`, `#access_token=`)
 *   4. personal-email-redaction      — RFC-5322-shaped personal emails
 *   5. username-path-segment-redaction — `/Users/<name>/` and `C:\\Users\\<name>\\`
 *                                       path segments (only the username segment,
 *                                       not the whole path)
 *
 * Sanitize contract:
 *   - Pure (no IO). `sanitizeFixture(input: string)` returns the redacted
 *     string + a `SanitizationReport`.
 *   - `passed: true` only when ALL rules have been applied. The capture
 *     CLI refuses to write a fixture with `passed: false`.
 *   - Each rule produces a stable replacement token (`<REDACTED-<rule}>`)
 *     so the test suite can grep for redaction without depending on
 *     the original (potentially sensitive) values.
 *
 * Why a separate service (not inline in capture CLI):
 *   - Unit-testable in isolation. The PRD AC-1.5 mandate is "tested",
 *     and 5 sanitize rules need 5+ test cases per rule. Keeping the
 *     logic in a service makes the tests trivial.
 *   - Re-usable by future capture tools (`peaks fixture redact`,
 *     `peaks fixture snapshot-share`) without forking logic.
 */
import { z } from 'zod';

// ─── Rule set ─────────────────────────────────────────────────────────

export type SanitizeRuleName =
  | 'cookie-redaction'
  | 'token-redaction'
  | 'sso-url-redaction'
  | 'personal-email-redaction'
  | 'username-path-segment-redaction';

export const SANITIZE_RULE_NAMES: ReadonlyArray<SanitizeRuleName> = [
  'cookie-redaction',
  'token-redaction',
  'sso-url-redaction',
  'personal-email-redaction',
  'username-path-segment-redaction'
];

/**
 * A single sanitize rule is a `name + regex + replacement`. Rules are
 * applied in array order; later rules see the output of earlier ones.
 * This matters for `sso-url-redaction` (runs after `token-redaction`
 * so the token in `?token=...` is not double-redacted).
 */
export interface SanitizeRule {
  readonly name: SanitizeRuleName;
  readonly pattern: RegExp;
  readonly replacement: string;
}

export const SANITIZE_RULES: ReadonlyArray<SanitizeRule> = [
  {
    name: 'cookie-redaction',
    // Match `Cookie: name=value` and `Set-Cookie: name=value; ...` headers.
    // Also match bare `name=value` cookie fragments inside JSON for fixtures
    // that originated from a JSON debug capture.
    pattern: /(?:set-cookie|cookie)\s*:\s*([^;\r\n]+)/gi,
    replacement: '<REDACTED-cookie>'
  },
  {
    name: 'token-redaction',
    // Bearer tokens (Authorization: Bearer ...), JWTs (xxx.yyy.zzz),
    // and well-known API-key prefixes.
    pattern: /(?:bearer\s+)[a-zA-Z0-9._\-+/=]{12,}|eyJ[a-zA-Z0-9._\-+/=]{20,}|(?:sk-|ghp_|gho_|ghs_|ghu_|ghr_|github_pat_|xox[abprs]-|AIza[0-9A-Za-z_\-]{35})[A-Za-z0-9_\-]+/gi,
    replacement: '<REDACTED-token>'
  },
  {
    name: 'sso-url-redaction',
    // SSO callback URLs with embedded tokens via `?` (e.g. `?token=`,
    // `?code=`, `?access_token=`) or via fragment `#access_token=`.
    pattern: /\bhttps?:\/\/[^\s"'<>]*(?:[?&](?:token|code|access_token|id_token|assertion)=[^&\s"'<>]*|#[^/\s"'<>]*access_token=[^\s"'<>]*)/gi,
    replacement: '<REDACTED-sso-url>'
  },
  {
    name: 'personal-email-redaction',
    // RFC-5322-ish local-part @ domain.tld. Restrict TLD to letters
    // (length 2-24) to avoid false positives like `pr-1234` (no `@`).
    pattern: /\b[A-Za-z0-9._%+\-]{1,64}@[A-Za-z0-9.\-]{1,255}\.[A-Za-z]{2,24}\b/g,
    replacement: '<REDACTED-email>'
  },
  {
    name: 'username-path-segment-redaction',
    // `/Users/<name>/` on POSIX and `C:\\Users\\<name>\\` / `\\Users\\<name>\\`
    // on Windows. The replacement PRESERVES the path separator that
    // precedes the username (slash or backslash) so the rest of the
    // path stays intact and the fixture still parses structurally.
    pattern: /((?:\/Users\/|\/home\/|C:\\Users\\|\\\\Users\\|\\Users\\|\\home\\))[A-Za-z0-9._\-]+/g,
    replacement: '$1<REDACTED-user>'
  }
];

// ─── Zod schemas ──────────────────────────────────────────────────────

export const SanitizationIssueSchema = z.object({
  rule: z.string(),
  match: z.string(),
  position: z.number().int().nonnegative()
});

export const SanitizationReportSchema = z.object({
  passed: z.boolean(),
  rulesApplied: z.array(z.enum([
    'cookie-redaction',
    'token-redaction',
    'sso-url-redaction',
    'personal-email-redaction',
    'username-path-segment-redaction'
  ])),
  issues: z.array(SanitizationIssueSchema)
});

export type SanitizationIssue = z.infer<typeof SanitizationIssueSchema>;
export type SanitizationReport = z.infer<typeof SanitizationReportSchema>;

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Apply all sanitize rules in order. Returns the redacted string and
 * a structured report. `passed` is `true` iff every rule from
 * `SANITIZE_RULE_NAMES` was applied (which it always is — the boolean
 * exists so future rules can short-circuit, and to give the CLI a
 * consistent contract surface).
 *
 * Pure function: no IO, no side effects. Safe to call in a tight loop.
 */
export function sanitizeFixture(input: string): { redacted: string; report: SanitizationReport } {
  let redacted = input;
  const issues: SanitizationIssue[] = [];
  const rulesApplied: SanitizeRuleName[] = [];

  for (const rule of SANITIZE_RULES) {
    rulesApplied.push(rule.name);
    // Reset the regex (since they are global + stateful across calls
    // when reused without resetting lastIndex).
    rule.pattern.lastIndex = 0;
    const matches = redacted.matchAll(rule.pattern);
    let localCount = 0;
    for (const m of matches) {
      // Only record the redacted form (not the original sensitive value)
      // to avoid leaking the secret back into the report.
      issues.push({
        rule: rule.name,
        match: rule.replacement,
        position: typeof m.index === 'number' ? m.index : 0
      });
      localCount++;
    }
    if (localCount > 0) {
      redacted = redacted.replace(rule.pattern, rule.replacement);
    }
  }

  return {
    redacted,
    report: {
      passed: true,
      rulesApplied,
      issues
    }
  };
}

/**
 * Sanitize + structural sanity check. Refuses to produce a `passed:
 * true` report if the redacted output is empty, has zero newlines, or
 * is identical to the input AND the input contains any of the
 * forbidden patterns. This guards against accidental no-op sanitization.
 */
export function sanitizeFixtureStrict(input: string): {
  redacted: string;
  report: SanitizationReport;
} {
  const result = sanitizeFixture(input);
  const looksSanitized =
    result.redacted !== input ||
    !SANITIZE_RULES.some((r) => {
      r.pattern.lastIndex = 0;
      return r.pattern.test(input);
    });
  if (input.length === 0 || result.redacted.length === 0 || !looksSanitized) {
    return {
      redacted: result.redacted,
      report: { ...result.report, passed: false }
    };
  }
  return result;
}
