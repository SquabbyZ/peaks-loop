// tests/unit/doctor/ecc-hooks-schema-drift.test.ts
//
// Unit test for the `integration:ecc-hooks-schema-drift` doctor check —
// it detects the third-party ECC plugin's `hooks.json` keys that Claude
// Code's plugin hook schema ignores (`$schema` at the root; `description`
// + `id` on every matcher group) and explains the source + fix.
//
// The probe is injected in every case so this file never reads the real
// `~/.claude/plugins/` tree.
//
// Run with:
//   pnpm vitest run tests/unit/doctor/ecc-hooks-schema-drift.test.ts

import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  check,
  defaultEccHooksDriftProbe,
  findEccHooksSchemaDrift,
  readEccInstallPath
} from '~/src/services/doctor/doctor-service/checks/ecc-hooks-schema-drift';
import type {
  DoctorCheck,
  DoctorContext,
  DoctorOptions
} from '~/src/services/doctor/doctor-service/types';

const CHECK_ID = 'integration:ecc-hooks-schema-drift';
const FIXTURE_HOOKS_PATH = '/home/user/.claude/plugins/cache/ecc/ecc/2.2.0/hooks/hooks.json';

// Minimal DoctorContext — this check only reads `options`.
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

// The plugin contract allows an async `run`; this check is synchronous,
// so narrow the union once here instead of at every call site.
function runCheck(ctx: DoctorContext): readonly DoctorCheck[] {
  return check.run(ctx) as readonly DoctorCheck[];
}

// Temp-home helpers: the default probe is driven against a throwaway
// directory tree so no test ever reads the real `~/.claude`.
const tempHomes: string[] = [];

function makeTempHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'ecc-drift-home-'));
  tempHomes.push(home);
  return home;
}

afterEach(() => {
  while (tempHomes.length > 0) rmSync(tempHomes.pop()!, { recursive: true, force: true });
});

