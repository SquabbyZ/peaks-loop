// tests/unit/context/context-audit-hint.test.ts
//
// Slice 2026-09-10-three-fixes (Slice 2) — the Step 0.8 gate's proactive
// context-consumer hint must be BOUNDED and THROTTLED:
//   ratio < 0.70            → no line
//   ratio ≥ 0.70 + cache hit → one line, zero transcript scans
//   cache miss              → at most ONE scan per TTL window
//   audit failure           → no line (fail-soft), still cached
//
// Dimensions covered:
//   - render:     the single-line format (tool + key + share + calls)
//   - behavior:   threshold / cache / TTL / fail-soft decision table
//   - integration: real fs — the cache file is written and re-read from disk
//   - a11y:       the line tells the LLM exactly what to run next
//
// Run with: pnpm vitest run tests/unit/context/context-audit-hint.test.ts

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import {
  buildContextAuditHint,
  contextHintCachePath,
  CONTEXT_HINT_CACHE_FILE_NAME,
  CONTEXT_HINT_CACHE_TTL_MS,
  CONTEXT_HINT_RATIO_THRESHOLD,
  formatContextHintLine,
  type ContextHintCacheEntry,
} from '~/src/services/context/context-audit-hint.js';
import type { ContextAuditResult } from '~/src/services/context/context-audit.js';

declareDimensions('tests/unit/context/context-audit-hint.test.ts', ['render', 'behavior', 'integration', 'a11y']);

const created: string[] = [];
function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'peaks-hint-'));
  created.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of created) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort tmp cleanup */
    }
  }
});

function auditResult(overrides: Partial<ContextAuditResult> = {}): ContextAuditResult {
  return {
    available: true,
    reason: null,
    transcriptPath: '/tmp/transcript.jsonl',
    totalBytes: 1000,
    entryCount: 5,
    groupCount: 2,
    topN: 1,
    entries: [{ tool: 'Bash', key: 'peaks memory reindex --json', bytes: 412, pctOfTotal: 41.2, count: 4 }],
    ...overrides,
  };
}

function cacheEntry(overrides: Partial<ContextHintCacheEntry> = {}): ContextHintCacheEntry {
  return {
    cachedAt: 1_000_000,
    available: true,
    ratio: 0.72,
    tool: 'Bash',
    key: 'peaks memory reindex --json',
    bytes: 412,
    pctOfTotal: 41.2,
    count: 4,
    ...overrides,
  };
}

describe('(render) the hint is exactly one actionable line', () => {
  it('names the tool, the key, the share, the call count and the ratio', () => {
    const line = formatContextHintLine(cacheEntry());
    expect(line).not.toContain('\n');
    expect(line).toContain('Bash');
    expect(line).toContain('peaks memory reindex --json');
    expect(line).toContain('41.2%');
    expect(line).toContain('4 calls');
    expect(line).toContain('72.0%');
  });

  it('singularises a one-call group', () => {
    expect(formatContextHintLine(cacheEntry({ count: 1 }))).toContain('1 call)');
  });
});

