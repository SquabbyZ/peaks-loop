// tests/unit/services/web/web-artifact-paths.test.ts
//
// AC1's mechanism layer. The E2E form of AC1 (a real `peaks web shot` followed
// by a filesystem walk of the project root) lives in the QA contract and cannot
// be unit-tested; what CAN be pinned here is the invariant that makes it true:
// every artifact path is derived from `getSessionDir`, and every write target
// passes `assertUnder`.
//
// This file is also the guard the tech-doc wrongly attributed to the deleted
// `tests/unit/services/session/session-dir-canonical.test.ts` (sc finding G1).
// It asserts on THIS module only; the repo-wide static scan is out of S1 scope.
//
// Dimensions covered:
//   - behavior:    path composition + the `assertUnder` accept/reject table
//   - integration: real absolute paths from a tmp workspace (fs-shaped input)
//   - render:      not applicable (returns strings, no text surface)
//   - a11y:        not applicable (no human-facing text or exit code)

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { withTmpWorkspacePerTest, type TmpWorkspace } from '../../_setup/tmp-workspace.js';

declareDimensions(
  'tests/unit/services/web/web-artifact-paths.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'resolvers return path strings; the CLI layer owns every text surface' },
    { dim: 'a11y', reason: 'no user-visible text or exit code is produced by these pure resolvers' },
  ],
);

import { normalizePath } from '../../../../src/shared/path-utils.js';
import {
  assertUnder,
  webContextStatePath,
  webDaemonDir,
  webDaemonInfoPath,
  webDir,
  webInstallLockPath,
  webLogPath,
  webProfilesDir,
  webShotPath,
  webSpawnLockPath,
  WEB_SUBDIR,
} from '../../../../src/services/web/web-artifact-paths.js';

const ws = withTmpWorkspacePerTest('peaks-web-paths-');
const SESSION_ID = '2026-09-10-session-528a63';

describe('behavior — web artifact resolvers', () => {
  it('when every resolver is called, should place its path under <root>/.peaks/_runtime/<sid>/web', () => {
    // given: a project root and a session id
    // when:  each resolver produces its path
    // then:  every path is under the single web directory
    const root = ws().path;
    const expected = `/.peaks/_runtime/${SESSION_ID}/${WEB_SUBDIR}`;
    const paths = [
      webDir(root, SESSION_ID),
      webDaemonDir(root, SESSION_ID),
      webShotPath(root, SESSION_ID, '20260910T090312345Z'),
      webDaemonInfoPath(root, SESSION_ID),
      webSpawnLockPath(root, SESSION_ID),
      webLogPath(root, SESSION_ID),
    ];
    for (const path of paths) {
      expect(normalizePath(path)).toContain(expected);
    }
  });

  it('when webInstallLockPath is called, should scope the lock to the user, not the session', () => {
    // given: the resource it guards is Playwright's machine-global browser cache
    // when:  the lock path is resolved
    // then:  it sits under the per-user peaks home — ONE lock for every session
    //        and project on this machine, which is the contention that exists
    expect(normalizePath(webInstallLockPath())).toMatch(/\/\.peaks\/web\/install\.lock$/);
    expect(normalizePath(webInstallLockPath())).not.toContain('/_runtime/');
  });

  it('when webShotPath is called, should build a colon-free timestamped png name', () => {
    // given: a Windows-hostile timestamp containing colons
    // when:  the shot path is composed
    // then:  the caller-supplied stamp is embedded verbatim as the file name
    const root = ws().path;
    const path = webShotPath(root, SESSION_ID, '20260910T090312345Z');
    expect(normalizePath(path)).toMatch(/\/web\/shot-20260910T090312345Z\.png$/);
  });

  it('when webContextStatePath is called, should land the state file under pw-profiles/<dispatchId>', () => {
    // given: a dispatch id
    // when:  the per-dispatch state path is resolved
    // then:  it reuses the pw-profiles directory convention and stores storageState.json
    const root = ws().path;
    const path = normalizePath(webContextStatePath(root, SESSION_ID, 'dispatch-42'));
    expect(path).toContain(`/.peaks/_runtime/${SESSION_ID}/pw-profiles/dispatch-42/storageState.json`);
  });

  it('when webProfilesDir is called, should land beside web/ rather than inside it', () => {
    // given: a project root and a session id
    // when:  the per-dispatch storage-state root is resolved
    // then:  it is a sibling of web/, which is why it is its own resolver
    const root = ws().path;
    const profiles = normalizePath(webProfilesDir(root, SESSION_ID));
    expect(profiles).toContain(`/.peaks/_runtime/${SESSION_ID}/pw-profiles`);
    expect(profiles.startsWith(normalizePath(webDir(root, SESSION_ID)))).toBe(false);
  });

  it('when the session id traverses, should reject it before any join', () => {
    // given: session ids that would relocate the whole artifact tree
    // when:  each resolver is called with one
    // then:  every one refuses (assertUnder cannot catch this: both sides share the sid)
    const root = ws().path;
    for (const sid of ['..\\..\\..\\..\\..\\tmp\\pwn', '../../tmp/pwn', '..', '.', 'a/b', 'a\\b']) {
      expect(() => webDir(root, sid)).toThrow(/WEB_INVALID_SESSION_ID/);
      expect(() => webProfilesDir(root, sid)).toThrow(/WEB_INVALID_SESSION_ID/);
      expect(() => webContextStatePath(root, sid, 'dispatch-1')).toThrow(/WEB_INVALID_SESSION_ID/);
    }
  });

  it('when two session ids are used, should produce two disjoint web directories', () => {
    // given: two distinct session ids in one project root
    // when:  the web directory is resolved for each
    // then:  the directories do not overlap
    const root = ws().path;
    const a = normalizePath(webDir(root, 'session-aaaaaa'));
    const b = normalizePath(webDir(root, 'session-bbbbbb'));
    expect(a).not.toBe(b);
    expect(a.includes(b)).toBe(false);
    expect(b.includes(a)).toBe(false);
  });
});

