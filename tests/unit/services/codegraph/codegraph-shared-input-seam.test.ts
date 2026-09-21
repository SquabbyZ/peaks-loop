// tests/unit/services/codegraph/codegraph-shared-input-seam.test.ts
//
// 4-dimension unit test for the SHARED-INPUT SEAM (perf audit F1, hardened
// by code review R4-1) — the optional second argument of
// `inspectCodegraphExcludeIntegrity` / `inspectCodegraphIndexIntegrity`.
//
// What the seam is for: `peaks codegraph status` runs both integrity axes in
// one process and both need the same `git ls-files` list and the same
// config, so the CLI reads them ONCE (`readCodegraphProjectInputs`) and hands
// the values to each axis. That halved the `git ls-files` spawn count.
//
// What went wrong with it (R4-1): the fields were typed `readonly string[]`,
// so `??` alone decided "read it yourself" vs "here is the answer" — and an
// explicitly passed `[]` is not nullish. An empty list means "nothing is
// tracked", which makes every `exclude` rule look harmless (exclude axis)
// AND makes every include-gap disappear (index axis): a real finding flipped
// to CLEAN on both axes, inside the guard built to prevent silent false
// passes. The fix keys on PROVENANCE, not emptiness.
//
// Controls (this repo's standard, non-negotiable):
//   - CLEAN control: the no-seam report on this fixture is a REAL gap, and
//     every probe shape must equal it AND non-trivially (a suite that
//     compares two clean reports proves nothing).
//   - INJECTION control: the fabricated empty value must be REFUSED, so the
//     false clean cannot be reached at all.
//   - DISCRIMINATOR control: a legitimately empty read is still ACCEPTED and
//     still equals the no-seam call — otherwise the fix would have smuggled
//     in "empty is illegal", which is a different (and wrong) rule, and
//     would turn `status` on an empty repo into a spurious warning.
//
// Dimensions covered:
//   - behavior:    the six verified probe shapes; omission falls back to the
//                  real read; a fabricated value throws
//   - integration: real temp git work trees, the real config reader, the real
//                  upstream language oracle
//   - a11y:        the refusal is a loud, actionable message that names the
//                  field and the producer the value must come from
//
// Run with: pnpm vitest run tests/unit/services/codegraph/codegraph-shared-input-seam.test.ts

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  readCodegraphExcludeConfig,
  readCodegraphProjectInputs,
  readTrackedFiles,
  reconcileCodegraphExclude,
  type ReadCodegraphExcludeConfig,
  type ReadTrackedFiles
} from '../../../../src/services/codegraph/codegraph-exclude-reconciler.js';
import { inspectCodegraphExcludeIntegrity } from '../../../../src/services/codegraph/codegraph-exclude-integrity.js';
import { inspectCodegraphIndexIntegrity } from '../../../../src/services/codegraph/codegraph-index-integrity.js';
import { declareDimensions } from '../../_setup/4dim-template.js';
import { HEAVY_SUBPROCESS_TEST_TIMEOUT_MS } from '../../_setup/subprocess-timeouts.js';

declareDimensions(
  'tests/unit/services/codegraph/codegraph-shared-input-seam.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    {
      dim: 'render',
      reason:
        'the seam renders nothing of its own — it either passes a value through unchanged or throws; the human and JSON rendering it feeds is owned by codegraph-exclude-integrity.test.ts and codegraph-index-integrity.test.ts'
    }
  ]
);

// ── the fixture ──────────────────────────────────────────────────────

// `include` admits `.ts` only, `exclude` blocks the one source file it does
// admit, and a supported `.mjs` sits just outside `include`. That is the
// reviewer's R4-1 reproduction, and it is chosen so ONE fixture makes BOTH
// axes report a gap: the exclude axis calls `**/ok.ts` harmful, and the
// index axis calls `scripts/tool.mjs` a file upstream would ingest but
// `include` withholds. A clean fixture could not tell a working guard from
// a guard that reports nothing.
const CONFIG = { include: ['**/*.ts'], exclude: ['**/ok.ts'] } as const;

