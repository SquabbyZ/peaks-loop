// tests/unit/skills/skill-sync-dry-run.test.ts
//
// `peaks skill sync --dry-run` has to reach the installer AS a dry run.
//
// WHY THIS FILE EXISTS. The report the command shows — which store entries are
// behind the installed release, which ones are the user's own — is only
// truthful if the command writes nothing. The installer is the module that
// decides what to write, and the command reaches it through the sync service,
// so the flag's journey across that seam is worth pinning: a dry run that
// reaches the installer as a real run would refresh the store and THEN report
// it as stale, which is worse than not reporting it at all.
//
// The installer is REPLACED here. The real one writes into the user's home
// directories, and no test may do that.
//
// Dimensions covered:
//   - behavior:    the options the installer receives, and the report that comes back
//   - integration: the real sync service and its installer seam
//   - render:      OMITTED — the service returns records and prints nothing
//   - a11y:        OMITTED — no human-facing text is asserted here

import { describe, expect, it, vi } from 'vitest';

import { runSkillSync, __testing } from '~/src/services/skills/sync-service';
import type {
  InstallBundledSkillsOptions,
  InstallResult,
  StoreEntryReport
} from '~/src/services/skills/sync-service-support';
import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/skills/skill-sync-dry-run.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'the service returns records and writes no human-facing output' },
    { dim: 'a11y', reason: 'no human-facing text, exit code or error message is asserted here' }
  ]
);

const ENTRIES: readonly StoreEntryReport[] = [
  { name: 'peaks-code', state: 'stale', action: 'planned', version: '4.1.15', reason: 'version' },
  { name: 'my-own-skill', state: 'unmanaged', action: 'unmanaged', version: null, reason: null }
];

function stubInstaller(result: InstallResult): {
  fn: (options: InstallBundledSkillsOptions) => InstallResult;
  calls: InstallBundledSkillsOptions[];
} {
  const calls: InstallBundledSkillsOptions[] = [];
  return {
    calls,
    fn: (options: InstallBundledSkillsOptions): InstallResult => {
      calls.push(options);
      return result;
    }
  };
}

describe('Scenario: behavior — the dry run reaches the installer as a dry run', () => {
  it('when the command runs a dry run, should hand the installer dryRun:true', async () => {
    // given: an installer that records what it was handed
    // when: the sync service runs a dry run
    // then: the installer was told to write nothing
    const stub = stubInstaller({ installed: ['peaks-code'], skipped: ['my-own-skill'] });
    vi.spyOn(__testing.services, 'loadInstallerForTest').mockResolvedValue(stub.fn);
    __testing.resetInstallerCache();

    await runSkillSync({
      projectRoot: '/tmp/peaks-project',
      platforms: ['claude-code'],
      dryRun: true
    });

    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]?.dryRun).toBe(true);
  });

  it('when the command runs for real, should hand the installer no dryRun flag', async () => {
    // given: an installer that records what it was handed
    // when: the sync service runs for real
    // then: the installer was not put in dry-run mode
    const stub = stubInstaller({ installed: ['peaks-code'], skipped: [] });
    vi.spyOn(__testing.services, 'loadInstallerForTest').mockResolvedValue(stub.fn);
    __testing.resetInstallerCache();

    await runSkillSync({ projectRoot: '/tmp/peaks-project', platforms: ['claude-code'] });

    expect(stub.calls[0]?.dryRun).toBeUndefined();
  });
});

describe('Scenario: integration — the store report survives the seam', () => {
  it('when the installer reports the store entries, should carry them into the platform result', async () => {
    // given: an installer that reports what the canonical store holds
    // when: the sync service runs
    // then: the entries are on the platform result, so a caller can report them
    const stub = stubInstaller({
      installed: ['peaks-code'],
      skipped: ['my-own-skill'],
      entries: ENTRIES
    });
    vi.spyOn(__testing.services, 'loadInstallerForTest').mockResolvedValue(stub.fn);
    __testing.resetInstallerCache();

    const result = await runSkillSync({
      projectRoot: '/tmp/peaks-project',
      platforms: ['claude-code'],
      dryRun: true
    });

    expect(result.perPlatform[0]?.entries).toEqual(ENTRIES);
  });
});
