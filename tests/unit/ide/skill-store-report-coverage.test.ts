// tests/unit/ide/skill-store-report-coverage.test.ts
//
// The store report must describe the STORE.
//
// WHY THIS FILE EXISTS. The report the sync command shows used to be built from the
// PACKAGE's skill list: one row per skill peaks-loop ships. That is the package's
// slice of the store, not the store. Two things fell out of that:
//
//   - a skill the USER put in the store — their own copy, with no sidecar, which
//     peaks-loop never overwrites — was invisible in the report that claims to
//     describe the store. The report said "0 unmanaged" while their skill sat
//     there;
//   - an entry the store does NOT hold was reported as `current`, which says the
//     store holds a copy that is not behind. It holds no copy at all.
//
// THE ARMS. A store-only user skill is reported and counted as unmanaged; an absent
// entry is reported as absent; the counts cover every row.
//
// NOTHING HERE TOUCHES A REAL HOME. The canonical store is redirected through
// `PEAKS_HOME` and the install target is given explicitly, so every path in this
// file resolves inside the scratch tree.
//
// Dimensions covered:
//   - behavior:    the rows the installer reports for a store
//   - render:      the report line those rows produce
//   - integration: the real installer against a real store on disk
//   - a11y:        OMITTED — the human-facing wording of the line is asserted in
//                  the command's own test file, not here

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { renderStoreReport } from '~/src/cli/commands/core/skill-store-report';
import type { StoreEntryReport } from '~/src/services/skills/sync-service-support';
import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/ide/skill-store-report-coverage.test.ts',
  ['behavior', 'render', 'integration'],
  [
    {
      dim: 'a11y',
      reason: 'the human-facing wording of the report line is asserted in the command test file'
    }
  ]
);

const SCRATCH_ROOT = mkdtempSync(join(tmpdir(), 'peaks-store-report-coverage-'));
const PACKAGE_ROOT = join(SCRATCH_ROOT, 'package');
const STORE_ROOT = join(SCRATCH_ROOT, 'store');
const IDE_SKILLS_DIR = join(SCRATCH_ROOT, 'ide-skills');
const PACKAGE_SKILL = 'peaks-code';
const USER_SKILL = 'my-own-skill';

const previousPeaksHome = process.env.PEAKS_HOME;

type Installer = {
  installBundledSkills: (options: Record<string, unknown>) => {
    installed: string[];
    skipped: string[];
    entries: StoreEntryReport[];
  };
};

const installer = (await import('../../../scripts/install-skills.mjs')) as unknown as Installer;

/** A package that ships exactly one skill. */
function writePackage(): void {
  rmSync(PACKAGE_ROOT, { recursive: true, force: true });
  mkdirSync(join(PACKAGE_ROOT, 'skills', PACKAGE_SKILL), { recursive: true });
  writeFileSync(
    join(PACKAGE_ROOT, 'package.json'),
    `${JSON.stringify({ name: 'peaks-loop-fixture', version: '4.1.17' })}\n`,
    'utf8'
  );
  writeFileSync(join(PACKAGE_ROOT, 'skills', PACKAGE_SKILL, 'SKILL.md'), '# peaks-code\n', 'utf8');
}

/** A skill in the store that the package does not ship, and that nobody owns. */
function writeUserSkill(): void {
  const entry = join(STORE_ROOT, 'skills', USER_SKILL);
  mkdirSync(entry, { recursive: true });
  writeFileSync(join(entry, 'SKILL.md'), '# my own skill\n', 'utf8');
}

function install(
  options: Record<string, unknown> = {}
): ReturnType<Installer['installBundledSkills']> {
  return installer.installBundledSkills({
    packageRoot: PACKAGE_ROOT,
    targetRoot: IDE_SKILLS_DIR,
    ...options
  });
}

beforeEach(() => {
  rmSync(STORE_ROOT, { recursive: true, force: true });
  rmSync(IDE_SKILLS_DIR, { recursive: true, force: true });
  mkdirSync(IDE_SKILLS_DIR, { recursive: true });
  writePackage();
  process.env.PEAKS_HOME = STORE_ROOT;
});

afterAll(() => {
  if (previousPeaksHome === undefined) delete process.env.PEAKS_HOME;
  else process.env.PEAKS_HOME = previousPeaksHome;
  rmSync(SCRATCH_ROOT, { recursive: true, force: true });
});

