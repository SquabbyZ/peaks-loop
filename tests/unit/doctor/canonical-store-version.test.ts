// tests/unit/doctor/canonical-store-version.test.ts
//
// 4-dimension unit test for the `skills:store-version` doctor check.
//
// THE GAP IT FILLS. The store's parity check compares the canonical store with
// the IDE trees — and on a normal install the IDE entry is a LINK INTO the
// store, so both sides are the same tree and the comparison is always in
// parity. A store frozen at an old release is perfectly self-consistent, and
// therefore invisible. This check makes the OTHER comparison: the store's
// recorded version against the installed package's version.
//
// THREE OUTCOMES, AND ALL THREE ARE ROWS:
//   - a store behind the installed version  → the check FAILS, with the remedy
//   - a store at the installed version       → the check PASSES, and says so
//   - no store at all                        → INFORMATIONAL, never a red
//
// IT ALWAYS EMITS A ROW. A check that stays silent when it finds nothing
// cannot be told apart from one that never ran.
//
// Every store is a temp directory; the real home is never read.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { schemasDir } from 'peaks-loop-shared/paths';

import {
  check as canonicalStoreVersionCheck,
  inspectCanonicalStoreVersions
} from '~/src/services/doctor/doctor-service/checks/canonical-store-version';
import { PLUGINS } from '~/src/services/doctor/doctor-service/plugin-registry';
import type {
  DoctorCheck,
  DoctorContext,
  DoctorOptions
} from '~/src/services/doctor/doctor-service/types';
import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions('tests/unit/doctor/canonical-store-version.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const INSTALLED = '4.1.17';
const BEHIND = '4.1.15';

const temps: string[] = [];

afterEach(() => {
  for (const temp of temps.splice(0)) {
    rmSync(temp, { recursive: true, force: true });
  }
});

function makeTempRoot(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `peaks-store-version-${label}-`));
  temps.push(root);
  return root;
}

/** A store root (the `skills` directory) holding one managed entry. */
function makeStore(label: string, version: string | null): string {
  const storeRoot = join(makeTempRoot(label), 'skills');
  mkdirSync(join(storeRoot, 'peaks-code'), { recursive: true });
  writeFileSync(join(storeRoot, 'peaks-code', 'SKILL.md'), '# peaks-code\n', 'utf8');
  const marker = join(storeRoot, 'peaks-code.peaks-managed');
  if (version === null) {
    // The LEGACY shape: a plain path, the sidecar every old install wrote.
    writeFileSync(marker, '/nowhere/peaks-loop/skills/peaks-code\n', 'utf8');
  } else {
    writeFileSync(
      marker,
      `${JSON.stringify({
        format: 'peaks-managed-v2',
        path: '/nowhere/peaks-loop/skills/peaks-code',
        version
      })}\n`,
      'utf8'
    );
  }
  return storeRoot;
}

