import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'node:os';
import {
  readdirSync,
  statSync as realStatSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { collectResourceSnapshot } from '../../../../src/services/job/job-resource-snapshot.js';
import { dirSizeMb } from '../../__test-helpers__/dirsize-shim.js';
import { ResourceSnapshotSchema } from '../../../../src/services/job/job-types.js';

// Single hoisted state shared by the `node:fs` and `node:os` vi.mock
// factories below. `vi.hoisted` is required so the variable exists at
// the time these factories are evaluated (vitest hoists vi.mock above
// imports).
//
//  fs.throwOnStatPaths  — AC-6 Test B pushes a path so statSync throws
//                         ENOENT for that one entry (inner-catch coverage).
//  os.cpus              — null ⇒ real cpus(); array ⇒ use that array
//                         (drives the `cpus.length || 1` fallback branch).
//  os.loadavg           — null ⇒ real loadavg(); array ⇒ use that
//                         (drives the `loadavg[0] ?? 0` nullish branch).
const mockState = vi.hoisted(() => ({
  fs: { throwOnStatPaths: new Set<string>() },
  os: { cpus: null as unknown, loadavg: null as number[] | null },
}));

// File-scope `vi.mock('node:fs')`. Empty `throwOnStatPaths` ⇒ statSync
// passes through to the real impl, so AC-1/AC-2/AC-3 see unmodified
// behaviour. AC-6 Test B populates the set right before invoking
// `dirSizeMb`.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readdirSync: actual.readdirSync,
    statSync: ((p: string) => {
      if (mockState.fs.throwOnStatPaths.has(p)) {
        const e = new Error('ENOENT: forced inner-stat failure for AC-6') as NodeJS.ErrnoException;
        e.code = 'ENOENT';
        throw e;
      }
      return actual.statSync(p);
    }) as typeof import('node:fs').statSync,
  };
});

// File-scope `vi.mock('node:os')` so branch-coverage tests can drive the
// `loadavg[0] ?? 0` nullish branch, the `cpus.length || 1` fallback
// branch, and the `Math.min(100, loadAvg*100)` upper-clamp branch.
//
// IMPORTANT: For `import os from 'node:os'` (default import) to see the
// mocks, the factory must export the mocked functions under BOTH the
// namespace keys AND `default.*` — Vite's CJS interop resolves the
// default import to the factory's `default` property.
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  const cpusFn = () => {
    if (mockState.os.cpus === null) return actual.cpus();
    return mockState.os.cpus as ReturnType<typeof actual.cpus>;
  };
  const loadavgFn = () => {
    if (mockState.os.loadavg === null) return actual.loadavg();
    return mockState.os.loadavg as ReturnType<typeof actual.loadavg>;
  };
  return {
    ...actual,
    cpus: cpusFn,
    loadavg: loadavgFn,
    default: {
      ...actual,
      cpus: cpusFn,
      loadavg: loadavgFn,
    },
  };
});

/**
 * Inline reference walk — sums the sizes of every top-level entry of `dir`.
 * Used as ground truth for AC-1 / AC-3 byte-equivalence assertions.
 */
function referenceWalkBytes(dir: string): number {
  let total = 0;
  for (const name of readdirSync(dir)) {
    total += realStatSync(join(dir, name)).size;
  }
  return total;
}