describe('(behavior) threshold / cache / TTL decision table', () => {
  it('emits nothing below the 0.70 threshold and never scans', () => {
    const runAudit = vi.fn(() => auditResult());
    const line = buildContextAuditHint({
      projectRoot: '/proj',
      sessionId: 'sid',
      cachePath: join(tmpDir(), 'cache.json'),
      probeRatio: () => CONTEXT_HINT_RATIO_THRESHOLD - 0.01,
      runAudit,
    });
    expect(line).toBeNull();
    expect(runAudit).not.toHaveBeenCalled();
  });

  it('emits one line on a cache miss and caches the audit result', () => {
    const cachePath = join(tmpDir(), 'cache.json');
    const runAudit = vi.fn(() => auditResult());
    const line = buildContextAuditHint({
      projectRoot: '/proj',
      sessionId: 'sid',
      nowMs: 1_000_000,
      cachePath,
      probeRatio: () => 0.72,
      runAudit,
    });
    expect(runAudit).toHaveBeenCalledTimes(1);
    expect(line).toContain('top consumer: Bash');
    expect(existsSync(cachePath)).toBe(true);
  });

  it('skips the transcript scan entirely when a fresh cache entry exists', () => {
    const cachePath = join(tmpDir(), 'cache.json');
    writeFileSync(cachePath, JSON.stringify(cacheEntry({ cachedAt: 1_000_000 })), 'utf8');
    const runAudit = vi.fn(() => auditResult());
    const line = buildContextAuditHint({
      projectRoot: '/proj',
      sessionId: 'sid',
      nowMs: 1_000_000 + CONTEXT_HINT_CACHE_TTL_MS - 1,
      cachePath,
      probeRatio: () => 0.72,
      runAudit,
    });
    expect(line).toContain('top consumer: Bash');
    expect(runAudit).not.toHaveBeenCalled();
  });

  it('scans at most once per TTL window across repeated gate calls', () => {
    const cachePath = join(tmpDir(), 'cache.json');
    const runAudit = vi.fn(() => auditResult());
    const base = { projectRoot: '/proj', sessionId: 'sid', cachePath, probeRatio: () => 0.72, runAudit };
    const first = buildContextAuditHint({ ...base, nowMs: 2_000_000 });
    const second = buildContextAuditHint({ ...base, nowMs: 2_000_000 + 60_000 });
    const third = buildContextAuditHint({ ...base, nowMs: 2_000_000 + CONTEXT_HINT_CACHE_TTL_MS - 1 });
    expect([first, second, third].every((l) => l !== null)).toBe(true);
    expect(runAudit).toHaveBeenCalledTimes(1);
  });

  it('re-scans once the cache entry is older than the TTL', () => {
    const cachePath = join(tmpDir(), 'cache.json');
    writeFileSync(cachePath, JSON.stringify(cacheEntry({ cachedAt: 1_000_000 })), 'utf8');
    const runAudit = vi.fn(() => auditResult());
    const line = buildContextAuditHint({
      projectRoot: '/proj',
      sessionId: 'sid',
      nowMs: 1_000_000 + CONTEXT_HINT_CACHE_TTL_MS + 1,
      cachePath,
      probeRatio: () => 0.72,
      runAudit,
    });
    expect(line).not.toBeNull();
    expect(runAudit).toHaveBeenCalledTimes(1);
  });

  it('emits nothing when the audit is unavailable, and caches the failure', () => {
    const cachePath = join(tmpDir(), 'cache.json');
    const runAudit = vi.fn(() => auditResult({ available: false, reason: 'transcript-not-found', entries: [] }));
    const base = { projectRoot: '/proj', sessionId: 'sid', cachePath, probeRatio: () => 0.72, runAudit };
    expect(buildContextAuditHint({ ...base, nowMs: 3_000_000 })).toBeNull();
    // Second call inside the TTL must not rescan (cached failure).
    expect(buildContextAuditHint({ ...base, nowMs: 3_000_000 + 1000 })).toBeNull();
    expect(runAudit).toHaveBeenCalledTimes(1);
    expect(JSON.parse(readFileSync(cachePath, 'utf8')).available).toBe(false);
  });

  it('emits nothing when the audit has no groups', () => {
    const line = buildContextAuditHint({
      projectRoot: '/proj',
      sessionId: 'sid',
      cachePath: join(tmpDir(), 'cache.json'),
      probeRatio: () => 0.72,
      runAudit: () => auditResult({ entries: [], entryCount: 0, groupCount: 0, totalBytes: 0 }),
    });
    expect(line).toBeNull();
  });

  it('fails soft when the ratio probe throws', () => {
    const runAudit = vi.fn(() => auditResult());
    const line = buildContextAuditHint({
      projectRoot: '/proj',
      sessionId: 'sid',
      cachePath: join(tmpDir(), 'cache.json'),
      probeRatio: () => {
        throw new Error('adapter exploded');
      },
      runAudit,
    });
    expect(line).toBeNull();
    expect(runAudit).not.toHaveBeenCalled();
  });

  it('fails soft when the audit runner throws', () => {
    const line = buildContextAuditHint({
      projectRoot: '/proj',
      sessionId: 'sid',
      cachePath: join(tmpDir(), 'cache.json'),
      probeRatio: () => 0.72,
      runAudit: () => {
        throw new Error('scan exploded');
      },
    });
    expect(line).toBeNull();
  });

  it('treats a corrupt cache file as a miss instead of throwing', () => {
    const cachePath = join(tmpDir(), 'cache.json');
    writeFileSync(cachePath, 'not json at all', 'utf8');
    const runAudit = vi.fn(() => auditResult());
    const line = buildContextAuditHint({
      projectRoot: '/proj',
      sessionId: 'sid',
      nowMs: 4_000_000,
      cachePath,
      probeRatio: () => 0.72,
      runAudit,
    });
    expect(line).not.toBeNull();
    expect(runAudit).toHaveBeenCalledTimes(1);
  });
});

describe('(integration) per-session cache on the real filesystem', () => {
  it('resolves the cache under .peaks/_runtime/<sid>/ and round-trips it', () => {
    const projectRoot = tmpDir();
    const cachePath = contextHintCachePath(projectRoot, '2026-09-10-session-abc123');
    expect(cachePath.endsWith(join('_runtime', '2026-09-10-session-abc123', 'context', CONTEXT_HINT_CACHE_FILE_NAME))).toBe(true);
    const line = buildContextAuditHint({
      projectRoot,
      sessionId: '2026-09-10-session-abc123',
      nowMs: 5_000_000,
      probeRatio: () => 0.75,
      runAudit: () => auditResult(),
    });
    expect(line).not.toBeNull();
    const onDisk = JSON.parse(readFileSync(cachePath, 'utf8')) as ContextHintCacheEntry;
    expect(onDisk.tool).toBe('Bash');
    expect(onDisk.cachedAt).toBe(5_000_000);
  });

  it('sanitises a session id that would escape the runtime dir', () => {
    const projectRoot = tmpDir();
    const cachePath = contextHintCachePath(projectRoot, '../evil');
    expect(cachePath).not.toContain('..');
    expect(cachePath).toContain(CONTEXT_HINT_CACHE_FILE_NAME);
  });
});

describe('(a11y) the line tells the LLM what to run next', () => {
  it('points at `peaks code context-audit` for the full breakdown', () => {
    expect(formatContextHintLine(cacheEntry())).toContain('peaks code context-audit');
  });
});