function writeManifest(home: string, manifest: unknown): string {
  const manifestPath = join(home, '.claude', 'plugins', 'installed_plugins.json');
  mkdirSync(join(home, '.claude', 'plugins'), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8');
  return manifestPath;
}

function writeHooksJson(installPath: string, payload: unknown): void {
  mkdirSync(join(installPath, 'hooks'), { recursive: true });
  writeFileSync(join(installPath, 'hooks', 'hooks.json'), JSON.stringify(payload), 'utf8');
}

// Mirrors the shipped ECC v2.2.0 layout: 23 matcher groups across 7
// events, each carrying `description` + `id`, plus a root `$schema`.
function buildEccShapedHooks(): unknown {
  const layout: ReadonlyArray<readonly [string, number]> = [
    ['PreToolUse', 8],
    ['PreCompact', 1],
    ['SessionStart', 2],
    ['PostToolUse', 2],
    ['PostToolUseFailure', 2],
    ['Stop', 7],
    ['SessionEnd', 1]
  ];
  const hooks: Record<string, unknown[]> = {};
  for (const [event, count] of layout) {
    hooks[event] = Array.from({ length: count }, (_, i) => ({
      matcher: '*',
      hooks: [{ type: 'command', command: `node hook-${event}-${i}.js` }],
      description: `${event} hook ${i}`,
      id: `hook:${event}:${i}`
    }));
  }
  return { $schema: 'https://example.invalid/hooks.schema.json', hooks };
}

describe('findEccHooksSchemaDrift (pure key scan)', () => {
  it('when the shipped ECC v2.2.0 layout is scanned, should count all 47 ignored keys', () => {
    // given: a synthetic hooks.json mirroring ECC v2.2.0 (root $schema + 23 groups with description/id)
    const payload = buildEccShapedHooks();

    // when: the pure drift scan runs over the parsed payload
    const finding = findEccHooksSchemaDrift(payload);

    // then: 1 root key + 23 groups x 2 keys = 47, matching the startup warning
    expect(finding.unknownKeyCount).toBe(47);
    expect(finding.rootKeys).toEqual(['$schema']);
    expect(finding.entryKeys).toEqual(['description', 'id']);
    expect(finding.entryCount).toBe(23);
  });

  it('when a hooks.json carries only schema-allowed keys, should report no drift', () => {
    // given: a clean payload ({ matcher, hooks } groups and a root `hooks` key only)
    const payload = {
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node ok.js' }] }] }
    };

    // when: the pure drift scan runs over the parsed payload
    const finding = findEccHooksSchemaDrift(payload);

    // then: every counter is zero
    expect(finding.unknownKeyCount).toBe(0);
    expect(finding.rootKeys).toEqual([]);
    expect(finding.entryKeys).toEqual([]);
    expect(finding.entryCount).toBe(0);
  });

  it('when a top-level description sits beside the hooks map, should report no drift', () => {
    // given: a payload using the documented-legal top-level `description` field
    const payload = {
      description: 'ECC consolidated plugin hooks',
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node ok.js' }] }] }
    };

    // when: the pure drift scan runs over the parsed payload
    const finding = findEccHooksSchemaDrift(payload);

    // then: the legal root key is not counted as drift
    expect(finding.unknownKeyCount).toBe(0);
    expect(finding.rootKeys).toEqual([]);
  });

  it('when the drifting ECC layout also gains a top-level description, should still count only the 47 illegal keys', () => {
    // given: the ECC v2.2.0 layout ($schema + 23 groups with description/id) plus a legal top-level description
    const payload = { ...(buildEccShapedHooks() as Record<string, unknown>), description: 'consolidated' };

    // when: the pure drift scan runs over the parsed payload
    const finding = findEccHooksSchemaDrift(payload);

    // then: the root description is legal, so only $schema + 23 x 2 matcher-group keys are flagged
    expect(finding.unknownKeyCount).toBe(47);
    expect(finding.rootKeys).toEqual(['$schema']);
    expect(finding.entryKeys).toEqual(['description', 'id']);
    expect(finding.entryCount).toBe(23);
  });

  it('when the hooks value is not an object, should still report the root-level drift', () => {
    // given: a payload whose unknown root key sits beside a malformed (non-object) hooks value
    const payload = { $schema: 'https://example.invalid/hooks.schema.json', hooks: ['not-an-object'] };

    // when: the pure drift scan runs over the parsed payload
    const finding = findEccHooksSchemaDrift(payload);

    // then: the root key is still counted and no matcher groups are inspected
    expect(finding.unknownKeyCount).toBe(1);
    expect(finding.rootKeys).toEqual(['$schema']);
    expect(finding.entryKeys).toEqual([]);
    expect(finding.entryCount).toBe(0);
  });

  it('when a hooks entry or a matcher group is malformed, should skip it and report no drift', () => {
    // given: two payloads — one whose event value is not an array, one whose group list holds non-objects
    const badEventValue = { hooks: { PreToolUse: 'not-an-array' } };
    const badGroupEntries = { hooks: { PreToolUse: [null, 'not-an-object'] } };

    // when: the pure drift scan runs over each payload
    const fromBadEventValue = findEccHooksSchemaDrift(badEventValue);
    const fromBadGroupEntries = findEccHooksSchemaDrift(badGroupEntries);

    // then: malformed shapes are skipped rather than counted as drift
    expect(fromBadEventValue.unknownKeyCount).toBe(0);
    expect(fromBadGroupEntries.unknownKeyCount).toBe(0);
    expect(fromBadGroupEntries.entryCount).toBe(0);
  });

  it('when the payload is not an object, should report no drift', () => {
    // given: a malformed payload (null) that the probe can hand over
    const payload = null;

    // when: the pure drift scan runs over a non-object payload
    const finding = findEccHooksSchemaDrift(payload);

    // then: the scan stays defensive and reports nothing
    expect(finding.unknownKeyCount).toBe(0);
  });
});

describe('default probe (temp home, never the real ~/.claude)', () => {
  it('when the plugin manifest is absent, should resolve no install path and no payload', () => {
    // given: a temp home with no ~/.claude/plugins/installed_plugins.json
    const home = makeTempHome();
    const manifestPath = join(home, '.claude', 'plugins', 'installed_plugins.json');

    // when: the manifest lookup and the default probe both run against that home
    const installPath = readEccInstallPath(manifestPath);
    const probe = defaultEccHooksDriftProbe(home);

    // then: absence resolves to null and the probe reports an uninstalled plugin
    expect(installPath).toBeNull();
    expect(probe).toEqual({ hooksPath: null, hooks: null });
  });

  it('when an ecc@ entry carries an installPath, should return it and parse that hooks.json', () => {
    // given: a temp home whose manifest points `ecc@ecc` at an install dir holding a hooks.json
    const home = makeTempHome();
    const installPath = join(home, 'plugins', 'cache', 'ecc', 'ecc', '2.2.0');
    const hooksPayload = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [] }] } };
    writeHooksJson(installPath, hooksPayload);
    const manifestPath = writeManifest(home, {
      version: 2,
      plugins: { 'ecc@ecc': [{ scope: 'user', installPath, version: '2.2.0' }] }
    });

    // when: the manifest lookup and the default probe both run against that home
    const resolved = readEccInstallPath(manifestPath);
    const probe = defaultEccHooksDriftProbe(home);

    // then: the install path is returned and the probe parses its hooks/hooks.json
    expect(resolved).toBe(installPath);
    expect(probe.hooksPath).toBe(join(installPath, 'hooks', 'hooks.json'));
    expect(probe.hooks).toEqual(hooksPayload);
  });

  it('when the manifest has no ecc@ key, should resolve no install path', () => {
    // given: a temp home whose manifest lists only unrelated plugins
    const home = makeTempHome();
    const manifestPath = writeManifest(home, {
      version: 2,
      plugins: { 'superpowers@claude-plugins-official': [{ installPath: join(home, 'other') }] }
    });

    // when: the manifest lookup runs against that home
    const installPath = readEccInstallPath(manifestPath);

    // then: no ecc@ entry means no ECC install path
    expect(installPath).toBeNull();
  });

  it('when the ecc@ entry holds no usable records, should resolve no install path', () => {
    // given: one temp home whose ecc@ecc entry is a non-array, and another holding an empty array
    const nonArrayHome = makeTempHome();
    const emptyArrayHome = makeTempHome();

    // when: the manifest lookup runs against each home's own manifest
    const fromNonArray = readEccInstallPath(
      writeManifest(nonArrayHome, { plugins: { 'ecc@ecc': { installPath: '/nope' } } })
    );
    const fromEmptyArray = readEccInstallPath(writeManifest(emptyArrayHome, { plugins: { 'ecc@ecc': [] } }));

    // then: neither shape yields an install path
    expect(fromNonArray).toBeNull();
    expect(fromEmptyArray).toBeNull();
  });

  it('when the ecc@ record has no string installPath, should resolve no install path', () => {
    // given: one temp home whose ecc@ecc record omits installPath, and another that sets it to a number
    const absentHome = makeTempHome();
    const nonStringHome = makeTempHome();

    // when: the manifest lookup runs against each home's own manifest
    const fromAbsent = readEccInstallPath(
      writeManifest(absentHome, { plugins: { 'ecc@ecc': [{ scope: 'user' }] } })
    );
    const fromNonString = readEccInstallPath(
      writeManifest(nonStringHome, { plugins: { 'ecc@ecc': [{ installPath: 42 }] } })
    );

    // then: a missing or non-string installPath resolves to null
    expect(fromAbsent).toBeNull();
    expect(fromNonString).toBeNull();
  });

  it('when the manifest or its ecc@ records are malformed, should resolve no install path', () => {
    // given: one temp home whose `plugins` is not an object, and another whose ecc@ecc holds a non-object record
    const badPluginsHome = makeTempHome();
    const badRecordHome = makeTempHome();

    // when: the manifest lookup runs against each home's own manifest
    const fromBadPlugins = readEccInstallPath(writeManifest(badPluginsHome, { plugins: 'nope' }));
    const fromBadRecord = readEccInstallPath(
      writeManifest(badRecordHome, { plugins: { 'ecc@ecc': [null, 'x'] } })
    );

    // then: both malformed shapes resolve to null instead of throwing
    expect(fromBadPlugins).toBeNull();
    expect(fromBadRecord).toBeNull();
  });

  it('when the installPath resolves but hooks.json is missing, should report the path with no payload', () => {
    // given: a temp home whose manifest points at an install dir with no hooks/hooks.json
    const home = makeTempHome();
    const installPath = join(home, 'plugins', 'cache', 'ecc', 'ecc', '2.2.0');
    mkdirSync(installPath, { recursive: true });
    writeManifest(home, { plugins: { 'ecc@ecc': [{ installPath }] } });

    // when: the default probe runs against that home
    const probe = defaultEccHooksDriftProbe(home);

    // then: the path is reported and the payload is null (the check treats this as nothing to report)
    expect(probe.hooksPath).toBe(join(installPath, 'hooks', 'hooks.json'));
    expect(probe.hooks).toBeNull();
  });
});

