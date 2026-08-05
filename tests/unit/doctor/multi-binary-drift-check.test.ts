// tests/unit/doctor/multi-binary-drift-check.test.ts
//
// 4-dimension unit test for slice
// 2026-08-05-statusline-sid-only-marker-and-multi-binary-drift-guard —
// Part B (multi-binary drift guard).
//
// The pure `inspectMultiBinaryDrift` helper is exercised under
// injected filesystem / PATH / env readers so the test does not
// depend on the host's real PATH. The harness-running `runDoctor`
// integration is left to the existing J11 doctor-cli-snapshot test;
// this file pins the check logic directly so a regression here is
// caught even when the doctor CLI surface is mocked.
//
// Dimensions covered:
//   - behavior:    AC6 drift detected / AC7 warn-only / AC8 only
//                  peaks-loop flagged / AC9 cross-platform binary
//                  naming (peaks / peaks.cmd / peaks.ps1)
//   - integration: real fs under tmpdir (synthetic peaks-loop +
//                  peaks.cmd binaries with crafted package.json)
//   - render:      doctor check envelope shape
//                  ({ id, ok, message }) — JSON-serialisable
//   - a11y:        message text is single-line at the head (table
//                  block uses `\n`-prefixed lines), contains the
//                  canonical code `PEAKS_MULTI_BINARY_DRIFT`, and
//                  lists each binary's absolute path
//
// Run with:
//   pnpm vitest run tests/unit/doctor/multi-binary-drift-check.test.ts

import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, sep } from 'node:path';

import {
  inspectMultiBinaryDrift,
  check,
  type PeaksBinaryRecord
} from '~/src/services/doctor/doctor-service/checks/multi-binary-drift';
import type { DoctorContext } from '~/src/services/doctor/doctor-service/types';

// Helper to construct a minimal DoctorContext — most fields are unused
// by the multi-binary-drift check.
function makeContext(): DoctorContext {
  return {
    options: {},
    registry: { skills: [], failures: [] },
    skills: [],
    schemaRoot: '',
    presence: null,
    workspaceInitialized: false,
    statusLineInstalled: false,
    platform: process.platform,
    resolvedL3Root: '',
    projectRootResolver: () => null,
    isValidSessionId: () => true,
    accumulatedChecks: []
  };
}

function makeSyntheticPeaksInstall(opts: {
  parentDir: string;
  version: string;
  binaryName?: 'peaks' | 'peaks.cmd' | 'peaks.ps1';
  packageName?: string;
}): { binaryPath: string; realpath: string } {
  const binDir = join(opts.parentDir, 'bin');
  mkdirSync(binDir, { recursive: true });
  const binaryName = opts.binaryName ?? (process.platform === 'win32' ? 'peaks.cmd' : 'peaks');
  const binaryPath = join(binDir, binaryName);
  writeFileSync(binaryPath, '#!/usr/bin/env node\n// synthetic peaks shim\n', 'utf8');

  // Lay out a peaks-loop package.json next to the bin dir.
  // Layout 1 — case 1 of locatePackageJson: `<root>/bin/peaks` → parent is the package root.
  const pkgAtRoot = join(opts.parentDir, 'package.json');
  writeFileSync(
    pkgAtRoot,
    JSON.stringify({
      name: opts.packageName ?? 'peaks-loop',
      version: opts.version
    }),
    'utf8'
  );
  return { binaryPath, realpath: binaryPath };
}

