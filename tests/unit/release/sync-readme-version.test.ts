// tests/unit/release/sync-readme-version.test.ts
//
// Guards the 2026-09-10 fix to `scripts/sync-readme-version.mjs`.
//
// Why this test file exists:
//   publish.yml calls the script after every version bump to keep the
//   "Latest" / "最新版本" row in both READMEs in step with package.json#version.
//   The pre-fix pattern hardcoded `4\.0\.0` and described a backtick-link
//   shape the READMEs no longer use, so the script matched nothing, printed
//   "no-op (pattern not found)", and exited 0 — for many releases. The rows
//   rotted to two different versions (README.md 4.0.32 / README-en.md 4.0.17)
//   while package.json sat at 4.0.37, and the publish workflow never noticed.
//
//   The load-bearing assertions here are the exit codes: a row that does not
//   match MUST abort (exit 1). A test that only asserted the happy-path
//   rewrite would re-admit the exact defect this file exists to prevent.
//
// Dimensions covered:
//   - render:      stdout lines distinguish "updated" / "already in sync"
//   - behavior:    on-disk row after the run; per-file date spacing preserved
//   - integration: subprocess spawn in a tmp cwd; CHANGELOG.md date source
//   - a11y:        exit codes and the human-readable stderr for a bad row

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions('tests/unit/release/sync-readme-version.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y',
]);

// ---- harness ---------------------------------------------------------------

// The two READMEs genuinely disagree on the spacing before the date; the
// script must accept both and rewrite neither.
const rowZh = (version: string, date: string): string =>
  `| **最新版本** | [![npm](https://img.shields.io/npm/v/peaks-loop)](https://www.npmjs.com/package/peaks-loop) — ${version}(${date}) |`;
const rowEn = (version: string, date: string): string =>
  `| **Latest** | [![npm](https://img.shields.io/npm/v/peaks-loop)](https://www.npmjs.com/package/peaks-loop) — ${version} (${date}) |`;

// A second row is included so a too-greedy pattern (one that matched past the
// version) would corrupt an unrelated line and fail the whole-file assertion.
const readme = (row: string, other: string): string =>
  `# peaks-loop\n\n| | |\n| --- | --- |\n${row}\n| **覆盖域** | ${other} |\n`;

interface Harness {
  cwd: string;
}

let active: Harness | null = null;
const createdDirs: string[] = [];

interface FixtureOptions {
  version: string;
  zhRow?: string;
  enRow?: string;
  changelog?: string | null;
}

function setupHarness(opts: FixtureOptions): Harness {
  const cwd = mkdtempSync(join(tmpdir(), 'peaks-sync-readme-'));
  createdDirs.push(cwd);
  writeFileSync(
    join(cwd, 'package.json'),
    JSON.stringify({ name: 'peaks-loop', version: opts.version }, null, 2) + '\n',
    'utf8',
  );
  writeFileSync(join(cwd, 'README.md'), readme(opts.zhRow ?? rowZh('4.0.32', '2026-09-08'), '代码'), 'utf8');
  writeFileSync(join(cwd, 'README-en.md'), readme(opts.enRow ?? rowEn('4.0.17', '2026-08-07'), 'Code'), 'utf8');
  if (opts.changelog !== null) {
    writeFileSync(
      join(cwd, 'CHANGELOG.md'),
      opts.changelog ?? `# Changelog\n\n## ${opts.version} — 2026-09-10 (test fixture)\n\n- body\n`,
      'utf8',
    );
  }
  active = { cwd };
  return active;
}

