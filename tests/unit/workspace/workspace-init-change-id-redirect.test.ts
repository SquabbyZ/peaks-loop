/**
 * Slice 2026-06-22-top-level-change-id-cleanup (2.8.3) +
 * slice 2026-06-23-audit-followup (2.8.4) — verifies the
 * `peaks workspace init --change-id <id>` redirect.
 *
 * Background: the 2.8.0-era layout wrote `.peaks/<changeId>/` as a
 * top-level sibling of `.peaks/_runtime/`. Slice 2.8.3 redirects the
 * binding to `.peaks/_runtime/current-change` as a plain text file —
 * NO sibling dir is created at top level. If a 2.8.0-era legacy
 * sibling `.peaks/<changeId>/` already exists, the init aborts with
 * `LegacyChangeIdSiblingError` so the user can migrate first.
 *
 * Slice 2.8.4 adds:
 *   - `LegacyChangeIdBindingError` guard in `setCurrentChangeId`: if
 *     a legacy 2.8.0-era SYMLINK exists at `.peaks/_runtime/current-change`,
 *     refuse to silently replace it (data-loss-shaped bug).
 *   - `validateChangeIdOrThrow` is called BEFORE any path join /
 *     existsSync probe (closes a small info-leak window).
 *   - lstatSync-based guard in `initWorkspace` distinguishes path
 *     types (file vs dir vs symlink vs broken symlink) instead of
 *     conflating them into one error.
 *
 * ACs (slice 2.8.3):
 *   1. `initWorkspace({ changeId: '<id>' })` does NOT create
 *      `.peaks/<changeId>/` at top level.
 *   2. The binding file `.peaks/_runtime/current-change` IS created
 *      and contains the change-id as its sole content.
 *   3. `initWorkspace({ changeId: '<id>' })` throws
 *      `LegacyChangeIdSiblingError` when `.peaks/<changeId>/` exists.
 *   4. `initWorkspace({})` (no changeId) does NOT touch the binding.
 *   5. Re-init with the same change-id is idempotent.
 *   6. Error envelope fields + 4-step migration recipe are present.
 *
 * ACs (slice 2.8.4):
 *   7. `initWorkspace({ changeId })` throws `LegacyChangeIdBindingError`
 *      when `.peaks/_runtime/current-change` is a legacy symlink
 *      (silent-replace defense — the data-loss-shaped bug).
 *   8. `initWorkspace({ changeId: '..' })` and `changeId: '.'` throw
 *      `ChangeIdValidationError` BEFORE reaching the legacy-sibling
 *      guard (validates the early-validation fix).
 *
 * Each test uses a fresh tmp project so the cases do not contaminate
 * each other.
 */

import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  initWorkspace,
  LegacyChangeIdSiblingError
} from '../../../src/services/workspace/workspace-service.js';
import {
  ChangeIdValidationError,
  getCurrentChangeId,
  getCurrentChangeIdSource,
  LegacyChangeIdBindingError,
  setCurrentChangeId
} from '../../../src/shared/change-id.js';

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-2.8.3-change-id-'));
}

const createdDirs: string[] = [];

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir !== undefined) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
  }
});

