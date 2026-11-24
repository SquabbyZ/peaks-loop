/**
 * URL trust for the render check.
 *
 * A design URL is trusted only when it is loopback (`localhost`, `127.0.0.1`,
 * `[::1]`) or an EXACT match to a PUBLIC address the user explicitly recorded
 * in `engine.json`. A substring check would accept `https://localhost.evil.com`;
 * parsing the URL and comparing the hostname exactly does not. Credentials and
 * non-HTTP schemes are refused outright, so a recorded URL cannot smuggle a
 * `user:pass@` or `file://` past the loopback test. The recorded-URL escape
 * hatch is checked AFTER the private-network refusal: recording a
 * `http://192.168.x.x` must not launder a host the plan forbids.
 */

import type { EngineContractFile } from './engine-contract.js';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/** Numeric addresses a URL the user recorded may not name. */
const PRIVATE_IPV4 =
  /^(?:0|10|127|169\.254|172\.(?:1[6-9]|2\d|3[01])|192\.168|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7]))\./;

function unbracket(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

/** True for loopback-only-adjacent hosts: `.local`, unique-local, link-local. */
function isPrivateHost(hostname: string): boolean {
  const host = unbracket(hostname).toLowerCase();
  if (host === '::' || host.endsWith('.local')) return true;
  // Any other IPv6 literal is untrusted: WHATWG canonicalizes an IPv4-mapped
  // address to hex (`[::ffff:c0a8:105]`), so matching the mapped tail is easy to
  // get wrong. Loopback `::1` already returned above.
  if (host.includes(':')) return true;
  return PRIVATE_IPV4.test(host);
}

export function isTrustedDesignUrl(
  url: string,
  engine: Pick<EngineContractFile, 'render'>
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (parsed.username !== '' || parsed.password !== '') return false;
  const hostname = unbracket(parsed.hostname);
  if (LOOPBACK_HOSTS.has(hostname)) return true;
  if (isPrivateHost(hostname)) return false;
  return engine.render.url !== null && url === engine.render.url;
}

/** True only for `http(s)://localhost|127.0.0.1|[::1]…`, whatever the port. */
export function isLoopbackUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return LOOPBACK_HOSTS.has(unbracket(parsed.hostname));
  } catch {
    return false;
  }
}
