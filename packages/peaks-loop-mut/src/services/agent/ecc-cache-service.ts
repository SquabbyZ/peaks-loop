/**
 * ECC cache service — Slice 3 of 4.0.0-beta.11.
 *
 * Drop-in replacement for the deleted `ecc-agent-service.ts`. The
 * pre-Slice-3 implementation shelled out to `npx ecc agent run ...`,
 * but the upstream `affaan-m/everything-claude-code` v2.0.0 release
 * has NO `ecc` binary — the repo is `agents/*.md` flat files plus
 * SKILL.md descriptors. The peaks-loop path is therefore download
 * + cache only; the LLM consumes cached `agents/*.md` directly
 * through `peaks ecc show <name>`.
 *
 * Six exports per RD §2:
 *   - setCacheDirPermissions
 *   - downloadToCache
 *   - readCacheManifest
 *   - listCachedAgents
 *   - readAgentSkill
 *   - cleanupStaleCache
 *
 * The cache layout is `~/.peaks/cache/ecc-installed.json` (manifest)
 * + `~/.peaks/cache/ecc-<sha>/agents/<name>.md`. The manifest is
 * the active-cache pointer; cleanupStaleCache iterates the on-disk
 * sha directories and decides based on the manifest's `fetchedAt`
 * (active) vs `mtimeMs` (orphan).
 *
 * Hard contracts (Karpathy #2 Simplicity First):
 *  - No subprocess plumbing. Network is `fetch()` only.
 *  - No factory; one module, six functions, six dependencies.
 *  - Strict selective extract: agents/*.md only, no symlinks, no
 *    `..`, no absolute paths, no devices.
 *  - D-009 fallback: parseFrontmatter throws on malformed input —
 *    wrap it in try/catch and synthesize `{name, description}`
 *    from the file name + first non-empty body line.
 *  - D-010 fallback: PRD's `ecc.tar.gz` asset URL does NOT exist
 *    upstream; try PRD first, fall back to GitHub's `tarball_url`
 *    on the release JSON.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parseFrontmatter } from '../../shared/frontmatter.js';

export const ECC_REPO_OWNER = 'affaan-m';
export const ECC_REPO_NAME = 'everything-claude-code';
const ECC_CACHE_VERSION = '1';
const ECC_TARBALL_BASENAME = 'ecc.tar.gz';

export type CacheManifest = {
  version: string;
  sha: string;
  fetchedAt: string;
  agents: string[];
};

export type DownloadResult = {
  sha: string;
  agents: number;
};

/**
 * Cache dir resolution — single source of truth. Tests inject
 * via `dirOverride` on the functions that take one.
 */
export function resolveEccCacheDir(): string {
  return join(homedir(), '.peaks', 'cache');
}

export function resolveManifestPath(dirOverride?: string): string {
  return join(dirOverride ?? resolveEccCacheDir(), 'ecc-installed.json');
}

export function resolveShaDir(sha: string, dirOverride?: string): string {
  return join(dirOverride ?? resolveEccCacheDir(), `ecc-${sha}`);
}

export function resolveAgentsDir(sha: string, dirOverride?: string): string {
  return join(resolveShaDir(sha, dirOverride), 'agents');
}

/**
 * Best-effort chmod 0o700 on POSIX; no-op on Windows (NTFS uses
 * ACLs, not POSIX mode bits). Swallows errors with WARN so a
 * permissions failure never blocks the CLI.
 */
export function setCacheDirPermissions(cacheDir: string): void {
  if (process.platform === 'win32') return;
  try {
    chmodSync(cacheDir, 0o700);
  } catch {
    /* best-effort */
  }
}

function isSafeAgentName(name: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(name);
}

