// tests/unit/context/harness-window-linked-settings.test.ts
//
// The LINK GUARD on `.claude/settings.local.json`, for the window half.
//
// TWO PLACEMENTS, ONE GUARD. The first suite covers a linked settings FILE. The
// second covers a linked `.claude` DIRECTORY — the file under it is ordinary, so
// the file-level `lstat` cannot see it and every write would land in the link
// target. Both are the same reason (`symlinked-settings`) because the remedy is
// the same: replace the link.
//
// WHY A FILE OF ITS OWN. `harness-window-config.test.ts` sits at the 500-line
// tests cap, and these three arms are about WHERE a write would land rather
// than what it would say — a different question from the sync/rollback arms they
// were written beside. Dividing them keeps each file under the cap without
// dropping an assertion.
//
// THE DEFECT THEY PIN. `writeFileSync`'s `'w'` flag is `O_WRONLY|O_CREAT|O_TRUNC`,
// so it FOLLOWS a link: a `.claude/settings.local.json` that is a symlink (or a
// Windows junction) would redirect every sync, reset and opt-out write into an
// arbitrary file outside the project, as the invoking user, with no operator
// action. `lstat`, never `stat`, is what sees it — `stat` follows the link and
// reports the victim's type.
//
// Dimensions covered:
//   - behavior:    the link is refused, and a missing path is still written
//   - integration: real fs — a real symlink (or junction) and a byte-compared target
//
// Dimensions omitted:
//   - render:      the module returns a result record; the CLI renders the
//                  sentence, asserted in the CLI tests
//   - a11y:        no user-visible text is emitted here — the CLI renders these
//                  results (asserted in the CLI tests)

import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  HARNESS_PERCENT_WRITTEN_KEY,
  syncHarnessPercent,
  type HarnessCompactThresholdLocation
} from '~/src/services/context/harness-compact-threshold-config';
import {
  HARNESS_WINDOW_SYNC_OPTOUT_KEY,
  HARNESS_WINDOW_WRITTEN_KEY,
  disableHarnessWindowSync,
  reenableHarnessWindowSync,
  resetHarnessWindow,
  syncHarnessWindow,
  type HarnessWindowLocation
} from '~/src/services/context/harness-window-config';
import { resetHarnessThreshold } from '~/src/services/context/harness-compact-threshold-reset';

declareDimensions(
  'tests/unit/context/harness-window-linked-settings.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'the module returns a result record; the CLI renders the sentence' },
    { dim: 'a11y', reason: 'no user-visible text is emitted here; the CLI renders these results' }
  ]
);

const KEY = 'CLAUDE_CODE_AUTO_COMPACT_WINDOW';