// The paths the index's own `files` table carries. Injected, because the
// real db is a build artifact: this test is about the shared tracked/config
// seam, not about SQLite.
const INDEXED_PATHS = ['src/ok.ts'] as const;

const cleanups: string[] = [];

afterEach(() => {
  while (cleanups.length > 0) {
    const dir = cleanups.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function git(dir: string, args: readonly string[]): void {
  execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore', windowsHide: true });
}

function makeGitRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(root);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'peaks-test@example.com']);
  git(root, ['config', 'user.name', 'peaks test']);

  return root;
}

function writeConfig(
  root: string,
  config: { include: readonly string[]; exclude: readonly string[] }
): void {
  mkdirSync(join(root, '.codegraph'), { recursive: true });
  writeFileSync(
    join(root, '.codegraph', 'config.json'),
    `${JSON.stringify(config, null, 2)}\n`,
    'utf8'
  );
}

/**
 * Two tracked files (`git add` names them explicitly, so the untracked
 * `.codegraph/config.json` stays out of the tracked list — a tracked config
 * would add its own include-gap and blur the assertions).
 */
function makeGappedRoot(): string {
  const root = makeGitRoot('peaks-cg-seam-');
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(join(root, 'src', 'ok.ts'), 'export const ok = 1;\n', 'utf8');
  writeFileSync(join(root, 'scripts', 'tool.mjs'), 'export const tool = 1;\n', 'utf8');
  writeConfig(root, CONFIG);
  git(root, ['add', 'src', 'scripts']);
  git(root, ['commit', '-qm', 'fixture']);

  return root;
}

/** A real git work tree that legitimately tracks NOTHING. */
function makeEmptyRoot(): string {
  const root = makeGitRoot('peaks-cg-seam-empty-');
  writeConfig(root, CONFIG);

  return root;
}

// ── the fabricated values the seam must refuse ───────────────────────

// The casts are deliberate and are the point: they express what a JS caller,
// or a future `as` written in a hurry, can do — the path the run-time half of
// the guard exists for. The COMPILE-TIME half is pinned separately, by the
// `@ts-expect-error` directives under "the type system refuses it too": if
// the brand is ever removed from the seam's field types, those directives
// become unused and `tsc` fails on them.
const forgedTrackedFiles = [] as unknown as ReadTrackedFiles;
const forgedConfig = { include: [], exclude: [] } as unknown as ReadCodegraphExcludeConfig;

// ── behavior: the hazard is real, and it is what the seam now refuses ──

describe('behavior — what an empty tracked list actually means', () => {
  it('should make a genuinely harmful exclude rule look completely harmless', () => {
    // Not a test of the seam: this is the pure core, and it is here to show
    // that refusing the empty value is refusing something REAL. If `[]` were
    // harmless, rejecting it would be theatre.
    const gapped = reconcileCodegraphExclude({
      trackedFiles: ['src/ok.ts'],
      include: [...CONFIG.include],
      exclude: [...CONFIG.exclude]
    });
    const withEmpty = reconcileCodegraphExclude({
      trackedFiles: [],
      include: [...CONFIG.include],
      exclude: [...CONFIG.exclude]
    });

    expect(gapped.excludedTrackedCount).toBe(1);
    expect(gapped.violations).toEqual([{ path: 'src/ok.ts', matchedRule: '**/ok.ts' }]);
    // The same config, the same rules — and not a single finding left.
    expect(withEmpty.excludedTrackedCount).toBe(0);
    expect(withEmpty.violations).toEqual([]);
    expect(withEmpty.rulesToRemove).toEqual([]);
  });
});

// ── behavior + integration: back-compat of the six verified probe shapes ──