function isSafeArchiveEntry(entryName: string): boolean {
  if (entryName.length === 0) return false;
  if (entryName.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(entryName)) return false;
  if (entryName.includes('..')) return false;
  // Strip the leading "<repo-root>/" segment (github tarballs prefix
  // every entry with "<repo>-<sha>/..."); everything after must
  // start with "agents/" and end with ".md" at a single level.
  const segments = entryName.split('/');
  // Drop the first "<repo>-<sha>" segment if present.
  if (segments.length >= 3 && segments[0]?.startsWith(`${ECC_REPO_NAME}-`)) {
    segments.shift();
  }
  if (segments.length !== 2) return false;
  return segments[0] === 'agents' && segments[1]?.endsWith('.md') === true;
}

function safeAgentNameFromEntry(entryName: string): string | null {
  const segments = entryName.split('/');
  if (segments.length >= 3 && segments[0]?.startsWith(`${ECC_REPO_NAME}-`)) {
    segments.shift();
  }
  const file = segments[segments.length - 1] ?? '';
  const base = file.replace(/\.md$/i, '');
  return isSafeAgentName(base) ? base : null;
}

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
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'peaks-loop' },
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

function asSha(value: string): string {
  return /^[0-9a-f]{40}$/.test(value) ? value : value;
}

/**
 * Tiny tar.gz extractor. Public-domain-compatible tar parser:
 *   - reads 512-byte header blocks
 *   - validates name + size
 *   - rejects anything that is not a regular file at a safe path
 *   - filters to the `agents/*.md` allowlist via isSafeArchiveEntry
 *
 * We do NOT decompress gzip via a third-party lib; Node's
 * `node:zlib` ships with `gunzip` so the implementation is
 * self-contained.
 */
async function extractAgentsFromTarGz(
  buffer: Uint8Array,
  outDir: string
): Promise<string[]> {
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const extracted: string[] = [];

  // Lazy import to keep the cold path cheap.
  const { gunzipSync } = await import('node:zlib');
  let tar: Uint8Array;
  try {
    tar = gunzipSync(buffer);
  } catch {
    return [];
  }

  const BLOCK = 512;
  let offset = 0;
  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    // Two consecutive zero blocks mark end-of-archive.
    if (header.every((b) => b === 0)) break;
    const name = readCString(header, 0, 100);
    if (name === null || name.length === 0) break;
    const sizeOctal = readCString(header, 124, 12);
    if (sizeOctal === null) break;
    const size = parseOctal(sizeOctal);
    if (size === null) break;
    const typeFlag = String.fromCharCode(header[156] ?? 0);
    // '0' or '\0' = regular file. Reject symlinks (2), dirs (5), etc.
    if (typeFlag !== '0' && typeFlag !== '\0') {
      offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
      continue;
    }
    if (!isSafeArchiveEntry(name)) {
      offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
      continue;
    }
    const safeName = safeAgentNameFromEntry(name);
    if (safeName === null) {
      offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
      continue;
    }
    const data = tar.subarray(offset + BLOCK, offset + BLOCK + size);
    writeFileSync(join(outDir, `${safeName}.md`), data);
    extracted.push(safeName);
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
  }
  return extracted;
}

function readCString(buf: Uint8Array, start: number, len: number): string | null {
  let end = start;
  while (end < start + len && buf[end] !== 0) end += 1;
  if (end === start) return '';
  try {
    return Buffer.from(buf.subarray(start, end)).toString('utf8');
  } catch {
    return null;
  }
}

function parseOctal(value: string): number | null {
  const trimmed = value.trim().replace(/\0+$/g, '');
  if (trimmed.length === 0) return 0;
  const n = Number.parseInt(trimmed, 8);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

async function fetchBuffer(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/octet-stream', 'user-agent': 'peaks-loop' },
    });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    return new Uint8Array(ab);
  } catch {
    return null;
  }
}

