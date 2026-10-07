// tests/unit/services/codegraph/codegraph-config-repair.test.ts
//
// 4-dimension unit test for the exclude repair entry point
// `repairCodegraphExcludeFromProject` in
// `src/services/codegraph/codegraph-exclude-repair.ts` (slice-002 of
// rid-2026-09-16-codegraph-index-integrity).
//
// Three claims carry what is left of the slice:
//
//   1. THE DEAD-ROW POLICY (user option, slice-002): dead rows are detected
//      always (slice-001) and PURGED on demand, and the demand path is
//      upstream `index --force` — the only path that drops rows for files
//      deleted in an earlier commit. The assertions here pin that the FLAG
//      reaches the upstream process (the invocation's argv), not merely a
//      boolean inside peaks-loop.
//
//   2. DURABLE + ATOMIC. The repair lands in ONE rewrite with ONE byte-exact
//      backup, and it STAYS — a rebuild never restores its own write.
//
//   3. IDEMPOTENT. A second run over an already-repaired config writes
//      nothing and spawns nothing.
//
// THE INCLUDE AXIS IS GONE (1.6.2 upgrade). This seam used to append the
// extensions upstream's own `include` template omitted, report that delta
// beside the exclude counter, and — because the exclude reconciler filters
// its candidates through `include` — had to normalise `include` BEFORE
// reconciling. 1.6.x ships no template and inverted what `include` MEANS, so
// the axis is deleted in `src/`; the cases whose SUBJECT was that axis are
// deleted here with it rather than weakened. Those were: the ordering trap
// (the rule it turned on is only invisible while `include` is narrow), the
// coverage-ratio pair (both assertions were on the include counters), the
// "no `include` key" limitation, and the pure include plan.
//
// What is mocked and why: `executeCodegraphInvocation` is passed in as the
// `runner` seam (the module takes it as an argument), so the tests observe
// exactly what the upstream process would be spawned with. Everything else —
// git, the config read, the reconciliation, the config rewrite, the backup,
// the report — runs for real against a real temp git work tree.
//
// Dimensions covered:
//   - behavior:    force vs incremental, idempotence
//   - integration: real git + real fs
//   - render:      the config bytes written (reduced exclude, one byte-exact
//                  backup)
//   - a11y:        every degraded path names what went wrong in `warning`
//
// Run with: pnpm vitest run tests/unit/services/codegraph/codegraph-config-repair.test.ts

