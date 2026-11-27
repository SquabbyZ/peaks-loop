/**
 * Classifying the two fidelity inputs before any capture runs. A URL must be
 * absolute http(s), carry no credentials, and sit inside the same trust
 * boundary the layout commands use (loopback, or the render URL recorded in
 * `design/engine.json`). Anything else is read as a local prototype file; a
 * path that cannot be read is refused rather than guessed at.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { readEngineContract } from './design-engine-deps.js';
import { sha256Hex } from './fidelity-evidence.js';
import { isLoopbackUrl, isTrustedDesignUrl } from './url-trust.js';

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const WINDOWS_DRIVE = /^[a-zA-Z]:[\\/]/;
const UNC_PREFIX = '\\\\';

function designRootOf(projectRoot: string, app: string | null): string {
  return join(projectRoot, app ?? '', 'design');
}

/** The same trust rule the layout commands use; an unreadable contract admits loopback. */
function trustedUrl(projectRoot: string, app: string | null, url: string): boolean {
  const engine = readEngineContract(designRootOf(projectRoot, app));
  return engine.ok ? isTrustedDesignUrl(url, engine.contract) : isLoopbackUrl(url);
}

export type CheckedUrl = { ok: true; url: string } | { ok: false; reason: string };

export function checkedUrl(raw: string, projectRoot: string, app: string | null): CheckedUrl {
  const value = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, reason: `${raw} is neither an absolute http(s) URL nor a local file` };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: `${raw} must use http or https` };
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return { ok: false, reason: 'a fidelity URL must not carry credentials' };
  }
  if (!trustedUrl(projectRoot, app, value)) {
    return {
      ok: false,
      reason: `${raw} is outside the trust boundary; use loopback or the recorded render URL`
    };
  }
  return { ok: true, url: value };
}

export type PrototypeSource =
  | { ok: true; kind: 'file'; ref: string; bytes: Buffer; sha256: string }
  | { ok: true; kind: 'url'; ref: string; url: string }
  | { ok: false; reason: string };

function looksLikeUrl(value: string): boolean {
  if (WINDOWS_DRIVE.test(value) || value.startsWith(UNC_PREFIX)) return false;
  return URL_SCHEME.test(value);
}

export function classifyPrototype(
  projectRoot: string,
  app: string | null,
  raw: string
): PrototypeSource {
  const value = raw.trim();
  if (looksLikeUrl(value)) {
    const checked = checkedUrl(value, projectRoot, app);
    return checked.ok
      ? { ok: true, kind: 'url', ref: value, url: checked.url }
      : { ok: false, reason: checked.reason };
  }
  const path = resolve(projectRoot, value);
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch {
    return { ok: false, reason: `${raw} is neither a readable local file nor an http(s) URL` };
  }
  return { ok: true, kind: 'file', ref: path, bytes, sha256: sha256Hex(bytes) };
}
