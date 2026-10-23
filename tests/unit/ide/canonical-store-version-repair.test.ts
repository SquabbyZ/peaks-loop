// tests/unit/ide/canonical-store-version-repair.test.ts
//
// THE DOWNSTREAM MACHINE'S SHAPE, END TO END.
//
// A machine installed peaks-loop, then sat on a store whose copy came from an
// older release. The IDE links pointed into that store, so the store was
// self-consistent and the parity check — which compares the store against the
// IDE trees — had nothing to say. Nothing named the staleness, so the skill
// stayed frozen until a skill's prose cited a file the old release did not
// ship.
//
// This file walks that shape and then the repair:
//
//   install  →  replace the store's copy with an older version  →  the doctor
//   check names the drift  →  run the repair  →  the store is current and the
//   doctor check is quiet again.
//
// NO REAL $HOME IS TOUCHED. The package is a fixture, the canonical store is
// redirected through `PEAKS_HOME`, and the IDE directory is a fixture too.
//
// Dimensions covered:
//   - behavior:    the states the install reports, and the drift it repairs
//   - integration: the real installer, the real store, and the real doctor check
//   - render:      OMITTED — the installer prints nothing here; the doctor check
//                  is exercised through its own return value
//   - a11y:        OMITTED — the message is asserted in the doctor check's own
//                  test file, not here

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { inspectCanonicalStoreVersions } from '~/src/services/doctor/doctor-service/checks/canonical-store-version';
import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/ide/canonical-store-version-repair.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'the installer writes no human-facing output in this file' },
    { dim: 'a11y', reason: 'the doctor message is asserted in the doctor check own test file' }
  ]
);

const installer = (await import('../../../scripts/install-skills.mjs')) as unknown as {
  installBundledSkills: (options: Record<string, unknown>) => {
    installed: string[];
    skipped: string[];
    entries: Array<{
      name: string;
      state: string;
      action: string;
      version: string | null;
      reason: string | null;
    }>;
  };
};

const storeMod = (await import('../../../scripts/canonical-store.mjs')) as unknown as {
  readManagedMarker: (targetPath: string) => { path: string | null; version: string | null } | null;
};

const FIXTURE_ROOT = mkdtempSync(join(tmpdir(), 'peaks-store-repair-'));
const PACKAGE_ROOT = join(FIXTURE_ROOT, 'package');
const STORE_ROOT = join(FIXTURE_ROOT, 'canonical-store');
const IDE_SKILLS_DIR = join(FIXTURE_ROOT, 'ide-skills');

const INSTALLED_VERSION = '4.1.17';
const OLD_VERSION = '4.1.15';
const CURRENT_BODY = '# peaks-code\n\nthe 4.1.17 release.\n';
const OLD_BODY = '# peaks-code\n\nthe 4.1.15 release.\n';

/**
 * The LEGACY v1 JSON sidecar — the shape the pre-canonical-store installer wrote for
 * the agents and output-styles families. It carries a version of its own (the
 * MARKER's version, not the release), so the store's reader cannot read a release
 * out of it: the whole blob is the recorded path and the release is unknown.
 */
const LEGACY_V1_MARKER = JSON.stringify({
  version: 1,
  kind: 'agent',
  agentName: 'peaks-code',
  sourcePath: '/nowhere/peaks-loop/skills/peaks-code',
  contentSha256: '0'.repeat(64)
});

const previousPeaksHome = process.env.PEAKS_HOME;

afterAll(() => {
  if (previousPeaksHome === undefined) delete process.env.PEAKS_HOME;
  else process.env.PEAKS_HOME = previousPeaksHome;
  rmSync(FIXTURE_ROOT, { recursive: true, force: true });
});

/** A package that ships one skill, at the given version. */
function writePackage(version: string): void {
  rmSync(PACKAGE_ROOT, { recursive: true, force: true });
  mkdirSync(join(PACKAGE_ROOT, 'skills', 'peaks-code'), { recursive: true });
  writeFileSync(
    join(PACKAGE_ROOT, 'package.json'),
    `${JSON.stringify({ name: 'peaks-loop-fixture', version })}\n`,
    'utf8'
  );
  writeFileSync(join(PACKAGE_ROOT, 'skills', 'peaks-code', 'SKILL.md'), CURRENT_BODY, 'utf8');
}

