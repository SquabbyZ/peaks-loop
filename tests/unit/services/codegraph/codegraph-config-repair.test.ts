// tests/unit/services/codegraph/codegraph-config-repair.test.ts
//
// 4-dimension unit test for the TWO-AXIS repair entry point
// `repairCodegraphExcludeFromProject` in
// `src/services/codegraph/codegraph-exclude-repair.ts` (slice-002 of
// rid-2026-09-16-codegraph-index-integrity).
//
// Slice-001 detected two defects; this is the file that proves they are
// FIXABLE. Three claims carry the slice:
//
//   1. ORDERING. Slice-001's RD measured, by a real test failure, that an
//      `exclude` rule blocking ONLY a file `include` drops reconciles
//      COMPLETELY CLEAN — and starts biting the moment `include` is widened.
//      So the exclude reconciliation must run AFTER include normalization.
//      The first test here asserts the TRAP exists (pre-normalization
//      reconciliation returns `rulesToRemove: []` and the shipped exclude
//      gate reports `gap: false`), and the second asserts the repair closes
//      it in the same run. If the trap ever stops existing the first test
//      fails, so the second cannot silently become vacuous.
//
//   2. THE DEAD-ROW POLICY (user option, slice-002): dead rows are detected
//      always (slice-001) and PURGED on demand, and the demand path is
//      upstream `index --force` — the only path that drops rows for files
//      deleted in an earlier commit. The assertions here pin that the FLAG
//      reaches the upstream process (the invocation's argv), not merely a
//      boolean inside peaks-loop.
//
//   3. ADDITIVE + ATOMIC. Both axes move in ONE rewrite with ONE backup, and
//      the include list is only ever appended to.
//
// What is mocked and why: `executeCodegraphInvocation` is passed in as the
// `runner` seam (the module takes it as an argument), so the tests observe
// exactly what the upstream process would be spawned with. Everything else —
// git, the config read, both reconciliations, the config rewrite, the backup,
// the report — runs for real against a real temp git work tree.
//
// Dimensions covered:
//   - behavior:    the two-axis plan, force vs incremental, idempotence
//   - integration: real git + real fs + the real upstream tables
//   - render:      the config bytes written (append-only include, reduced
//                  exclude, one byte-exact backup)
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
  repairCodegraphExcludeFromProject,
  repairCodegraphInclude
} from '../../../../src/services/codegraph/codegraph-exclude-repair.js';
import { inspectCodegraphExcludeIntegrity } from '../../../../src/services/codegraph/codegraph-exclude-integrity.js';
import { inspectCodegraphIndexIntegrity } from '../../../../src/services/codegraph/codegraph-index-integrity.js';
import {
  readTrackedFiles,
  reconcileCodegraphExclude
} from '../../../../src/services/codegraph/codegraph-exclude-reconciler.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../../_setup/subprocess-timeouts.js';
import { upstreamUnnamedIncludeExtensions } from '../../../../src/services/codegraph/codegraph-include-reconciler.js';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions('tests/unit/services/codegraph/codegraph-config-repair.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

// The five patterns the include axis appends, DERIVED here from upstream's
// own data rather than typed out — so this expectation moves with upstream
// for the same reason the implementation does.
const EXPECTED_INCLUDE_ADDITIONS = upstreamUnnamedIncludeExtensions().map(
  (extension) => `**/*${extension}`
);

// What the index axis would call "extractor-supported" in these fixtures.
// Injected rather than re-derived: the point of these cases is the repair,
// and `codegraph-index-integrity.test.ts` already owns the real-oracle tests.
const supportsFixturePath = (filePath: string): boolean =>
  filePath.endsWith('.ts') || filePath.endsWith('.mjs');

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
  return join(projectRoot, '.codegraph', 'config.json');
}

