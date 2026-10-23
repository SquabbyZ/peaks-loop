// tests/unit/ide/canonical-store-version-staleness.test.ts
//
// THE DEFECT THIS FILE PINS. The canonical store's sidecar recorded only the
// SOURCE PATH, so a copy frozen at an old release was indistinguishable from a
// current one: the store was self-consistent, the IDE links pointed into it,
// and the parity check (store against IDE) could not see it. A downstream
// machine sat on a 4.1.15-era skill while 4.1.17 was installed, and nothing
// anywhere said so.
//
// THE CONTRACT, case by case:
//   - a LEGACY sidecar (a plain path, the shape on every existing machine)
//     reads as "ours, version unknown", and version unknown is STALE;
//   - a sidecar whose version is behind the source package's is refreshed,
//     even when its recorded PATH still names a package that is long gone;
//   - a sidecar whose version matches and whose bytes match is left alone;
//   - a sidecar whose recorded PATH is stale but whose version matches has its
//     path corrected — a marker pointing at a path that no longer exists is
//     itself a stale fact — while the bytes are not copied again;
//   - a store entry with NO sidecar is the user's own and is never overwritten.
//
// NO REAL $HOME IS TOUCHED. Every path is under one `mkdtemp` root removed in
// `afterAll`, and the store is redirected through the `root` option.
//
// Dimensions covered:
//   - behavior:    the decision each case makes, and the sidecar it leaves
//   - integration: the real module against a real filesystem
//   - render:      OMITTED — the module returns records and prints nothing
//   - a11y:        OMITTED — no human-facing text, exit code or message here

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/ide/canonical-store-version-staleness.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'the store returns records and writes no human-facing output' },
    { dim: 'a11y', reason: 'no human-facing text, exit code or error message is asserted here' }
  ]
);

const mod = (await import('../../../scripts/canonical-store.mjs')) as unknown as {
  ensureCanonicalCopy: (options: Record<string, unknown>) => {
    canonicalPath: string;
    action: string;
    state: string;
    version: string | null;
    reason?: string | null;
  };
  readManagedMarker: (targetPath: string) => { path: string | null; version: string | null } | null;
  readManagedTarget: (targetPath: string) => string | null;
  writeManagedMarker: (targetPath: string, provenance: string, version?: string) => void;
};

const FIXTURE_ROOT = mkdtempSync(join(tmpdir(), 'peaks-store-version-'));
const STORE_ROOT = join(FIXTURE_ROOT, 'store');
const SOURCE_ROOT = join(FIXTURE_ROOT, 'package');
const SKILL_NAME = 'peaks-code';
const SOURCE_PATH = join(SOURCE_ROOT, 'skills', SKILL_NAME);

/** The release the source package ships. */
const CURRENT_VERSION = '4.1.17';
/** The release the store's copy was made from — TWO versions behind. */
const OLD_VERSION = '4.1.15';

const CURRENT_BODY = '# peaks-code\n\nthe current release.\n';
const OLD_BODY = '# peaks-code\n\nthe 4.1.15 release.\n';

