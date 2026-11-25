/**
 * The ONE sanitising seam every echoed audit value passes through (Task 6e).
 *
 * A CSS / inline value is untrusted repository content: it can carry a
 * credentials-bearing URL (`padding: var(--x) url(https://u:p@h/a)`), control
 * bytes (ESC, NUL) and an unbounded length. Those reach `humanText` /
 * `techText`, the persisted `design/audit-*.md` / `.json`, and the terminal.
 *
 * Applied at the finding boundary — `auditUnit` for every detector and the
 * contract-level contrast findings — so a NEW detector cannot bypass it by
 * forgetting to call a per-value helper.
 *
 * The order matters: URLs are redacted first, on the raw text, because a
 * control byte collapsed by `plainText` could otherwise hide the userinfo from
 * `redactUrl`'s authority scan. `plainText` then strips whole ANSI/OSC
 * sequences and remaining control bytes and collapses whitespace, and
 * `capDetail` bounds the echo (a 5 KB value cannot paste a file into the
 * evidence). A non-URL value is left intact: `redactUrl` returns it as written.
 */

import { capDetail, plainText } from '../evidence-text.js';
import { redactUrl } from '../url-redact.js';
import type { AuditFinding } from './audit-finding.js';

/**
 * A URL-shaped run inside a larger value. `scheme://…` and opaque
 * `scheme:…@…` shapes are matched, and so is a PROTOCOL-RELATIVE run (`//…@…`):
 * `url(//user:s3cret@host/a)` is a URL whose host is resolved at render time,
 * and its userinfo reached the finding, the markdown and the JSON when only a
 * scheme-qualified run was matched. The excluded characters stop each run at
 * the CSS/JS punctuation a URL is embedded in (`url(…)`, quotes, `;`, commas);
 * `redactUrl` leaves a run with no `@` in its authority exactly as written, so
 * an ordinary `//` in a value survives the pass unchanged.
 */
const URL_IN_TEXT = /\b[A-Za-z][A-Za-z0-9+.-]*:[^\s"'`<>();,]+|\/\/[^\s"'`<>();,]+/g;

function maskUrlsInText(text: string): string {
  return text.replace(URL_IN_TEXT, (token) => redactUrl(token));
}

/** One echoed value: userinfo masked, control bytes gone, length bounded. */
export function auditEcho(value: string): string {
  return capDetail(plainText(maskUrlsInText(value)));
}

/** A finding whose four echoed fields are safe to persist and print. */
export function sanitizeFinding(finding: AuditFinding): AuditFinding {
  return {
    ...finding,
    value: auditEcho(finding.value),
    expected: auditEcho(finding.expected),
    humanText: auditEcho(finding.humanText),
    techText: auditEcho(finding.techText)
  };
}

/** Every finding sanitised; idempotent, so a second pass cannot corrupt it. */
export function sanitizeFindings(findings: readonly AuditFinding[]): AuditFinding[] {
  return findings.map(sanitizeFinding);
}
