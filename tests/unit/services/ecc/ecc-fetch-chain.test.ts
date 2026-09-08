// 2026-09-09-ecc-install-fetch-fix — pins the D-010 download chain.
//
// Regression: `fetchBuffer` forced `accept: application/octet-stream`, which
// GitHub's `api.github.com/.../tarball/<ref>` endpoint rejects with 415, so
// the tarball_url fallback was dead. Combined with a PRD `ecc.tar.gz` URL
// that 404s upstream (v2.2.0 ships only .png assets), `peaks ecc install`
// could never succeed.
//
// These tests stub `fetch` (no real network) and mock `node:os#homedir` so
// `downloadToCache` writes into a tmp home.

import { gzipSync } from 'node:zlib';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { homeDirRef } = vi.hoisted(() => ({ homeDirRef: { value: '' } }));

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => homeDirRef.value };
});

const { downloadToCache, ECC_REPO_NAME } = await import(
  '../../../../packages/peaks-loop-mut/src/services/agent/ecc-cache-service.js'
);

const TAG = 'v2.2.0';
const ROOT = 'affaan-m-ECC-deadbeef'; // api.github.com tarball root shape
const PRD_ASSET_URL = `https://github.com/affaan-m/ECC/releases/download/${TAG}/ecc.tar.gz`;
const ASSET_URL = `https://github.com/affaan-m/ECC/releases/download/${TAG}/ECC-universal-${TAG}.tgz`;

type Call = { url: string; accept: string | undefined };

let calls: Call[] = [];
let roots: string[] = [];

function tmpRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-ecc-fetch-'));
  roots.push(root);
  return root;
}

// --- minimal tar.gz builder (header + body, no checksum validation) --------

function tarHeader(name: string, size: number): Uint8Array {
  const enc = new TextEncoder();
  const block = new Uint8Array(512);
  block.set(enc.encode(name).slice(0, 100), 0);
  block.set(enc.encode(`${size.toString(8).padStart(11, '0')}\0`), 124);
  block[156] = '0'.charCodeAt(0); // regular file
  block.set(enc.encode('ustar\0'), 257);
  block.set(enc.encode('00'), 263);
  return block;
}

function makeTarGz(entries: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const [name, body] of Object.entries(entries)) {
    const data = enc.encode(body);
    chunks.push(tarHeader(name, data.length), data, new Uint8Array((512 - (data.length % 512)) % 512));
  }
  chunks.push(new Uint8Array(1024)); // end-of-archive
  const tar = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    tar.set(chunk, offset);
    offset += chunk.length;
  }
  return new Uint8Array(gzipSync(tar));
}

const TARBALL = makeTarGz({
  [`${ROOT}/agents/code-review.md`]: '# Code review\n\nbody',
  [`${ROOT}/agents/security-review.md`]: '# Security review\n\nbody',
  [`${ROOT}/README.md`]: 'not an agent'
});

// --- fetch stub ------------------------------------------------------------

type Route = { status?: number; body?: Uint8Array | unknown };

function stubFetch(routes: Record<string, Route>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { headers?: Record<string, string> }) => {
      const url = String(input);
      calls.push({ url, accept: init?.headers?.accept });
      const route = routes[url];
      if (route === undefined) return new Response('', { status: 404 });
      const status = route.status ?? 200;
      if (status !== 200) return new Response('', { status });
      const body = route.body;
      if (body instanceof Uint8Array) return new Response(body, { status });
      return new Response(JSON.stringify(body ?? {}), {
        status,
        headers: { 'content-type': 'application/json' }
      });
    })
  );
}

const LATEST_URL = `https://api.github.com/repos/affaan-m/${ECC_REPO_NAME}/releases/latest`;
const TAGS_URL = `https://api.github.com/repos/affaan-m/${ECC_REPO_NAME}/releases/tags/${TAG}`;
const TARBALL_URL = `https://api.github.com/repos/affaan-m/${ECC_REPO_NAME}/tarball/${TAG}`;

function releaseBody(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { tag_name: TAG, tarball_url: TARBALL_URL, assets: [], ...extra };
}

beforeEach(() => {
  calls = [];
  homeDirRef.value = tmpRoot();
});

afterEach(() => {
  vi.unstubAllGlobals();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

describe('downloadToCache D-010 chain', () => {
  it('leads with tarball_url and never sends application/octet-stream', async () => {
    stubFetch({
      [LATEST_URL]: { body: releaseBody() },
      [TAGS_URL]: { body: releaseBody() },
      [TARBALL_URL]: { body: TARBALL }
    });

    const result = await downloadToCache();

    expect(result).toEqual({ sha: TAG, agents: 2 });
    const tarballCall = calls.find((c) => c.url === TARBALL_URL);
    expect(tarballCall?.accept).toBe('application/vnd.github+json');
    expect(calls.some((c) => c.accept === 'application/octet-stream')).toBe(false);
    // Winner is the API tarball — no asset, no PRD URL touched.
    expect(calls.some((c) => c.url === PRD_ASSET_URL)).toBe(false);
    expect(calls.some((c) => c.url === ASSET_URL)).toBe(false);
    // Extractor strips the synthetic root and keeps only agents/*.md.
    const materialized = readdirSync(join(homeDirRef.value, '.peaks', 'agents', 'ecc'))
      .filter((f) => f.endsWith('.md'))
      .sort();
    expect(materialized).toEqual(['code-review.md', 'security-review.md']);
    expect(existsSync(join(homeDirRef.value, '.claude'))).toBe(false);
  });

  it('falls back to a release asset when tarball_url is rejected (415)', async () => {
    stubFetch({
      [LATEST_URL]: { body: releaseBody() },
      [TAGS_URL]: {
        body: releaseBody({ assets: [{ name: `ECC-universal-${TAG}.tgz`, browser_download_url: ASSET_URL }] })
      },
      [TARBALL_URL]: { status: 415 },
      [ASSET_URL]: { body: TARBALL }
    });

    const result = await downloadToCache();

    expect(result).toEqual({ sha: TAG, agents: 2 });
    expect(calls.some((c) => c.url === ASSET_URL)).toBe(true);
    expect(calls.some((c) => c.url === PRD_ASSET_URL)).toBe(false);
  });

  it('uses the PRD asset URL only as last resort, with the renamed repo', async () => {
    stubFetch({
      [LATEST_URL]: { body: releaseBody() },
      [TAGS_URL]: { body: releaseBody({ assets: [] }) },
      [TARBALL_URL]: { status: 415 },
      [PRD_ASSET_URL]: { body: TARBALL }
    });

    const result = await downloadToCache();

    expect(result).toEqual({ sha: TAG, agents: 2 });
    expect(calls.some((c) => c.url === PRD_ASSET_URL)).toBe(true);
    expect(calls.filter((c) => c.url === TARBALL_URL)).toHaveLength(1);
  });

  it('throws fetch-failed only after all three paths fail', async () => {
    stubFetch({
      [LATEST_URL]: { body: releaseBody() },
      [TAGS_URL]: { body: releaseBody({ assets: [] }) },
      [TARBALL_URL]: { status: 415 },
      [PRD_ASSET_URL]: { status: 404 }
    });

    await expect(downloadToCache()).rejects.toThrow('fetch-failed');
    expect(calls.some((c) => c.url === TARBALL_URL)).toBe(true);
    expect(calls.some((c) => c.url === PRD_ASSET_URL)).toBe(true);
  });

  it('pins the upstream repo rename to ECC', () => {
    expect(ECC_REPO_NAME).toBe('ECC');
  });
});
