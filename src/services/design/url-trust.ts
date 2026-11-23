/**
 * URL trust for the render check.
 *
 * A design URL is trusted only when it is loopback (`localhost`, `127.0.0.1`,
 * `[::1]`) or an EXACT match to the address the user explicitly recorded in
 * `engine.json`. A substring check would accept `https://localhost.evil.com`;
 * parsing the URL and comparing the hostname exactly does not. Credentials and
 * non-HTTP schemes are refused outright, so a recorded URL cannot smuggle a
 * `user:pass@` or `file://` past the loopback test.
 */

import type { EngineContractFile } from './engine-contract.js';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function unbracket(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
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
  if (LOOPBACK_HOSTS.has(unbracket(parsed.hostname))) return true;
  return engine.render.url !== null && url === engine.render.url;
}