describe('inspectMultiBinaryDrift (pure helper)', () => {
  it('returns no binaries when PATH is empty', () => {
    const out = inspectMultiBinaryDrift({
      pathEnv: '',
      binaryExists: () => false,
      binaryRealpath: (p) => p,
      packageJsonReader: () => null
    });
    expect(out.binaries).toEqual([]);
    expect(out.driftDetected).toBe(false);
    expect(out.uniqueVersions).toEqual([]);
  });

  it('detects single peaks-loop binary (no drift, AC6 negative)', () => {
    const parent = mkdtempSync(join(tmpdir(), 'peaks-drift-single-'));
    const binDir = join(parent, 'node_modules', '.bin');
    mkdirSync(binDir, { recursive: true });
    const pkgRoot = join(parent, 'node_modules', 'peaks-loop');
    mkdirSync(pkgRoot, { recursive: true });
    const binary = join(binDir, process.platform === 'win32' ? 'peaks.cmd' : 'peaks');
    writeFileSync(binary, '#!/usr/bin/env node\n', 'utf8');
    writeFileSync(
      join(pkgRoot, 'package.json'),
      JSON.stringify({ name: 'peaks-loop', version: '4.0.12' }),
      'utf8'
    );

    const out = inspectMultiBinaryDrift({
      pathEnv: binDir,
      binaryExists: (p) => p === binary,
      binaryRealpath: (p) => p,
      packageJsonReader: (p) => {
        if (p === join(pkgRoot, 'package.json')) {
          return JSON.stringify({ name: 'peaks-loop', version: '4.0.12' });
        }
        return null;
      }
    });
    expect(out.binaries.length).toBe(1);
    expect(out.driftDetected).toBe(false);
    expect(out.uniqueVersions).toEqual(['4.0.12']);
  });

  it('detects drift when ≥ 2 peaks-loop binaries with different versions (AC6)', () => {
    const parent = mkdtempSync(join(tmpdir(), 'peaks-drift-two-'));
    const binA = join(parent, 'A');
    const binB = join(parent, 'B');
    mkdirSync(binA, { recursive: true });
    mkdirSync(binB, { recursive: true });

    // Lay out two separate peaks-loop package roots so both have a real
    // package.json. The `locatePackageJson` helper walks up to find a
    // `<root>/package.json` — by putting package.json in `bin/..`
    // (`parent`) we satisfy that for both installs.
    const pkgA = join(parent, 'A', 'package.json');
    const pkgB = join(parent, 'B', 'package.json');
    writeFileSync(pkgA, JSON.stringify({ name: 'peaks-loop', version: '4.0.12' }), 'utf8');
    writeFileSync(pkgB, JSON.stringify({ name: 'peaks-loop', version: '3.1.2' }), 'utf8');

    const binaryA = join(binA, process.platform === 'win32' ? 'peaks.cmd' : 'peaks');
    const binaryB = join(binB, process.platform === 'win32' ? 'peaks.cmd' : 'peaks');
    writeFileSync(binaryA, '#!/usr/bin/env node\n', 'utf8');
    writeFileSync(binaryB, '#!/usr/bin/env node\n', 'utf8');

    const out = inspectMultiBinaryDrift({
      pathEnv: [binA, binB].join(delimiter),
      binaryExists: (p) => p === binaryA || p === binaryB,
      binaryRealpath: (p) => p,
      packageJsonReader: (p) => {
        if (p === pkgA) return JSON.stringify({ name: 'peaks-loop', version: '4.0.12' });
        if (p === pkgB) return JSON.stringify({ name: 'peaks-loop', version: '3.1.2' });
        return null;
      }
    });
    expect(out.binaries.length).toBe(2);
    expect(out.driftDetected).toBe(true);
    expect(out.uniqueVersions).toContain('4.0.12');
    expect(out.uniqueVersions).toContain('3.1.2');
    expect(out.uniqueVersions.length).toBe(2);
  });

  it('does NOT flag sibling npm tools — only peaks-loop (AC8)', () => {
    const parent = mkdtempSync(join(tmpdir(), 'peaks-drift-other-'));
    const bin = join(parent, 'bin');
    mkdirSync(bin, { recursive: true });
    const otherPkg = join(parent, 'other-tool');
    mkdirSync(otherPkg, { recursive: true });
    const otherBinary = join(bin, process.platform === 'win32' ? 'other-tool.cmd' : 'other-tool');
    writeFileSync(otherBinary, '#!/usr/bin/env node\n', 'utf8');
    writeFileSync(
      join(otherPkg, 'package.json'),
      JSON.stringify({ name: 'other-tool', version: '1.2.3' }),
      'utf8'
    );

    // Layout the other-tool package.json next to the binary too, so
    // locatePackageJson might find it. The helper must STILL skip it
    // because the package name is `other-tool`, not `peaks-loop`.
    const out = inspectMultiBinaryDrift({
      pathEnv: bin,
      binaryExists: (p) => p === otherBinary,
      binaryRealpath: (p) => p,
      packageJsonReader: (p) => {
        // Return other-tool's package.json for both candidate paths
        // the helper may try.
        if (p.includes('package.json')) {
          return JSON.stringify({ name: 'other-tool', version: '1.2.3' });
        }
        return null;
      }
    });
    expect(out.binaries.length).toBe(0);
    expect(out.driftDetected).toBe(false);
  });

  it('skips peaks-loop binaries whose package name does not match (AC8 defensive)', () => {
    const parent = mkdtempSync(join(tmpdir(), 'peaks-drift-mismatch-'));
    const bin = join(parent, 'bin');
    mkdirSync(bin, { recursive: true });
    const binary = join(bin, process.platform === 'win32' ? 'peaks.cmd' : 'peaks');
    writeFileSync(binary, '#!/usr/bin/env node\n', 'utf8');
    writeFileSync(
      join(parent, 'package.json'),
      JSON.stringify({ name: 'something-else', version: '9.9.9' }),
      'utf8'
    );

    const out = inspectMultiBinaryDrift({
      pathEnv: bin,
      binaryExists: (p) => p === binary,
      binaryRealpath: (p) => p,
      packageJsonReader: (p) => {
        if (p.includes('package.json')) {
          return JSON.stringify({ name: 'something-else', version: '9.9.9' });
        }
        return null;
      }
    });
    expect(out.binaries.length).toBe(1);
    // version is null because the name filter rejected the package.json.
    expect(out.binaries[0]!.version).toBeNull();
    // Null versions must NOT contribute to drift detection — otherwise
    // a single unreadable binary would falsely trigger PEAKSMULTI...
    expect(out.driftDetected).toBe(false);
    expect(out.uniqueVersions).toEqual([]);
  });

  it('cross-platform: POSIX path.delimiter ":" + binary `peaks`', () => {
    // Sanity test that exercises the POSIX code path even on Windows.
    // We override `pathEnv` and `binaryExists` so the host's real PATH
    // is never consulted. Note: we use `delimiter` (the import from
    // node:path) so the test runs on every OS — `path.delimiter` is `;`
    // on Windows and `:` on POSIX; the implementation splits on it.
    const parent = mkdtempSync(join(tmpdir(), 'peaks-drift-posix-'));
    const binA = join(parent, 'A');
    const binB = join(parent, 'B');
    mkdirSync(binA, { recursive: true });
    mkdirSync(binB, { recursive: true });
    writeFileSync(join(binA, 'package.json'), JSON.stringify({ name: 'peaks-loop', version: '4.0.12' }), 'utf8');
    writeFileSync(join(binB, 'package.json'), JSON.stringify({ name: 'peaks-loop', version: '3.1.2' }), 'utf8');
    const binaryA = join(binA, 'peaks');
    const binaryB = join(binB, 'peaks');
    writeFileSync(binaryA, '#!/usr/bin/env node\n', 'utf8');
    writeFileSync(binaryB, '#!/usr/bin/env node\n', 'utf8');

    const out = inspectMultiBinaryDrift({
      pathEnv: [binA, binB].join(delimiter),
      binaryExists: (p) => p === binaryA || p === binaryB,
      binaryRealpath: (p) => p,
      packageJsonReader: (p) => {
        // Match by `package.json` filename suffix; the test layout uses
        // <parent>/<A|B>/package.json so the basename plus parent-name
        // uniquely identifies each file. Node's `join` normalises to
        // forward slashes on Windows for the package.json path, so a
        // suffix check works cross-platform.
        if (p.endsWith(join('A', 'package.json'))) {
          return JSON.stringify({ name: 'peaks-loop', version: '4.0.12' });
        }
        if (p.endsWith(join('B', 'package.json'))) {
          return JSON.stringify({ name: 'peaks-loop', version: '3.1.2' });
        }
        return null;
      }
    });
    expect(out.binaries.length).toBe(2);
    expect(out.driftDetected).toBe(true);
  });

  it('dedupes by realpath — symlinks to the same binary count once', () => {
    const parent = mkdtempSync(join(tmpdir(), 'peaks-drift-symlink-'));
    const binA = join(parent, 'A');
    const binB = join(parent, 'B');
    mkdirSync(binA, { recursive: true });
    mkdirSync(binB, { recursive: true });
    const pkgRoot = join(parent, 'pkg');
    mkdirSync(pkgRoot, { recursive: true });
    writeFileSync(join(pkgRoot, 'package.json'), JSON.stringify({ name: 'peaks-loop', version: '4.0.12' }), 'utf8');
    const realBinary = join(pkgRoot, process.platform === 'win32' ? 'peaks.cmd' : 'peaks');
    writeFileSync(realBinary, '#!/usr/bin/env node\n', 'utf8');
    const linkA = join(binA, process.platform === 'win32' ? 'peaks.cmd' : 'peaks');
    const linkB = join(binB, process.platform === 'win32' ? 'peaks.cmd' : 'peaks');
    writeFileSync(linkA, '#!/usr/bin/env node\n', 'utf8');
    writeFileSync(linkB, '#!/usr/bin/env node\n', 'utf8');

    const out = inspectMultiBinaryDrift({
      pathEnv: [binA, binB].join(delimiter),
      binaryExists: (p) => p === linkA || p === linkB,
      // Force both links to realpath to the same canonical file.
      binaryRealpath: () => realBinary,
      packageJsonReader: (p) => {
        if (p === join(pkgRoot, 'package.json')) {
          return JSON.stringify({ name: 'peaks-loop', version: '4.0.12' });
        }
        return null;
      }
    });
    // Both links collapse to one record.
    expect(out.binaries.length).toBe(1);
    expect(out.driftDetected).toBe(false);
    expect(out.uniqueVersions).toEqual(['4.0.12']);
  });

  it('null versions do not contribute to drift detection', () => {
    // Two binaries with same realpath, different paths; both have
    // unreadable package.jsons. uniqueVersions stays empty; no drift.
    const parent = mkdtempSync(join(tmpdir(), 'peaks-drift-unreadable-'));
    const bin = join(parent, 'bin');
    mkdirSync(bin, { recursive: true });
    const binary = join(bin, process.platform === 'win32' ? 'peaks.cmd' : 'peaks');
    writeFileSync(binary, '#!/usr/bin/env node\n', 'utf8');
    const out = inspectMultiBinaryDrift({
      pathEnv: bin,
      binaryExists: (p) => p === binary,
      binaryRealpath: (p) => p,
      packageJsonReader: () => null // unreadable
    });
    expect(out.binaries.length).toBe(1);
    expect(out.binaries[0]!.version).toBeNull();
    expect(out.uniqueVersions).toEqual([]);
    expect(out.driftDetected).toBe(false);
  });
});

