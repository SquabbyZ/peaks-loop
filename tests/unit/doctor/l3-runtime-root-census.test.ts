// tests/unit/doctor/l3-runtime-root-census.test.ts
//
// The doctor check that puts the runtime-root census in front of an operator.
//
// WHAT IT MUST DO
//
//   - report an unregistered FILE at the runtime root — the blind spot that let
//     204 files accumulate on 2026-10-24 with nothing able to name them;
//   - report an unregistered DIRECTORY at the runtime root;
//   - stay silent on a tree of registered entries and session dirs;
//   - say "could not determine", never "clean", when the root cannot be read;
//   - carry a check id the doctor report schema accepts, and run in the L3
//     group that the registry order puts last.
//
// The clean-tree fixture is built from `RUNTIME_SYSTEM_ENTRIES` itself, so a
// registry entry the census does not honour (a legitimate file the registry
// forgot, say) turns this file red instead of silently going unnoticed.
//
// Omitting `render`: the check returns a `DoctorCheck` record rather than
// rendering anything; its shape is asserted under `behavior`.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { check } from '~/src/services/doctor/doctor-service/checks/l3-runtime-root-census';
import { PLUGINS } from '~/src/services/doctor/doctor-service/plugin-registry';
import { buildReport } from '~/src/services/doctor/doctor-service/report/final-summary';
import type { DoctorCheck, DoctorContext } from '~/src/services/doctor/doctor-service/types';
import { isArray } from '~/src/shared/array-guards';
import { isValidSessionId } from '~/src/services/workspace/sid-naming-guard';
import { RUNTIME_SYSTEM_ENTRIES } from '~/src/services/workspace/runtime-layout';
import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/doctor/l3-runtime-root-census.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    {
      dim: 'render',
      reason:
        'the check returns a DoctorCheck record and renders nothing; its shape is asserted under behavior'
    }
  ]
);

const CHECK_ID = 'L3:l3-runtime-root-census';
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

let root: string;
let runtimeDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-doctor-runtime-census-'));
  runtimeDir = join(root, '.peaks', '_runtime');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** The real validator, not a stub: the check's whole job is that distinction. */
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
    resolvedL3Root: root,
    projectRootResolver: () => root,
    isValidSessionId,
    accumulatedChecks: []
  };
}

/**
 * `DoctorCheckPlugin.run` may return a promise; this check is synchronous.
 */
function runCheck(): readonly DoctorCheck[] {
  const result = check.run(makeContext());

  if (result instanceof Promise || !isArray(result)) return [];

  return result;
}

function run(): DoctorCheck {
  const checks = runCheck();
  const found = checks.find((entry) => entry.id === CHECK_ID);
  if (found === undefined) {
    throw new Error(`missing check ${CHECK_ID}; got ${checks.map((c) => c.id).join(', ')}`);
  }
  return found;
}

/** A tree holding every registered entry, plus one real session dir. */
function makeRegisteredTree(): void {
  mkdirSync(runtimeDir, { recursive: true });
  for (const entry of RUNTIME_SYSTEM_ENTRIES) {
    const full = join(runtimeDir, entry.name);
    if (entry.kind === 'dir') mkdirSync(full, { recursive: true });
    else writeFileSync(full, '{}', 'utf8');
  }
  mkdirSync(join(runtimeDir, '2026-09-16-session-5bcf09'), { recursive: true });
}

// ── integration: real trees on disk ───────────────────────────────────

describe('Scenario: integration — real .peaks/_runtime/ trees on disk', () => {
  // The 204-file blind spot: `L3:l3-orphan-sessions` reads directories only,
  // so a stray file at the root had no product check able to name it.
  it('when a stray file sits at the runtime root, should report it as unregistered', () => {
    // given: a runtime root holding one unregistered file
    // when: the doctor runs the runtime-root census
    // then: the finding names the stray file and marks it as a file
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(join(runtimeDir, 'stray.log'), 'x', 'utf8');

    const result = run();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('stray.log');
    expect(result.message).toContain('(file)');
  });

  it('when a stray directory sits at the runtime root, should report it as unregistered', () => {
    // given: a runtime root holding one unregistered directory
    // when: the doctor runs the runtime-root census
    // then: the finding names the stray directory and marks it as a directory
    mkdirSync(runtimeDir, { recursive: true });
    mkdirSync(join(runtimeDir, 'stray-dir'), { recursive: true });

    const result = run();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('stray-dir');
    expect(result.message).toContain('(dir)');
  });

  it('when the runtime root holds only registered entries, should stay silent', () => {
    // given: a runtime root holding every registered entry and one session directory
    // when: the doctor runs the runtime-root census
    // then: the census reports ok and names the runtime root census
    makeRegisteredTree();

    const result = run();
    expect(result.ok).toBe(true);
    expect(result.message).toContain('Runtime root census');
  });

  it('when the runtime root cannot be read, should say it could not be determined', () => {
    // given: a runtime root that does not exist
    // when: the doctor runs the runtime-root census
    // then: the finding is a warning that says the root could not be determined
    const result = run();
    expect(result.ok).toBe(false);
    expect(result.severity).toBe('warning');
    expect(result.message).toContain('could not be determined');
    // Not the clean verdict: the census never certified this tree.
    expect(result.message).not.toContain('are registered or session-shaped');
  });

  // `doctor-self:check-id-pattern` runs BEFORE the L3 group, so the L3 ids
  // are not covered by the runtime self-check. The pattern is asserted here
  // against the schema file itself instead.
  it('when the doctor report schema is read, should carry a check id it accepts', () => {
    // given: the doctor report schema and the census check id
    // when: the census id is matched against the schema id pattern
    // then: the pattern is a string and the census id matches it
    const schema = JSON.parse(
      readFileSync(join(REPO_ROOT, 'schemas', 'doctor-report.schema.json'), 'utf8')
    ) as { properties?: { checks?: { items?: { properties?: { id?: { pattern?: string } } } } } };
    const pattern = schema.properties?.checks?.items?.properties?.id?.pattern;
    expect(typeof pattern).toBe('string');
    expect(new RegExp(pattern as string).test(CHECK_ID)).toBe(true);
  });

  // The registry order is load-bearing: the L3 series runs last so it
  // observes a settled tree.
  it('when the doctor plugin registry is ordered, should run the census last', () => {
    // given: the doctor plugin registry in its published order
    // when: the census position is compared with the last non-L3 check
    // then: the census sits after the last non-L3 check
    const names = PLUGINS.map((plugin) => plugin.name);
    const censusIndex = names.indexOf('l3-runtime-root-census');
    const lastNonL3 = names.reduce(
      (last, name, index) => (name.startsWith('l3-') ? last : index),
      -1
    );
    expect(censusIndex).toBeGreaterThan(lastNonL3);
  });
});