afterAll(() => {
  rmSync(FIXTURE_ROOT, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(STORE_ROOT, { recursive: true, force: true });
  rmSync(SOURCE_ROOT, { recursive: true, force: true });
  mkdirSync(SOURCE_PATH, { recursive: true });
  writeFileSync(join(SOURCE_PATH, 'SKILL.md'), CURRENT_BODY, 'utf8');
});

/** The store's copy of the skill, with the given body. */
function writeStoreCopy(body: string): string {
  const canonicalPath = join(STORE_ROOT, 'skills', SKILL_NAME);
  mkdirSync(canonicalPath, { recursive: true });
  writeFileSync(join(canonicalPath, 'SKILL.md'), body, 'utf8');
  return canonicalPath;
}

/** The store's copy, with a sidecar in the v2 shape. */
function writeManagedStoreCopy(body: string, version: string, recordedPath: string): string {
  const canonicalPath = writeStoreCopy(body);
  mod.writeManagedMarker(canonicalPath, recordedPath, version);
  return canonicalPath;
}

/** The store's copy, with a LEGACY sidecar — a plain path, as every old install wrote. */
function writeLegacyStoreCopy(body: string, recordedPath: string): string {
  const canonicalPath = writeStoreCopy(body);
  writeFileSync(`${canonicalPath}.peaks-managed`, `${recordedPath}\n`, 'utf8');
  return canonicalPath;
}

/** The store the copy lands in. */
function storeOptions(): Record<string, unknown> {
  return {
    kind: 'skills',
    name: SKILL_NAME,
    sourcePath: SOURCE_PATH,
    root: STORE_ROOT,
    version: CURRENT_VERSION
  };
}

describe('Scenario: behavior — the sidecar records the version that produced the copy', () => {
  it('when a legacy sidecar names an old release, should refresh the copy and rewrite the sidecar in the new shape', () => {
    // given: a store copy holding the 4.1.15 bytes behind a LEGACY sidecar — a
    //        plain path, the shape on every machine installed before this change
    // when: the store reconciles that entry against the current package
    // then: the copy is refreshed, and the sidecar now names BOTH the source and
    //        the version — the fact that made the staleness knowable
    const canonicalPath = writeLegacyStoreCopy(OLD_BODY, join(SOURCE_ROOT, 'skills', SKILL_NAME));
    const result = mod.ensureCanonicalCopy(storeOptions());
    expect(result.action).toBe('installed');
    expect(result.state).toBe('stale');
    expect(readFileSync(join(canonicalPath, 'SKILL.md'), 'utf8')).toBe(CURRENT_BODY);
    const marker = mod.readManagedMarker(canonicalPath);
    expect(marker?.version).toBe(CURRENT_VERSION);
    expect(marker?.path).toBe(SOURCE_PATH);
  });

  it('when a sidecar records the current version, should leave the copy untouched', () => {
    // given: a store copy holding the current bytes behind a sidecar that
    //        records the current version
    // when: the store reconciles that entry
    // then: nothing is copied and nothing is rewritten
    const canonicalPath = writeManagedStoreCopy(CURRENT_BODY, CURRENT_VERSION, SOURCE_PATH);
    const before = statSync(join(canonicalPath, 'SKILL.md')).mtimeMs;
    const result = mod.ensureCanonicalCopy(storeOptions());
    expect(result.action).toBe('unchanged');
    expect(result.state).toBe('current');
    expect(statSync(join(canonicalPath, 'SKILL.md')).mtimeMs).toBe(before);
    expect(mod.readManagedMarker(canonicalPath)?.version).toBe(CURRENT_VERSION);
  });

  it('when a store entry carries no sidecar, should leave the user-authored copy alone and report it', () => {
    // given: a store entry with NO sidecar — the user's own copy, which peaks-loop
    //        has never owned
    // when: the store reconciles that entry
    // then: the copy is untouched, and the skip is REPORTED rather than silent
    const canonicalPath = writeStoreCopy('# my own peaks-code\n');
    const result = mod.ensureCanonicalCopy(storeOptions());
    expect(result.action).toBe('unmanaged');
    expect(result.state).toBe('unmanaged');
    expect(readFileSync(join(canonicalPath, 'SKILL.md'), 'utf8')).toBe('# my own peaks-code\n');
  });

  it('when a sidecar names a vanished package path but records the current version, should correct the path without copying again', () => {
    // given: a current copy whose sidecar names a package path that no longer
    //        exists — a global install that has since been replaced
    // when: the store reconciles that entry
    // then: the bytes are not copied again, and the stale path in the sidecar is
    //        corrected — a marker naming a path that no longer exists is itself stale
    const canonicalPath = writeManagedStoreCopy(
      CURRENT_BODY,
      CURRENT_VERSION,
      join(SOURCE_ROOT, 'package-4.1.9', 'skills', SKILL_NAME)
    );
    const before = statSync(join(canonicalPath, 'SKILL.md')).mtimeMs;
    const result = mod.ensureCanonicalCopy(storeOptions());
    expect(result.action).toBe('unchanged');
    expect(result.state).toBe('current');
    expect(statSync(join(canonicalPath, 'SKILL.md')).mtimeMs).toBe(before);
    expect(mod.readManagedMarker(canonicalPath)?.path).toBe(SOURCE_PATH);
  });

  it('when a sidecar is behind the version AND names a vanished path, should refresh the copy', () => {
    // given: a store copy holding the old bytes behind a sidecar that records an
    //        old version and a package path that no longer exists
    // when: the store reconciles that entry
    // then: the copy is refreshed on the VERSION alone — the dead path is not
    //        what decides it — and the sidecar records the current source
    const canonicalPath = writeManagedStoreCopy(
      OLD_BODY,
      OLD_VERSION,
      join(SOURCE_ROOT, 'package-4.1.9', 'skills', SKILL_NAME)
    );
    const result = mod.ensureCanonicalCopy(storeOptions());
    expect(result.action).toBe('installed');
    expect(result.state).toBe('stale');
    expect(result.reason).toBe('version');
    expect(readFileSync(join(canonicalPath, 'SKILL.md'), 'utf8')).toBe(CURRENT_BODY);
    expect(mod.readManagedMarker(canonicalPath)?.path).toBe(SOURCE_PATH);
  });

  it('when a dry run meets a stale copy, should plan the refresh and write nothing', () => {
    // given: a store copy holding the old bytes behind a sidecar that records the
    //        old version
    // when: the store reconciles that entry in dry-run mode
    // then: the staleness is REPORTED and the copy is left exactly as it was
    const canonicalPath = writeManagedStoreCopy(OLD_BODY, OLD_VERSION, SOURCE_PATH);
    const result = mod.ensureCanonicalCopy({ ...storeOptions(), dryRun: true });
    expect(result.action).toBe('planned');
    expect(result.state).toBe('stale');
    expect(readFileSync(join(canonicalPath, 'SKILL.md'), 'utf8')).toBe(OLD_BODY);
    expect(mod.readManagedMarker(canonicalPath)?.version).toBe(OLD_VERSION);
  });
});

describe('Scenario: integration — the sidecar the store writes is readable by the store', () => {
  it('when a copy is written, should leave a sidecar naming the source and the version', () => {
    // given: a source package and an empty store
    // when: the store materialises the copy
    // then: the sidecar beside the copy is the v2 shape, and the legacy reader
    //        still answers with the source path
    const result = mod.ensureCanonicalCopy(storeOptions());
    const markerPath = `${result.canonicalPath}.peaks-managed`;
    expect(existsSync(markerPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(markerPath, 'utf8')) as Record<string, unknown>;
    expect(parsed['format']).toBe('peaks-managed-v2');
    expect(parsed['version']).toBe(CURRENT_VERSION);
    expect(parsed['path']).toBe(SOURCE_PATH);
    expect(mod.readManagedTarget(result.canonicalPath)).toBe(SOURCE_PATH);
  });

  it('when a legacy sidecar is read, should answer with the path and an unknown version', () => {
    // given: a store copy behind a legacy sidecar — a plain path
    // when: the sidecar is read
    // then: the legacy shape is READ, not rejected — a reader that threw on it
    //        would break every existing install
    const canonicalPath = writeLegacyStoreCopy(CURRENT_BODY, SOURCE_PATH);
    const marker = mod.readManagedMarker(canonicalPath);
    expect(marker).not.toBeNull();
    expect(marker?.path).toBe(SOURCE_PATH);
    expect(marker?.version).toBeNull();
  });
});