/** Minimal DoctorContext — this check only reads `options`. */
function makeContext(options: DoctorOptions = {}): DoctorContext {
  return {
    options,
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

function runCheck(storeRoot: string, installedVersion = INSTALLED): readonly DoctorCheck[] {
  return canonicalStoreVersionCheck.run(
    makeContext({ canonicalStoreVersion: { storeRoot, installedVersion } })
  ) as readonly DoctorCheck[];
}

function only(checks: readonly DoctorCheck[]): DoctorCheck {
  const [check] = checks;
  if (check === undefined) throw new Error('expected one check');
  return check;
}

describe('(render) canonical-store-version output shape', () => {
  it('when the check runs, should emit exactly one row with the skills:store-version:store id', () => {
    // given: a store holding one managed entry at the installed version
    // when: the check runs
    // then: exactly one row is emitted, and it carries the store id
    const storeRoot = makeStore('render', INSTALLED);

    const checks = runCheck(storeRoot);

    expect(checks).toHaveLength(1);
    expect(checks[0]?.id).toBe('skills:store-version:store');
    expect(checks[0]?.message.length).toBeGreaterThan(0);
  });

  it('when the doctor plugin list is read, should include the canonical-store-version check', () => {
    // given: the doctor plugin registry
    // when: the plugin names are read
    // then: the canonical-store-version check is one of them
    const names = PLUGINS.map((plugin) => plugin.name);
    expect(names).toContain('canonical-store-version');
  });

  it('when the doctor-report schema is read, should accept the id the check emits', () => {
    // given: a store whose entry is behind the installed version
    // when: the check runs and the emitted id is matched against the schema
    // then: the emitted id satisfies the schema's own pattern
    const storeRoot = makeStore('render-schema', BEHIND);
    const emitted = runCheck(storeRoot).map((check) => check.id);
    const schema = JSON.parse(
      readFileSync(join(schemasDir, 'doctor-report.schema.json'), 'utf8')
    ) as { properties: { checks: { items: { properties: { id: { pattern: string } } } } } };
    const pattern = new RegExp(schema.properties.checks.items.properties.id.pattern);

    expect(emitted).toEqual(['skills:store-version:store']);
    expect(emitted.filter((id) => !pattern.test(id))).toEqual([]);
  });
});

describe('(behavior) the store is compared with the installed package', () => {
  it('when the store is behind the installed version, should fail and name the remedy', () => {
    // given: a store whose entry records a version behind the installed one
    // when: the check runs
    // then: it fails, and the message names the installed version and the repair
    const storeRoot = makeStore('behind', BEHIND);

    const check = only(runCheck(storeRoot));

    expect(check.ok).toBe(false);
    expect(check.message).toContain(INSTALLED);
    expect(check.message).toContain('peaks skill sync');
  });

  it('when the store is at the installed version, should pass', () => {
    // given: a store whose entry records the installed version
    // when: the check runs
    // then: it passes
    const storeRoot = makeStore('current', INSTALLED);

    const check = only(runCheck(storeRoot));

    expect(check.ok).toBe(true);
  });

  it('when there is no store at all, should report it as informational rather than failing', () => {
    // given: a project with no canonical store at all
    // when: the check runs
    // then: it passes, and says there is no store — an absence is not a failure
    const storeRoot = join(makeTempRoot('absent'), 'skills');

    const check = only(runCheck(storeRoot));

    expect(check.ok).toBe(true);
    expect(check.severity).toBeUndefined();
    expect(check.message).toContain('No canonical skill store');
  });

  it('when a sidecar records no version, should treat the entry as stale', () => {
    // given: a store whose entry carries a legacy sidecar that names no version
    // when: the check runs
    // then: the entry is stale — a version nobody can read is a version behind
    const storeRoot = makeStore('legacy', null);

    const check = only(runCheck(storeRoot));

    expect(check.ok).toBe(false);
    expect(check.message).toContain('no version recorded');
  });

  it('when a store entry has no sidecar, should not count it as ours', () => {
    // given: a store holding a skill the user put there, with no sidecar
    // when: the store is inspected and the check runs
    // then: the entry is not counted as managed and not counted as stale
    const storeRoot = join(makeTempRoot('unmanaged'), 'skills');
    mkdirSync(join(storeRoot, 'my-own-skill'), { recursive: true });
    writeFileSync(join(storeRoot, 'my-own-skill', 'SKILL.md'), '# mine\n', 'utf8');

    const inspection = inspectCanonicalStoreVersions(storeRoot, INSTALLED);

    expect(inspection.managed).toBe(0);
    expect(inspection.stale).toHaveLength(0);
    expect(only(runCheck(storeRoot)).ok).toBe(true);
  });

  it('when the recorded version is ahead of the installed one, should not call it stale', () => {
    // given: a store whose entry records a version ahead of the installed one
    // when: the store is inspected
    // then: nothing is stale — a newer copy is not a behind one
    const storeRoot = makeStore('ahead', '4.2.0');

    const inspection = inspectCanonicalStoreVersions(storeRoot, INSTALLED);

    expect(inspection.stale).toHaveLength(0);
    expect(only(runCheck(storeRoot)).ok).toBe(true);
  });
});

describe('(integration) the check reads a real store on disk', () => {
  it('when the store holds a stale entry, should count it and name it', () => {
    // given: a store on disk holding two entries, both behind the installed version
    // when: the store is inspected and the check runs
    // then: both are counted as stale, and both are named
    const storeRoot = makeStore('disk-stale', BEHIND);
    const second = join(storeRoot, 'peaks-rd');
    mkdirSync(second, { recursive: true });
    writeFileSync(join(second, 'SKILL.md'), '# peaks-rd\n', 'utf8');
    writeFileSync(
      join(storeRoot, 'peaks-rd.peaks-managed'),
      `${JSON.stringify({
        format: 'peaks-managed-v2',
        path: '/nowhere/peaks-loop/skills/bee/peaks-rd',
        version: BEHIND
      })}\n`,
      'utf8'
    );

    const inspection = inspectCanonicalStoreVersions(storeRoot, INSTALLED);
    const check = only(runCheck(storeRoot));

    expect(inspection.managed).toBe(2);
    expect(inspection.stale.map((entry) => entry.name)).toEqual(['peaks-code', 'peaks-rd']);
    expect(check.ok).toBe(false);
    expect(check.message).toContain('2 of 2');
  });

  it('when the check runs, should not write to the store', () => {
    // given: a store whose sidecar is read before the check
    // when: the check runs
    // then: the sidecar is byte-for-byte what it was — the check only reads
    const storeRoot = makeStore('read-only', BEHIND);
    const markerPath = join(storeRoot, 'peaks-code.peaks-managed');
    const before = readFileSync(markerPath, 'utf8');

    runCheck(storeRoot);

    expect(readFileSync(markerPath, 'utf8')).toBe(before);
  });
});

describe('(a11y) the message names what is wrong and what to do', () => {
  it('when the store is behind, should name the store, the versions and the repair', () => {
    // given: a store whose entry is behind the installed version
    // when: the check runs
    // then: the message names the store, both versions and the repair
    const storeRoot = makeStore('message', BEHIND);

    const check = only(runCheck(storeRoot));

    expect(check.message).toContain(storeRoot);
    expect(check.message).toContain(BEHIND);
    expect(check.message).toContain(INSTALLED);
    expect(check.message).toContain('peaks skill sync');
  });

  it('when the store is current, should say so in words', () => {
    // given: a store whose entry is at the installed version
    // when: the check runs
    // then: the message says the store is current, and names the version
    const storeRoot = makeStore('message-clean', INSTALLED);

    const check = only(runCheck(storeRoot));

    expect(check.message).toContain('current');
    expect(check.message).toContain(INSTALLED);
  });
});
