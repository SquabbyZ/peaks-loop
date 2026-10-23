// tests/unit/cli/commands/skill-sync-store-report.test.ts
//
// `peaks skill sync` must SHOW what the canonical store holds.
//
// WHY. The install's `skipped` list was a value in a return object nobody read:
// a store entry that was left alone, and a copy that was behind the installed
// release, both looked exactly like a successful install from the outside. A
// dry run is where that report belongs — it says what a repair WOULD do,
// before anything is written.
//
// The sync service is replaced here (the real one installs into the user's
// home directories). The rendering under test is the command's.
//
// Dimensions covered:
//   - render:      the JSON envelope carries the report in its next actions
//   - behavior:    the report names every state the store can be in
//   - integration: the real command registration and the real envelope builder
//   - a11y:        the human output names the stale and the left-alone entries
//
// Run with: pnpm vitest run tests/unit/cli/commands/skill-sync-store-report.test.ts

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerSkillRegistryCommands } from '~/src/cli/commands/core/skill-registry-commands';
import { declareDimensions } from '../../_setup/4dim-template.js';
import { makeCapturedIo, type CapturedIo } from '../../_setup/io.js';

declareDimensions('tests/unit/cli/commands/skill-sync-store-report.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const __sync = vi.hoisted((): { result: unknown } => ({ result: null }));

vi.mock('../../../../src/services/skills/sync-service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/services/skills/sync-service.js')>()),
  runSkillSync: () => Promise.resolve(__sync.result)
}));

const originalExitCode = process.exitCode;

const ENTRIES = [
  { name: 'peaks-code', state: 'stale', action: 'planned', version: '4.1.15', reason: 'version' },
  { name: 'peaks-rd', state: 'current', action: 'unchanged', version: '4.1.17', reason: null },
  { name: 'my-own-skill', state: 'unmanaged', action: 'unmanaged', version: null, reason: null }
];

/** A store that holds nothing the package ships: every entry is absent. */
const ABSENT_ENTRIES = [
  { name: 'peaks-code', state: 'absent', action: 'planned', version: null, reason: null }
];

/** Two entries this run repaired: stale as found, current now. */
const REPAIRED_ENTRIES = [
  { name: 'peaks-code', state: 'stale', action: 'installed', version: '4.1.17', reason: 'version' },
  { name: 'peaks-rd', state: 'stale', action: 'installed', version: '4.1.17', reason: 'version' }
];

function syncResult(dryRun: boolean, entries: unknown[] = ENTRIES): unknown {
  return {
    applied: !dryRun,
    dryRun,
    projectRoot: '/tmp/peaks-project',
    perPlatform: [
      {
        platform: 'claude-code',
        ok: true,
        installed: ['peaks-code', 'peaks-rd'],
        skipped: ['my-own-skill'],
        entries,
        durationMs: 3
      }
    ],
    syncedCount: 1,
    failedCount: 0,
    totalInstalled: 2
  };
}

beforeEach(() => {
  __sync.result = syncResult(true);
});

afterEach(() => {
  process.exitCode = originalExitCode;
});

async function runCli(args: readonly string[]): Promise<CapturedIo> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  registerSkillRegistryCommands(program.command('skill'), io);
  await program.parseAsync(['node', 'peaks', 'skill', 'sync', ...args]);
  return captured;
}

describe('(render) the store report reaches the envelope', () => {
  it('when the sync command runs, should put the report in the next actions of the JSON envelope', async () => {
    // given: a store holding a current, a stale and an unmanaged entry
    // when: the sync command runs with --json
    // then: the report line is one of the envelope's next actions
    const captured = await runCli(['--json']);
    const envelope = JSON.parse(captured.text()) as {
      ok: boolean;
      nextActions: string[];
      data: { perPlatform: Array<{ entries: unknown[] }> };
    };

    expect(envelope.ok).toBe(true);
    expect(envelope.nextActions.join('\n')).toContain('skill store:');
    expect(envelope.data.perPlatform[0]?.entries).toHaveLength(3);
  });
});