import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  existsSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CODEGRAPH_CONFIG_BACKUP_SUFFIX,
  repairCodegraphExcludeFromProject
} from '../../../../src/services/codegraph/codegraph-exclude-repair.js';
import { inspectCodegraphExcludeIntegrity } from '../../../../src/services/codegraph/codegraph-exclude-integrity.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../../_setup/subprocess-timeouts.js';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions('tests/unit/services/codegraph/codegraph-config-repair.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const cleanups: string[] = [];

afterEach(() => {
  while (cleanups.length > 0) {
    const dir = cleanups.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function makeProjectRoot(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(dir);
  return dir;
}

function git(dir: string, args: readonly string[]): void {
  execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore', windowsHide: true });
}

function configPathOf(projectRoot: string): string {
  return join(projectRoot, 'codegraph.json');
}

function writeConfig(projectRoot: string, config: Record<string, unknown>): void {
  mkdirSync(join(projectRoot, '.codegraph'), { recursive: true });
  writeFileSync(configPathOf(projectRoot), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

// The fixture every case below starts from: a real temp git work tree whose
// config carries one `exclude` rule that really does block a tracked `.ts`
// file, plus one it does not. A project-AUTHORED rule is the only class of
// offender left now that 1.6.x ships no default template to collide with —
// `exclude` still means "keep OUT of the index even when git-tracked".
function makeRepairFixture(): string {
  const projectRoot = makeProjectRoot('peaks-cg-repair-');
  git(projectRoot, ['init', '-q']);
  git(projectRoot, ['config', 'user.email', 'peaks-test@example.com']);
  git(projectRoot, ['config', 'user.name', 'peaks test']);

  mkdirSync(join(projectRoot, 'src'), { recursive: true });
  mkdirSync(join(projectRoot, 'vendor'), { recursive: true });
  writeFileSync(join(projectRoot, 'src', 'ok.ts'), 'export const ok = 1;\n', 'utf8');
  writeFileSync(join(projectRoot, 'vendor', 'lib.ts'), 'export const lib = 1;\n', 'utf8');
  git(projectRoot, ['add', '-A']);
  git(projectRoot, ['commit', '-qm', 'fixture']);

  writeConfig(projectRoot, {
    version: 1,
    rootDir: '.',
    include: ['**/*.ts'],
    exclude: ['**/vendor/**', '**/node_modules/**'],
    languages: ['typescript'],
    frameworks: [],
    maxFileSize: 1048576,
    extractDocstrings: true,
    trackCallSites: false
  });

  return projectRoot;
}

type RecordedRun = { readonly args: readonly string[]; readonly subcommand: string };

function makeRecordingRunner(result: { exitCode: number } = { exitCode: 0 }): {
  runs: RecordedRun[];
  runner: (invocation: { args: readonly string[]; subcommand: string }) => Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;
} {
  const runs: RecordedRun[] = [];
  return {
    runs,
    runner: async (invocation) => {
      runs.push({ args: [...invocation.args], subcommand: invocation.subcommand });
      return { exitCode: result.exitCode, stdout: '', stderr: '' };
    }
  };
}

// ── 1. behavior: the repair does not repeat itself ───────────────────

describe('repairCodegraphExcludeFromProject — idempotence', () => {
  it(
    'should be idempotent — a second run writes nothing and spawns nothing',
    async () => {
      const projectRoot = makeRepairFixture();
      const first = makeRecordingRunner();
      await repairCodegraphExcludeFromProject(projectRoot, first.runner);
      const configAfterFirst = readFileSync(configPathOf(projectRoot), 'utf8');

      const second = makeRecordingRunner();
      const report = await repairCodegraphExcludeFromProject(projectRoot, second.runner);

      expect(report.applied).toBe(false);
      expect(report.rulesRemoved).toEqual([]);
      expect(second.runs).toHaveLength(0);
      expect(readFileSync(configPathOf(projectRoot), 'utf8')).toBe(configAfterFirst);
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );
});

// ── 2. the dead-row policy: the force flag reaches upstream ──────────

describe('reindex option — the dead-row purge path', () => {
  it(
    'reindex:"force" should pass upstream`s own --force flag, and report the forced rebuild',
    async () => {
      const projectRoot = makeRepairFixture();
      const { runs, runner } = makeRecordingRunner();

      const report = await repairCodegraphExcludeFromProject(projectRoot, runner, {
        reindex: 'force'
      });

      expect(report.reindexed).toBe(true);
      expect(report.forcedRebuild).toBe(true);
      // The load-bearing assertion: the flag is in the ARGV of the upstream
      // process. `index --force` is `cg.clear()` + a full `indexAll()` in the
      // installed upstream, and that `clear()` is the only thing that deletes
      // rows for files deleted in an earlier commit — plain `indexAll` only
      // upserts, and `sync` only removes working-tree deletions (measured on
      // this repo: all four dead rows are committed deletions, invisible to
      // `git status`). Asserting an internal boolean would not pin any of that.
      expect(runs).toHaveLength(1);
      expect(runs[0]?.args).toContain('index');
      expect(runs[0]?.args).toContain('--force');
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it(
    'reindex:false should spawn nothing at all (the preflight / autorefresh mode)',
    async () => {
      const projectRoot = makeRepairFixture();
      const configPath = configPathOf(projectRoot);
      const before = readFileSync(configPath, 'utf8');
      const { runs, runner } = makeRecordingRunner();

      const report = await repairCodegraphExcludeFromProject(projectRoot, runner, {
        reindex: false
      });

      expect(report.applied).toBe(true);
      expect(report.reindexed).toBe(false);
      expect(report.forcedRebuild).toBe(false);
      expect(runs).toHaveLength(0);
      // Not a degradation: nothing went wrong, so there is nothing to warn about.
      expect(report.warning).toBeNull();

      // Invariant: the two callers that pass `reindex: false` (the pre-dispatch
      // preflight and the post-slice autorefresh) get the config repair and
      // nothing else. Asserted on the config bytes rather than on a flag alone,
      // because "the repair is durable" is a statement about the file: the bytes
      // on disk are NOT the ones this run started with.
      expect(readFileSync(configPath, 'utf8')).not.toBe(before);
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it(
    'should report the TRUE forced state when a forced rebuild FAILS — upstream may have cleared already',
    async () => {
      const projectRoot = makeRepairFixture();
      const { runner } = makeRecordingRunner({ exitCode: 9 });

      const report = await repairCodegraphExcludeFromProject(projectRoot, runner, {
        reindex: 'force'
      });

      // `reindexed: false` says "did not complete"; it must NOT be read as
      // "nothing was purged", because upstream's `index --force` runs
      // `cg.clear()` BEFORE `indexAll()` — a forced run that failed has
      // already deleted the rows. Hardcoding `false` here (as this did) made
      // the two states indistinguishable in the envelope.
      expect(report.reindexed).toBe(false);
      expect(report.forcedRebuild).toBe(true);
      expect(report.warning).toContain('index failed (exit 9)');
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it(
    'reindex:"force" with a clean config should still rebuild, but write nothing',
    async () => {
      const projectRoot = makeRepairFixture();
      const { runs, runner } = makeRecordingRunner();
      // First run repairs the exclude list, so the second has nothing to change.
      await repairCodegraphExcludeFromProject(projectRoot, runner);
      const bytesAfterRepair = readFileSync(configPathOf(projectRoot), 'utf8');
      const mtimeAfterRepair = statSync(configPathOf(projectRoot)).mtimeMs;
      runs.length = 0;

      const report = await repairCodegraphExcludeFromProject(projectRoot, runner, {
        reindex: 'force'
      });

      // The config is untouched — no rewrite, no new backup (the .bak that the
      // first run left keeps its own bytes, asserted by mtime + content here).
      expect(report.applied).toBe(false);
      expect(readFileSync(configPathOf(projectRoot), 'utf8')).toBe(bytesAfterRepair);
      expect(statSync(configPathOf(projectRoot)).mtimeMs).toBe(mtimeAfterRepair);
      // The `.bak` a FORCED run leaves behind is a rollback POINT, not a rollback:
      // nothing on this path consumes it. `peaks codegraph config-restore` does,
      // and only when an operator asks for it — which is what keeps a forced run
      // from reverting the very repair it just made.
      expect(existsSync(`${configPathOf(projectRoot)}${CODEGRAPH_CONFIG_BACKUP_SUFFIX}`)).toBe(
        true
      );

      // …but the rebuild still ran, forced. This is a DELIBERATE asymmetry: a
      // clean reconciliation does not prove the index is complete (the gate's
      // coverage verdict is admission-only — a file `include` admits that
      // upstream skipped for `maxFileSize` or on an extraction error is
      // invisible to it), so an operator who asked for a forced rebuild gets
      // one rather than a "nothing to do".
      expect(report.reindexed).toBe(true);
      expect(report.forcedRebuild).toBe(true);
      expect(runs).toHaveLength(1);
      expect(runs[0]?.args).toContain('--force');
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  // ── `'force'` is index-only: the config repair STAYS ───────────────

  it(
    'reindex:"force" should KEEP the repaired config while rebuilding forced',
    async () => {
      const projectRoot = makeRepairFixture();
      const configPath = configPathOf(projectRoot);
      const before = readFileSync(configPath, 'utf8');
      const { runs, runner } = makeRecordingRunner();

      const report = await repairCodegraphExcludeFromProject(projectRoot, runner, {
        reindex: 'force'
      });

      // The repair really happened in this one run…
      expect(report.applied).toBe(true);
      expect(report.rulesRemoved).toEqual(['**/vendor/**']);

      // …and it STAYS. This is the load-bearing half of the mode's contract: a
      // `'force'` that restored its own write would leave the config exactly as
      // it found it, so `peaks codegraph status` would still report the gap and
      // exit 75 would never clear — the verb would cancel itself out. Putting a
      // config BACK is the explicit `peaks codegraph config-restore` verb, which
      // reads the `.bak` this run leaves and never runs on its own.
      expect(readFileSync(configPath, 'utf8')).not.toBe(before);
      const repaired = JSON.parse(readFileSync(configPath, 'utf8')) as {
        include: string[];
        exclude: string[];
      };
      expect(repaired.include).toEqual(['**/*.ts']);
      expect(repaired.exclude).toEqual(['**/node_modules/**']);
      expect(readFileSync(`${configPath}${CODEGRAPH_CONFIG_BACKUP_SUFFIX}`, 'utf8')).toBe(before);

      // The forced rebuild ran — `--force` in the ARGV is upstream's `cg.clear()`
      // + `indexAll()`, the only path that drops rows for files deleted in an
      // earlier commit.
      expect(report.warning).toBeNull();
      expect(report.reindexed).toBe(true);
      expect(report.forcedRebuild).toBe(true);
      expect(runs).toHaveLength(1);
      expect(runs[0]?.args).toContain('index');
      expect(runs[0]?.args).toContain('--force');
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it(
    'both repair modes should keep the repair — `force` differs only in the rebuild',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const plainRoot = makeRepairFixture();
      const forcedRoot = makeRepairFixture();

      const plain = await repairCodegraphExcludeFromProject(
        plainRoot,
        makeRecordingRunner().runner
      );
      const forced = await repairCodegraphExcludeFromProject(
        forcedRoot,
        makeRecordingRunner().runner,
        {
          reindex: 'force'
        }
      );

      // The two modes produce the SAME config, byte for byte: `'force'` is not a
      // different repair, it is the same repair followed by a different rebuild.
      // Without this control the case above could be satisfied by a `'force'`
      // special case that happens to write something else.
      expect(readFileSync(configPathOf(forcedRoot), 'utf8')).toBe(
        readFileSync(configPathOf(plainRoot), 'utf8')
      );
      expect(forced.rulesRemoved).toEqual(plain.rulesRemoved);
      expect(readFileSync(configPathOf(plainRoot), 'utf8')).not.toContain('"**/vendor/**"');

      // …and the ONLY difference is the flag that reaches upstream.
      expect(plain.forcedRebuild).toBe(false);
      expect(forced.forcedRebuild).toBe(true);
    }
  );

  it(
    'should write the repair to disk BEFORE the follow-up index is spawned',
    async () => {
      const projectRoot = makeRepairFixture();
      const configPath = configPathOf(projectRoot);
      const before = readFileSync(configPath, 'utf8');

      // The oracle is what the CONFIG holds at the moment upstream is spawned,
      // not what the report claims afterwards. It is load-bearing: the reduced
      // `exclude` is exactly what the rebuild exists to act on, so a spawn that
      // ran first — or a config written only after it — would rebuild against
      // the gapped config and recover nothing.
      const configAtSpawn: string[] = [];
      const runner = async (): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
        configAtSpawn.push(readFileSync(configPath, 'utf8'));
        return { exitCode: 0, stdout: '', stderr: '' };
      };

      await repairCodegraphExcludeFromProject(projectRoot, runner, { reindex: 'force' });

      expect(configAtSpawn).toHaveLength(1);
      expect(configAtSpawn[0]).not.toBe(before);
      expect((JSON.parse(configAtSpawn[0] ?? '{}') as { exclude: string[] }).exclude).toEqual([
        '**/node_modules/**'
      ]);
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );
});

// ── 3. render + a11y: the writer and its degraded paths ──────────────

describe('the writer keeps the third-party config intact', () => {
  it(
    'should name the exclude repair in the warning when the follow-up index fails',
    async () => {
      const projectRoot = makeRepairFixture();
      const { runner } = makeRecordingRunner({ exitCode: 7 });

      const report = await repairCodegraphExcludeFromProject(projectRoot, runner);

      expect(report.applied).toBe(true);
      expect(report.reindexed).toBe(false);
      // The control for the forced case above: this run was NOT forced
      // (`reindex` defaults to `true`, i.e. an ordinary incremental index), so
      // nothing was purged and `forcedRebuild: false` is the truth here. The
      // two cases together are what makes the field a discriminator.
      expect(report.forcedRebuild).toBe(false);
      // The warning names what THIS repair did and pins the whole sentence, so
      // an extra claim cannot be smuggled into it.
      expect(report.warning).toMatch(
        /^codegraph config repaired \(1 exclude rule\(s\) removed\) but the follow-up index failed \(exit 7\)/
      );
      // The config repair itself is durable — it is not rolled back.
      expect(inspectCodegraphExcludeIntegrity(projectRoot).gap).toBe(false);
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it(
    'when the project is not a git work tree, should warn and leave the config alone',
    async () => {
      const projectRoot = makeProjectRoot('peaks-cg-repair-nogit-');
      writeConfig(projectRoot, { include: ['**/*.ts'], exclude: ['**/tool.mjs'] });
      const before = readFileSync(configPathOf(projectRoot), 'utf8');

      const { runs, runner } = makeRecordingRunner();
      const report = await repairCodegraphExcludeFromProject(projectRoot, runner);

      expect(report.applied).toBe(false);
      expect(report.warning).toContain('reconcile skipped');
      expect(runs).toHaveLength(0);
      expect(readFileSync(configPathOf(projectRoot), 'utf8')).toBe(before);
      expect(existsSync(`${configPathOf(projectRoot)}${CODEGRAPH_CONFIG_BACKUP_SUFFIX}`)).toBe(
        false
      );
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );
});
