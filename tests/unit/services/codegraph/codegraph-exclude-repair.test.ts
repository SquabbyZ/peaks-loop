// tests/unit/services/codegraph/codegraph-exclude-repair.test.ts
//
// 4-dimension unit test for `src/services/codegraph/codegraph-exclude-repair.ts`
// (slice S2 of rid-2026-09-12-codegraph-exclude-integrity).
//
// S1 proves WHICH rules are wrong; this file proves what happens when
// someone acts on that verdict. Three things must hold:
//   1. The pure plan is a subset operation — it never invents a rule,
//      and feeding the result back in changes nothing (idempotent).
//   2. The writer touches `.codegraph/config.json` ONLY when there is
//      something to remove, keeps every other key byte-identical, and
//      leaves a byte-exact `config.json.bak` behind.
//   3. The end-to-end step reproduces the real defect from the REAL
//      upstream default template (`DEFAULT_CONFIG` from the pinned
//      `@colbymchenry/codegraph`), repairs it, and converges to zero
//      violations — proven in a real temp git work tree, because
//      "tracked" is the whole safety argument.
//
// The `before` on the integration path is deliberately the upstream
// default template, NOT this workspace's `.codegraph/config.json`: that
// file has already been repaired by hand, so reconciling against it
// returns zero violations and would make the fix look unnecessary.
//
// Dimensions covered:
//   - behavior:    pure plan (subset, order, idempotence, unknown rules)
//   - integration: real temp git work tree + real DEFAULT_CONFIG
//                  template + real fs writes through the adapters
//   - render:      resulting config bytes (keys preserved, indent kept,
//                  backup byte-exact) and the returned report shape
//   - a11y:        every degraded path names what went wrong in the
//                  `warning` field instead of failing silently
//
// Run with: pnpm vitest run tests/unit/services/codegraph/codegraph-exclude-repair.test.ts

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CODEGRAPH_CONFIG_BACKUP_SUFFIX,
  applyCodegraphConfigRepair,
  repairCodegraphExclude,
  repairCodegraphExcludeFromProject
} from '../../../../src/services/codegraph/codegraph-exclude-repair.js';
import { rollbackCodegraphConfig } from '../../../../src/services/codegraph/codegraph-config-repair-writer.js';
import type { CodegraphConfigRollbackResult } from '../../../../src/services/codegraph/codegraph-config-repair-writer.js';
import { inspectCodegraphExcludeIntegrity } from '../../../../src/services/codegraph/codegraph-exclude-integrity.js';
import { declareDimensions } from '../../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../../_setup/subprocess-timeouts.js';