/** Run the installer against the fixture package, store and IDE directory. */
function install(): ReturnType<typeof installer.installBundledSkills> {
  return installer.installBundledSkills({
    packageRoot: PACKAGE_ROOT,
    targetRoot: IDE_SKILLS_DIR
  });
}

beforeEach(() => {
  rmSync(STORE_ROOT, { recursive: true, force: true });
  rmSync(IDE_SKILLS_DIR, { recursive: true, force: true });
  mkdirSync(IDE_SKILLS_DIR, { recursive: true });
  writePackage(INSTALLED_VERSION);
  process.env.PEAKS_HOME = STORE_ROOT;
});

describe('Scenario: behavior — the install reports what the store holds', () => {
  it('when the installer runs against a fresh store, should report the entry as absent', () => {
    // given: a package that ships one skill, and an empty canonical store
    // when: the installer runs
    // then: the entry is reported as ABSENT — the store held no copy of it, and
    //        "current" would claim it holds one that is not behind — and the copy
    //        the run made carries the version that produced it
    const result = install();
    expect(result.entries.map((entry) => entry.name)).toEqual(['peaks-code']);
    expect(result.entries[0]?.state).toBe('absent');
    const marker = JSON.parse(
      readFileSync(join(STORE_ROOT, 'skills', 'peaks-code.peaks-managed'), 'utf8')
    ) as Record<string, unknown>;
    expect(marker['version']).toBe(INSTALLED_VERSION);
  });

  it('when the store holds an older version, should report the entry as stale', () => {
    // given: an installed store whose copy was made by an older release
    // when: the installer runs again
    // then: the entry is reported as stale, and the reason is named
    install();
    const canonicalPath = join(STORE_ROOT, 'skills', 'peaks-code');
    writeFileSync(join(canonicalPath, 'SKILL.md'), OLD_BODY, 'utf8');
    writeFileSync(
      `${canonicalPath}.peaks-managed`,
      `${JSON.stringify({
        format: 'peaks-managed-v2',
        path: join(PACKAGE_ROOT, 'skills', 'peaks-code'),
        version: OLD_VERSION
      })}\n`,
      'utf8'
    );
    const result = install();
    expect(result.entries[0]?.state).toBe('stale');
    expect(result.entries[0]?.reason).toBe('version');
  });
});

