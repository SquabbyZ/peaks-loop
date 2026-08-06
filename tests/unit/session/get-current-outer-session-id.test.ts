// tests/unit/session/get-current-outer-session-id.test.ts
//
// Slice 2026-08-06-session-outer-cache (G1 / AC3-AC6):
//   `getCurrentOuterSessionId(projectRoot)` reads
//     process.env.PEAKS_OUTER_SESSION_ID ?? CLAUDE_CODE_SESSION_ID
//     ?? <file-cache> ?? undefined
//   and never throws on missing / malformed cache files. The function
//   is private to `session-binding-bridge.ts`, so we exercise the
//   same logic via the public `outer-cache write/read` CLI surface
//   + `ensureSession` (which reads the cache via getCurrentOuterSessionId).
//
// Dimensions covered:
//   - behavior:    resolution ordering (env > cache > undefined),
//                  cache-missing returns undefined, cache-malformed
//                  JSON returns undefined.
//   - integration: tmp workspace + .peaks/_runtime/.outer-session-cache.json
//                  round-trip; same physical layout the SessionStart
//                  hook uses.
//   - render:      omitted — function returns string | undefined, no
//                  formatted output surface.
//   - a11y:        omitted — no human-facing text in this path.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { declareDimensions } from '../_setup/4dim-template.js';
import { ensureSession } from '../../../src/services/session/session-binding-bridge.js';
import { getSessionMeta } from '../../../src/services/session/session-manager.js';

declareDimensions(
  'tests/unit/session/get-current-outer-session-id.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'getCurrentOuterSessionId returns string | undefined; no formatted output surface' },
    { dim: 'a11y', reason: 'no human-facing text in the resolution path' },
  ],
);

const CACHE_REL = join('.peaks', '_runtime', '.outer-session-cache.json');

let workspace: string;
let prevCwd: string;
let prevPeaksEnv: string | undefined;
let prevClaudeEnv: string | undefined;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'peaks-outer-cache-'));
  prevCwd = process.cwd();
  process.chdir(workspace);
  prevPeaksEnv = process.env.PEAKS_OUTER_SESSION_ID;
  prevClaudeEnv = process.env.CLAUDE_CODE_SESSION_ID;
  delete process.env.PEAKS_OUTER_SESSION_ID;
  delete process.env.CLAUDE_CODE_SESSION_ID;
});