describe('harness-window-config — a LINKED settings file is refused rather than written through', () => {
  let root = '';
  let location: HarnessWindowLocation = { settingsPath: '', envVar: KEY };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'peaks-harness-window-link-'));
    location = { settingsPath: join(root, '.claude', 'settings.local.json'), envVar: KEY };
  });

  afterEach(() => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  function envBlock(): Record<string, unknown> {
    return (
      (JSON.parse(readFileSync(location.settingsPath, 'utf8')) as { env?: Record<string, unknown> })
        .env ?? {}
    );
  }

  /**
   * Put a link at the settings path, pointing at `victim`, and ASSERT it is
   * really a link before any test relies on one — otherwise a platform that
   * refused both a file symlink and a junction would let the refusal tests
   * pass green against a plain file that was never a link (a guard that
   * cannot be watched failing is decoration).
   *
   * A junction is the fallback for Windows without Developer Mode: `lstat`
   * reports it as `isSymbolicLink()`, so it exercises the same branch, and the
   * real file-symlink path runs on POSIX CI.
   */
  function linkSettingsTo(victim: string): void {
    mkdirSync(join(root, '.claude'), { recursive: true });
    try {
      symlinkSync(victim, location.settingsPath, 'file');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'EACCES' && code !== 'UNKNOWN') throw error;
      symlinkSync(victim, location.settingsPath, 'junction');
    }
    expect(lstatSync(location.settingsPath).isSymbolicLink()).toBe(true);
  }

  it('when the settings file is a link, should refuse the sync and leave the target untouched', () => {
    // given: `.claude/settings.local.json` is a link to a file outside it
    // when: the probe tries to materialize a window
    // then: it is refused with its own reason, and the target is byte-identical
    const victim = join(root, 'victim.json');
    writeFileSync(victim, '{"env":{"DO_NOT_TOUCH":"yes"}}\n', 'utf8');
    linkSettingsTo(victim);
    const before = readFileSync(victim, 'utf8');
    const result = syncHarnessWindow({ location, tokens: 500_000, env: {} });
    expect(result.action).toBe('skipped');
    expect(result.reason).toBe('symlinked-settings');
    expect(readFileSync(victim, 'utf8')).toBe(before);
  });

  it('when the settings file is a link, should refuse reset for the same reason and touch nothing', () => {
    // given: a link whose target already carries a peaks window
    // when: the documented rollback runs
    // then: reported absent, nothing written — the target keeps its rows
    const victim = join(root, 'victim.json');
    writeFileSync(
      victim,
      `${JSON.stringify({ env: { [KEY]: '500000', [HARNESS_WINDOW_WRITTEN_KEY]: '500000' } }, null, 2)}\n`,
      'utf8'
    );
    linkSettingsTo(victim);
    const before = readFileSync(victim, 'utf8');
    const result = resetHarnessWindow({ location, env: {} });
    expect(result.action).toBe('absent');
    expect(readFileSync(victim, 'utf8')).toBe(before);
  });

  it('when the settings file is a link, should refuse --disable and leave the target untouched', () => {
    // given: a link to a victim file, as the two reviewers reproduced
    // when: `--disable` tries to record the opt-out
    // then: refused with its own reason and the victim is byte-identical. The
    //       old `disableHarnessWindowSync` had no link guard, so the opt-out
    //       was written INTO the victim as the invoking user.
    const victim = join(root, 'victim.json');
    writeFileSync(victim, '{"env":{"DO_NOT_TOUCH":"yes"}}\n', 'utf8');
    linkSettingsTo(victim);
    const before = readFileSync(victim, 'utf8');
    const result = disableHarnessWindowSync({ location });
    expect(result.action).toBe('symlinked-settings');
    expect(readFileSync(victim, 'utf8')).toBe(before);
  });

  it('when the settings file is a link, should refuse --reenable and leave the target untouched', () => {
    // given: a link to a victim that carries the opt-out row
    // when: `--reenable` tries to clear it
    // then: refused, and the victim still holds its row — a clear-through would
    //       edit a file outside the project
    const victim = join(root, 'victim.json');
    writeFileSync(
      victim,
      `${JSON.stringify({ env: { [HARNESS_WINDOW_SYNC_OPTOUT_KEY]: 'off' } }, null, 2)}\n`,
      'utf8'
    );
    linkSettingsTo(victim);
    const before = readFileSync(victim, 'utf8');
    const result = reenableHarnessWindowSync({ location });
    expect(result.action).toBe('symlinked-settings');
    expect(readFileSync(victim, 'utf8')).toBe(before);
  });

  it('when the project root IS the home directory, should refuse --reenable and write nothing', () => {
    // given: a home-rooted location whose file holds the opt-out
    // when: `--reenable` runs
    // then: refused — the same H1 guard `--disable` has, because clearing the
    //       opt-out is still a write into the user's personal settings
    const victim = join(root, 'victim.json');
    writeFileSync(
      victim,
      `${JSON.stringify({ env: { [HARNESS_WINDOW_SYNC_OPTOUT_KEY]: 'off' } }, null, 2)}\n`,
      'utf8'
    );
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(location.settingsPath, readFileSync(victim, 'utf8'), 'utf8');
    const before = readFileSync(location.settingsPath, 'utf8');
    const result = reenableHarnessWindowSync({
      location: { ...location, projectRoot: homedir() }
    });
    expect(result.action).toBe('refused-unsafe-project-root');
    expect(readFileSync(location.settingsPath, 'utf8')).toBe(before);
  });

  it('when the settings file is ABSENT, should still write — a missing path is not a link', () => {
    // given: no settings file at all (the ordinary first write)
    // when: the sync runs
    // then: it writes, because lstat's ENOENT is "not a link", not a refusal
    expect(existsSync(location.settingsPath)).toBe(false);
    const result = syncHarnessWindow({ location, tokens: 500_000, env: {} });
    expect(result.action).toBe('written');
    expect(envBlock()[KEY]).toBe('500000');
  });
});

/**
 * The DIRECTORY half of the same guard. `lstat` on the settings FILE cannot see
 * a `.claude` that is itself a link: the file under it is ordinary, so the
 * file-level guard said "not a link" and every write landed in the link target.
 *
 * Every arm asserts `isSymbolicLink()` on the directory fixture first, so the
 * refusal cannot pass against a plain directory that was never a link.
 */
