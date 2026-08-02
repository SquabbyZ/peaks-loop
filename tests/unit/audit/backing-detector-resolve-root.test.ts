// tests/unit/audit/backing-detector-resolve-root.test.ts
//
// 4-dimension unit test for src/services/audit/backing-detector.ts.
//
// Slice 4.0.7-dogfood-PR-1 (ice-cola surface probe 2026-08-02): pre-rid,
// `classifyBacking` resolved every `enforcerRef` against the audited
// `--project` root, but `enforcerRef` paths are written relative to the
// peaks-loop source itself. The result: auditing any downstream project
// (e.g. ice-cola) reported all 26 enforcer files as "missing on disk"
// (88 enforcerFindings on ice-cola).
//
// The rid changes `classifyBacking` to resolve `enforcerRef` against the
// peaks-loop install root (resolved via `import.meta.url` + upward walk
// to find `package.json#name === 'peaks-loop'`), with a `peaksLoopRoot`
// override for tests.
//
// Dimensions covered:
//   - render:     RedLineEntry.backing value (cli-backed / partial / prose-only)
//   - behavior:   6 cases — peaks-loop root resolves all 26 enforcers; ice-cola
//                 root (the bug repro) ALSO resolves all 26; explicit override
//                 wins; relative path outside catalog dir yields prose-only;
//                 enforcerRef: null returns enforcerExists: false; partial
//                 phrase keeps backing as 'partial' regardless of disk
//   - integration: real peaks-loop repo on disk drives the catalog walk
//                 end-to-end (no mock of `existsSync`); assert each of the
//                 26 enforcer files in the catalog is reachable from the
//                 resolved peaks-loop root
//   - a11y:        not applicable — no user-visible text in this module
//
// Run with: pnpm vitest run tests/unit/audit/backing-detector-resolve-root.test.ts

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetPeaksLoopRootCache,
  classifyBacking,
  classifyBackingBatch,
  resolvePeaksLoopRoot,
} from '../../../src/services/audit/backing-detector.js';
import { RED_LINE_CATALOG } from '../../../src/services/audit/red-line-catalog.js';
import { RED_LINE_CATALOG_P2_A } from '../../../src/services/audit/red-line-catalog-p2-a.js';
import { RED_LINE_CATALOG_P2_B } from '../../../src/services/audit/red-line-catalog-p2-b.js';
import type { RedLineEntry } from '../../../src/services/audit/types.js';
import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/audit/backing-detector-resolve-root.test.ts',
  ['render', 'behavior', 'integration'],
  [
    { dim: 'a11y', reason: 'no user-visible text in classifyBacking; backing field is internal only' },
  ],
);

function makeEntry(enforcerRef: string | null, context = 'MANDATORY rule text'): RedLineEntry {
  return {
    id: 'rl-test-001',
    rule: 'Test rule',
    source: {
      file: 'skills/bee/test/SKILL.md',
      line: 1,
      marker: 'MANDATORY',
      context,
    },
    backing: 'prose-only',
    enforcerRef,
  };
}

// Real catalog entries are `RedLineCatalogEntry` (no `source` field). When
// they reach `classifyBacking`, the classifier has already wrapped them
// in `RedLineEntry` with a `source` derived from the discovered location.
// We construct a synthetic RedLineEntry for catalog walk assertions so
// the test does not depend on the classifier's internal scaffolding.
function catalogEntryToRedLineEntry(
  id: string,
  enforcerRef: string | null,
  context = 'MANDATORY rule text',
): RedLineEntry {
  return {
    id,
    rule: 'Test rule',
    source: {
      file: 'skills/bee/test/SKILL.md',
      line: 1,
      marker: 'MANDATORY',
      context,
    },
    backing: 'prose-only',
    enforcerRef,
  };
}

describe('render: classifyBacking backing field', () => {
  // PR-1 fix: backing-detector caches the peaks-loop root across
  // imports. Reset the cache so the test suite's test order does
  // not poison the resolved root.
  beforeEach(() => {
    _resetPeaksLoopRootCache();
  });

  it('returns cli-backed when enforcerRef resolves to a real file', () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'peaks-backing-'));
    try {
      mkdirSync(join(fakeRoot, 'src/services/audit/enforcers'), { recursive: true });
      writeFileSync(join(fakeRoot, 'src/services/audit/enforcers/test.ts'), 'export const x = 1;\n');
      const result = classifyBacking(
        makeEntry('src/services/audit/enforcers/test.ts'),
        '/some/audited/project',
        fakeRoot,
      );
      expect(result.entry.backing).toBe('cli-backed');
      expect(result.enforcerExists).toBe(true);
    } finally {
      rmSync(fakeRoot, { recursive: true, force: true });
    }
  });

  it('returns prose-only when enforcerRef does NOT resolve to a real file', () => {
    const result = classifyBacking(
      makeEntry('src/services/audit/enforcers/does-not-exist.ts'),
      '/some/audited/project',
      mkdtempSync(join(tmpdir(), 'peaks-backing-empty-')),
    );
    expect(result.entry.backing).toBe('prose-only');
    expect(result.enforcerExists).toBe(false);
  });
});