afterEach(() => {
  if (prevPeaksEnv === undefined) delete process.env.PEAKS_OUTER_SESSION_ID;
  else process.env.PEAKS_OUTER_SESSION_ID = prevPeaksEnv;
  if (prevClaudeEnv === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
  else process.env.CLAUDE_CODE_SESSION_ID = prevClaudeEnv;
  try { process.chdir(prevCwd); } catch { /* best-effort */ }
  setImmediate(() => {
    try { rmSync(workspace, { recursive: true, force: true }); } catch { /* best-effort */ }
  });
});

function writeCacheFile(payload: string): string {
  const dir = join(workspace, '.peaks', '_runtime');
  mkdirSync(dir, { recursive: true });
  const path = join(workspace, CACHE_REL);
  writeFileSync(path, payload, 'utf8');
  return path;
}

async function bindSession(): Promise<string> {
  return ensureSession(workspace);
}

describe("Scenario: behavior — outer-session-id resolution ordering", () => {
  it('AC3: cache file alone (no env) wins → ensureSession stamps the cached outer onto meta', async () => {
    const cachedOuter = 'cached-outer-from-session-start-3fe1be';
    writeCacheFile(JSON.stringify({ outerSessionId: cachedOuter, capturedAt: '2026-08-06T00:00:00.000Z' }));

    const sessionId = await bindSession();
    const meta = getSessionMeta(workspace, sessionId);
    expect(meta?.outerSessionId).toBe(cachedOuter);
  });

  it('AC4: PEAKS_OUTER_SESSION_ID wins over the cached value', async () => {
    const cachedOuter = 'cached-outer-from-session-start-3fe1be';
    const envOverride = 'env-override-peaks-outer';
    writeCacheFile(JSON.stringify({ outerSessionId: cachedOuter, capturedAt: '2026-08-06T00:00:00.000Z' }));
    process.env.PEAKS_OUTER_SESSION_ID = envOverride;

    const sessionId = await bindSession();
    const meta = getSessionMeta(workspace, sessionId);
    expect(meta?.outerSessionId).toBe(envOverride);
  });

  it('AC4b: CLAUDE_CODE_SESSION_ID wins over the cached value when PEAKS env is unset', async () => {
    const cachedOuter = 'cached-outer-from-session-start-3fe1be';
    const claudeEnv = 'claude-code-session-from-env';
    writeCacheFile(JSON.stringify({ outerSessionId: cachedOuter, capturedAt: '2026-08-06T00:00:00.000Z' }));
    process.env.CLAUDE_CODE_SESSION_ID = claudeEnv;

    const sessionId = await bindSession();
    const meta = getSessionMeta(workspace, sessionId);
    expect(meta?.outerSessionId).toBe(claudeEnv);
  });

  it('AC5: cache file missing → undefined; meta field is NOT written (preserves legacy / pre-slice)', async () => {
    // No cache file, no env vars — bound session has no outer recorded.
    const sessionId = await bindSession();
    const meta = getSessionMeta(workspace, sessionId);
    expect(meta?.outerSessionId).toBeUndefined();
  });

  it('AC6: malformed JSON cache is treated as cache-miss; no throw, meta unchanged', async () => {
    writeCacheFile('this is not { valid json');
    const sessionId = await bindSession();
    const meta = getSessionMeta(workspace, sessionId);
    expect(meta?.outerSessionId).toBeUndefined();
    // The malformed file is still on disk — ensureSession must not
    // delete or rewrite it.
    expect(existsSync(join(workspace, CACHE_REL))).toBe(true);
  });

  it('AC6b: cache file with non-string outerSessionId is treated as cache-miss', async () => {
    writeCacheFile(JSON.stringify({ outerSessionId: 12345, capturedAt: '2026-08-06T00:00:00.000Z' }));
    const sessionId = await bindSession();
    const meta = getSessionMeta(workspace, sessionId);
    expect(meta?.outerSessionId).toBeUndefined();
  });

  it('AC6c: empty-string outerSessionId is treated as cache-miss', async () => {
    writeCacheFile(JSON.stringify({ outerSessionId: '', capturedAt: '2026-08-06T00:00:00.000Z' }));
    const sessionId = await bindSession();
    const meta = getSessionMeta(workspace, sessionId);
    expect(meta?.outerSessionId).toBeUndefined();
  });
});

describe("Scenario: integration — cache file round-trip with ensureSession", () => {
  it('ensureSession on an already-bound session re-reads the cache and updates meta', async () => {
    // First call: no cache → binding is created, meta has no outerSessionId.
    const sessionId = await ensureSession(workspace);
    const initial = getSessionMeta(workspace, sessionId);
    expect(initial?.outerSessionId).toBeUndefined();

    // Simulate SessionStart hook firing: write the cache file.
    const newOuter = 'session-start-outer-after-bind';
    writeCacheFile(JSON.stringify({ outerSessionId: newOuter, capturedAt: '2026-08-06T01:00:00.000Z' }));

    // Second call: existing binding is found; cache is read; meta is stamped.
    const sessionId2 = await ensureSession(workspace);
    expect(sessionId2).toBe(sessionId); // PB1: same session, no rotation
    const updated = getSessionMeta(workspace, sessionId2);
    expect(updated?.outerSessionId).toBe(newOuter);
  });

  it('multiple ensureSession calls keep meta on the most recent cache value', async () => {
    const outerA = 'outer-a-first';
    const outerB = 'outer-b-second';
    writeCacheFile(JSON.stringify({ outerSessionId: outerA, capturedAt: '2026-08-06T02:00:00.000Z' }));

    const sessionId = await ensureSession(workspace);
    expect(getSessionMeta(workspace, sessionId)?.outerSessionId).toBe(outerA);

    writeCacheFile(JSON.stringify({ outerSessionId: outerB, capturedAt: '2026-08-06T03:00:00.000Z' }));
    const sessionId2 = await ensureSession(workspace);
    expect(sessionId2).toBe(sessionId);
    expect(getSessionMeta(workspace, sessionId2)?.outerSessionId).toBe(outerB);
  });

  it('cache file lives under .peaks/_runtime/ — gitignored by the repo rule', async () => {
    const path = writeCacheFile(JSON.stringify({ outerSessionId: 'x', capturedAt: '2026-08-06T00:00:00.000Z' }));
    const absolute = resolve(path);
    expect(absolute).toContain(join('.peaks', '_runtime'));
    // Verify the .gitignore covers the parent directory (defensive).
    const gitignore = readFileSync(resolve(__dirname, '..', '..', '..', '.gitignore'), 'utf8');
    expect(gitignore).toMatch(/^\.peaks\/_runtime\//m);
  });
});