describe('collectResourceSnapshot', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(os.tmpdir(), 'peaks-job-snap-'));
    for (let i = 0; i < 100; i++) {
      writeFileSync(join(dir, `f-${i}.bin`), Buffer.alloc(64, i & 0xff));
    }
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns a structurally-valid snapshot', () => {
    const snap = collectResourceSnapshot(dir);
    expect(snap.cpuPercent).toBeGreaterThanOrEqual(0);
    expect(snap.cpuPercent).toBeLessThanOrEqual(100);
    expect(snap.memMb).toBeGreaterThanOrEqual(0);
    expect(snap.diskMb).toBeGreaterThanOrEqual(0);
    expect(snap.contextRatio).toBeGreaterThanOrEqual(0);
    expect(snap.contextRatio).toBeLessThanOrEqual(1);
    const r = ResourceSnapshotSchema.safeParse(snap);
    expect(r.success).toBe(true);
  });

  it('capturedAt is ISO 8601', () => {
    const snap = collectResourceSnapshot(dir);
    expect(() => new Date(snap.capturedAt)).not.toThrow();
    expect(snap.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('CLAUDE_CONTEXT_USAGE_PERCENT truthy branch', () => {
    const before = process.env.CLAUDE_CONTEXT_USAGE_PERCENT;
    try {
      process.env.CLAUDE_CONTEXT_USAGE_PERCENT = '37';
      const snap = collectResourceSnapshot(dir);
      expect(snap.contextRatio).toBeCloseTo(0.37, 5);
    } finally {
      if (before === undefined) delete process.env.CLAUDE_CONTEXT_USAGE_PERCENT;
      else process.env.CLAUDE_CONTEXT_USAGE_PERCENT = before;
    }
  });

  it('CLAUDE_CONTEXT_USAGE_PERCENT upper-clamp branch (>1 normalises to 1)', () => {
    const before = process.env.CLAUDE_CONTEXT_USAGE_PERCENT;
    try {
      process.env.CLAUDE_CONTEXT_USAGE_PERCENT = '250';
      const snap = collectResourceSnapshot(dir);
      expect(snap.contextRatio).toBe(1);
    } finally {
      if (before === undefined) delete process.env.CLAUDE_CONTEXT_USAGE_PERCENT;
      else process.env.CLAUDE_CONTEXT_USAGE_PERCENT = before;
    }
  });

  it('loadavg[0] ?? 0 nullish branch (empty loadavg array)', () => {
    // Empty loadavg → `loadavg[0]` is undefined → nullish-coalesce fires.
    const origCpus = mockState.os.cpus;
    const origLoadavg = mockState.os.loadavg;
    try {
      mockState.os.cpus = [{}];
      mockState.os.loadavg = [];
      const snap = collectResourceSnapshot(dir);
      expect(snap.cpuPercent).toBe(0);
    } finally {
      mockState.os.cpus = origCpus;
      mockState.os.loadavg = origLoadavg;
    }
  });

  it('cpus.length || 1 fallback branch (empty cpus array)', () => {
    // Empty cpus → `cpus.length || 1` returns 1 → loadAvg/1 = loadavg[0].
    // High loadavg → cpuPercent > 100 → clamps to 100.
    const origCpus = mockState.os.cpus;
    const origLoadavg = mockState.os.loadavg;
    try {
      mockState.os.cpus = [];
      mockState.os.loadavg = [2];
      const snap = collectResourceSnapshot(dir);
      expect(snap.cpuPercent).toBe(100);
    } finally {
      mockState.os.cpus = origCpus;
      mockState.os.loadavg = origLoadavg;
    }
  });

  it('Math.min(100, _) upper-clamp branch (load > cpus)', () => {
    const origCpus = mockState.os.cpus;
    const origLoadavg = mockState.os.loadavg;
    try {
      mockState.os.cpus = [{}];
      mockState.os.loadavg = [3];
      const snap = collectResourceSnapshot(dir);
      expect(snap.cpuPercent).toBe(100);
    } finally {
      mockState.os.cpus = origCpus;
      mockState.os.loadavg = origLoadavg;
    }
  });
});

describe('dirSizeMb cap (AC-1 / AC-2 / AC-3) and AC-6 catch paths', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(os.tmpdir(), 'peaks-job-snap-'));
    for (let i = 0; i < 100; i++) {
      writeFileSync(join(dir, `f-${i}.bin`), Buffer.alloc(64, i & 0xff));
    }
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('AC-1: default-unbounded returns original byte sum (via reference walk)', () => {
    const expectedBytes = referenceWalkBytes(dir);
    const expectedMb = Math.round(expectedBytes / 1024 / 1024);

    const result = dirSizeMb(dir);
    expect(result).toBe(expectedMb);
  });

  it('AC-3: default-signature backward compatibility (no opts) on bounded fixture', () => {
    const expectedBytes = referenceWalkBytes(dir);
    const expectedMb = Math.round(expectedBytes / 1024 / 1024);

    const resultLegacy = dirSizeMb(dir);
    expect(resultLegacy).toBe(expectedMb);

    const resultEmpty = dirSizeMb(dir, {});
    expect(resultEmpty).toBe(expectedMb);

    const resultZeroCap = dirSizeMb(dir, { maxEntries: 0 });
    expect(resultZeroCap).toBe(expectedMb);
  });

  it('AC-2: maxEntries cap is respected and partial sum is non-zero (lower bound)', () => {
    // Contract: `entries.length > cap ⇒ cap triggers and the returned
    // value is a lower-bound partial sum`. The smallest such fixture
    // is CAP + 1 entries; CAP and TOTAL are both arbitrary test-local
    // values (the prod caller always passes its own `maxEntries`).
    // A previous version used TOTAL=5500, CAP=5000 — a 5500-file
    // statSync loop that ran 27 minutes under cumulative fs-handle
    // pressure during `vitest run` (full suite) on Windows despite
    // 4-5s per-test runs. The contract is independent of magnitude;
    // we test the smallest case that exercises it.
    //
    // Slice-014b fix: ENTRY_SIZE=1024 with CAP=100 produced a partial
    // sum of 100 KiB which `Math.round(100 KiB / 1 MiB) → 0`. The old
    // assertion `expect(expectedMb).toBeGreaterThan(0)` was therefore
    // unsatisfiable on this fixture (NOT a service bug — `dirSizeMb`
    // is correct). ENTRY_SIZE=12 KiB keeps the fixture CAP-sized but
    // lifts the partial sum above 1 MiB so the rounded value is ≥ 1.
    // Calculated: (CAP × 12 KiB) = 1.2 MiB → Math.round → 1.
    const CAP = 100;
    const TOTAL = CAP + 1;
    const ENTRY_SIZE = 12 * 1024; // 12 KiB; CAP × 12 KiB = 1.2 MiB ⇒ rounds to 1

    const bigDir = mkdtempSync(join(os.tmpdir(), 'peaks-job-snap-big-'));
    try {
      for (let i = 0; i < TOTAL; i++) {
        writeFileSync(join(bigDir, `b-${i}.bin`), Buffer.alloc(ENTRY_SIZE, i & 0xff));
      }

      const allNames = readdirSync(bigDir);
      expect(allNames.length).toBeGreaterThan(CAP);

      const firstNames = allNames.slice(0, CAP);
      let partialBytes = 0;
      for (const name of firstNames) {
        partialBytes += realStatSync(join(bigDir, name)).size;
      }
      const expectedMb = Math.round(partialBytes / 1024 / 1024);
      expect(partialBytes).toBeGreaterThan(0);
      expect(expectedMb).toBeGreaterThan(0);

      const result = dirSizeMb(bigDir, { maxEntries: CAP });

      expect(result).toBe(expectedMb);
      expect(result).not.toBe(0);
    } finally {
      rmSync(bigDir, { recursive: true, force: true });
    }
  });

  it('AC-6 (1/2): outer readdirSync catch returns 0 when directory is missing', () => {
    const missing = join(os.tmpdir(), `/nope-missing-${Date.now()}-${Math.random()}`);
    const result = dirSizeMb(missing);
    expect(result).toBe(0);
  });

  it('AC-6 (2/2): inner per-entry statSync catch skips the throwing entry, sums survivors', () => {
    // Fixture: 12 survivor entries × 60_000 bytes = 720_000 bytes ≈ 0.687 MiB
    // ⇒ rounds to 1 MB. Plus one `zz-throw-target.bin` (1 MiB exactly).
    //   - inner-catch skips the throw-target: total = 720_000 → rounds to 1
    //   - throw-target included:           total = 1_768_576 → rounds to 2
    //   - outer-catch fired:                total = 0
    const fixDir = mkdtempSync(join(os.tmpdir(), 'peaks-job-snap-inner-'));
    try {
      for (let i = 0; i < 12; i++) {
        writeFileSync(join(fixDir, `s-${i}.dat`), Buffer.alloc(60000, 0xab));
      }
      const THROW_SIZE = 1024 * 1024;
      const throwPath = join(fixDir, 'zz-throw-target.bin');
      writeFileSync(throwPath, Buffer.alloc(THROW_SIZE, 0xcd));

      const precheck = realStatSync(throwPath);
      expect(precheck.size).toBe(THROW_SIZE);

      mockState.fs.throwOnStatPaths.add(throwPath);

      let result: number;
      try {
        result = dirSizeMb(fixDir);
      } finally {
        mockState.fs.throwOnStatPaths.delete(throwPath);
      }

      expect(result).toBe(1);
      expect(result).not.toBe(2);
      expect(result).not.toBe(0);
      expect(Number.isFinite(result)).toBe(true);
    } finally {
      rmSync(fixDir, { recursive: true, force: true });
    }
  });
});