describe('Scenario: behavior — the rows cover the store, not the package', () => {
  it('when the store holds a skill the package does not ship, should report it as unmanaged', () => {
    // given: a store holding a skill peaks-loop does not ship and does not own
    // when: the installer runs
    // then: the user's skill has a row, and the row says it is unmanaged — the
    //        report describes the store, not only the package's slice of it
    writeUserSkill();

    const result = install();

    const row = result.entries.find((entry) => entry.name === USER_SKILL);
    expect(row).toBeDefined();
    expect(row?.state).toBe('unmanaged');
    expect(row?.action).toBe('unmanaged');
  });

  it('when the store holds a skill this release no longer ships, should report it as retired', () => {
    // given: a store entry peaks-loop OWNS — it carries our sidecar — for a skill
    //        this release does not ship any more
    // when: the installer runs
    // then: the entry has a row, and the row says it is retired — ours, and no
    //        longer shipped — and the run removes it
    const retired = join(STORE_ROOT, 'skills', 'old-skill');
    mkdirSync(retired, { recursive: true });
    writeFileSync(join(retired, 'SKILL.md'), '# old\n', 'utf8');
    writeFileSync(
      `${retired}.peaks-managed`,
      `${JSON.stringify({
        format: 'peaks-managed-v2',
        path: '/old/peaks-code',
        version: '4.0.0'
      })}\n`,
      'utf8'
    );

    const result = install();

    const row = result.entries.find((entry) => entry.name === 'old-skill');
    expect(row?.state).toBe('retired');
    expect(row?.action).toBe('pruned');
    expect(existsSync(retired)).toBe(false);
  });

  it('when a dry run meets an entry the store does not hold, should report it as absent', () => {
    // given: an empty canonical store, and a package that ships one skill
    // when: the installer runs in dry-run mode
    // then: the entry is ABSENT — the store holds no copy of it, so it is not a
    //        current copy either — and the plan is on the action
    expect(existsSync(join(STORE_ROOT, 'skills'))).toBe(false);

    const result = install({ dryRun: true });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.name).toBe(PACKAGE_SKILL);
    expect(result.entries[0]?.state).toBe('absent');
    expect(result.entries[0]?.action).toBe('planned');
    expect(result.entries[0]?.version).toBeNull();
  });
});

describe('Scenario: render — the report line counts every row', () => {
  it('when the store holds a user skill the package does not ship, should name it and count it', () => {
    // given: a store holding a skill peaks-loop does not ship and does not own
    // when: the installer runs and the report is rendered from its rows
    // then: the line names the user's skill and counts it as unmanaged
    writeUserSkill();

    const result = install();
    const report = renderStoreReport(result.entries, false);

    expect(report).toContain('1 unmanaged');
    expect(report).toContain(USER_SKILL);
  });

  it('when a dry run meets an absent entry, should count it as absent and not as current', () => {
    // given: an empty canonical store
    // when: the installer runs in dry-run mode and the report is rendered
    // then: the entry is counted as absent, the counts add up to the number of
    //        rows, and no row is counted as current
    const result = install({ dryRun: true });
    const report = renderStoreReport(result.entries, true);

    expect(report).toContain('0 current');
    expect(report).toContain('1 absent');
    const counts = ['current', 'stale', 'unmanaged', 'retired', 'absent'].map((state) =>
      Number(report?.match(new RegExp(`(\\d+) ${state}`))?.[1] ?? '0')
    );
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(result.entries.length);
  });
});

describe('Scenario: integration — the rows match the store on disk', () => {
  it('when the installer runs against a real store, should report one row per store entry and one per package skill', () => {
    // given: a store holding the user's skill beside a package skill
    // when: the installer runs again
    // then: the store holds the package's copy AND the user's, and the report has
    //        a row for each — the package's copy is current, the user's is not
    //        ours and is never overwritten
    writeUserSkill();
    install();

    const result = install();

    expect(existsSync(join(STORE_ROOT, 'skills', PACKAGE_SKILL))).toBe(true);
    expect(existsSync(join(STORE_ROOT, 'skills', USER_SKILL))).toBe(true);
    expect(result.entries).toHaveLength(2);
    const byName = new Map(result.entries.map((entry) => [entry.name, entry]));
    expect(byName.get(PACKAGE_SKILL)?.state).toBe('current');
    expect(byName.get(USER_SKILL)?.state).toBe('unmanaged');
  });
});
