/**
 * Per spec §4.1 Step 2 / Task 10 — headroom-fetcher.
 *
 * Cache contract:
 *   - On cache hit, return the cached excerpt with the requested version.
 *   - On cache miss, fall back to the remote fetcher if provided.
 *   - On cache miss with no remote, return null.
 *
 * The cache path is per-session and per-dep:
 *   <cacheDir>/<dep>@<version>.md
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHeadroomFetcher } from '../../../../src/services/context/headroom-fetcher.js';

let cacheDir: string;

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), 'peaks-headroom-cache-'));
});

afterEach(() => {
  rmSync(cacheDir, { recursive: true, force: true });
});

describe('headroom-fetcher', () => {
  it('returns cached doc when version matches', async () => {
    writeFileSync(join(cacheDir, 'antd@5.21.0.md'), 'Form.Item API');
    const fetcher = createHeadroomFetcher({ cacheDir, remoteFetcher: async () => null });
    const result = await fetcher('antd', '5.21.0');
    expect(result).toEqual({ version: '5.21.0', excerpt: 'Form.Item API' });
  });

  it('returns null when cache miss + no remote', async () => {
    const fetcher = createHeadroomFetcher({ cacheDir, remoteFetcher: async () => null });
    const result = await fetcher('antd', '5.21.0');
    expect(result).toBeNull();
  });

  it('falls back to remoteFetcher on cache miss', async () => {
    const fetcher = createHeadroomFetcher({
      cacheDir,
      remoteFetcher: async (dep, version) => ({ version, excerpt: `Remote ${dep}` }),
    });
    const result = await fetcher('oauth-client', '2.4.0');
    expect(result).toEqual({ version: '2.4.0', excerpt: 'Remote oauth-client' });
  });
});