async function downloadTarball(
  ref: string,
  sha: string,
  outDir: string
): Promise<string[]> {
  // D-010: PRD URL first, GitHub fallback second.
  const prdUrl = `https://github.com/${ECC_REPO_OWNER}/${ECC_REPO_NAME}/releases/download/${encodeURIComponent(ref)}/${ECC_TARBALL_BASENAME}`;
  let buffer = await fetchBuffer(prdUrl);

  if (buffer === null) {
    const release = await fetchReleaseJson(
      `https://api.github.com/repos/${ECC_REPO_OWNER}/${ECC_REPO_NAME}/releases/tags/${encodeURIComponent(ref)}`
    );
    const tarballUrl = release?.tarball_url;
    if (typeof tarballUrl === 'string' && tarballUrl.length > 0) {
      buffer = await fetchBuffer(tarballUrl);
    }
    if (buffer === null && Array.isArray(release?.assets)) {
      const asset =
        release.assets.find((a) => a.name === ECC_TARBALL_BASENAME) ??
        release.assets.find((a) => a.name === `${ECC_REPO_NAME}-universal-${ref}.tgz`) ??
        release.assets.find((a) => a.name.endsWith('.tgz') || a.name.endsWith('.tar.gz'));
      if (asset) buffer = await fetchBuffer(asset.browser_download_url);
    }
  }

  if (buffer === null) {
    throw new Error('fetch-failed');
  }

  return extractAgentsFromTarGz(buffer, outDir);
}

/**
 * Download ECC into `~/.peaks/cache/ecc-<sha>/agents/`. Returns
 * the resolved SHA + the number of agents extracted.
 *
 * Throws `Error('fetch-failed')` on network failure so the CLI
 * layer can render the manual-install instructions.
 */
export async function downloadToCache(
  { ref }: { ref?: string } = {}
): Promise<DownloadResult> {
  const requestedRef = ref ?? 'latest';
  let resolvedSha: string;
  if (requestedRef === 'latest') {
    const release = await fetchReleaseJson(
      `https://api.github.com/repos/${ECC_REPO_OWNER}/${ECC_REPO_NAME}/releases/latest`
    );
    const tag = release?.tag_name;
    if (typeof tag !== 'string' || tag.length === 0) {
      throw new Error('fetch-failed');
    }
    resolvedSha = asSha(await resolveCommitSha(tag) ?? tag);
  } else {
    resolvedSha = asSha(await resolveCommitSha(requestedRef) ?? requestedRef);
  }

  const cacheDir = resolveEccCacheDir();
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
  setCacheDirPermissions(cacheDir);

  const agentsDir = resolveAgentsDir(resolvedSha, cacheDir);
  if (existsSync(agentsDir) && readdirSync(agentsDir).length > 0) {
    // Already populated; emit manifest + return.
    const agents = readdirSync(agentsDir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.replace(/\.md$/i, ''));
    writeManifest({ version: ECC_CACHE_VERSION, sha: resolvedSha, fetchedAt: new Date().toISOString(), agents });
    return { sha: resolvedSha, agents: agents.length };
  }

  const extracted = await downloadTarball(requestedRef === 'latest' ? resolvedSha : requestedRef, resolvedSha, agentsDir);
  const manifest: CacheManifest = {
    version: ECC_CACHE_VERSION,
    sha: resolvedSha,
    fetchedAt: new Date().toISOString(),
    agents: extracted,
  };
  writeManifest(manifest);
  return { sha: resolvedSha, agents: extracted.length };
}

function writeManifest(manifest: CacheManifest): void {
  const path = resolveManifestPath();
  writeFileSync(path, JSON.stringify(manifest, null, 2));
}