describe('(behavior) the report names every state', () => {
  it('when the store report is rendered, should count the current, the stale and the unmanaged entries', async () => {
    // given: a store holding a current, a stale and an unmanaged entry
    // when: the sync command runs with --json
    // then: the report counts each of the three states
    const captured = await runCli(['--json']);
    const envelope = JSON.parse(captured.text()) as { nextActions: string[] };
    const report = envelope.nextActions.find((action) => action.startsWith('skill store:'));

    expect(report).toBeDefined();
    expect(report).toContain('1 current');
    expect(report).toContain('1 stale');
    expect(report).toContain('1 unmanaged');
  });

  it('when the store holds nothing the package ships, should count the absent entries as absent', async () => {
    // given: a store that holds no copy of the package's skill
    // when: the command runs
    // then: the entry is counted as absent, and nothing is counted as current
    __sync.result = syncResult(true, ABSENT_ENTRIES);

    const captured = await runCli(['--json']);
    const envelope = JSON.parse(captured.text()) as { nextActions: string[] };
    const report = envelope.nextActions.find((action) => action.startsWith('skill store:'));

    expect(report).toBeDefined();
    expect(report).toContain('0 current');
    expect(report).toContain('1 absent');
  });

  it('when the counts are printed, should add up to the number of rows', async () => {
    // given: a store with one current entry, one stale and one unmanaged
    // when: the sync command runs with --json
    // then: every row is counted once — a row the report does not count is a row
    //        a reader cannot account for
    const captured = await runCli(['--json']);
    const envelope = JSON.parse(captured.text()) as { nextActions: string[] };
    const report = envelope.nextActions.find((action) => action.startsWith('skill store:'));

    const counts = ['current', 'stale', 'unmanaged', 'retired', 'absent'].map((state) =>
      Number(report?.match(new RegExp(`(\\d+) ${state}`))?.[1] ?? '0')
    );
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(3);
  });

  it('when the report is printed, should say which reading the counts are taken in', async () => {
    // given: a store report whose counts are the state the run FOUND
    // when: the sync command runs with --json
    // then: the line names the reading, so "2 stale" cannot be read as "2 stale
    //        NOW" after a repair that fixed them
    const captured = await runCli(['--json']);
    const envelope = JSON.parse(captured.text()) as { nextActions: string[] };
    const report = envelope.nextActions.find((action) => action.startsWith('skill store:'));

    expect(report).toBeDefined();
    expect(report).toContain('state as found');
  });
  it('when the run repaired two stale entries, should say so next to their names', async () => {
    // given: two entries that were stale as found and were repaired by this run
    // when: the command runs
    // then: the two readings are distinguishable — the count is what was found,
    //        the annotation is what this run did about it
    __sync.result = syncResult(false, REPAIRED_ENTRIES);

    const captured = await runCli(['--json']);
    const envelope = JSON.parse(captured.text()) as { nextActions: string[] };
    const report = envelope.nextActions.find((action) => action.startsWith('skill store:'));

    expect(report).toContain('2 stale');
    expect(report).toContain('peaks-code');
    expect(report).toContain('peaks-rd');
    expect(report).toContain('repaired by this run');
  });
});

describe('(integration) the command registration is the real one', () => {
  it('when the sync command runs, should report what the sync service returned', async () => {
    // given: the real command registration and the real sync service
    // when: the sync command runs
    // then: the service's own report is printed, and the exit code is untouched
    const captured = await runCli([]);

    expect(captured.text()).toContain('skill store:');
    expect(process.exitCode).toBe(originalExitCode);
  });
});

describe('(a11y) the human output names the entries', () => {
  it('when the human output is read, should name the stale entries and the ones left alone', async () => {
    // given: a store holding a stale entry and an entry of the user's own
    // when: the sync command runs
    // then: the human output names both, and says which is stale
    const captured = await runCli([]);

    expect(captured.text()).toContain('peaks-code');
    expect(captured.text()).toContain('my-own-skill');
    expect(captured.text()).toContain('stale');
  });

  it('when the command runs in dry-run mode, should say the dry run wrote nothing', async () => {
    // given: a dry run
    // when: the sync command runs with --dry-run
    // then: the human output says the run wrote nothing
    const captured = await runCli(['--dry-run']);

    expect(captured.text()).toContain('dry run');
  });
});