function writeConfig(projectRoot: string, config: Record<string, unknown>): void {
  mkdirSync(join(projectRoot, '.codegraph'), { recursive: true });
  writeFileSync(configPathOf(projectRoot), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function readConfig(projectRoot: string): Record<string, unknown> {
  return JSON.parse(readFileSync(configPathOf(projectRoot), 'utf8')) as Record<string, unknown>;
}

// The fixture the ordering claim needs: a tracked `.mjs` that `include`
// withholds, plus an `exclude` rule that blocks exactly that file. That rule
// is harmless TODAY (it blocks nothing the index would admit) and harmful the
// instant `include` is widened — which is what makes reconciling in the wrong
// order a silent no-op.
function makeOrderingFixture(): string {
  const projectRoot = makeProjectRoot('peaks-cg-repair-order-');
  git(projectRoot, ['init', '-q']);
  git(projectRoot, ['config', 'user.email', 'peaks-test@example.com']);
  git(projectRoot, ['config', 'user.name', 'peaks test']);

  mkdirSync(join(projectRoot, 'src'), { recursive: true });
  mkdirSync(join(projectRoot, 'scripts'), { recursive: true });
  writeFileSync(join(projectRoot, 'src', 'ok.ts'), 'export const ok = 1;\n', 'utf8');
  writeFileSync(join(projectRoot, 'scripts', 'tool.mjs'), 'export const tool = 1;\n', 'utf8');
  git(projectRoot, ['add', '-A']);
  git(projectRoot, ['commit', '-qm', 'fixture']);

  writeConfig(projectRoot, {
    version: 1,
    rootDir: '.',
    include: ['**/*.ts'],
    exclude: ['**/tool.mjs', '**/node_modules/**'],
    languages: ['typescript'],
    frameworks: [],
    maxFileSize: 1048576,
    extractDocstrings: true,
    trackCallSites: false
  });

  return projectRoot;
}

// The ordering fixture plus a tracked `src/Tool.MJS`: an UPPERCASE extension
// upstream's extractor supports (`detectLanguage` lowercases) that no
// case-sensitive `include` pattern admits — slice-002's declared limitation 1,
// used here as the one shape in which a coverage ratio MUST report a
// shortfall rather than "N of N".
function makeUppercaseFixture(): string {
  const projectRoot = makeOrderingFixture();
  writeFileSync(join(projectRoot, 'src', 'Tool.MJS'), 'export const tool = 1;\n', 'utf8');
  git(projectRoot, ['add', '-A']);
  git(projectRoot, ['commit', '-qm', 'uppercase fixture']);

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

// ── 1. the ordering trap, then the repair ────────────────────────────

describe('the exclude reconciliation must run AFTER include normalization', () => {
  it('the on-disk include list hides the harmful rule — the trap this ordering exists for', () => {
    const projectRoot = makeOrderingFixture();

    // Pre-normalization reconciliation, exactly as the shipped restore path
    // used to run it: the rule blocks a file the index would never admit, so
    // it blocks NOTHING and is reported clean.
    const preNormalization = reconcileCodegraphExclude({
      trackedFiles: readTrackedFiles(projectRoot),
      include: ['**/*.ts'],
      exclude: ['**/tool.mjs', '**/node_modules/**']
    });

    expect(preNormalization.rulesToRemove).toEqual([]);
    // …and the SHIPPED exclude gate agrees, in the same words it reports for a
    // healthy project. This is the non-vacuity control for the case below: if
    // the trap ever disappears, this assertion fails instead of the repair
    // silently having nothing to prove.
    expect(inspectCodegraphExcludeIntegrity(projectRoot).gap).toBe(false);
  });

  it('after normalization the same rule IS seen — in the same run that widens include', async () => {
    const projectRoot = makeOrderingFixture();

    // The index axis, before: the `.mjs` file is a supported tracked file the
    // include list does not admit. (`readIndexedPaths` is stubbed empty — this
    // fixture has no database, and the axis under test is axis ①.)
    const before = inspectCodegraphIndexIntegrity(projectRoot, {
      readIndexedPaths: () => [],
      supportsPath: supportsFixturePath
    });
    expect(before.includeGap).toEqual(['scripts/tool.mjs']);
    expect(before.gap).toBe(true);

    const { runs, runner } = makeRecordingRunner();
    const report = await repairCodegraphExcludeFromProject(projectRoot, runner);

    // BOTH axes moved in one repair.
    expect(report.applied).toBe(true);
    expect(report.includePatternsAdded).toEqual(EXPECTED_INCLUDE_ADDITIONS);
    expect(report.rulesRemoved).toEqual(['**/tool.mjs']);
    // The coverage ratio the CLI renders from these two fields, measured on
    // a fixture where the repair really did admit more than it started with.
    // `trackedSourceCount` is the DENOMINATOR (every extractor-supported
    // tracked file) and is now an independent measurement, not a copy of the
    // numerator — the two agree here because this fixture's include list ends
    // up complete. The shortfall case below is where they must differ.
    expect(report.includeAdmittedAfter).toBe(2);
    expect(report.trackedSourceCount).toBe(2);
    // The exclude axis recovers exactly one file: `scripts/tool.mjs`, the one
    // the dropped rule had been hiding from the now-widened index.
    expect(report.filesRecovered).toBe(1);
    expect(report.reindexed).toBe(true);
    expect(report.forcedRebuild).toBe(false);
    expect(report.warning).toBeNull();

    // The config on disk: include appended to (never reordered), exclude
    // reduced by exactly the rule that the widening made harmful.
    const config = readConfig(projectRoot);
    expect(config.include).toEqual(['**/*.ts', ...EXPECTED_INCLUDE_ADDITIONS]);
    expect(config.exclude).toEqual(['**/node_modules/**']);
    expect(
      readFileSync(`${configPathOf(projectRoot)}${CODEGRAPH_CONFIG_BACKUP_SUFFIX}`, 'utf8')
    ).toContain('"**/tool.mjs"');

    // The index axis, after: the gap that was reported is CLOSED, asserted by
    // re-running the inspector rather than by trusting the report.
    const after = inspectCodegraphIndexIntegrity(projectRoot, {
      readIndexedPaths: () => [],
      supportsPath: supportsFixturePath
    });
    expect(after.includeGap).toEqual([]);
    expect(after.gap).toBe(false);
    expect(inspectCodegraphExcludeIntegrity(projectRoot).gap).toBe(false);

    // …and the rebuild ran, INCREMENTALLY: the recovered files are what this
    // repair is about, and `--force` is reserved for `repair-index`.
    expect(runs).toHaveLength(1);
    expect(runs[0]?.subcommand).toBe('index');
    expect(runs[0]?.args).not.toContain('--force');
  });

  it('is idempotent — a second run writes nothing and spawns nothing', async () => {
    const projectRoot = makeOrderingFixture();
    const first = makeRecordingRunner();
    await repairCodegraphExcludeFromProject(projectRoot, first.runner);
    const configAfterFirst = readFileSync(configPathOf(projectRoot), 'utf8');

    const second = makeRecordingRunner();
    const report = await repairCodegraphExcludeFromProject(projectRoot, second.runner);

    expect(report.applied).toBe(false);
    expect(report.includePatternsAdded).toEqual([]);
    expect(report.rulesRemoved).toEqual([]);
    expect(second.runs).toHaveLength(0);
    expect(readFileSync(configPathOf(projectRoot), 'utf8')).toBe(configAfterFirst);
  });
});

// ── 2. the coverage ratio's denominator is an independent measurement ─

describe("the repair report's coverage ratio can report a SHORTFALL", () => {
  /**
   * The defect this pins (code review MEDIUM-1): the denominator the CLI
   * divides by was fed from the reconciler's ADMITTED count — the numerator's
   * own expression — so every "Include now admits N of M" printed N of N and
   * could never report the shortfall it exists to report. The denominator is
   * now `upstreamSupportsPath` over the tracked files: an extension decision,
   * not a glob match, so the two numbers can differ.
   *
   * The `.MJS` file is this slice's own DECLARED LIMITATION 1 made visible:
   * upstream's `detectLanguage` lowercases, so the file IS extractor-supported,
   * while every pattern in both templates matches case-SENSITIVELY, so no
   * repair can admit it. That is a legitimate, permanent shortfall — the exact
   * shape the message had to be able to say.
   */
  it('should count an extractor-supported file the include list cannot admit', async () => {
    const projectRoot = makeUppercaseFixture();
    const { runner } = makeRecordingRunner();
    const report = await repairCodegraphExcludeFromProject(projectRoot, runner);

    expect(report.applied).toBe(true);
    // 3 supported tracked files, 2 of them admitted by the repaired include
    // list. Before the fix both numbers were 2 and printed "2 of 2".
    expect(report.trackedSourceCount).toBe(3);
    expect(report.includeAdmittedAfter).toBe(2);
    expect(report.trackedSourceCount).toBeGreaterThan(report.includeAdmittedAfter);
  });

  it('should report a COMPLETE ratio as equal — the clean control', async () => {
    const projectRoot = makeOrderingFixture();
    const { runner } = makeRecordingRunner();
    const report = await repairCodegraphExcludeFromProject(projectRoot, runner);

    // Both tracked files are supported AND admitted, so numerator and
    // denominator agree for a real reason here. Without this control the
    // assertion above could be satisfied by a denominator that is merely
    // always larger.
    expect(report.trackedSourceCount).toBe(2);
    expect(report.includeAdmittedAfter).toBe(2);
  });
});

// ── 2b. the dead-row policy: the force flag reaches upstream ─────────

describe('reindex option — the dead-row purge path', () => {
  it('reindex:"force" should pass upstream`s own --force flag, and report the forced rebuild', async () => {
    const projectRoot = makeOrderingFixture();
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
  });

  it('reindex:false should spawn nothing at all (the preflight / autorefresh mode)', async () => {
    const projectRoot = makeOrderingFixture();
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
  });

  it('should report the TRUE forced state when a forced rebuild FAILS — upstream may have cleared already', async () => {
    const projectRoot = makeOrderingFixture();
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
  });

  it('reindex:"force" with a clean config should still rebuild, but write nothing', async () => {
    const projectRoot = makeOrderingFixture();
    const { runs, runner } = makeRecordingRunner();
    // First run repairs both axes, so the second has nothing to change.
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
    expect(existsSync(`${configPathOf(projectRoot)}${CODEGRAPH_CONFIG_BACKUP_SUFFIX}`)).toBe(true);

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
  });

  // ── `'force'` is index-only: the config repair STAYS ───────────────

  it('reindex:"force" should KEEP the repaired config while rebuilding forced', async () => {
    const projectRoot = makeOrderingFixture();
    const configPath = configPathOf(projectRoot);
    const before = readFileSync(configPath, 'utf8');
    const { runs, runner } = makeRecordingRunner();

    const report = await repairCodegraphExcludeFromProject(projectRoot, runner, {
      reindex: 'force'
    });

    // The repair really happened — both axes moved in this one run…
    expect(report.applied).toBe(true);
    expect(report.rulesRemoved).toEqual(['**/tool.mjs']);
    expect(report.includePatternsAdded).toEqual(EXPECTED_INCLUDE_ADDITIONS);

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
    expect(repaired.include).toEqual(['**/*.ts', ...EXPECTED_INCLUDE_ADDITIONS]);
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
  });

  it(
    'both repair modes should keep the repair — `force` differs only in the rebuild',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const plainRoot = makeOrderingFixture();
      const forcedRoot = makeOrderingFixture();

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
      expect(forced.includePatternsAdded).toEqual(plain.includePatternsAdded);
      expect(readFileSync(configPathOf(plainRoot), 'utf8')).not.toContain('"**/tool.mjs"');

      // …and the ONLY difference is the flag that reaches upstream.
      expect(plain.forcedRebuild).toBe(false);
      expect(forced.forcedRebuild).toBe(true);
    }
  );

  it('should write the repair to disk BEFORE the follow-up index is spawned', async () => {
    const projectRoot = makeOrderingFixture();
    const configPath = configPathOf(projectRoot);
    const before = readFileSync(configPath, 'utf8');

    // The oracle is what the CONFIG holds at the moment upstream is spawned,
    // not what the report claims afterwards. It is load-bearing: the widened
    // `include` is exactly what the rebuild exists to admit, so a spawn that
    // ran first — or a config written only after it — would rebuild against the
    // gapped config and recover nothing.
    const configAtSpawn: string[] = [];
    const runner = async (): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
      configAtSpawn.push(readFileSync(configPath, 'utf8'));
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    await repairCodegraphExcludeFromProject(projectRoot, runner, { reindex: 'force' });

    expect(configAtSpawn).toHaveLength(1);
    expect(configAtSpawn[0]).not.toBe(before);
    expect((JSON.parse(configAtSpawn[0] ?? '{}') as { include: string[] }).include).toEqual([
      '**/*.ts',
      ...EXPECTED_INCLUDE_ADDITIONS
    ]);
  });
});

// ── 3. render + a11y: the writer and its degraded paths ──────────────

describe('the writer keeps the third-party config intact', () => {
  it(
    'DECLARED LIMITATION — a config with no `include` key is not repaired at all',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const projectRoot = makeProjectRoot('peaks-cg-repair-noinclude-');
      git(projectRoot, ['init', '-q']);
      git(projectRoot, ['config', 'user.email', 'peaks-test@example.com']);
      git(projectRoot, ['config', 'user.name', 'peaks test']);
      mkdirSync(join(projectRoot, 'vendor'), { recursive: true });
      writeFileSync(join(projectRoot, 'vendor', 'lib.ts'), 'export const lib = 1;\n', 'utf8');
      git(projectRoot, ['add', '-A']);
      git(projectRoot, ['commit', '-qm', 'fixture']);
      // A hand-written minimal config with no `include` at all. Upstream's own
      // `validateConfig` rejects such a file, and the READER here is strict
      // about both keys, so the whole step degrades to its documented warning.
      //
      // This is UNCHANGED behaviour, asserted so that the widening did not
      // quietly turn it into a throw or into a half-repair: before slice-002 the
      // same strict read made the exclude axis skip this config too.
      //
      // (The WRITER is deliberately more tolerant than the reader — it repairs a
      // config that carries only `exclude` without inventing an `include` key.
      // That is what keeps `applyCodegraphConfigRepair`'s exclude-only callers
      // working; it is pinned by the "no-op the second time" case in
      // `codegraph-exclude-repair.test.ts`, which repairs such a config first.)
      writeConfig(projectRoot, { exclude: ['**/vendor/**'] });
      const before = readFileSync(configPathOf(projectRoot), 'utf8');

      const { runs, runner } = makeRecordingRunner();
      const report = await repairCodegraphExcludeFromProject(projectRoot, runner);

      expect(report.applied).toBe(false);
      expect(report.warning).toContain('reconcile skipped');
      expect(runs).toHaveLength(0);
      expect(readFileSync(configPathOf(projectRoot), 'utf8')).toBe(before);
    }
  );

  it('should report the include axis in the warning when the follow-up index fails', async () => {
    const projectRoot = makeOrderingFixture();
    const { runner } = makeRecordingRunner({ exitCode: 7 });

    const report = await repairCodegraphExcludeFromProject(projectRoot, runner);

    expect(report.applied).toBe(true);
    expect(report.reindexed).toBe(false);
    // The control for the forced case above: this run was NOT forced
    // (`reindex` defaults to `true`, i.e. an ordinary incremental index), so
    // nothing was purged and `forcedRebuild: false` is the truth here. The
    // two cases together are what makes the field a discriminator.
    expect(report.forcedRebuild).toBe(false);
    expect(report.warning).toMatch(
      /^codegraph config repaired \(1 exclude rule\(s\) removed, 5 include pattern\(s\) added\) but the follow-up index failed \(exit 7\)/
    );
    // The config repair itself is durable — it is not rolled back.
    expect(inspectCodegraphExcludeIntegrity(projectRoot).gap).toBe(false);
  });

  it('when the project is not a git work tree, should warn and leave the config alone', async () => {
    const projectRoot = makeProjectRoot('peaks-cg-repair-nogit-');
    writeConfig(projectRoot, { include: ['**/*.ts'], exclude: ['**/tool.mjs'] });
    const before = readFileSync(configPathOf(projectRoot), 'utf8');

    const { runs, runner } = makeRecordingRunner();
    const report = await repairCodegraphExcludeFromProject(projectRoot, runner);

    expect(report.applied).toBe(false);
    expect(report.warning).toContain('reconcile skipped');
    expect(runs).toHaveLength(0);
    expect(readFileSync(configPathOf(projectRoot), 'utf8')).toBe(before);
    expect(existsSync(`${configPathOf(projectRoot)}${CODEGRAPH_CONFIG_BACKUP_SUFFIX}`)).toBe(false);
  });
});

// ── 4. behavior: the pure include plan ───────────────────────────────

describe('repairCodegraphInclude (pure plan)', () => {
  it('when there is nothing to add, should report changed:false and return the same list', () => {
    const include = ['**/*.ts'];

    const plan = repairCodegraphInclude({ include, patternsToAdd: [] });

    expect(plan.changed).toBe(false);
    expect(plan.addedPatterns).toEqual([]);
    expect(plan.include).toEqual(include);
  });

  it('should append in order and keep every existing entry where it was', () => {
    const plan = repairCodegraphInclude({
      include: ['b/**', 'a/**'],
      patternsToAdd: ['c/**', 'd/**']
    });

    expect(plan.changed).toBe(true);
    expect(plan.addedPatterns).toEqual(['c/**', 'd/**']);
    expect(plan.include).toEqual(['b/**', 'a/**', 'c/**', 'd/**']);
  });

  it('should never append a pattern that is already present', () => {
    const plan = repairCodegraphInclude({
      include: ['**/*.mjs'],
      patternsToAdd: ['**/*.mjs', '**/*.mjs']
    });

    expect(plan.changed).toBe(false);
    expect(plan.addedPatterns).toEqual([]);
    expect(plan.include).toEqual(['**/*.mjs']);
  });
});