describe('Scenario: integration — the downstream shape, and the repair', () => {
  it('when a store is frozen at an old version, should be named by the doctor check and repaired by the install', () => {
    // given: an installed store, then the copy replaced by an OLDER version
    //        behind a LEGACY sidecar — the exact shape of the downstream machine
    // when: the doctor check is asked whether the store is behind
    // then: the drift is NAMED — the store was silent before this check existed
    install();
    const canonicalPath = join(STORE_ROOT, 'skills', 'peaks-code');
    writeFileSync(join(canonicalPath, 'SKILL.md'), OLD_BODY, 'utf8');
    writeFileSync(
      `${canonicalPath}.peaks-managed`,
      `${join(PACKAGE_ROOT, 'skills', 'peaks-code')}\n`,
      'utf8'
    );
    const storeRoot = join(STORE_ROOT, 'skills');

    const before = inspectCanonicalStoreVersions(storeRoot, INSTALLED_VERSION);

    expect(before.stale.map((entry) => entry.name)).toEqual(['peaks-code']);
    expect(before.stale[0]?.version).toBeNull();

    // when: the repair runs
    install();

    // then: the store holds the current bytes behind a sidecar that records the
    //        current version, and the doctor check is quiet again
    expect(readFileSync(join(canonicalPath, 'SKILL.md'), 'utf8')).toBe(CURRENT_BODY);
    const marker = JSON.parse(readFileSync(`${canonicalPath}.peaks-managed`, 'utf8')) as Record<
      string,
      unknown
    >;
    expect(marker['format']).toBe('peaks-managed-v2');
    expect(marker['version']).toBe(INSTALLED_VERSION);
    const after = inspectCanonicalStoreVersions(storeRoot, INSTALLED_VERSION);
    expect(after.stale).toHaveLength(0);
    expect(after.managed).toBe(1);
  });

  it('when the recorded path of the marker is stale, should correct it and still refresh a version-behind store', () => {
    // given: a store copy made by an OLDER release, whose sidecar names a package
    //        path that no longer exists — the global install that was replaced
    // when: the repair runs
    // then: the copy is refreshed and the sidecar names the CURRENT source — the
    //        dead path is corrected rather than trusted
    install();
    const canonicalPath = join(STORE_ROOT, 'skills', 'peaks-code');
    writeFileSync(join(canonicalPath, 'SKILL.md'), OLD_BODY, 'utf8');
    writeFileSync(
      `${canonicalPath}.peaks-managed`,
      `${JSON.stringify({
        format: 'peaks-managed-v2',
        path: join(PACKAGE_ROOT, 'package-4.1.9', 'skills', 'peaks-code'),
        version: OLD_VERSION
      })}\n`,
      'utf8'
    );

    install();

    expect(readFileSync(join(canonicalPath, 'SKILL.md'), 'utf8')).toBe(CURRENT_BODY);
    const marker = JSON.parse(readFileSync(`${canonicalPath}.peaks-managed`, 'utf8')) as Record<
      string,
      unknown
    >;
    expect(marker['path']).toBe(join(PACKAGE_ROOT, 'skills', 'peaks-code'));
    expect(marker['version']).toBe(INSTALLED_VERSION);
  });

  it('when the store is dry-run inspected, should report the staleness and write nothing', () => {
    // given: an installed store whose copy was made by an older release
    // when: the installer runs in dry-run mode
    // then: the staleness is reported, and the store is untouched — the sidecar
    //        still names the old version, because a plan writes nothing
    install();
    const canonicalPath = join(STORE_ROOT, 'skills', 'peaks-code');
    writeFileSync(join(canonicalPath, 'SKILL.md'), OLD_BODY, 'utf8');
    writeFileSync(
      `${canonicalPath}.peaks-managed`,
      `${JSON.stringify({
        format: 'peaks-managed-v2',
        path: join(PACKAGE_ROOT, 'skills', 'peaks-code'),
        version: OLD_VERSION
      })}\n`,
      'utf8'
    );

    const result = installer.installBundledSkills({
      packageRoot: PACKAGE_ROOT,
      targetRoot: IDE_SKILLS_DIR,
      dryRun: true
    });

    expect(result.entries[0]?.state).toBe('stale');
    expect(readFileSync(join(canonicalPath, 'SKILL.md'), 'utf8')).toBe(OLD_BODY);
    const marker = JSON.parse(readFileSync(`${canonicalPath}.peaks-managed`, 'utf8')) as Record<
      string,
      unknown
    >;
    expect(marker['version']).toBe(OLD_VERSION);
  });

  it('when a store entry carries a legacy v1 JSON sidecar, should refresh it and rewrite the sidecar in the v2 shape', () => {
    // given: an installed store whose copy carries the LEGACY v1 JSON sidecar — the
    //        shape the pre-canonical-store installer wrote — with a version nobody
    //        can read out of it
    // when: the repair runs
    // then: the copy is refreshed — a copy that cannot name its version is stale —
    //        and the sidecar is rewritten in the shape this build writes
    install();
    const canonicalPath = join(STORE_ROOT, 'skills', 'peaks-code');
    writeFileSync(`${canonicalPath}.peaks-managed`, `${LEGACY_V1_MARKER}\n`, 'utf8');

    const result = install();

    expect(result.entries[0]?.state).toBe('stale');
    expect(result.entries[0]?.reason).toBe('version');
    const marker = JSON.parse(readFileSync(`${canonicalPath}.peaks-managed`, 'utf8')) as Record<
      string,
      unknown
    >;
    expect(marker['format']).toBe('peaks-managed-v2');
    expect(marker['version']).toBe(INSTALLED_VERSION);
    expect(marker['path']).toBe(join(PACKAGE_ROOT, 'skills', 'peaks-code'));
  });

  it('when a legacy v1 JSON sidecar is read, should answer with the whole blob as the path and no version', () => {
    // given: a store entry whose sidecar holds the legacy v1 JSON marker
    // when: the sidecar is read
    // then: the path is the whole blob and the version is null — the old reader's
    //        answer, unchanged. "Version unknown" is what makes the copy stale, and
    //        that is why the repair above refreshes it.
    install();
    const canonicalPath = join(STORE_ROOT, 'skills', 'peaks-code');
    writeFileSync(`${canonicalPath}.peaks-managed`, `${LEGACY_V1_MARKER}\n`, 'utf8');

    const marker = storeMod.readManagedMarker(canonicalPath);

    expect(marker?.path).toBe(LEGACY_V1_MARKER);
    expect(marker?.version).toBeNull();
  });
});
