// tests/unit/lint/silent-warning-detector.test.ts
//
// AC A2.3 — unit-test coverage for the G2 silent-warning detector (Slice A.2
// of v2-14-0-anti-fake-green-hardening). Each `describe` block exercises one
// of the 4 anti-patterns plus the two exemption paths (self-豁免 and the
// `// TODO(g2):` grace marker).
//
// The detector is loaded as an ESM module — the test file uses dynamic
// import() so the TypeScript Compiler API inside the detector is resolved
// lazily, mirroring the production code path.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const DETECTOR = join(REPO_ROOT, 'scripts', 'lint', 'silent-warning-detector.mjs');
const DETECTOR_URL = pathToFileURL(DETECTOR).href;

// Run the detector against a single temp file by passing its path as an
// explicit positional arg. Returns the parsed JSON envelope.
function runDetector(args: string[], cwd: string = REPO_ROOT): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [DETECTOR, ...args], { cwd, encoding: 'utf8' });
  return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function runOnSource(source: string, flags: string[] = ['--json']) {
  const dir = mkdtempSync(join(tmpdir(), 'peaks-swd-'));
  const file = join(dir, 'fixture.ts');
  writeFileSync(file, source);
  const r = runDetector([...flags, file]);
  return { dir, file, ...r };
}

// ---------- AC A2.1 — Pattern 1: empty-catch -----------------------------

describe('silent-warning-detector — pattern 1: empty-catch', () => {
  let r: ReturnType<typeof runOnSource>;
  beforeAll(() => {
    r = runOnSource(
      `function load() {\n  try { return JSON.parse('{}'); } catch {}\n}\n`,
    );
  });
  afterAll(() => {});

  test('flags empty catch clause', () => {
    const env = JSON.parse(r.stdout);
    expect(env.violationCount).toBeGreaterThanOrEqual(1);
    expect(env.violations.some((v: any) => v.rule === 'empty-catch')).toBe(true);
  });

  test('exits 1 on default mode', () => {
    expect(r.status).toBe(1);
  });
});

// ---------- AC A2.1 — Pattern 1 negative + catch with logging ------------

describe('silent-warning-detector — pattern 1 negative', () => {
  test('does NOT flag a catch that pushes to envelope.warnings', () => {
    const r = runOnSource(
      `function load(env: any) {\n  try { return JSON.parse('{}'); } catch (err) { env.warnings.push({ code: 'JSON_PARSE', err }); throw err; }\n}\n`,
    );
    const env = JSON.parse(r.stdout);
    expect(env.violations.some((v: any) => v.rule === 'empty-catch')).toBe(false);
    expect(env.violations.some((v: any) => v.rule === 'catch-return-null')).toBe(false);
  });
});

// ---------- AC A2.1 — Pattern 2: catch-return-null -----------------------

describe('silent-warning-detector — pattern 2: catch-return-null', () => {
  test('flags catch that returns null', () => {
    const r = runOnSource(
      `function getOrNull() {\n  try { return readConfig(); } catch { return null; }\n}\n`,
    );
    const env = JSON.parse(r.stdout);
    expect(env.violations.some((v: any) => v.rule === 'catch-return-null')).toBe(true);
  });

  test('flags catch that returns undefined', () => {
    const r = runOnSource(
      `async function loadAsync() {\n  try { return await fetchX(); } catch (e) { return undefined; }\n}\n`,
    );
    const env = JSON.parse(r.stdout);
    expect(env.violations.some((v: any) => v.rule === 'catch-return-null')).toBe(true);
  });

  test('does NOT flag a catch that returns a meaningful fallback object', () => {
    const r = runOnSource(
      `function getOrFallback() {\n  try { return readConfig(); } catch (err) { return { ok: false, error: err }; }\n}\n`,
    );
    const env = JSON.parse(r.stdout);
    expect(env.violations.some((v: any) => v.rule === 'catch-return-null')).toBe(false);
  });
});

// ---------- AC A2.1 — Pattern 3: promise-reject-no-cause -----------------

describe('silent-warning-detector — pattern 3: promise-reject-no-cause', () => {
  test('flags Promise.reject(string) without cause envelope', () => {
    const r = runOnSource(
      `function fail() { return Promise.reject('bad'); }\n`,
    );
    const env = JSON.parse(r.stdout);
    expect(env.violations.some((v: any) => v.rule === 'promise-reject-no-cause')).toBe(true);
  });

  test('does NOT flag Promise.reject(new Error(...))', () => {
    const r = runOnSource(
      `function fail() { return Promise.reject(new Error('bad')); }\n`,
    );
    const env = JSON.parse(r.stdout);
    expect(env.violations.some((v: any) => v.rule === 'promise-reject-no-cause')).toBe(false);
  });

  test('does NOT flag Promise.reject with cause envelope', () => {
    const r = runOnSource(
      `function fail(orig: unknown) { return Promise.reject({ code: 'X', cause: orig }); }\n`,
    );
    const env = JSON.parse(r.stdout);
    expect(env.violations.some((v: any) => v.rule === 'promise-reject-no-cause')).toBe(false);
  });
});

