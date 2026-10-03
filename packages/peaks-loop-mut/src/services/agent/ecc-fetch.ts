/**
 * ECC network layer — release JSON fetch, SHA resolution and the D-010
 * tarball download chain (tarball_url -> release asset -> PRD asset URL),
 * including the accept-header rules that keep the API tarball alive.
 *
 * Split verbatim out of `ecc-cache-service.ts` (wave 11 slice A,
 * 2026-10-03); no behaviour changed.
 */

import {
  ECC_REPO_OWNER,
  ECC_REPO_NAME,
  ECC_TARBALL_BASENAME,
  GITHUB_API_ACCEPT
} from './ecc-cache-config.js';
import { extractAgentsFromTarGz } from './ecc-archive-safety.js';

/**
 * Best-effort fetch of the upstream release JSON. Returns the
 * parsed body, or null on any network/parse error. Used as the
 * D-010 fallback path.
 */
async function fetchReleaseJson(apiBase: string): Promise<{
  tag_name?: string;
  tarball_url?: string;
  assets?: { name: string; browser_download_url: string }[];
} | null> {
  try {
    const res = await fetch(apiBase, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'peaks-loop' }
    });
    if (!res.ok) return null;
    return (await res.json()) as {
      tag_name?: string;
      tarball_url?: string;
      assets?: { name: string; browser_download_url: string }[];
    };
  } catch {
    return null;
  }
}

/**
 * Resolve a 40-char commit SHA for `tag`. Prefers the GitHub
 * releases API (which dereferences annotated tags to commit SHA
 * via `target_commitish`). Falls back to the tag name if the
 * upstream returns a non-SHA-shaped identifier (older tags).
 */
async function resolveCommitSha(ref: string): Promise<string | null> {
  const apiBase = `https://api.github.com/repos/${ECC_REPO_OWNER}/${ECC_REPO_NAME}/releases/tags/${encodeURIComponent(ref)}`;
  const release = await fetchReleaseJson(apiBase);
  const tagName = release?.tag_name ?? ref;
  if (/^[0-9a-f]{40}$/.test(tagName)) return tagName;
  return tagName;
}

/**
 * Binary fetch with an explicit, overridable `accept`.
 *
 * Do NOT default to `application/octet-stream`: GitHub's
 * `api.github.com/.../tarball/<ref>` endpoint rejects it with 415.
 * Omitting `accept` entirely is fine for release-asset / codeload
 * URLs, which always serve the bytes.
 */
async function fetchBuffer(url: string, accept?: string): Promise<Uint8Array | null> {
  try {
    const headers: Record<string, string> = { 'user-agent': 'peaks-loop' };
    if (accept !== undefined) headers.accept = accept;
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    return new Uint8Array(ab);
  } catch {
    return null;
  }
}

async function downloadTarball(ref: string, sha: string, outDir: string): Promise<string[]> {
  // D-010 order (2026-09-09): tarball_url -> release asset -> PRD URL.
  // See the module header for why each step exists and which one works.
  let buffer: Uint8Array | null = null;

  const release = await fetchReleaseJson(
    `https://api.github.com/repos/${ECC_REPO_OWNER}/${ECC_REPO_NAME}/releases/tags/${encodeURIComponent(ref)}`
  );

  // 1. API tarball. Requires the GitHub JSON accept header (octet-stream 415s).
  const tarballUrl = release?.tarball_url;
  if (typeof tarballUrl === 'string' && tarballUrl.length > 0) {
    buffer = await fetchBuffer(tarballUrl, GITHUB_API_ACCEPT);
  }

  // 2. Release asset, if this release happens to ship one.
  if (buffer === null && Array.isArray(release?.assets)) {
    const asset =
      release.assets.find((a) => a.name === ECC_TARBALL_BASENAME) ??
      release.assets.find((a) => a.name === `${ECC_REPO_NAME}-universal-${ref}.tgz`) ??
      release.assets.find((a) => a.name.endsWith('.tgz') || a.name.endsWith('.tar.gz'));
    if (asset) buffer = await fetchBuffer(asset.browser_download_url);
  }

  // 3. PRD asset URL — last resort, dead upstream today.
  if (buffer === null) {
    const prdUrl = `https://github.com/${ECC_REPO_OWNER}/${ECC_REPO_NAME}/releases/download/${encodeURIComponent(ref)}/${ECC_TARBALL_BASENAME}`;
    buffer = await fetchBuffer(prdUrl);
  }

  if (buffer === null) {
    throw new Error('fetch-failed');
  }

  return extractAgentsFromTarGz(buffer, outDir);
}

// Cross-module glue: private inside ecc-cache-service.ts before the split.
export { fetchReleaseJson, resolveCommitSha, downloadTarball };