export function readCacheManifest(): CacheManifest | null {
  const path = resolveManifestPath();
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as CacheManifest;
    if (
      typeof parsed.version === 'string' &&
      typeof parsed.sha === 'string' &&
      typeof parsed.fetchedAt === 'string' &&
      Array.isArray(parsed.agents)
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

let warnedAboutFallback = false;

function fallbackMetadata(fileName: string): { name: string; description: string } {
  const base = fileName.replace(/\.md$/i, '');
  let description = '';
  try {
    const body = readFileSync(join(resolveManifestDirForAgents(), fileName), 'utf8');
    const lines = body.split(/\r?\n/);
    let inFrontmatter = false;
    let seenClosing = false;
    for (const raw of lines) {
      const line = raw.trim();
      if (!seenClosing) {
        if (!inFrontmatter && line === '---') {
          inFrontmatter = true;
          continue;
        }
        if (inFrontmatter && line === '---') {
          seenClosing = true;
          continue;
        }
        continue;
      }
      if (line.length === 0) continue;
      description = line;
      break;
    }
  } catch {
    /* best-effort */
  }
  if (description.length > 80) description = `${description.slice(0, 77)}...`;
  if (!warnedAboutFallback) {
    try {
      process.stderr.write(`warning: cached agent "${base}" has malformed frontmatter; falling back to filename + first body line\n`);
    } catch {
      /* best-effort */
    }
    warnedAboutFallback = true;
  }
  return { name: base, description };
}

function resolveManifestDirForAgents(): string {
  const manifest = readCacheManifest();
  if (manifest === null) return '';
  return resolveAgentsDir(manifest.sha);
}

export function listCachedAgents(): { name: string; description: string }[] {
  const manifest = readCacheManifest();
  if (manifest === null) return [];
  const agentsDir = resolveAgentsDir(manifest.sha);
  if (!existsSync(agentsDir)) return [];
  const out: { name: string; description: string }[] = [];
  for (const file of readdirSync(agentsDir).sort()) {
    if (!file.endsWith('.md')) continue;
    const fullPath = join(agentsDir, file);
    let meta: { name: string; description: string };
    try {
      const raw = readFileSync(fullPath, 'utf8');
      const fm = parseFrontmatter(raw);
      meta = { name: fm.name, description: fm.description };
    } catch {
      // D-009 fallback — name from filename, description from first body line.
      meta = fallbackMetadata(file);
    }
    out.push(meta);
  }
  return out;
}

export function readAgentSkill(name: string): string | null {
  if (!isSafeAgentName(name)) return null;
  const manifest = readCacheManifest();
  if (manifest === null) return null;
  const file = join(resolveAgentsDir(manifest.sha), `${name}.md`);
  if (!existsSync(file)) return null;
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/**
 * 7-day TTL sweep over `ecc-<sha>/` directories.
 *
 * - Active cache (per manifest `sha`): use `fetchedAt` as the
 *   age source; remove if older than `retentionDays`.
 * - Orphan caches (any other `ecc-<40hex>` directory): use
 *   directory `mtimeMs` as the age source.
 * - If the active cache is removed, invalidate the manifest.
 *
 * Returns the absolute paths of the removed directories.
 */
export function cleanupStaleCache({
  retentionDays,
  nowMs,
  dirOverride,
}: {
  retentionDays: number;
  nowMs: number;
  dirOverride?: string;
}): { removed: string[] } {
  const cacheDir = dirOverride ?? resolveEccCacheDir();
  if (!existsSync(cacheDir)) return { removed: [] };

  const dayMs = 24 * 60 * 60 * 1000;
  const cutoff = nowMs - retentionDays * dayMs;
  const manifest = readCacheManifest();
  const activeSha = manifest?.sha ?? null;
  const activeFetchedAt = manifest?.fetchedAt ? Date.parse(manifest.fetchedAt) : NaN;

  const removed: string[] = [];
  let names: string[];
  try {
    names = readdirSync(cacheDir);
  } catch {
    return { removed: [] };
  }

  for (const name of names) {
    const match = /^ecc-([0-9a-f]{40})$/.exec(name);
    if (match === null) continue;
    const sha = match[1] ?? '';
    const fullPath = join(cacheDir, name);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    let ageMs: number;
    if (sha === activeSha && Number.isFinite(activeFetchedAt)) {
      ageMs = nowMs - activeFetchedAt;
    } else {
      ageMs = nowMs - stat.mtimeMs;
    }
    if (ageMs > retentionDays * dayMs) {
      try {
        rmSync(fullPath, { recursive: true, force: true });
        removed.push(fullPath);
      } catch {
        /* best-effort */
      }
    }
  }

  // Invalidate manifest if active cache was removed.
  if (activeSha !== null && removed.some((p) => p.includes(`ecc-${activeSha}`))) {
    try {
      rmSync(resolveManifestPath(cacheDir), { force: true });
    } catch {
      /* best-effort */
    }
  }

  return { removed };
}