describe('workspace init --change-id redirect (slice 2026-06-22 + 2026-06-23)', () => {
  test('AC1: initWorkspace with --change-id does NOT create .peaks/<changeId>/ sibling dir', async () => {
    const projectRoot = makeProject();
    createdDirs.push(projectRoot);
    const changeId = '2026-06-22-my-change';

    await initWorkspace({
      projectRoot,
      sessionId: '2026-06-22-session-aaaaaa',
      changeId
    });

    const siblingPath = join(projectRoot, '.peaks', changeId);
    expect(existsSync(siblingPath)).toBe(false);
  });

  test('AC2: initWorkspace with --change-id writes the binding to .peaks/_runtime/current-change', async () => {
    const projectRoot = makeProject();
    createdDirs.push(projectRoot);
    const changeId = 'add-user-auth';

    const report = await initWorkspace({
      projectRoot,
      sessionId: '2026-06-22-session-bbbbbb',
      changeId
    });

    expect(report.changeId).toBe(changeId);
    expect(report.changeIdAction).toBe('bound');

    const bindingPath = join(projectRoot, '.peaks', '_runtime', 'current-change');
    expect(existsSync(bindingPath)).toBe(true);
    const content = readFileSync(bindingPath, 'utf8').trim();
    expect(content).toBe(changeId);
  });

  test('AC3: initWorkspace throws LegacyChangeIdSiblingError when .peaks/<changeId>/ already exists', async () => {
    const projectRoot = makeProject();
    createdDirs.push(projectRoot);
    const changeId = 'legacy-orphan';

    // Pre-create a 2.8.0-era orphan dir at top level — simulate a
    // leftover from before the 2.8.3 redirect landed.
    const legacyDir = join(projectRoot, '.peaks', changeId);
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, 'marker.txt'), 'orphaned content', 'utf8');

    let caught: unknown = null;
    try {
      await initWorkspace({
        projectRoot,
        sessionId: '2026-06-22-session-cccccc',
        changeId
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(LegacyChangeIdSiblingError);
    const err = caught as LegacyChangeIdSiblingError;
    expect(err.code).toBe('LEGACY_CHANGE_ID_SIBLING');
    expect(err.changeId).toBe(changeId);
    expect(err.legacyPath).toBe(legacyDir);
    expect(err.message).toContain(legacyDir);
    expect(err.message).toContain('.peaks/_runtime/<sessionId>/');

    // The orphan dir must NOT have been touched.
    expect(existsSync(join(legacyDir, 'marker.txt'))).toBe(true);
  });

  test('AC4: initWorkspace without --change-id leaves .peaks/_runtime/current-change untouched', async () => {
    const projectRoot = makeProject();
    createdDirs.push(projectRoot);

    const report = await initWorkspace({
      projectRoot,
      sessionId: '2026-06-22-session-dddddd'
    });

    expect(report.changeId).toBeNull();
    expect(report.changeIdAction).toBe('none');

    const bindingPath = join(projectRoot, '.peaks', '_runtime', 'current-change');
    expect(existsSync(bindingPath)).toBe(false);
  });

  test('AC5: re-init with the same change-id is idempotent', async () => {
    const projectRoot = makeProject();
    createdDirs.push(projectRoot);
    const changeId = 'idempotent-change';

    await initWorkspace({
      projectRoot,
      sessionId: '2026-06-22-session-eeeeee',
      changeId
    });
    const bindingPath = join(projectRoot, '.peaks', '_runtime', 'current-change');
    const firstContent = readFileSync(bindingPath, 'utf8');

    const report = await initWorkspace({
      projectRoot,
      sessionId: '2026-06-22-session-eeeeee',
      changeId
    });
    expect(report.changeId).toBe(changeId);
    expect(report.changeIdAction).toBe('bound');

    const secondContent = readFileSync(bindingPath, 'utf8');
    expect(secondContent.trim()).toBe(firstContent.trim());
  });

  test('AC6: LegacyChangeIdSiblingError carries envelope fields + 4-step recipe in order', async () => {
    // The CLI catch block reads error.changeId + error.legacyPath to
    // build the JSON envelope. The 4-step migration recipe (1) inspect,
    // (2) move, (3) delete, (4) re-run is surfaced in error.message
    // and must appear in order so the user can follow it verbatim.
    const projectRoot = makeProject();
    createdDirs.push(projectRoot);
    const changeId = 'envelope-check';
    mkdirSync(join(projectRoot, '.peaks', changeId), { recursive: true });

    let caught: unknown = null;
    try {
      await initWorkspace({
        projectRoot,
        sessionId: '2026-06-22-session-ffffff',
        changeId
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(LegacyChangeIdSiblingError);
    const err = caught as LegacyChangeIdSiblingError;
    expect(typeof err.changeId).toBe('string');
    expect(typeof err.legacyPath).toBe('string');
    expect(err.legacyPath.endsWith(changeId)).toBe(true);
    // Pin the 4-step recipe ordering. The message format is:
    //   "...Migration: (1) inspect ... (2) move ... (3) delete ... (4) re-run ..."
    expect(err.message).toContain('(1) inspect');
    expect(err.message).toContain('(2) move');
    expect(err.message).toContain('(3) delete');
    expect(err.message).toContain('(4) re-run');
    // Confirm the (1) appears before (2), (2) before (3), (3) before (4).
    const i1 = err.message.indexOf('(1) inspect');
    const i2 = err.message.indexOf('(2) move');
    const i3 = err.message.indexOf('(3) delete');
    const i4 = err.message.indexOf('(4) re-run');
    expect(i1).toBeGreaterThan(-1);
    expect(i1).toBeLessThan(i2);
    expect(i2).toBeLessThan(i3);
    expect(i3).toBeLessThan(i4);
  });

  test('AC7: setCurrentChangeId refuses to silently replace a legacy 2.8.0-era symlink at the binding path', () => {
    // The data-loss-shaped bug surfaced by the 2.8.3 audit: if a
    // user upgrades from 2.8.2 with a 2.8.0-era symlink at
    // .peaks/_runtime/current-change, the prior code would have
    // unlinkSync'd the symlink and writeFileSync'd a plain file in
    // its place — destroying the existing binding intent with no
    // log/envelope signal. The 2.8.4 fix detects the symlink via
    // lstatSync and throws LegacyChangeIdBindingError.
    //
    // Cross-platform: creating real symlinks on Windows requires
    // admin privileges (EPERM in non-admin shells). We use the
    // platform-appropriate symlink primitive:
    //   - Linux/macOS: `symlinkSync(target, path)` — true symlink
    //   - Windows:     `symlinkSync(target, path, 'junction')` — a
    //                  directory junction (no admin required).
    //
    // Note: `lstatSync` returns isSymbolicLink()=true for both real
    // symlinks and Windows junctions, so the test exercises the
    // production code path identically on both platforms.
    const projectRoot = makeProject();
    createdDirs.push(projectRoot);

    const legacyTarget = join(projectRoot, '.peaks', '014-full-dogfood');
    mkdirSync(legacyTarget, { recursive: true });

    const runtimeDir = join(projectRoot, '.peaks', '_runtime');
    mkdirSync(runtimeDir, { recursive: true });
    const bindingPath = join(runtimeDir, 'current-change');
    const isWindows = process.platform === 'win32';
    if (isWindows) {
      // Junction mode requires a directory target — `legacyTarget`
      // is already a directory so this works without admin.
      symlinkSync(legacyTarget, bindingPath, 'junction');
    } else {
      symlinkSync(legacyTarget, bindingPath);
    }

    let caught: unknown = null;
    try {
      setCurrentChangeId(projectRoot, 'some-change-id', { form: 'file' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(LegacyChangeIdBindingError);
    const err = caught as LegacyChangeIdBindingError;
    expect(err.code).toBe('LEGACY_CHANGE_ID_BINDING');
    expect(err.bindingPath).toBe(bindingPath);
    expect(err.changeId).toBe('some-change-id');
    // The 3-step recipe is surfaced in error.message.
    expect(err.message).toContain('(1) inspect');
    expect(err.message).toContain('(2) unlink');
    expect(err.message).toContain('(3) re-run');

    // The symlink must NOT have been replaced — load-bearing
    // assertion of the HIGH fix. Use lstatSync (not existsSync)
    // to prove the symlink itself is still there AND the target
    // is unchanged. existsSync alone would also pass if the
    // symlink had been silently replaced with a plain file.
    expect(existsSync(bindingPath)).toBe(true);
    const afterStat = lstatSync(bindingPath);
    expect(afterStat.isSymbolicLink()).toBe(true);
    expect(afterStat.isFile()).toBe(false);
  });

  test('AC7b: setCurrentChangeId sets symlinkTarget=null when realpathSync throws (broken symlink)', () => {
    // The production code at change-id.ts catches realpathSync
    // failures (which happen when the symlink target has been
    // deleted) and surfaces symlinkTarget=null in the error.
    // AC7 covers only the resolvable-target case; this case
    // pins the broken-symlink branch explicitly.
    const projectRoot = makeProject();
    createdDirs.push(projectRoot);

    // Create a symlink pointing at a NON-EXISTENT target. On
    // Linux/macOS symlinkSync accepts a dangling target. On
    // Windows, junction mode requires the target to exist, so
    // we use 'file' mode and accept EPERM may block this test
    // on non-admin Windows shells — guarded with conditional
    // skip below.
    const runtimeDir = join(projectRoot, '.peaks', '_runtime');
    mkdirSync(runtimeDir, { recursive: true });
    const bindingPath = join(runtimeDir, 'current-change');
    const danglingTarget = join(projectRoot, '.peaks', 'deleted-change');
    // danglingTarget is intentionally NOT created — that's the
    // point of the broken-symlink scenario.

    const isWindows = process.platform === 'win32';
    let createdBrokenSymlink = false;
    try {
      if (isWindows) {
        // Junction mode requires target to exist; use 'file' mode
        // and accept that some Windows shells may reject it.
        try {
          symlinkSync(danglingTarget, bindingPath, 'file');
          createdBrokenSymlink = true;
        } catch {
          // EPERM on non-admin Windows — skip this AC on Windows
          // since the broken-symlink case cannot be reproduced
          // without admin privileges for dangling symlinks.
        }
      } else {
        symlinkSync(danglingTarget, bindingPath);
        createdBrokenSymlink = true;
      }
    } catch {
      createdBrokenSymlink = false;
    }

    if (!createdBrokenSymlink) {
      // Platform cannot reproduce this scenario — skip rather
      // than fail. The test is a defense-in-depth pin; the
      // resolvable-symlink AC7 already covers the production
      // code path on Windows.
      return;
    }

    let caught: unknown = null;
    try {
      setCurrentChangeId(projectRoot, 'some-change-id', { form: 'file' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(LegacyChangeIdBindingError);
    const err = caught as LegacyChangeIdBindingError;
    // The broken-symlink branch sets symlinkTarget=null because
    // realpathSync throws ENOENT when the target is gone.
    expect(err.symlinkTarget).toBeNull();
    // The error message must NOT include '(target: ...)' since
    // the target could not be resolved.
    expect(err.message).not.toMatch(/\(target:/);
  });

  test('AC8: initWorkspace rejects change-id "../" before reaching the legacy-sibling guard', async () => {
    // The 2.8.3 code joined the unvalidated change-id into a path
    // and ran existsSync on it before validation. Slice 2.8.4 closes
    // that probe window by calling validateChangeIdOrThrow FIRST.
    // AC8 exercises the validation path explicitly.
    const projectRoot = makeProject();
    createdDirs.push(projectRoot);

    let caught: unknown = null;
    try {
      await initWorkspace({
        projectRoot,
        sessionId: '2026-06-22-session-aaaaaa',
        changeId: '../etc/passwd'
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ChangeIdValidationError);
  });

  test('AC8b: initWorkspace rejects change-id "." before reaching the legacy-sibling guard', async () => {
    const projectRoot = makeProject();
    createdDirs.push(projectRoot);

    let caught: unknown = null;
    try {
      await initWorkspace({
        projectRoot,
        sessionId: '2026-06-22-session-bbbbbb',
        changeId: '.'
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ChangeIdValidationError);
  });

  test('AC9: getCurrentChangeId reads the new file-form binding written by initWorkspace', async () => {
    // Round-trip test: initWorkspace writes the file-form binding;
    // getCurrentChangeId reads it back. This pins the production
    // read-path that request-artifact-service and slice-check-service
    // depend on. Before AC9 was added, the reader had zero direct
    // test coverage (grep confirmed no test anywhere in the codebase
    // called getCurrentChangeId directly).
    const projectRoot = makeProject();
    createdDirs.push(projectRoot);
    const changeId = 'round-trip-change';

    await initWorkspace({
      projectRoot,
      sessionId: '2026-06-22-session-gggggg',
      changeId
    });

    // The reader must resolve the change-id.
    expect(getCurrentChangeId(projectRoot)).toBe(changeId);
    // And identify the source as 'file' (the 2.8.3+ form), not
    // 'symlink' (the 2.8.0 legacy form).
    const source = getCurrentChangeIdSource(projectRoot);
    expect(source).not.toBeNull();
    expect(source?.changeId).toBe(changeId);
    expect(source?.source).toBe('file');
  });
});