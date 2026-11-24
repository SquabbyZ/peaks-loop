/**
 * URL text for a refusal message, and URL identity for a self-compare guard.
 *
 * A refused URL can carry `user:pass@` userinfo (the trust boundary rejects it,
 * but the refusal still quotes the value). Evidence persists those messages, so
 * the credentials must never be echoed: `redactUrl` keeps the host, port and
 * path a reader needs to fix the problem and drops the userinfo (CWE-532).
 *
 * `normalizedUrl` answers "is this the same address?" with WHATWG parsing, so
 * `http://127.0.0.1:4311` and `http://127.0.0.1:4311/` are the same URL. A
 * fidelity comparison between two spellings of one address measures a page
 * against itself and always reports a perfect score.
 */

const SCHEME_PREFIX = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const AUTHORITY_END = /[/?#]/;

/**
 * Mask a `<user>:<pass>@` shape in text, masking only the authority segment.
 *
 * The authority starts after `//` (or after the scheme colon when there is no
 * `//`, which is how an opaque `scheme:user:pass@host` parses), and ends at
 * the first `/`, `?` or `#`. In a `//` authority an `@` alone is userinfo —
 * `http://user@host:99999/` is malformed but still names a user — so it is
 * masked regardless of a colon. In an opaque form the `@` may belong to the
 * path, so only a `<user>:<pass>@` shape (a colon before the `@`) is masked.
 * `***@` replaces from the authority start through the `@`, so no user or
 * password character survives while the scheme and the rest of the URL do.
 */
function maskUserinfo(value: string): string {
  const scheme = SCHEME_PREFIX.exec(value);
  const afterScheme = scheme === null ? 0 : scheme[0].length;
  const hasSlashes = value.startsWith('//', afterScheme);
  const authorityStart = hasSlashes ? afterScheme + 2 : afterScheme;
  const endMatch = AUTHORITY_END.exec(value.slice(authorityStart));
  const authorityEnd = endMatch === null ? value.length : authorityStart + endMatch.index;
  const at = value.indexOf('@', authorityStart);
  if (at === -1 || at >= authorityEnd) return value;
  if (!hasSlashes && !value.slice(authorityStart, at).includes(':')) return value;
  return `${value.slice(0, authorityStart)}***@${value.slice(at + 1)}`;
}

/**
 * The URL without its userinfo, masked in text whether or not it parses.
 *
 * A well-formed URL loses its WHATWG username/password. Two shapes need the
 * textual pass as well: a malformed URL (an out-of-range port, a broken IPv6
 * literal) fails parsing but can still carry `user:pass@` in its authority,
 * and an opaque URL (`some-scheme:user:pass@host`) parses with NO userinfo
 * while its text still spells one. `maskUserinfo` rewrites a
 * `<user>:<pass>@` shape to `***@` in every branch, so neither can echo a
 * credential into the evidence. A credential-free input is returned exactly
 * as written.
 */
export function redactUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return maskUserinfo(value);
  }
  if (parsed.username === '' && parsed.password === '') return maskUserinfo(value);
  parsed.username = '';
  parsed.password = '';
  return maskUserinfo(parsed.toString());
}

/** The canonical form of a URL, or null when it does not parse. */
export function normalizedUrl(value: string): string | null {
  let href: string | null = null;
  try {
    href = new URL(value).href;
  } catch {
    href = null;
  }
  return href;
}
