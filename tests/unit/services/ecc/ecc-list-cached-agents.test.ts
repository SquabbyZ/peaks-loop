// 2026-10-03-wave11-sliceA — pins the D-009 warn-once latch across the
// ecc-cache-service split. `warnedAboutFallback` (module state in
// ecc-cache-manifest.ts) guards a single stderr warning inside
// `fallbackMetadata`; if the latch and its reader ever drift apart, this
// file goes red — two calls over one malformed agent must warn exactly once.
//
// It also doubles as the T2 arm: the delayed import below must resolve
// `resolveEccCacheDir()`'s `homedir()` through the `node:os` mock across the
// WHOLE sibling closure. If any sibling initialised before the mock was
// installed, the manifest lookup would hit the real home dir and this test
// would find zero agents.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { homeDirRef } = vi.hoisted(() => ({ homeDirRef: { value: '' } }));

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => homeDirRef.value };
});

// Delayed import — same contract as ecc-fetch-chain.test.ts: the module
// graph (facade + all six siblings) initialises only after the mock.
const { listCachedAgents } =
  await import('../../../../packages/peaks-loop-mut/src/services/agent/ecc-cache-service.js');

const SHA = 'b'.repeat(40);
let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-ecc-list-'));
  homeDirRef.value = root;
  const cacheDir = join(root, '.peaks', 'cache');
  const agentsDir = join(cacheDir, `ecc-${SHA}`, 'agents');
  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(
    join(cacheDir, 'ecc-installed.json'),
    JSON.stringify({
      version: '1',
      sha: SHA,
      fetchedAt: new Date().toISOString(),
      agents: ['broken-agent']
    })
  );
  // No `---` opening marker: parseFrontmatter throws, D-009 fallback fires.
  writeFileSync(join(agentsDir, 'broken-agent.md'), 'no frontmatter at all\n');
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe('listCachedAgents D-009 warn-once latch', () => {
  it('warns exactly once across two calls and resolves through the mocked homedir', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const first = listCachedAgents();
    const second = listCachedAgents();

    // T2 arm: non-empty result proves resolveEccCacheDir() resolved through
    // the node:os mock into this test's tmp home, not the real one.
    expect(first).toHaveLength(1);
    expect(first[0]?.name).toBe('broken-agent');
    // Body has no frontmatter block, so the fallback description stays empty.
    expect(first[0]?.description).toBe('');
    expect(second).toEqual(first);

    const warnings = stderr.mock.calls.filter((c) =>
      String(c[0]).includes('malformed frontmatter')
    );
    expect(warnings).toHaveLength(1);
  });
});