function runSync(): { status: number | null; stdout: string; stderr: string } {
  if (!active) throw new Error('runSync called without active harness');
  const scriptPath = resolve(__dirname, '..', '..', '..', 'scripts', 'sync-readme-version.mjs');
  if (!existsSync(scriptPath)) {
    throw new Error(`sync-readme-version.mjs not found at ${scriptPath}`);
  }
  const r = spawnSync(process.execPath, [scriptPath], {
    cwd: active.cwd,
    encoding: 'utf8',
    shell: false,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const read = (file: string): string => readFileSync(join(active!.cwd, file), 'utf8');

afterEach(() => {
  if (active !== null) rmSync(active.cwd, { recursive: true, force: true });
  active = null;
});

afterAll(() => {
  expect(createdDirs.filter((dir) => existsSync(dir))).toEqual([]);
});

// ---- render dimension ------------------------------------------------------

describe('Scenario: (render) — updated vs already-in-sync lines are distinguishable', () => {
  it('when invoked, should print one "updated" line per file and a total line', () => {
    // given: a stale tree at package.json 4.0.37
    setupHarness({ version: '4.0.37' });
    // when:  the script runs
    const r = runSync();
    // then:  each file reports its own update
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('[sync-readme-version] updated README.md (1 occurrence(s)) -> 4.0.37');
    expect(r.stdout).toContain('[sync-readme-version] updated README-en.md (1 occurrence(s)) -> 4.0.37');
    expect(r.stdout).toContain('[sync-readme-version] total 2 occurrence(s) updated to 4.0.37');
  });

  it('when invoked, should a second run reports "already in sync" and exits 0', () => {
    // given: an already-synced tree (the script just ran)
    setupHarness({ version: '4.0.37' });
    runSync();
    // when:  it runs again
    const r = runSync();
    // then:  idempotent — no write, no failure, and it says so
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('README.md already in sync (1 row(s) matched) -> 4.0.37');
    expect(r.stdout).toContain('total 0 occurrence(s) updated to 4.0.37');
  });
});

// ---- behavior dimension ----------------------------------------------------

describe('Scenario: (behavior) — only the version label moves', () => {
  it('when invoked, should rewrites both rows to the current version', () => {
    setupHarness({ version: '4.0.37' });
    const r = runSync();
    expect(r.status).toBe(0);
    expect(read('README.md')).toBe(readme(rowZh('4.0.37', '2026-09-10'), '代码'));
    expect(read('README-en.md')).toBe(readme(rowEn('4.0.37', '2026-09-10'), 'Code'));
  });

  it('when invoked, should keeps each file\'s own spacing before the date', () => {
    // given: README.md uses `4.0.32(…<date>)`, README-en.md uses `4.0.17 (…<date>)`
    setupHarness({ version: '4.0.37' });
    // when:  the script runs
    runSync();
    // then:  neither spacing was "fixed" — the no-space and space forms survive
    expect(read('README.md')).toContain('— 4.0.37(2026-09-10) |');
    expect(read('README-en.md')).toContain('— 4.0.37 (2026-09-10) |');
  });

  it('when invoked, should replaces a non-4.0.0 label (the old pattern was hardcoded)', () => {
    // given: the row carries a prerelease label the literal `4\.0\.0` pattern never matched
    setupHarness({ version: '4.0.37', zhRow: rowZh('4.0.0-beta.27', '2026-07-01') });
    // when:  the script runs
    const r = runSync();
    // then:  it is matched and replaced
    expect(r.status).toBe(0);
    expect(read('README.md')).toContain('— 4.0.37(2026-09-10) |');
  });

  it('when invoked, should keeps the row date when CHANGELOG has no heading for the version', () => {
    // given: a CHANGELOG that does not mention 4.0.37
    setupHarness({ version: '4.0.37', changelog: '# Changelog\n\n## 4.0.36 — 2026-09-01 (old)\n' });
    // when:  the script runs
    const r = runSync();
    // then:  the version moves, the date is NOT invented
    expect(r.status).toBe(0);
    expect(read('README.md')).toBe(readme(rowZh('4.0.37', '2026-09-08'), '代码'));
    expect(r.stderr).toContain('keeping each README row');
  });
});

// ---- integration dimension -------------------------------------------------

describe('Scenario: (integration) — date comes from the release CHANGELOG, runs from a tmp cwd', () => {
  it('when invoked, should takes the date from the `## <version> — <date>` heading', () => {
    setupHarness({ version: '4.0.37', changelog: '# Changelog\n\n## 4.0.37 — 2026-09-10 (h)\n' });
    const r = runSync();
    expect(r.status).toBe(0);
    expect(read('README.md')).toContain('— 4.0.37(2026-09-10) |');
    expect(r.stdout).not.toContain('warn:');
  });

  it('when invoked, should still sync (exit 0) when CHANGELOG.md is missing entirely', () => {
    setupHarness({ version: '4.0.37', changelog: null });
    const r = runSync();
    expect(r.status).toBe(0);
    expect(read('README.md')).toContain('— 4.0.37(2026-09-08) |');
  });
});

// ---- a11y dimension --------------------------------------------------------

describe('Scenario: (a11y) — an unmatched row aborts the publish instead of passing quietly', () => {
  it('when invoked, should exit 1 and name the file when one row is unrecognisable', () => {
    // given: README-en.md's row was reformatted into a shape the pattern does not describe
    setupHarness({ version: '4.0.37', enRow: '| **Release** | — 4.0.17 (2026-08-07) |' });
    // when:  the script runs
    const r = runSync();
    // then:  loud failure, not the pre-fix "no-op (pattern not found)" + exit 0
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('ERROR: version row not found in README-en.md');
    expect(r.stderr).toContain('Refusing to exit 0 with a stale version row');
    // and the still-matching file is left correctly synced
    expect(read('README.md')).toContain('— 4.0.37(2026-09-10) |');
  });

  it('when invoked, should exit 1 without touching either file when both rows are unrecognisable', () => {
    setupHarness({
      version: '4.0.37',
      zhRow: '| **版本** | 4.0.32 |',
      enRow: '| **Version** | 4.0.17 |',
    });
    const r = runSync();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('README.md, README-en.md');
    expect(read('README.md')).toContain('| **版本** | 4.0.32 |');
    expect(read('README-en.md')).toContain('| **Version** | 4.0.17 |');
  });
});