describe('behavior: classifyBacking end-to-end (the ice-cola dogfood bug)', () => {
  let iceColaRoot: string;
  let peaksLoopRoot: string;

  beforeEach(() => {
    _resetPeaksLoopRootCache();
    iceColaRoot = mkdtempSync(join(tmpdir(), 'ice-cola-sim-'));
    // Simulate ice-cola: a downstream project that does NOT contain
    // peaks-loop's enforcer files in its own tree.
    mkdirSync(join(iceColaRoot, 'packages/server'), { recursive: true });
    writeFileSync(join(iceColaRoot, 'package.json'), '{"name":"ice-cola"}');
    peaksLoopRoot = resolvePeaksLoopRoot();
  });

  afterEach(() => {
    rmSync(iceColaRoot, { recursive: true, force: true });
  });

  it('pre-rid bug repro: with peaks-loop root, every catalog enforcer is cli-backed', () => {
    // The catalog is shipped from peaks-loop itself; resolving enforcerRef
    // against the peaks-loop root must find every file the catalog claims.
    let orphanCount = 0;
    for (const entry of [...RED_LINE_CATALOG, ...RED_LINE_CATALOG_P2_A, ...RED_LINE_CATALOG_P2_B]) {
      if (entry.enforcerRef === null) continue;
      const wrapped = catalogEntryToRedLineEntry(entry.id, entry.enforcerRef);
      const result = classifyBacking(wrapped, iceColaRoot, peaksLoopRoot);
      if (result.enforcerExists === false) orphanCount++;
    }
    expect(orphanCount).toBe(0);
  });

  it('regression guard: ice-cola as project + peaks-loop root = 0 orphans', () => {
    // This is the EXACT dogfood scenario: ice-cola is the audited project,
    // peaks-loop is the package that owns the catalog. After the fix, this
    // reports 0 orphans. Pre-rid this was 26+ (every catalog entry).
    const wrapped: RedLineEntry[] = [
      ...RED_LINE_CATALOG,
      ...RED_LINE_CATALOG_P2_A,
      ...RED_LINE_CATALOG_P2_B,
    ]
      .filter((e) => e.enforcerRef !== null)
      .map((e) => catalogEntryToRedLineEntry(e.id, e.enforcerRef));
    const result = classifyBackingBatch(wrapped, iceColaRoot, peaksLoopRoot);
    const orphans = result.entries.filter((e) => e.backing === 'prose-only' && e.enforcerRef !== null);
    expect(orphans.length).toBe(0);
  });

  it('explicit peaksLoopRoot override wins over auto-detected root', () => {
    const customRoot = mkdtempSync(join(tmpdir(), 'peaks-custom-'));
    try {
      mkdirSync(join(customRoot, 'src/services/audit/enforcers'), { recursive: true });
      writeFileSync(join(customRoot, 'src/services/audit/enforcers/foo.ts'), 'export const x = 1;\n');
      const result = classifyBacking(
        makeEntry('src/services/audit/enforcers/foo.ts'),
        iceColaRoot,
        customRoot,
      );
      expect(result.enforcerExists).toBe(true);
      expect(result.entry.backing).toBe('cli-backed');
    } finally {
      rmSync(customRoot, { recursive: true, force: true });
    }
  });

  it('enforcerRef: null returns enforcerExists: false without resolving', () => {
    const result = classifyBacking(makeEntry(null), iceColaRoot, peaksLoopRoot);
    expect(result.enforcerExists).toBe(false);
    expect(result.entry.backing).toBe('prose-only');
  });

  it('partial phrases keep backing as partial regardless of disk existence', () => {
    const partialContext = 'this gate is best effort and LLM-cooperation based';
    const result = classifyBacking(
      makeEntry('src/services/audit/enforcers/code-ban.ts', partialContext),
      iceColaRoot,
      peaksLoopRoot,
    );
    expect(result.entry.backing).toBe('partial');
  });
});

describe('integration: real peaks-loop repo drives the full catalog walk', () => {
  it('all 26 enforcer files referenced by the catalog exist on disk', () => {
    _resetPeaksLoopRootCache();
    const peaksLoopRoot = resolvePeaksLoopRoot();
    // Confirm the resolver actually found peaks-loop's package.json.
    expect(peaksLoopRoot).toMatch(/peaks-loop[\\\/]?$/);
    const allEntries: RedLineEntry[] = [
      ...RED_LINE_CATALOG,
      ...RED_LINE_CATALOG_P2_A,
      ...RED_LINE_CATALOG_P2_B,
    ];
    const nonNullRefs = allEntries.filter((e) => e.enforcerRef !== null);
    expect(nonNullRefs.length).toBeGreaterThanOrEqual(26);
    let missingFiles = 0;
    const missingList: string[] = [];
    for (const entry of nonNullRefs) {
      const wrapped = catalogEntryToRedLineEntry(entry.id, entry.enforcerRef);
      const result = classifyBacking(wrapped, peaksLoopRoot, peaksLoopRoot);
      if (!result.enforcerExists) {
        missingFiles++;
        missingList.push(`${entry.id}: ${entry.enforcerRef}`);
      }
    }
    expect(missingFiles, `Missing enforcer files: ${missingList.join(', ')}`).toBe(0);
  });
});