describe('check plugin', () => {
  it('when the ECC hooks.json carries unknown keys, should emit a warning naming the path, key families and fix', () => {
    // given: a probe reporting the ECC plugin installed with drifting hooks.json
    const ctx = makeContext({
      eccHooksDriftProbe: () => ({ hooksPath: FIXTURE_HOOKS_PATH, hooks: buildEccShapedHooks() })
    });

    // when: the check runs
    const emitted = runCheck(ctx);

    // then: one ok:false warning carrying the id, path, key families and remediation
    expect(emitted).toHaveLength(1);
    const single = emitted[0]!;
    expect(single.id).toBe(CHECK_ID);
    expect(single.ok).toBe(false);
    expect(single.severity).toBe('warning');
    expect(single.message).toContain(FIXTURE_HOOKS_PATH);
    expect(single.message).toContain('$schema');
    expect(single.message).toContain('description');
    expect(single.message).toContain('id');
    expect(single.message).toContain('47');
    expect(single.message).toContain('affaan-m/ECC');
    expect(single.message).toContain('Upgrading ECC will not help');
  });

  it('when only a matcher group carries unknown keys, should warn without an empty root clause', () => {
    // given: a probe reporting a clean document root but an `id` on one matcher group
    const ctx = makeContext({
      eccHooksDriftProbe: () => ({
        hooksPath: FIXTURE_HOOKS_PATH,
        hooks: { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [], id: 'pre:bash:dispatcher' }] } }
      })
    });

    // when: the check runs
    const emitted = runCheck(ctx);

    // then: the warning names the group-level key and omits the (empty) root clause
    expect(emitted[0]!.ok).toBe(false);
    expect(emitted[0]!.severity).toBe('warning');
    expect(emitted[0]!.message).toContain('1 key(s)');
    expect(emitted[0]!.message).toContain('on 1 matcher group(s): id');
    expect(emitted[0]!.message).not.toContain('at the root:');
  });

  it('when the ECC hooks.json is clean, should pass', () => {
    // given: a probe reporting a clean hooks.json
    const ctx = makeContext({
      eccHooksDriftProbe: () => ({
        hooksPath: FIXTURE_HOOKS_PATH,
        hooks: { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node ok.js' }] }] } }
      })
    });

    // when: the check runs
    const emitted = runCheck(ctx);

    // then: the check passes and says so
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.id).toBe(CHECK_ID);
    expect(emitted[0]!.ok).toBe(true);
    expect(emitted[0]!.severity).toBeUndefined();
    expect(emitted[0]!.message).toContain('the startup "unknown keys ... ignored" warning will not appear');
  });

  it('when upstream consolidates the per-matcher descriptions into a top-level description, should pass', () => {
    // given: the likely upstream fix — one root description, no per-matcher description/id
    const ctx = makeContext({
      eccHooksDriftProbe: () => ({
        hooksPath: FIXTURE_HOOKS_PATH,
        hooks: {
          description: 'ECC consolidated plugin hooks',
          hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node ok.js' }] }] }
        }
      })
    });

    // when: the check runs
    const emitted = runCheck(ctx);

    // then: the recommended remediation is not reported as a false positive
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.id).toBe(CHECK_ID);
    expect(emitted[0]!.ok).toBe(true);
    expect(emitted[0]!.severity).toBeUndefined();
  });

  it('when the ECC plugin is not installed, should pass', () => {
    // given: a probe reporting no resolved plugin path (manifest has no ecc@* entry)
    const ctx = makeContext({ eccHooksDriftProbe: () => ({ hooksPath: null, hooks: null }) });

    // when: the check runs
    const emitted = runCheck(ctx);

    // then: absence is not a failure
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.id).toBe(CHECK_ID);
    expect(emitted[0]!.ok).toBe(true);
    expect(emitted[0]!.message).toContain('ECC plugin not installed');
  });

  it('when the plugin path resolves but hooks.json is unreadable, should pass', () => {
    // given: a probe whose path resolved yet yielded no parsable payload
    const ctx = makeContext({ eccHooksDriftProbe: () => ({ hooksPath: FIXTURE_HOOKS_PATH, hooks: null }) });

    // when: the check runs
    const emitted = runCheck(ctx);

    // then: the unreadable file is reported as nothing to check, not a failure
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.ok).toBe(true);
    expect(emitted[0]!.message).toContain(FIXTURE_HOOKS_PATH);
    expect(emitted[0]!.message).toContain('No readable ECC plugin hooks.json');
  });

  it('when the probe throws, should pass without breaking the doctor', () => {
    // given: a probe that throws (defensive — a cosmetic check must not fail the run)
    const ctx = makeContext({
      eccHooksDriftProbe: () => {
        throw new Error('synthetic probe failure');
      }
    });

    // when: the check runs
    const emitted = runCheck(ctx);

    // then: the failure is surfaced in the message and the check stays ok
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.ok).toBe(true);
    expect(emitted[0]!.message).toContain('synthetic probe failure');
  });
});
