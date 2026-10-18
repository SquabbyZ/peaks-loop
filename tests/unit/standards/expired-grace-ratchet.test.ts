// tests/unit/standards/expired-grace-ratchet.test.ts
//
// A shrink-only ratchet for expired temporary-debt markers under `src/**`.
//
// THE DEBT THIS LOCKS. Temporary catches were annotated
// `// TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)` when
// the current version was 2.14. The grace period has long since passed (the
// tree is 4.1.6), and nothing enforced the expiry: 129 markers across 83
// tracked `.ts` files remain, so the "temporary" annotation is decorative.
// Fixing 129 catches at once is separate, riskier work; this file makes the
// debt SHRINK-ONLY instead. An expired marker may not appear in a file the
// baseline does not bless, a baselined count may not change, and a baseline
// entry may not outlive its last marker.
//
// WHY A RECORDED BASELINE AND NOT A ZERO FLOOR. A zero floor would fail on the
// tree the slice was written against, so it could never be committed. The
// baseline is the implementation-time measurement, and the ratchet direction is
// the mechanism: the only way this number moves is DOWN (fix a marker and
// shrink the entry) or sideways behind a deliberate, reviewable baseline edit.
//
// HOW A NEW MARKER IS CAUGHT. `git ls-files -z -- src` names the population —
// tracked files only, so an untracked scratch file cannot red the suite — and
// `.peaks/lint/expired-grace-baseline.json` says which files are allowed to
// carry how many expired markers. The comparison is the pure
// `compareBaseline`, which is also driven with a synthetic population in the
// control arm below so the failure direction is observed, not assumed.
//
// FAILURE MESSAGES. `describeViolations` renders the file, the line, the marker
// and the count; the `render` scenario pins that text.
//
// Omitting the `a11y` dimension: this guard has no human-visible surface of its
// own — it emits no stdout, no exit code and no message outside a vitest
// assertion, whose text is covered by `render`.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  compareBaseline,
  scanExpiredGrace,
  type BaselineViolation,
  type GraceBaseline,
  type GraceMarker
} from './_expired-grace-scan.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const BASELINE_PATH = join(REPO_ROOT, '.peaks/lint/expired-grace-baseline.json');

/** `package.json#version` is the source of truth for the current minor. */
const PACKAGE_VERSION = (
  JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as { version: string }
).version;
const CURRENT_MINOR = PACKAGE_VERSION.split('.').slice(0, 2).join('.');

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as GraceBaseline;

declareDimensions(
  'tests/unit/standards/expired-grace-ratchet.test.ts',
  ['behavior', 'integration', 'render'],
  [
    {
      dim: 'a11y',
      reason: 'no user-facing surface: emits no stdout, exit code or message of its own'
    }
  ]
);

/** Tracked `.ts` files under `src/` — exactly `git ls-files`, no untracked files. */
function trackedSrcTsFiles(): string[] {
  const listed = execFileSync('git', ['ls-files', '-z', '--', 'src'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    // Repo standard: every child_process call site pins this, or Windows flashes
    // a console window (tests/unit/spawn-windows-hide-guard.test.ts).
    windowsHide: true
  });
  return listed
    .split('\u0000')
    .filter((path) => path.endsWith('.ts'))
    .sort();
}

/** Repo-relative path → the EXPIRED markers measured in that file. */
function expiredPopulation(currentMinor: string): Map<string, GraceMarker[]> {
  const population = new Map<string, GraceMarker[]>();
  for (const path of trackedSrcTsFiles()) {
    const expired = scanExpiredGrace(
      readFileSync(join(REPO_ROOT, path), 'utf8'),
      currentMinor
    ).filter((marker) => marker.expired);
    if (expired.length > 0) population.set(path, expired);
  }
  return population;
}

function describeViolations(violations: readonly BaselineViolation[]): string {
  return violations
    .map((violation) => {
      switch (violation.kind) {
        case 'unblessed':
          return (
            `${violation.path}: ${violation.count} expired grace marker(s) in a file absent ` +
            `from the baseline — ${violation.markers
              .map((marker) => `line ${marker.line} '${marker.marker}'`)
              .join(', ')}`
          );
        case 'count-mismatch':
          return (
            `${violation.path}: ${violation.count} expired grace marker(s), ` +
            `baseline records ${violation.expected}`
          );
        case 'stale':
          return (
            `${violation.path}: baseline records expired grace markers, but the file now has ` +
            `${violation.count} — the ratchet may only shrink — remove this entry from the baseline`
          );
        default: {
          const exhaustive: never = violation;
          return exhaustive;
        }
      }
    })
    .join('\n');
}

// ── behavior: the detector can fail ─────────────────────────────────