describe('behavior — every verified probe shape still matches the no-seam call', () => {
  it(
    'should be bit-identical on the exclude axis',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const root = makeGappedRoot();
      const noSeam = inspectCodegraphExcludeIntegrity(root);

      // Clean control FIRST: equivalence between two clean reports would be
      // vacuous, so the baseline must be a real gap before it is compared.
      expect(noSeam.gap).toBe(true);
      expect(noSeam.trackedSourceCount).toBe(1);
      expect(noSeam.violations).toEqual([{ path: 'src/ok.ts', matchedRule: '**/ok.ts' }]);

      const realTracked = readTrackedFiles(root);
      const realConfig = readCodegraphExcludeConfig(root);

      const shapes: readonly { readonly name: string; readonly probe: () => unknown }[] = [
        { name: '{} (empty object)', probe: () => inspectCodegraphExcludeIntegrity(root, {}) },
        {
          name: '{trackedFiles: undefined, config: undefined}',
          probe: () =>
            inspectCodegraphExcludeIntegrity(root, { trackedFiles: undefined, config: undefined })
        },
        {
          name: 'config-only (tracked omitted -> real read)',
          probe: () => inspectCodegraphExcludeIntegrity(root, { config: realConfig })
        },
        {
          name: 'tracked-only (config omitted -> real read)',
          probe: () => inspectCodegraphExcludeIntegrity(root, { trackedFiles: realTracked })
        },
        {
          name: 'the full shared read',
          probe: () => inspectCodegraphExcludeIntegrity(root, readCodegraphProjectInputs(root))
        }
      ];

      for (const shape of shapes) {
        expect(JSON.stringify(shape.probe()), shape.name).toBe(JSON.stringify(noSeam));
      }
    }
  );

  it(
    'should be bit-identical on the index axis',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const root = makeGappedRoot();
      const adapters = { readIndexedPaths: () => [...INDEXED_PATHS] };
      const noSeam = inspectCodegraphIndexIntegrity(root, adapters);

      expect(noSeam.gap).toBe(true);
      expect(noSeam.trackedSourceCount).toBe(2);
      expect(noSeam.admittedTrackedCount).toBe(1);
      expect(noSeam.includeGap).toEqual(['scripts/tool.mjs']);

      const realTracked = readTrackedFiles(root);
      const realConfig = readCodegraphExcludeConfig(root);

      const shapes: readonly { readonly name: string; readonly probe: () => unknown }[] = [
        {
          name: '{} (empty object)',
          probe: () => inspectCodegraphIndexIntegrity(root, { ...adapters })
        },
        {
          name: '{trackedFiles: undefined, config: undefined}',
          probe: () =>
            inspectCodegraphIndexIntegrity(root, {
              ...adapters,
              trackedFiles: undefined,
              config: undefined
            })
        },
        {
          name: 'config-only (tracked omitted -> real read)',
          probe: () => inspectCodegraphIndexIntegrity(root, { ...adapters, config: realConfig })
        },
        {
          name: 'tracked-only (config omitted -> real read)',
          probe: () =>
            inspectCodegraphIndexIntegrity(root, { ...adapters, trackedFiles: realTracked })
        },
        {
          name: 'the full shared read',
          probe: () =>
            inspectCodegraphIndexIntegrity(root, {
              ...adapters,
              ...readCodegraphProjectInputs(root)
            })
        }
      ];

      for (const shape of shapes) {
        expect(JSON.stringify(shape.probe()), shape.name).toBe(JSON.stringify(noSeam));
      }
    }
  );
});

// ── integration: an empty READ is still legal, only a fabricated one is not ──

describe('integration — a legitimately empty read is not the thing being refused', () => {
  it(
    'should accept an empty tracked list that the reader really produced',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const root = makeEmptyRoot();

      // The reader's own answer for a repo that tracks nothing IS `[]`. The
      // discriminator is provenance, not emptiness: refusing this would report
      // a spurious warning on an empty repository.
      expect(readTrackedFiles(root)).toEqual([]);

      const noSeam = inspectCodegraphExcludeIntegrity(root);
      const withSeam = inspectCodegraphExcludeIntegrity(root, readCodegraphProjectInputs(root));

      expect(noSeam.gap).toBe(false);
      expect(noSeam.trackedSourceCount).toBe(0);
      expect(JSON.stringify(withSeam)).toBe(JSON.stringify(noSeam));
    }
  );

  it(
    'should accept an empty tracked list on the index axis too',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const root = makeEmptyRoot();
      const adapters = { readIndexedPaths: () => [] };

      const noSeam = inspectCodegraphIndexIntegrity(root, adapters);
      const withSeam = inspectCodegraphIndexIntegrity(root, {
        ...adapters,
        ...readCodegraphProjectInputs(root)
      });

      expect(noSeam.gap).toBe(false);
      expect(JSON.stringify(withSeam)).toBe(JSON.stringify(noSeam));
    }
  );
});