declareDimensions('tests/unit/services/codegraph/codegraph-exclude-repair.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

// ── the REAL upstream template (never this workspace's config) ────────

const require = createRequire(import.meta.url);
const UPSTREAM_TYPES_PATH = require.resolve('@colbymchenry/codegraph/dist/types.js');
const UPSTREAM_DEFAULT_CONFIG = (
  require(UPSTREAM_TYPES_PATH) as {
    DEFAULT_CONFIG: Record<string, unknown> & { include: string[]; exclude: string[] };
  }
).DEFAULT_CONFIG;

// The five real offender rules. They are not invented here: the test
// asserts below that the pinned upstream template really ships them.
const OFFENDER_RULES = [
  '**/vendor/**',
  '**/artifacts/**',
  '**/bin/**',
  '**/release/**',
  '**/publish/**'
] as const;

// `bin` is checked last so at least one rule is NOT first in the array;
// ordering assertions below rely on this.
const HIT_DIRS = ['vendor', 'artifacts', 'bin', 'release', 'publish'] as const;

const cleanups: string[] = [];

afterEach(() => {
  while (cleanups.length > 0) {
    const dir = cleanups.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

// ── fixtures ─────────────────────────────────────────────────────────

function makeProjectRoot(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(dir);
  return dir;
}

function git(dir: string, args: readonly string[]): void {
  execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore', windowsHide: true });
}

/**
 * A real temp git work tree with one tracked `.ts` file inside each
 * offender directory, one tracked file OUTSIDE every rule, and one
 * UNTRACKED file inside an offender directory. The untracked file is
 * the load-bearing negative case: it must never justify a removal.
 */
function makeFreshCloneFixture(): string {
  const projectRoot = makeProjectRoot('peaks-cg-s2-');
  git(projectRoot, ['init', '-q']);
  git(projectRoot, ['config', 'user.email', 'peaks-test@example.com']);
  git(projectRoot, ['config', 'user.name', 'peaks test']);

  mkdirSync(join(projectRoot, 'src'), { recursive: true });
  writeFileSync(join(projectRoot, 'src', 'ok.ts'), 'export const ok = 1;\n', 'utf8');

  for (const dir of HIT_DIRS) {
    mkdirSync(join(projectRoot, dir), { recursive: true });
    writeFileSync(join(projectRoot, dir, `${dir}.ts`), `export const ${dir} = 1;\n`, 'utf8');
  }

  // Written AFTER the commit below would be wrong — commit first, then
  // add this one, so it stays untracked.
  git(projectRoot, ['add', '-A']);
  git(projectRoot, ['commit', '-qm', 'fixture']);
  writeFileSync(join(projectRoot, 'vendor', 'untracked.ts'), 'export const ghost = 1;\n', 'utf8');

  // The fresh-clone state: upstream `init` writes its own default
  // template verbatim, which is what makes this defect reproducible.
  mkdirSync(join(projectRoot, '.codegraph'), { recursive: true });
  writeFileSync(
    join(projectRoot, '.codegraph', 'config.json'),
    `${JSON.stringify(UPSTREAM_DEFAULT_CONFIG, null, 2)}\n`,
    'utf8'
  );

  return projectRoot;
}

function configPathOf(projectRoot: string): string {
  return join(projectRoot, '.codegraph', 'config.json');
}

function readConfig(projectRoot: string): Record<string, unknown> {
  return JSON.parse(readFileSync(configPathOf(projectRoot), 'utf8')) as Record<string, unknown>;
}

const stubRunner = async () => ({ exitCode: 0, stdout: 'indexed\n', stderr: '' });

// ── behavior: the pure plan ──────────────────────────────────────────

describe('repairCodegraphExclude (pure plan)', () => {
  it('when nothing needs removing, should report changed:false and return the same list', () => {
    const exclude = ['**/node_modules/**', '**/dist/**'];

    const plan = repairCodegraphExclude({ exclude, rulesToRemove: [] });

    expect(plan.changed).toBe(false);
    expect(plan.removedRules).toEqual([]);
    expect(plan.exclude).toEqual(exclude);
  });

  it('should drop exactly the listed rules and keep the rest in config order', () => {
    const exclude = ['**/vendor/**', '**/node_modules/**', '**/artifacts/**', '**/dist/**'];

    const plan = repairCodegraphExclude({
      exclude,
      rulesToRemove: ['**/vendor/**', '**/artifacts/**']
    });

    expect(plan.changed).toBe(true);
    expect(plan.removedRules).toEqual(['**/vendor/**', '**/artifacts/**']);
    expect(plan.exclude).toEqual(['**/node_modules/**', '**/dist/**']);
  });

  it('should never invent a rule that is not already in the exclude list', () => {
    const plan = repairCodegraphExclude({
      exclude: ['**/dist/**'],
      rulesToRemove: ['**/vendor/**']
    });

    expect(plan.changed).toBe(false);
    expect(plan.exclude).toEqual(['**/dist/**']);
  });

  it('is idempotent — feeding the repaired list back in changes nothing', () => {
    const exclude = ['**/vendor/**', '**/dist/**'];
    const rulesToRemove = ['**/vendor/**'];

    const first = repairCodegraphExclude({ exclude, rulesToRemove });
    const second = repairCodegraphExclude({ exclude: first.exclude, rulesToRemove });

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.exclude).toEqual(first.exclude);
  });
});

// ── render + a11y: the writer ────────────────────────────────────────

describe('applyCodegraphConfigRepair (config writer)', () => {
  it('when rulesToRemove is empty, should not touch the file at all (bytes and mtime identical)', () => {
    const projectRoot = makeProjectRoot('peaks-cg-s2-noop-');
    mkdirSync(join(projectRoot, '.codegraph'), { recursive: true });
    writeFileSync(configPathOf(projectRoot), '{"exclude":["**/dist/**"]}\n', 'utf8');
    const before = readFileSync(configPathOf(projectRoot), 'utf8');
    const mtimeBefore = statSync(configPathOf(projectRoot)).mtimeMs;

    const outcome = applyCodegraphConfigRepair(projectRoot, {
      rulesToRemove: [],
      includePatternsToAdd: []
    });

    expect(outcome.applied).toBe(false);
    expect(readFileSync(configPathOf(projectRoot), 'utf8')).toBe(before);
    expect(statSync(configPathOf(projectRoot)).mtimeMs).toBe(mtimeBefore);
    expect(existsSync(`${configPathOf(projectRoot)}${CODEGRAPH_CONFIG_BACKUP_SUFFIX}`)).toBe(false);
  });

  it('when there is work to do, should keep every other key byte-identical and back up the original exactly', () => {
    const projectRoot = makeProjectRoot('peaks-cg-s2-write-');
    mkdirSync(join(projectRoot, '.codegraph'), { recursive: true });
    const original = `${JSON.stringify(
      {
        version: 1,
        rootDir: '.',
        include: ['**/*.ts'],
        exclude: ['**/vendor/**', '**/dist/**', '**/artifacts/**'],
        languages: ['typescript'],
        frameworks: [],
        maxFileSize: 1048576,
        extractDocstrings: true,
        trackCallSites: false
      },
      null,
      2
    )}\n`;
    writeFileSync(configPathOf(projectRoot), original, 'utf8');

    const outcome = applyCodegraphConfigRepair(projectRoot, {
      rulesToRemove: ['**/vendor/**', '**/artifacts/**'],
      includePatternsToAdd: []
    });

    expect(outcome.applied).toBe(true);

    // byte-exact rollback copy
    expect(
      readFileSync(`${configPathOf(projectRoot)}${CODEGRAPH_CONFIG_BACKUP_SUFFIX}`, 'utf8')
    ).toBe(original);

    // Only the `exclude` array moved: everything before it and
    // everything after it must be byte-identical. Sliced textually
    // (rather than via a rebuilt expectation) so this cannot pass by
    // re-running the same serializer the implementation uses.
    const after = readFileSync(configPathOf(projectRoot), 'utf8');
    const sliceAroundExclude = (text: string): { prefix: string; suffix: string } => {
      const start = text.indexOf('"exclude"');
      const end = text.indexOf(']', start);
      return { prefix: text.slice(0, start), suffix: text.slice(end + 1) };
    };
    expect(sliceAroundExclude(after).prefix).toBe(sliceAroundExclude(original).prefix);
    expect(sliceAroundExclude(after).suffix).toBe(sliceAroundExclude(original).suffix);

    // and the parsed shape agrees
    const parsed = readConfig(projectRoot);
    expect(parsed.exclude).toEqual(['**/dist/**']);
    expect(parsed.include).toEqual(['**/*.ts']);
    expect(parsed.version).toBe(1);
    expect(Object.keys(parsed)).toEqual([
      'version',
      'rootDir',
      'include',
      'exclude',
      'languages',
      'frameworks',
      'maxFileSize',
      'extractDocstrings',
      'trackCallSites'
    ]);
  });

  it('should be a no-op the second time — the backup is not rewritten', () => {
    const projectRoot = makeProjectRoot('peaks-cg-s2-twice-');
    mkdirSync(join(projectRoot, '.codegraph'), { recursive: true });
    writeFileSync(configPathOf(projectRoot), '{"exclude":["**/vendor/**","**/dist/**"]}\n', 'utf8');

    expect(
      applyCodegraphConfigRepair(projectRoot, {
        rulesToRemove: ['**/vendor/**'],
        includePatternsToAdd: []
      }).applied
    ).toBe(true);
    const afterFirst = readFileSync(configPathOf(projectRoot), 'utf8');
    const backupAfterFirst = readFileSync(
      `${configPathOf(projectRoot)}${CODEGRAPH_CONFIG_BACKUP_SUFFIX}`,
      'utf8'
    );

    const second = applyCodegraphConfigRepair(projectRoot, {
      rulesToRemove: ['**/vendor/**'],
      includePatternsToAdd: []
    });

    expect(second.applied).toBe(false);
    expect(readFileSync(configPathOf(projectRoot), 'utf8')).toBe(afterFirst);
    expect(
      readFileSync(`${configPathOf(projectRoot)}${CODEGRAPH_CONFIG_BACKUP_SUFFIX}`, 'utf8')
    ).toBe(backupAfterFirst);
  });
});

// ── integration: the real defect, on the real template ───────────────

describe('repairCodegraphExcludeFromProject (fresh clone self-heal)', () => {
  it('the pinned upstream template really ships the five offender rules', () => {
    for (const rule of OFFENDER_RULES) {
      expect(UPSTREAM_DEFAULT_CONFIG.exclude).toContain(rule);
    }
  });

  it(
    'reproduces the defect from the upstream template, then converges to zero violations',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const projectRoot = makeFreshCloneFixture();

      // before — upstream default template, untouched
      const before = inspectCodegraphExcludeIntegrity(projectRoot);
      expect(before.gap).toBe(true);
      expect(before.excludedTrackedCount).toBe(HIT_DIRS.length);
      expect([...before.rulesToRemove].sort()).toEqual([...OFFENDER_RULES].sort());

      const report = await repairCodegraphExcludeFromProject(projectRoot, stubRunner);

      expect(report.applied).toBe(true);
      expect(report.filesRecovered).toBe(HIT_DIRS.length);
      expect(report.reindexed).toBe(true);
      expect(report.warning).toBeNull();
      expect([...report.rulesRemoved].sort()).toEqual([...OFFENDER_RULES].sort());

      // after — idempotent and converged
      const after = inspectCodegraphExcludeIntegrity(projectRoot);
      expect(after.gap).toBe(false);
      expect(after.rulesToRemove).toEqual([]);
      expect(after.excludedTrackedCount).toBe(0);

      // the harmless default rules survived
      const excludeAfter = readConfig(projectRoot).exclude as string[];
      expect(excludeAfter).toContain('**/node_modules/**');
      expect(excludeAfter).toContain('**/target/release/**');
      expect(excludeAfter.length).toBe(
        UPSTREAM_DEFAULT_CONFIG.exclude.length - OFFENDER_RULES.length
      );

      // second run has nothing left to do and writes nothing
      const second = await repairCodegraphExcludeFromProject(projectRoot, stubRunner);
      expect(second.applied).toBe(false);
      expect(second.warning).toBeNull();
    }
  );

  it('never counts — and never removes a rule for — an untracked file', () => {
    const projectRoot = makeFreshCloneFixture();

    // `vendor/untracked.ts` exists on disk but git does not track it, so
    // removing `**/vendor/**` must be justified by `vendor/vendor.ts` alone.
    const impact = inspectCodegraphExcludeIntegrity(projectRoot).ruleImpacts.find(
      (entry) => entry.rule === '**/vendor/**'
    );
    expect(impact?.blockedCount).toBe(1);

    expect(
      inspectCodegraphExcludeIntegrity(projectRoot).violations.map((v) => v.path)
    ).not.toContain('vendor/untracked.ts');
  });

  it('when the follow-up index fails, should still report the repair and carry a warning', async () => {
    const projectRoot = makeFreshCloneFixture();
    const failing = async () => ({ exitCode: 3, stdout: '', stderr: 'index blew up\n' });

    const report = await repairCodegraphExcludeFromProject(projectRoot, failing);

    expect(report.applied).toBe(true);
    expect(report.reindexed).toBe(false);
    expect(report.warning).toContain('follow-up index failed');
    // The config repair itself is durable — it is not rolled back.
    expect(inspectCodegraphExcludeIntegrity(projectRoot).gap).toBe(false);
  });

  it('when the project is not a git work tree, should return a warning instead of throwing', async () => {
    const projectRoot = makeProjectRoot('peaks-cg-s2-nogit-');
    mkdirSync(join(projectRoot, '.codegraph'), { recursive: true });
    writeFileSync(
      configPathOf(projectRoot),
      '{"include":["**/*.ts"],"exclude":["**/vendor/**"]}\n',
      'utf8'
    );

    const report = await repairCodegraphExcludeFromProject(projectRoot, stubRunner);

    expect(report.applied).toBe(false);
    expect(report.warning).toContain('reconcile skipped');
    // the config was NOT touched
    expect(readConfig(projectRoot).exclude).toEqual(['**/vendor/**']);
  });

  it('when the config is missing, should warn and leave the tree alone', async () => {
    const projectRoot = makeProjectRoot('peaks-cg-s2-noconfig-');
    git(projectRoot, ['init', '-q']);

    const report = await repairCodegraphExcludeFromProject(projectRoot, stubRunner);

    expect(report.applied).toBe(false);
    expect(report.warning).toContain('reconcile skipped');
  });

  it(
    'with reindex:false, should repair the config but leave the index rebuild to the caller',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      // The pre-dispatch preflight and the post-slice autorefresh both run
      // `index` immediately after this step, so asking for a second rebuild
      // here would index the same tree twice (5-30 s each).
      const projectRoot = makeFreshCloneFixture();
      let runnerCalls = 0;
      const countingRunner = async () => {
        runnerCalls += 1;
        return { exitCode: 0, stdout: '', stderr: '' };
      };

      const report = await repairCodegraphExcludeFromProject(projectRoot, countingRunner, {
        reindex: false
      });

      expect(report.applied).toBe(true);
      expect(runnerCalls).toBe(0);
      expect(report.reindexed).toBe(false);
      // Not a degradation: nothing went wrong, so there is nothing to warn about.
      expect(report.warning).toBeNull();
      // The config repair itself still landed.
      expect(inspectCodegraphExcludeIntegrity(projectRoot).gap).toBe(false);
    }
  );
});

// ── A1 + A4 (`2026-09-17-codegraph-msg-and-refresh`) ──────────────────

/**
 * The fixture behind A1: the two axes are SEPARATED so each report field can
 * be read on its own.
 *
 *   - include axis has work — the on-disk `include` list admits TypeScript
 *     files only, so upstream's five extractor-supported extensions its own
 *     template omits (`.mjs`, `.cjs`, `.pyw`, `.hxx`, `.rake`) get appended,
 *     and two TRACKED files (one `.mjs`, one `.cjs`) are newly admitted.
 *   - exclude axis is clean — the one rule it carries (a node_modules glob,
 *     spelled out in the fixture body below) blocks no tracked file, so zero
 *     rules are removed.
 *
 * That is the exact shape of the measured run behind the defect: 5 include
 * patterns added, 0 exclude rules removed, and a message that reported
 * "recovering 0 tracked source file(s)" while the include axis moved files.
 *
 * NOTE: glob literals would close this comment — the same hazard the file
 * header names — so the fixture body holds them and this comment does not.
 */
function makeIncludeAxisFixture(): string {
  const projectRoot = makeProjectRoot('peaks-cg-a1-');
  git(projectRoot, ['init', '-q']);
  git(projectRoot, ['config', 'user.email', 'peaks-test@example.com']);
  git(projectRoot, ['config', 'user.name', 'peaks test']);

  mkdirSync(join(projectRoot, 'src'), { recursive: true });
  writeFileSync(join(projectRoot, 'src', 'ok.ts'), 'export const ok = 1;\n', 'utf8');
  writeFileSync(join(projectRoot, 'app.mjs'), 'export const a = 1;\n', 'utf8');
  writeFileSync(join(projectRoot, 'tool.cjs'), 'module.exports = 1;\n', 'utf8');
  git(projectRoot, ['add', '-A']);
  git(projectRoot, ['commit', '-qm', 'fixture']);

  mkdirSync(join(projectRoot, '.codegraph'), { recursive: true });
  writeFileSync(
    join(projectRoot, '.codegraph', 'config.json'),
    `${JSON.stringify({ version: 1, include: ['**/*.ts'], exclude: ['**/node_modules/**'] }, null, 2)}\n`,
    'utf8'
  );

  return projectRoot;
}

describe('A1 — the report counts each axis on its own', () => {
  it('when only the include axis moved, should report the include delta and NOT the exclude counter', async () => {
    // given: a project where 5 include patterns admit 2 tracked files and no
    //        exclude rule blocks anything
    const projectRoot = makeIncludeAxisFixture();

    // when: the shared two-axis repair runs
    const report = await repairCodegraphExcludeFromProject(projectRoot, stubRunner, {
      reindex: false
    });

    // then: the exclude axis' counter is honestly zero …
    expect(report.applied).toBe(true);
    expect(report.filesRecovered).toBe(0);
    // … the include axis' own delta is the number the reader needs …
    expect(report.includePatternsAdded).toHaveLength(5);
    expect(report.includeFilesRecovered).toBe(2);
    // … and it is a DELTA, not the absolute admission count re-reported. If
    //     the two were equal this assertion would pass on a tautology, so the
    //     values are pinned apart on purpose (3 admitted, 2 of them new).
    expect(report.includeAdmittedAfter).toBe(3);
    expect(report.includeFilesRecovered).not.toBe(report.includeAdmittedAfter);
  });

  it('when the include axis is already complete, should report zero rather than re-count admitted files', async () => {
    // given: a project the repair has already widened once
    const projectRoot = makeIncludeAxisFixture();
    await repairCodegraphExcludeFromProject(projectRoot, stubRunner, { reindex: false });

    // when: the repair runs a second time
    const report = await repairCodegraphExcludeFromProject(projectRoot, stubRunner, {
      reindex: false
    });

    // then: nothing moved, and the tracked `.mjs`/`.cjs` files it already
    //       admitted are NOT reported as recovered a second time
    expect(report.applied).toBe(false);
    expect(report.includePatternsAdded).toHaveLength(0);
    expect(report.includeFilesRecovered).toBe(0);
    // The gate on the extra admission pass is provably equivalent, not an
    // approximation: with nothing appended the normalized list IS the on-disk
    // list, so the ungated delta is zero too. No test can tell them apart —
    // which is the point of choosing that gate.
  });
});

describe('A4 — the rollback copy carries the original config mode', () => {
  it('should publish the backup at the config mode instead of the process umask', async () => {
    // given: a config with a mode the process umask would not produce
    const projectRoot = makeIncludeAxisFixture();
    const configPath = configPathOf(projectRoot);
    chmodSync(configPath, 0o640);
    const modeBefore = statSync(configPath).mode & 0o777;

    // when: the config is repaired
    const report = await repairCodegraphExcludeFromProject(projectRoot, stubRunner, {
      reindex: false
    });

    // then: the rollback copy restores the permission the project granted,
    //       not the one this process happens to run under
    expect(report.applied).toBe(true);
    const backupPath = `${configPath}${CODEGRAPH_CONFIG_BACKUP_SUFFIX}`;
    expect(statSync(backupPath).mode & 0o777).toBe(modeBefore);
  });

  it('should replace a read-only previous backup rather than failing on it', async () => {
    // Regression on the mechanism the case above relies on: with the mode
    // preserved, a read-only config makes the backup read-only too — and
    // Windows cannot REPLACE a read-only destination (`renameSync` throws
    // EPERM, measured), so the SECOND repair would fail on its own artifact.
    // given: a read-only `.bak` left by an earlier repair
    const projectRoot = makeIncludeAxisFixture();
    const configPath = configPathOf(projectRoot);
    const backupPath = `${configPath}${CODEGRAPH_CONFIG_BACKUP_SUFFIX}`;
    writeFileSync(backupPath, '{"stale":true}\n', 'utf8');
    chmodSync(backupPath, 0o444);
    const modeBefore = statSync(configPath).mode & 0o777;

    // when: the repair runs over it
    const report = await repairCodegraphExcludeFromProject(projectRoot, stubRunner, {
      reindex: false
    });

    // then: it replaced the previous backup in one go, with no warning …
    expect(report.applied).toBe(true);
    expect(report.warning).toBeNull();
    expect(readFileSync(backupPath, 'utf8')).not.toContain('stale');
    // … and the replacement carries the config's mode, not the 0o444 it had
    expect(statSync(backupPath).mode & 0o777).toBe(modeBefore);

    // cleanup: leave the fixture removable on Windows
    chmodSync(backupPath, 0o666);
  });
});

// ── the read side of the `.bak` (slice A1) ───────────────────────────

/**
 * `applyCodegraphConfigRepair` has always promised a byte-exact
 * `config.json.bak`, but until `rollbackCodegraphConfig` nothing in the
 * repository ever READ that copy back — "rollback" named a file nobody
 * restored. These cases pin the read side: byte-exact, mode-restoring, and
 * making the SAME refusal at the backup path that the write side makes.
 *
 * The refusal is the case that matters. `config.json.bak` is a FIXED, guessable
 * and committable path, so a repository can ship it as a link; a rollback that
 * read through that link would publish a file the operator never reviewed into
 * `.codegraph/config.json`. The predicate has one branch per link shape, so
 * each shape gets its own case — and the hard-link and directory branches are
 * the ones this platform can always build (a real file symlink needs Windows
 * Developer Mode; the junction fallback below reports `isSymbolicLink()`).
 */
describe('rollbackCodegraphConfig — the read side of the backup', () => {
  /**
   * The refusal arm's reason, with the refusal itself as the assertion: this
   * THROWS when the rollback went ahead, so a case written for a refusal cannot
   * pass by reading an `error` that isn't there. It also narrows the result
   * union, which is why the read is not a bare `result.error`.
   */
  function refusalReason(result: CodegraphConfigRollbackResult): string {
    if (result.rolledBack) {
      throw new Error('expected the rollback to be REFUSED, but it restored the config');
    }
    return result.error;
  }

  function makeRepairedFixture(): {
    projectRoot: string;
    configPath: string;
    backupPath: string;
    original: string;
    repaired: string;
  } {
    const projectRoot = makeProjectRoot('peaks-cg-rollback-');
    mkdirSync(join(projectRoot, '.codegraph'), { recursive: true });
    const original = `${JSON.stringify(
      { version: 1, include: ['**/*.ts'], exclude: ['**/vendor/**', '**/dist/**'] },
      null,
      2
    )}\n`;
    writeFileSync(configPathOf(projectRoot), original, 'utf8');

    // The real writer, so the `.bak` under test is the one production makes.
    const outcome = applyCodegraphConfigRepair(projectRoot, {
      rulesToRemove: ['**/vendor/**'],
      includePatternsToAdd: []
    });
    expect(outcome.applied).toBe(true);

    return {
      projectRoot,
      configPath: configPathOf(projectRoot),
      backupPath: `${configPathOf(projectRoot)}${CODEGRAPH_CONFIG_BACKUP_SUFFIX}`,
      original,
      repaired: readFileSync(configPathOf(projectRoot), 'utf8')
    };
  }

  it('should restore the config byte-for-byte, and the mode it was saved with', async () => {
    const { configPath, backupPath, original, repaired } = makeRepairedFixture();
    // READ-ONLY is the mode this case uses, and it is chosen rather than
    // arbitrary: `chmod` on Windows only toggles the read-only bit (measured:
    // 0o640 and 0o600 both read back as 0o666, 0o444 reads back as 0o444), so
    // a 0o640 assertion would pass on this platform whatever the rollback did.
    // 0o444 is discriminating on both platforms, and it is the mode whose loss
    // a rollback would be least likely to notice.
    chmodSync(backupPath, 0o444);
    const restoredMode = statSync(backupPath).mode & 0o777;
    // Non-vacuity control: the mode the `.bak` carries really is NOT the mode a
    // freshly written file gets from this process's umask, which is what a
    // rollback that dropped the mode argument would publish instead.
    const probePath = join(configPath, '..', 'probe.json');
    writeFileSync(probePath, '{}\n', 'utf8');
    const umaskMode = statSync(probePath).mode & 0o777;
    rmSync(probePath, { force: true });
    expect(restoredMode).not.toBe(umaskMode);

    const result = await rollbackCodegraphConfig(configPath);

    expect(result.rolledBack).toBe(true);
    expect(readFileSync(configPath, 'utf8')).toBe(original);
    expect(statSync(configPath).mode & 0o777).toBe(restoredMode);
    // The point of the case: the bytes are the ORIGINAL ones, not the repaired
    // ones the writer had just published.
    expect(readFileSync(configPath, 'utf8')).not.toBe(repaired);

    // cleanup: leave the fixture removable on Windows
    chmodSync(configPath, 0o666);
  });

  it('should round-trip the writer exactly — write, then roll back, and be back where it started', async () => {
    const { configPath, original } = makeRepairedFixture();

    const result = await rollbackCodegraphConfig(configPath);

    expect(result.rolledBack).toBe(true);
    // `original` is the literal text the fixture wrote, so this is the
    // round-trip claim and not a re-serialization: any re-formatting, any
    // re-ordering of keys, any lost trailing newline fails here.
    expect(readFileSync(configPath, 'utf8')).toBe(original);
  });

  it('should refuse a hard link at the backup path, leaving both files alone', async () => {
    const { configPath, backupPath } = makeRepairedFixture();
    // The attack, in the shape this platform always allows: `.bak` is a second
    // name for a file the operator never reviewed. Reading through it would
    // publish that file's bytes into the config.
    rmSync(backupPath, { force: true });
    const victimPath = join(configPath, '..', 'victim.json');
    writeFileSync(victimPath, '{"INJECTED":true}\n', 'utf8');
    linkSync(victimPath, backupPath);
    const configBefore = readFileSync(configPath, 'utf8');

    const result = await rollbackCodegraphConfig(configPath);

    expect(result.rolledBack).toBe(false);
    expect(refusalReason(result)).toContain('refusing to restore through a hard link');
    // Nothing was read through the link and nothing was written: the config
    // still holds the repaired bytes, and the victim is untouched.
    expect(readFileSync(configPath, 'utf8')).toBe(configBefore);
    expect(readFileSync(victimPath, 'utf8')).toBe('{"INJECTED":true}\n');
  });

  it('should refuse a symbolic link at the backup path', async () => {
    const { configPath, backupPath } = makeRepairedFixture();
    rmSync(backupPath, { force: true });
    const victimPath = join(configPath, '..', 'victim.json');
    writeFileSync(victimPath, '{"INJECTED":true}\n', 'utf8');

    try {
      // The real shape on POSIX and on Windows with Developer Mode.
      symlinkSync(victimPath, backupPath, 'file');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'EACCES' && code !== 'UNKNOWN') {
        throw error;
      }
      // Windows without the privilege: a junction is the symlink this platform
      // can always build, and Node reports `isSymbolicLink()` for it — the same
      // predicate branch, so the case still exercises the branch it names.
      symlinkSync(join(configPath, '..'), backupPath, 'junction');
    }

    const result = await rollbackCodegraphConfig(configPath);

    expect(result.rolledBack).toBe(false);
    expect(refusalReason(result)).toContain('refusing to restore through a symbolic link');
    expect(readFileSync(configPath, 'utf8')).not.toContain('INJECTED');
  });

  it('should refuse a directory at the backup path', async () => {
    const { configPath, backupPath } = makeRepairedFixture();
    rmSync(backupPath, { force: true });
    mkdirSync(backupPath);

    const result = await rollbackCodegraphConfig(configPath);

    expect(result.rolledBack).toBe(false);
    // "at", not "through": there is nowhere for the bytes to land.
    expect(refusalReason(result)).toContain('refusing to restore at a directory');
  });

  it('should report a missing backup instead of inventing a rollback point', async () => {
    const { configPath, backupPath, repaired } = makeRepairedFixture();
    rmSync(backupPath, { force: true });

    const result = await rollbackCodegraphConfig(configPath);

    expect(result.rolledBack).toBe(false);
    expect(refusalReason(result)).toContain(`cannot read ${backupPath}`);
    // Fails closed: with nothing to restore, the config keeps the bytes the
    // repair published rather than being truncated or left half-written.
    expect(readFileSync(configPath, 'utf8')).toBe(repaired);
  });
});