// ---------- AC A2.1 — Pattern 4: console.error-no-env --------------------

describe('silent-warning-detector — pattern 4: console-error-no-env', () => {
  test('flags console.error in function that never references envelope.warnings', () => {
    const r = runOnSource(
      `function reportFailure(err: unknown) {\n  console.error('failed', err);\n}\n`,
    );
    const env = JSON.parse(r.stdout);
    expect(env.violations.some((v: any) => v.rule === 'console-error-no-env')).toBe(true);
  });

  test('does NOT flag console.error in function that does push to envelope.warnings', () => {
    const r = runOnSource(
      `function reportFailure(err: unknown, env: { warnings: any[] }) {\n  console.error('failed', err);\n  env.warnings.push({ code: 'FAIL', err });\n}\n`,
    );
    const env = JSON.parse(r.stdout);
    expect(env.violations.some((v: any) => v.rule === 'console-error-no-env')).toBe(false);
  });
});

// ---------- AC A2.3 — self-豁免 (detector skips itself and test files) ----

describe('silent-warning-detector — self-exemption', () => {
  test('does NOT scan scripts/lint/ files (passing it as explicit path skips via isSelf)', () => {
    // We exercise the exported helper directly because the CLI scans src/
    // by default and never visits scripts/lint/.
    return import(DETECTOR_URL).then((mod: any) => {
      const detectorFile = join(REPO_ROOT, 'scripts', 'lint', 'silent-warning-detector.mjs');
      expect(mod.isSelf(detectorFile)).toBe(true);
      const testFile = join(REPO_ROOT, 'tests', 'unit', 'lint', 'silent-warning-detector.test.ts');
      expect(mod.isSelf(testFile)).toBe(true);
      // A normal src file is NOT exempt.
      const srcFile = join(REPO_ROOT, 'src', 'cli', 'index.ts');
      expect(mod.isSelf(srcFile)).toBe(false);
    });
  });

  test('CLI default scan does not visit scripts/lint/ or tests/unit/lint/', () => {
    // Running the detector against the repo root should NOT report any
    // violations from the detector source itself even though it contains
    // `} catch {` patterns in analyzeSource.
    const r = runDetector(['--json']);
    const env = JSON.parse(r.stdout);
    const detectorPaths = env.violations.filter((v: any) => v.file.includes('scripts/lint/'));
    expect(detectorPaths).toEqual([]);
    const testPaths = env.violations.filter((v: any) => v.file.includes('tests/unit/lint/'));
    expect(testPaths).toEqual([]);
  });
});

// ---------- AC A2.2 — // TODO(g2): grace marker --------------------------

describe('silent-warning-detector — TODO(g2) grace marker', () => {
  test('suppresses empty-catch violation when line carries // TODO(g2):', () => {
    const r = runOnSource(
      `function load() {\n  try { return JSON.parse('{}'); } catch (e) { /* TODO(g2): legacy */ }\n}\n`,
    );
    const env = JSON.parse(r.stdout);
    expect(env.violations.some((v: any) => v.rule === 'empty-catch')).toBe(false);
  });
});

// ---------- AC A2.2 — --warn-only mode ----------------------------------

describe('silent-warning-detector — exit codes (A2.2)', () => {
  test('default mode exits 1 when violations present', () => {
    const r = runOnSource(`function f() { try { return 1; } catch {} }\n`, []);
    expect(r.status).toBe(1);
  });

  test('--warn-only mode exits 0 even with violations', () => {
    const r = runOnSource(`function f() { try { return 1; } catch {} }\n`, ['--warn-only']);
    expect(r.status).toBe(0);
  });

  test('clean source exits 0 in default mode', () => {
    const r = runOnSource(
      `function clean(env: { warnings: any[] }) {\n  try { return 1; } catch (err) { env.warnings.push({ code: 'X', err }); throw err; }\n}\n`,
      [],
    );
    expect(r.status).toBe(0);
  });
});

// ---------- AC A2.3 — analyzeSource direct call --------------------------

describe('silent-warning-detector — analyzeSource direct API', () => {
  test('analyzeSource returns expected rule list for a multi-violation source', async () => {
    const mod = await import(DETECTOR_URL);
    const src = [
      `function a() { try { return 1; } catch {} }`,
      `function b() { try { return 2; } catch (e) { return null; } }`,
      `function c() { return Promise.reject('plain'); }`,
      `function d(err: unknown) { console.error('oops', err); }`,
    ].join('\n');
    const v = await mod.analyzeSourceAsync(src, 'virtual.ts');
    const rules = new Set(v.map((x: any) => x.rule));
    expect(rules.has('empty-catch')).toBe(true);
    expect(rules.has('catch-return-null')).toBe(true);
    expect(rules.has('promise-reject-no-cause')).toBe(true);
    expect(rules.has('console-error-no-env')).toBe(true);
  });
});