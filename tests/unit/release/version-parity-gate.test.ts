// tests/unit/release/version-parity-gate.test.ts
//
// rid 2026-10-03-release-gate-quote-brittle — pins the value-based readers that
// replaced publish.yml's inline greps. The failure mode this guards against is
// quote-tolerance degrading into version-tolerance, so every direction has an
// arm: equal value passes with single OR double quotes; a drifted value FAILS
// with the drift message (carrying the observed value, never an empty string);
// a missing file FAILS with the missing-artifact message; an unparseable file
// FAILS loudly instead of yielding ''.
//
// The tests run `runGate` — the exact function the workflow step executes via
// `node scripts/verify-version-parity.mjs <gate>` — so CI and this file cannot
// diverge.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  extractConstant,
  readConstantValue,
  runGate
} from '../../../scripts/verify-version-parity.mjs';

const projectRootOfRepo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-parity-gate-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** tarball-shaped fixture: package.json next to dist/version.js (type module). */
function writeDistVersionJs(body: string): string {
  const dir = join(root, 'package');
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'p', type: 'module' }));
  const file = join(dir, 'dist', 'version.js');
  writeFileSync(file, body);
  return file;
}

/** source-shaped fixture: TypeScript (not importable by node) like §(A′). */
function writeTsIndex(body: string): string {
  const file = join(root, 'index.ts');
  writeFileSync(file, body);
  return file;
}

const run = (name: string, file: string, expectValue: string) =>
  runGate(name, { file, expect: expectValue });

describe('parity gate arms — shared-dist (§A/§B, built .js)', () => {
  it('arm 1: single-quoted value equal to root → PASS (today\u2019s CI red turned green)', async () => {
    const file = writeDistVersionJs("export const CLI_VERSION = '4.1.0';\n");
    const r = await run('shared-dist', file, '4.1.0');
    expect(r.ok).toBe(true);
    expect(r.lines.join('\n')).toContain('On-disk CLI_VERSION alignment OK');
  });

  it('arm 2: double-quoted value equal to root → PASS (historical form keeps working)', async () => {
    const file = writeDistVersionJs('export const CLI_VERSION = "4.1.0";\n');
    const r = await run('shared-dist', file, '4.1.0');
    expect(r.ok).toBe(true);
  });

  it('arm 3: single-quoted value DIFFERENT → FAIL with the drift message', async () => {
    const file = writeDistVersionJs("export const CLI_VERSION = '4.0.54';\n");
    const r = await run('shared-dist', file, '4.1.0');
    expect(r.ok).toBe(false);
    expect(r.lines.join('\n')).toContain('title=CLI_VERSION drift');
    expect(r.lines.join('\n')).toContain('carries 4.0.54');
    expect(r.lines.join('\n')).not.toContain('carries  ');
  });

  it('arm 4: double-quoted value DIFFERENT → FAIL with the drift message', async () => {
    const file = writeDistVersionJs('export const CLI_VERSION = "4.0.54";\n');
    const r = await run('shared-dist', file, '4.1.0');
    expect(r.ok).toBe(false);
    expect(r.lines.join('\n')).toContain('title=CLI_VERSION drift');
    expect(r.lines.join('\n')).toContain('carries 4.0.54');
  });

  it('arm 5: missing built file → FAIL with the missing-artifact message, not empty-string drift', async () => {
    const r = await run('shared-dist', join(root, 'absent-package', 'dist', 'version.js'), '4.1.0');
    expect(r.ok).toBe(false);
    expect(r.lines.join('\n')).toContain('title=missing shared dist/version.js');
    expect(r.lines.join('\n')).not.toContain('drift');
  });

  it('tarball profile: missing version.js inside the extracted tarball → stale-tarball message', async () => {
    const r = await run('shared-tarball', join(root, 'package', 'dist', 'version.js'), '4.1.0');
    expect(r.ok).toBe(false);
    expect(r.lines.join('\n')).toContain('title=stale-tarball');
    expect(r.lines.join('\n')).not.toContain('drift');
  });
});