describe('behavior — assertUnder', () => {
  it('when the child is inside the parent, should not throw', () => {
    // given: a web directory and a direct child of it
    // when:  the write guard is applied
    // then:  it resolves silently
    const root = ws().path;
    const parent = webDir(root, SESSION_ID);
    expect(() => assertUnder(join(parent, 'shot-1.png'), parent)).not.toThrow();
  });

  it('when the child is the parent itself, should not throw', () => {
    // given: a web directory used as its own child
    // when:  the write guard is applied
    // then:  the equality case is accepted
    const root = ws().path;
    const parent = webDir(root, SESSION_ID);
    expect(() => assertUnder(parent, parent)).not.toThrow();
  });

  it('when the child escapes via .., should throw WEB_PATH_ESCAPE', () => {
    // given: a traversal that climbs out of the web directory
    // when:  the write guard is applied
    // then:  the escape is rejected
    const root = ws().path;
    const parent = webDir(root, SESSION_ID);
    expect(() => assertUnder(join(parent, '..', '..', 'evil.png'), parent)).toThrow(/WEB_PATH_ESCAPE/);
  });

  it('when the child is a sibling-prefix directory, should throw WEB_PATH_ESCAPE', () => {
    // given: <root>2, whose name shares a prefix with <root>
    // when:  a path inside the sibling is checked against the web directory
    // then:  a bare startsWith comparison would pass, but the guard rejects it
    const root = ws().path;
    const parent = webDir(root, SESSION_ID);
    const sibling = join(`${root}2`, 'web', 'shot-1.png');
    expect(() => assertUnder(sibling, parent)).toThrow(/WEB_PATH_ESCAPE/);
  });

  it('when the child is an unrelated absolute path, should throw WEB_PATH_ESCAPE', () => {
    // given: an absolute path outside the project root entirely
    // when:  the write guard is applied
    // then:  the escape is rejected
    const root = ws().path;
    const parent = webDir(root, SESSION_ID);
    expect(() => assertUnder(join(root, 'evil.png'), parent)).toThrow(/WEB_PATH_ESCAPE/);
  });

  it('when the storage-state path is guarded, should accept pw-profiles and never web', () => {
    // given: the per-dispatch storage-state path, a SIBLING of web/
    // when:  it is checked against both candidate parents
    // then:  only the pw-profiles parent accepts it; webDir rejects every dispatch
    const root = ws().path;
    const statePath = webContextStatePath(root, SESSION_ID, 'dispatch-1');
    expect(() => assertUnder(statePath, webProfilesDir(root, SESSION_ID))).not.toThrow();
    expect(() => assertUnder(statePath, webDir(root, SESSION_ID))).toThrow(/WEB_PATH_ESCAPE/);
  });
});

describe('integration — resolvers against a real directory tree', () => {
  it('when the web directory is created, should be a real directory the shot path lives in', () => {
    // given: a session workspace on disk
    // when:  the web directory is materialised
    // then:  the shot path is a child of that existing directory
    const workspace: TmpWorkspace = ws();
    const webRoot = webDir(workspace.path, SESSION_ID);
    mkdirSync(webRoot, { recursive: true });
    const shot = normalizePath(webShotPath(workspace.path, SESSION_ID, '20260910T090312345Z'));
    expect(shot.startsWith(normalizePath(webRoot))).toBe(true);
  });
});