// ── behavior: the verdict ─────────────────────────────────────────────

describe('Scenario: behavior — the verdict', () => {
  it('when the census runs, should emit exactly one check carrying the census id', () => {
    // given: a runtime root holding every registered entry
    // when: the doctor runs the runtime-root census
    // then: exactly one check is emitted and it carries the census id
    makeRegisteredTree();

    const checks = runCheck();
    expect(checks).toHaveLength(1);
    expect(checks[0]?.id).toBe(CHECK_ID);
  });

  it('when a stray entry sits at the runtime root, should fail the doctor exit code', () => {
    // given: a runtime root holding one unregistered file
    // when: the doctor report is built from the census findings
    // then: the summary is not ok and counts one failed check
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(join(runtimeDir, 'stray.log'), 'x', 'utf8');

    const report = buildReport(runCheck());
    expect(report.summary.ok).toBe(false);
    expect(report.summary.failed).toBe(1);
    expect(report.summary.warnings).toBe(0);
  });

  // "Cannot determine" is not the same claim as "there is a problem": the
  // check is not ok (it did not certify the tree), but it must not turn
  // `peaks doctor` red on a project that has no peaks workspace yet.
  it('when the runtime root cannot be read, should warn without failing the exit code', () => {
    // given: a runtime root that does not exist
    // when: the doctor report is built from the census findings
    // then: the summary stays ok and counts one warning
    const report = buildReport(runCheck());
    expect(report.summary.ok).toBe(true);
    expect(report.summary.failed).toBe(0);
    expect(report.summary.warnings).toBe(1);
  });

  it('when the runtime root cannot be read, should count one warning per root', () => {
    // given: a runtime root that does not exist
    // when: the doctor runs the runtime-root census
    // then: the finding carries the warning severity
    const result = run();
    expect(result.severity).toBe('warning');
  });
});

// ── a11y: the operator-facing message ─────────────────────────────────

describe('Scenario: a11y — the operator-facing message', () => {
  it('when the runtime root holds stray entries, should name each offender with its kind', () => {
    // given: a runtime root holding one stray file and one stray directory
    // when: the doctor runs the runtime-root census
    // then: the message names both offenders with their kinds
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(join(runtimeDir, 'stray.log'), 'x', 'utf8');
    mkdirSync(join(runtimeDir, 'stray-dir'), { recursive: true });

    const result = run();
    expect(result.message).toContain('stray.log (file)');
    expect(result.message).toContain('stray-dir (dir)');
  });

  it('when a stray entry sits at the runtime root, should name the registry to edit', () => {
    // given: a runtime root holding one unregistered file
    // when: the doctor runs the runtime-root census
    // then: the message names the runtime-layout registry file
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(join(runtimeDir, 'stray.log'), 'x', 'utf8');

    const result = run();
    expect(result.message).toContain('src/services/workspace/runtime-layout.ts');
  });

  it('when the runtime root holds more strays than the cut, should report how many were elided', () => {
    // given: a runtime root holding seven stray files
    // when: the doctor runs the runtime-root census
    // then: the message counts the strays and says how many more were elided
    mkdirSync(runtimeDir, { recursive: true });
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      writeFileSync(join(runtimeDir, `${name}.log`), 'x', 'utf8');
    }

    const result = run();
    expect(result.message).toContain('7 stray entr(y/ies)');
    expect(result.message).toContain('(+2 more)');
  });

  it('when the runtime root cannot be read, should say the tree was not verified clean', () => {
    // given: a runtime root that does not exist
    // when: the doctor runs the runtime-root census
    // then: the message says the root could not be read and was not verified clean
    const result = run();
    expect(result.message).toContain('could not be read');
    expect(result.message).toContain('NOT verified clean');
  });

  it('when the census reports a stray entry, should keep the message free of control bytes', () => {
    // given: a runtime root holding one unregistered file
    // when: the doctor runs the runtime-root census
    // then: the message carries no control characters
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(join(runtimeDir, 'stray.log'), 'x', 'utf8');

    const result = run();
    // Built from escapes so this source file itself stays free of raw control
    // bytes — which is the very thing being asserted about the message.
    const controlChars = new RegExp('[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f]');
    expect(controlChars.test(result.message)).toBe(false);
  });
});