// ── behavior + a11y: the fabricated value is refused, loudly ──────────

describe('behavior — an explicit empty value is refused on both axes', () => {
  it(
    'should refuse a hand-built empty tracked list on the exclude axis',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const root = makeGappedRoot();

      expect(() =>
        inspectCodegraphExcludeIntegrity(root, { trackedFiles: forgedTrackedFiles })
      ).toThrow(/"trackedFiles" did not come from readTrackedFiles/);
    }
  );

  it(
    'should refuse a hand-built empty config on the exclude axis',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const root = makeGappedRoot();

      expect(() => inspectCodegraphExcludeIntegrity(root, { config: forgedConfig })).toThrow(
        /"config" did not come from readCodegraphExcludeConfig/
      );
    }
  );

  it(
    'should refuse a hand-built empty tracked list on the index axis',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const root = makeGappedRoot();

      expect(() =>
        inspectCodegraphIndexIntegrity(root, {
          readIndexedPaths: () => [...INDEXED_PATHS],
          trackedFiles: forgedTrackedFiles
        })
      ).toThrow(/"trackedFiles" did not come from readTrackedFiles/);
    }
  );

  it(
    'should refuse a hand-built empty config on the index axis',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const root = makeGappedRoot();

      expect(() =>
        inspectCodegraphIndexIntegrity(root, {
          readIndexedPaths: () => [...INDEXED_PATHS],
          config: forgedConfig
        })
      ).toThrow(/"config" did not come from readCodegraphExcludeConfig/);
    }
  );

  it(
    'should name the producer and the remedy, so the message is actionable',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const root = makeGappedRoot();
      let message = '';

      try {
        inspectCodegraphExcludeIntegrity(root, { trackedFiles: forgedTrackedFiles });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }

      expect(message).toContain('readCodegraphProjectInputs(projectRoot)');
      expect(message).toContain('CLEAN on both codegraph axes');
    }
  );
});

// ── behavior: the type system refuses it too (the compile-time half) ──

describe('behavior — the type system refuses a fabricated value as well', () => {
  it(
    'should reject an empty literal at compile time and at run time',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // The compile-time half: with the read mark on the seam's field types,
      // each line below is a type error, which is what `@ts-expect-error`
      // asserts. Remove the mark and `tsc` fails on the now-unused directives.
      // @ts-expect-error R9 — `[]` is not a read-provenance value
      const typeLevelRejectedTracked: ReadTrackedFiles = [];
      // @ts-expect-error R9 — a hand-built config is not a read-provenance value
      const typeLevelRejectedConfig: ReadCodegraphExcludeConfig = { include: [], exclude: [] };

      // The run-time half, on the very values those declarations produce: the
      // literal IS `[]` at run time, and `[]` is exactly what the seam refuses.
      expect(typeLevelRejectedTracked).toEqual([]);
      expect(typeLevelRejectedConfig).toEqual({ include: [], exclude: [] });

      const root = makeGappedRoot();
      expect(() =>
        inspectCodegraphExcludeIntegrity(root, { trackedFiles: typeLevelRejectedTracked })
      ).toThrow(/did not come from readTrackedFiles/);
      expect(() =>
        inspectCodegraphExcludeIntegrity(root, { config: typeLevelRejectedConfig })
      ).toThrow(/did not come from readCodegraphExcludeConfig/);
    }
  );
});