describe('harness-window-config — a LINKED .claude directory is refused rather than written through', () => {
  const PERCENT_KEY = 'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE';
  /**
   * Peaks content on BOTH knobs, so a non-link file would be edited by every
   * writer. Deliberately WITHOUT the opt-out row: that gate runs before the link
   * guard and would answer `opted-out`, which is a different refusal — the arm
   * below pins that state separately.
   */
  const PEAKS_CONTENT = `${JSON.stringify(
    {
      env: {
        [KEY]: '500000',
        [HARNESS_WINDOW_WRITTEN_KEY]: '500000',
        [PERCENT_KEY]: '70',
        [HARNESS_PERCENT_WRITTEN_KEY]: '70'
      }
    },
    null,
    2
  )}\n`;
  let root = '';
  let victimDir = '';
  let location: HarnessCompactThresholdLocation;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'peaks-harness-dirlink-'));
    victimDir = join(root, 'victim');
    mkdirSync(victimDir);
    const project = join(root, 'project');
    mkdirSync(project);
    // A junction is the fallback where a directory symlink needs privileges.
    // `lstat` reports it as `isSymbolicLink()`, i.e. the same branch.
    try {
      symlinkSync(victimDir, join(project, '.claude'), 'junction');
    } catch {
      symlinkSync(victimDir, join(project, '.claude'), 'dir');
    }
    location = {
      settingsPath: join(project, '.claude', 'settings.local.json'),
      envVar: KEY,
      percentEnvVar: PERCENT_KEY,
      projectRoot: project
    };
  });

  afterEach(() => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  /** Give the victim the peaks content, then return what is on disk before the call. */
  function seedVictim(): string {
    writeFileSync(join(victimDir, 'settings.local.json'), PEAKS_CONTENT, 'utf8');
    return readFileSync(join(victimDir, 'settings.local.json'), 'utf8');
  }

  /** The six writers, each named with the refusal it reports for a linked placement. */
  const writers: ReadonlyArray<{
    readonly name: string;
    readonly run: () => string;
    readonly reason: string;
  }> = [
    {
      name: 'syncHarnessWindow',
      run: () => syncHarnessWindow({ location, tokens: 250_000, env: {} }).reason ?? '',
      reason: 'symlinked-settings'
    },
    {
      name: 'syncHarnessPercent',
      run: () => syncHarnessPercent({ location, percent: 80 }).reason ?? '',
      reason: 'symlinked-settings'
    },
    {
      name: 'resetHarnessThreshold',
      run: () => resetHarnessThreshold({ thresholdLocation: location }).refusal ?? '',
      reason: 'symlinked-settings'
    },
    {
      name: 'disableHarnessWindowSync',
      run: () => disableHarnessWindowSync({ location }).action,
      reason: 'symlinked-settings'
    },
    {
      name: 'reenableHarnessWindowSync',
      run: () => reenableHarnessWindowSync({ location }).action,
      reason: 'symlinked-settings'
    },
    {
      name: 'resetHarnessWindow (window-only rollback)',
      run: () => resetHarnessWindow({ location, env: {} }).action,
      reason: 'absent'
    }
  ];

  it.each(writers.map((w) => [w.name, w] as const))(
    'when .claude is a link, should refuse %s and leave the target byte-identical',
    (_name, writer) => {
      // given: `.claude` is a junction to a directory holding a real settings file
      // when: that writer is called
      // then: it reports a refusal and the file outside the project is untouched
      expect(lstatSync(join(root, 'project', '.claude')).isSymbolicLink()).toBe(true);
      const before = seedVictim();
      expect(writer.run()).toBe(writer.reason);
      expect(readFileSync(join(victimDir, 'settings.local.json'), 'utf8')).toBe(before);
    }
  );

  it('when .claude is ABSENT, should write the first sync — a missing directory is not a link', () => {
    // given: a project with no .claude directory at all
    // when: the percent half, which creates the directory, runs
    // then: it writes the file there instead of refusing the first install
    const project = join(root, 'fresh');
    mkdirSync(project);
    const fresh: HarnessCompactThresholdLocation = {
      ...location,
      settingsPath: join(project, '.claude', 'settings.local.json'),
      projectRoot: project
    };
    expect(existsSync(join(project, '.claude'))).toBe(false);
    expect(syncHarnessPercent({ location: fresh, percent: 80 }).action).toBe('written');
    expect(existsSync(fresh.settingsPath)).toBe(true);
  });
});