describe('parity gate arms — runtime-src (§A′, TypeScript source)', () => {
  it('single-quoted RUNTIME_VERSION equal → PASS', async () => {
    const file = writeTsIndex("export const RUNTIME_VERSION = '4.1.0';\n");
    const r = await run('runtime-src', file, '4.1.0');
    expect(r.ok).toBe(true);
    expect(r.lines.join('\n')).toContain('On-disk RUNTIME_VERSION alignment OK');
  });

  it('double-quoted RUNTIME_VERSION equal → PASS', async () => {
    const file = writeTsIndex('export const RUNTIME_VERSION = "4.1.0";\n');
    expect((await run('runtime-src', file, '4.1.0')).ok).toBe(true);
  });

  it('RUNTIME_VERSION drift (either quote) → FAIL with the drift message', async () => {
    const single = writeTsIndex("export const RUNTIME_VERSION = '4.0.36';\n");
    const r1 = await run('runtime-src', single, '4.1.0');
    expect(r1.ok).toBe(false);
    expect(r1.lines.join('\n')).toContain('RUNTIME_VERSION=4.0.36');
    rmSync(single);
    const double = writeTsIndex('export const RUNTIME_VERSION = "4.0.36";\n');
    const r2 = await run('runtime-src', double, '4.1.0');
    expect(r2.ok).toBe(false);
    expect(r2.lines.join('\n')).toContain('title=runtime CLI_VERSION drift');
  });

  it('missing src/index.ts → FAIL with the missing message', async () => {
    const r = await run('runtime-src', join(root, 'nope', 'index.ts'), '4.1.0');
    expect(r.ok).toBe(false);
    expect(r.lines.join('\n')).toContain('title=missing runtime src/index.ts');
  });
});

describe('reader internals — import first, extract second, fabricate never', () => {
  it('type:module dist is read by EVALUATING the built module (via import)', async () => {
    const file = writeDistVersionJs("export const CLI_VERSION = '4.1.0';\n");
    const read = await readConstantValue(file, 'CLI_VERSION');
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.value).toBe('4.1.0');
      expect(read.via).toBe('import');
    }
  });

  it('unquoted / absent constant → unparseable, never an empty value', async () => {
    const file = writeDistVersionJs('export const CLI_VERSION = 410;\n');
    const read = await readConstantValue(file, 'CLI_VERSION');
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.reason).toBe('unparseable');
    const gate = await run('shared-dist', file, '4.1.0');
    expect(gate.lines.join('\n')).toContain('unparseable');
  });

  it('extractor accepts single, double and backtick quotes but no bare tokens', () => {
    expect(extractConstant("const X = 'a.b.c';", 'X')).toBe('a.b.c');
    expect(extractConstant('const X = "a.b.c";', 'X')).toBe('a.b.c');
    expect(extractConstant('const X = `a.b.c`;', 'X')).toBe('a.b.c');
    expect(extractConstant('const X = a.b.c;', 'X')).toBeNull();
    expect(extractConstant('const X = "";', 'X')).toBeNull();
    expect(extractConstant('const OTHER = "1.0.0";', 'X')).toBeNull();
  });
});

describe('live repo smoke — the CLI entrypoint the workflow step runs', () => {
  // Not a fixture: this runs the real gate against this checkout, exactly as
  // publish.yml does. If the on-disk values drift or a reader regresses to a
  // brittle one, this arm goes red locally instead of in CI at publish time.
  it('node scripts/verify-version-parity.mjs shared-dist exits 0 on a built tree', () => {
    const distFile = 'packages/peaks-loop-shared/dist/version.js';
    if (!existsSync(join(projectRootOfRepo, distFile))) return; // unbuilt checkout — nothing to read
    const res = spawnSync(
      process.execPath,
      [join(projectRootOfRepo, 'scripts', 'verify-version-parity.mjs'), 'shared-dist'],
      { cwd: projectRootOfRepo, encoding: 'utf8', windowsHide: true }
    );
    expect(res.stdout).toContain('On-disk CLI_VERSION alignment OK');
    expect(res.status).toBe(0);
  });

  it('node scripts/verify-version-parity.mjs runtime-src exits 0 on this checkout', () => {
    const res = spawnSync(
      process.execPath,
      [join(projectRootOfRepo, 'scripts', 'verify-version-parity.mjs'), 'runtime-src'],
      { cwd: projectRootOfRepo, encoding: 'utf8', windowsHide: true }
    );
    expect(res.stdout).toContain('On-disk RUNTIME_VERSION alignment OK');
    expect(res.status).toBe(0);
  });
});