describe('Scenario: behavior — the detector can fail, and only on expired markers', () => {
  const currentMinor = '4.1';

  it('flags an expired marker (v2.13.0 against 4.1)', () => {
    expect(
      scanExpiredGrace('// TODO(g2): grace: 1 minor release (v2.13.0)\n', currentMinor)
    ).toEqual([
      { line: 1, marker: 'grace: 1 minor release (v2.13.0)', version: 'v2.13.0', expired: true }
    ]);
  });

  it('does not flag a marker at the current minor (v4.1.0)', () => {
    expect(scanExpiredGrace('// grace: 1 minor release (v4.1.0)\n', currentMinor)).toEqual([
      { line: 1, marker: 'grace: 1 minor release (v4.1.0)', version: 'v4.1.0', expired: false }
    ]);
  });

  it('parses the comma spelling as well as the parenthesised one', () => {
    const markers = scanExpiredGrace('// grace: 1 minor release, v2.14.0)\n', currentMinor);
    expect(markers).toEqual([
      {
        line: 1,
        marker: 'grace: 1 minor release, v2.14.0)',
        version: 'v2.14.0',
        expired: true
      }
    ]);
  });

  it('treats an unversioned marker as expired', () => {
    expect(scanExpiredGrace('// grace: 1 minor release\n', currentMinor)).toEqual([
      { line: 1, marker: 'grace: 1 minor release', version: null, expired: true }
    ]);
  });

  it('ignores prose that does not spell a grace marker', () => {
    expect(
      scanExpiredGrace('// a temporary grace period remains, but this is prose\n', currentMinor)
    ).toEqual([]);
  });

  it('reports an unblessed file and a stale baseline entry from a synthetic population', () => {
    const population = new Map<string, readonly GraceMarker[]>([
      [
        'src/new.ts',
        [
          {
            line: 3,
            marker: 'grace: 1 minor release (v2.14.0)',
            version: 'v2.14.0',
            expired: true
          }
        ]
      ]
    ]);
    const synthetic: GraceBaseline = {
      version: 1,
      currentMinor,
      files: [{ path: 'src/gone.ts', occurrences: 1, versions: ['v2.14.0'] }]
    };

    expect(compareBaseline(population, synthetic)).toEqual([
      {
        kind: 'unblessed',
        path: 'src/new.ts',
        count: 1,
        markers: [
          {
            line: 3,
            marker: 'grace: 1 minor release (v2.14.0)',
            version: 'v2.14.0',
            expired: true
          }
        ]
      },
      { kind: 'stale', path: 'src/gone.ts', count: 0 }
    ]);
  });

  it('reports a baselined file whose expired-marker count changed', () => {
    const marker: GraceMarker = {
      line: 2,
      marker: 'grace: 1 minor release (v2.14.0)',
      version: 'v2.14.0',
      expired: true
    };
    const population = new Map<string, readonly GraceMarker[]>([
      ['src/known.ts', [marker, { ...marker, line: 9 }]]
    ]);
    const synthetic: GraceBaseline = {
      version: 1,
      currentMinor,
      files: [{ path: 'src/known.ts', occurrences: 1, versions: ['v2.14.0'] }]
    };

    expect(compareBaseline(population, synthetic)).toEqual([
      { kind: 'count-mismatch', path: 'src/known.ts', count: 2, expected: 1 }
    ]);
  });
});

// ── integration: the real tree against the recorded baseline ────────

describe('Scenario: integration — the ratchet walks tracked src/** and matches the baseline', () => {
  const filesFromGit = trackedSrcTsFiles();
  const population = expiredPopulation(CURRENT_MINOR);

  it('reaches a non-empty population of tracked src .ts files', () => {
    // A floor tied to the independent git enumeration. The real rule is the
    // comparison below: an empty population would turn every baseline entry
    // stale, so this cannot pass by seeing nothing while the baseline is
    // populated. It exists to name the enumeration as a thing that ran.
    expect(filesFromGit.length).toBeGreaterThan(0);
  });

  it('records the current minor (regenerate the baseline for a new minor)', () => {
    if (baseline.currentMinor !== CURRENT_MINOR) {
      const previouslyExpired = expiredPopulation(baseline.currentMinor);
      const newlyExpired: string[] = [];
      for (const [path, markers] of population) {
        const oldKeys = new Set(
          (previouslyExpired.get(path) ?? []).map(
            (marker) => `${marker.line}:${marker.version ?? 'unversioned'}`
          )
        );
        for (const marker of markers) {
          if (!oldKeys.has(`${marker.line}:${marker.version ?? 'unversioned'}`)) {
            newlyExpired.push(`${path}:${marker.line} '${marker.marker}'`);
          }
        }
      }
      throw new Error(
        `The baseline records currentMinor ${baseline.currentMinor}, but package.json is ` +
          `${CURRENT_MINOR}. Regenerate the baseline for the new minor. Newly expired markers:\n` +
          newlyExpired.join('\n')
      );
    }
    expect(baseline.currentMinor).toBe(CURRENT_MINOR);
  });

  const violations = compareBaseline(population, baseline);

  it('records every expired marker in a baselined file at the recorded count', () => {
    const unblessedOrChanged = violations.filter((violation) => violation.kind !== 'stale');
    expect(unblessedOrChanged, describeViolations(unblessedOrChanged)).toEqual([]);
  });

  it('has no stale baseline entry', () => {
    const stale = violations.filter((violation) => violation.kind === 'stale');
    expect(stale, describeViolations(stale)).toEqual([]);
  });
});

// ── render: the failure message ─────────────────────────────────────

describe('Scenario: render — the failure message names the file, line and marker', () => {
  it('names an unblessed file, its line, its marker and the count', () => {
    const message = describeViolations([
      {
        kind: 'unblessed',
        path: 'src/a.ts',
        count: 1,
        markers: [
          {
            line: 7,
            marker: 'grace: 1 minor release (v2.14.0)',
            version: 'v2.14.0',
            expired: true
          }
        ]
      }
    ]);
    expect(message).toContain('src/a.ts');
    expect(message).toContain('1 expired grace marker');
    expect(message).toContain('line 7');
    expect(message).toContain('grace: 1 minor release (v2.14.0)');
  });

  it('tells the reader to shrink a stale baseline entry', () => {
    const message = describeViolations([{ kind: 'stale', path: 'src/gone.ts', count: 0 }]);
    expect(message).toContain('src/gone.ts');
    expect(message).toContain('the ratchet may only shrink');
    expect(message).toContain('remove this entry from the baseline');
  });
});