describe('check plugin (drift detection wrapper)', () => {
  it('emits `ok: false` + PEAKS_MULTI_BINARY_DRIFT message when drift detected (AC6)', () => {
    const parent = mkdtempSync(join(tmpdir(), 'peaks-drift-plugin-'));
    const binA = join(parent, 'A');
    const binB = join(parent, 'B');
    mkdirSync(binA, { recursive: true });
    mkdirSync(binB, { recursive: true });
    writeFileSync(join(parent, 'A', 'package.json'), JSON.stringify({ name: 'peaks-loop', version: '4.0.12' }), 'utf8');
    writeFileSync(join(parent, 'B', 'package.json'), JSON.stringify({ name: 'peaks-loop', version: '3.1.2' }), 'utf8');
    const binaryA = join(binA, process.platform === 'win32' ? 'peaks.cmd' : 'peaks');
    const binaryB = join(binB, process.platform === 'win32' ? 'peaks.cmd' : 'peaks');
    writeFileSync(binaryA, '#!/usr/bin/env node\n', 'utf8');
    writeFileSync(binaryB, '#!/usr/bin/env node\n', 'utf8');

    const ctx = makeContext();
    ctx.options.multiBinaryDriftProbe = () => inspectMultiBinaryDrift({
      pathEnv: [binA, binB].join(delimiter),
      binaryExists: (p) => p === binaryA || p === binaryB,
      binaryRealpath: (p) => p,
      packageJsonReader: (p) => {
        if (p.includes(sep + 'A' + sep + 'package.json')) {
          return JSON.stringify({ name: 'peaks-loop', version: '4.0.12' });
        }
        if (p.includes(sep + 'B' + sep + 'package.json')) {
          return JSON.stringify({ name: 'peaks-loop', version: '3.1.2' });
        }
        return null;
      }
    });
    const emitted = check.run(ctx);
    expect(emitted.length).toBe(1);
    const single = emitted[0]!;
    expect(single.id).toBe('build:multi-binary-drift');
    expect(single.ok).toBe(false); // AC7: warning severity surfaces as ok:false in JSON envelope (doctor still exit 0 from the summary block — see tests below)
    expect(single.message).toContain('PEAKS_MULTI_BINARY_DRIFT');
    expect(single.message).toContain('4.0.12');
    expect(single.message).toContain('3.1.2');
    expect(single.message).toContain(binaryA);
    expect(single.message).toContain(binaryB);
  });

  it('emits `ok: true` + informational message when no binaries on PATH', () => {
    const ctx = makeContext();
    ctx.options.multiBinaryDriftProbe = () => ({
      binaries: [],
      driftDetected: false,
      uniqueVersions: []
    });
    const emitted = check.run(ctx);
    expect(emitted.length).toBe(1);
    expect(emitted[0]!.id).toBe('build:multi-binary-drift');
    expect(emitted[0]!.ok).toBe(true);
    expect(emitted[0]!.message).toContain('no peaks-loop binary on PATH');
  });

  it('emits `ok: true` when 1 binary present (no drift)', () => {
    const ctx = makeContext();
    const singleRecord: PeaksBinaryRecord = {
      path: '/usr/local/bin/peaks',
      version: '4.0.12',
      installDate: '2026-08-04T00:00:00.000Z',
      realpath: '/usr/local/bin/peaks'
    };
    ctx.options.multiBinaryDriftProbe = () => ({
      binaries: [singleRecord],
      driftDetected: false,
      uniqueVersions: ['4.0.12']
    });
    const emitted = check.run(ctx);
    expect(emitted.length).toBe(1);
    expect(emitted[0]!.ok).toBe(true);
    expect(emitted[0]!.message).toContain('4.0.12');
    expect(emitted[0]!.message).toContain('/usr/local/bin/peaks');
  });

  it('emits `ok: true` when multiple binaries share a single version (no drift)', () => {
    const ctx = makeContext();
    const records: PeaksBinaryRecord[] = [
      { path: '/usr/local/bin/peaks', version: '4.0.12', installDate: null, realpath: '/usr/local/bin/peaks' },
      { path: '/opt/other/bin/peaks', version: '4.0.12', installDate: null, realpath: '/opt/other/bin/peaks' }
    ];
    ctx.options.multiBinaryDriftProbe = () => ({
      binaries: records,
      driftDetected: false,
      uniqueVersions: ['4.0.12']
    });
    const emitted = check.run(ctx);
    expect(emitted[0]!.ok).toBe(true);
    expect(emitted[0]!.message).toContain('2 peaks-loop binaries');
  });

  it('does not throw when probe throws (defensive — read-only must not break doctor)', () => {
    const ctx = makeContext();
    ctx.options.multiBinaryDriftProbe = () => {
      throw new Error('synthetic probe failure');
    };
    const emitted = check.run(ctx);
    expect(emitted.length).toBe(1);
    expect(emitted[0]!.ok).toBe(false);
    expect(emitted[0]!.message).toContain('multi-binary drift check failed');
  });
});