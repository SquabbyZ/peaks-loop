/**
 * Secret redaction for peaks-loop JSONL log lines.
 *
 * Slice 2026-06-16-cli-logging (G6). The logger must NEVER write
 * a raw secret to disk. We redact at two levels:
 *  1. Field level — when a structured payload contains a key whose
 *     name matches a secret pattern (`api_key`, `password`, `token`,
 *     `Authorization`, etc.), the value is replaced with `<redacted>`.
 *  2. Line level — when a free-form string contains patterns like
 *     `Authorization: Bearer <token>`, `api_key=<value>`, or
 *     `password="<value>"`, the token-shaped value is replaced.
 *
 * Redaction is intentionally conservative: false positives are
 * acceptable (a user can read a redacted line); false negatives are
 * NOT (a leaked token may be pasted into a GitHub issue).
 *
 * The PRD lists the redaction triggers; this module is the only
 * place the regex table lives, so any future addition (e.g. a new
 * `client_secret` key) is a one-line change.
 */

const SECRET_KEY_PATTERN = /^(?:.*[\._-])?(api[_-]?key|apikey|api[_-]?secret|secret|password|passwd|token|authorization|access[_-]?token|refresh[_-]?token|cookie|set[_-]?cookie|client[_-]?secret)$/i;

/**
 * Returns true when the given key name should be treated as a
 * secret regardless of the value's shape. Case-insensitive.
 */
export function isSecretKey(key: unknown): boolean {
  if (typeof key !== 'string' || key.length === 0) return false;
  return SECRET_KEY_PATTERN.test(key);
}

/**
 * Heuristic: a string value that looks like a credential-shaped
 * token (Bearer, github_pat_, ghp_, sk_, long opaque base64) is
 * redacted. Short, human-readable strings (a name, a command name)
 * are left alone.
 */
const TOKEN_VALUE_PATTERN = /^(?:Bearer\s+[A-Za-z0-9._\-+/=]{8,}|ghp_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-[A-Za-z0-9]{16,}|[A-Za-z0-9_\-]{32,})$/;

const REDACTED = '<redacted>';

/**
 * Redact a single string value. Returns the original string when
 * it does not look like a credential; returns `<redacted>` when it
 * does. Empty / non-strings return as-is.
 */
export function redactValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (value.length === 0) return value;
  if (TOKEN_VALUE_PATTERN.test(value)) return REDACTED;
  return value;
}

/**
 * Line-level redaction. Replaces `key=value`, `key="value"`, and
 * `key: value` substrings whose key matches the secret pattern.
 * Preserves non-secret lines verbatim.
 */
const LINE_KEY_VALUE_PATTERN = new RegExp(
  String.raw`((?:api[_-]?key|apikey|secret|password|passwd|token|access[_-]?token|refresh[_-]?token|client[_-]?secret))` +
  String.raw`\s*[=:]\s*` +
  String.raw`(?:"([^"]*)"|'([^']*)'|([^\s,;"'` +
  String.raw`` +
  String.raw`]+))`,
  'gi'
);

const AUTH_HEADER_PATTERN = /Authorization\s*:\s*Bearer\s+[A-Za-z0-9._\-+/=]+/gi;

export function redactLine(line: string): string {
  if (typeof line !== 'string' || line.length === 0) return line;
  let out = line;
  out = out.replace(AUTH_HEADER_PATTERN, (match) => {
    return match.replace(/Bearer\s+[A-Za-z0-9._\-+/=]+/, `Bearer ${REDACTED}`);
  });
  out = out.replace(LINE_KEY_VALUE_PATTERN, (_match, key, q1, q2, bare) => {
    if (q1 !== undefined) return `${key}=${REDACTED}`;
    if (q2 !== undefined) return `${key}=${REDACTED}`;
    if (bare !== undefined) {
      // For bare (unquoted) key=value pairs, any value longer than 4
      // chars is treated as a secret — these are config dumps where
      // the value is always opaque (the test fixture
      // `api_key=supersecret12345` is 19 chars; production secrets
      // are usually ≥ 16). This is conservative on purpose.
      if (bare.length >= 4) return `${key}=${REDACTED}`;
      return `${key}=${bare}`;
    }
    return _match;
  });
  return out;
}
