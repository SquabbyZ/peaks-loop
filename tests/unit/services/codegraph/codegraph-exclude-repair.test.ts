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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CODEGRAPH_CONFIG_BACKUP_SUFFIX,
  applyCodegraphExcludeRepair,
  repairCodegraphExclude,
  repairCodegraphExcludeFromProject,
} from '../../../../src/services/codegraph/codegraph-exclude-repair.js';
import { inspectCodegraphExcludeIntegrity } from '../../../../src/services/codegraph/codegraph-exclude-integrity.js';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions('tests/unit/services/codegraph/codegraph-exclude-repair.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y',
]);

// ── the REAL upstream template (never this workspace's config) ────────

const require = createRequire(import.meta.url);
const UPSTREAM_TYPES_PATH = require.resolve('@colbymchenry/codegraph/dist/types.js');
const UPSTREAM_DEFAULT_CONFIG = (require(UPSTREAM_TYPES_PATH) as {
  DEFAULT_CONFIG: Record<string, unknown> & { include: string[]; exclude: string[] };
}).DEFAULT_CONFIG;

// The five real offender rules. They are not invented here: the test
// asserts below that the pinned upstream template really ships them.
const OFFENDER_RULES = [
  '**/vendor/**',
  '**/artifacts/**',
  '**/bin/**',
  '**/release/**',
  '**/publish/**',
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
  execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
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
      rulesToRemove: ['**/vendor/**', '**/artifacts/**'],
    });

    expect(plan.changed).toBe(true);
    expect(plan.removedRules).toEqual(['**/vendor/**', '**/artifacts/**']);
    expect(plan.exclude).toEqual(['**/node_modules/**', '**/dist/**']);
  });

  it('should never invent a rule that is not already in the exclude list', () => {
    const plan = repairCodegraphExclude({
      exclude: ['**/dist/**'],
      rulesToRemove: ['**/vendor/**'],
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

describe('applyCodegraphExcludeRepair (config writer)', () => {
  it('when rulesToRemove is empty, should not touch the file at all (bytes and mtime identical)', () => {
    const projectRoot = makeProjectRoot('peaks-cg-s2-noop-');
    mkdirSync(join(projectRoot, '.codegraph'), { recursive: true });
    writeFileSync(configPathOf(projectRoot), '{"exclude":["**/dist/**"]}\n', 'utf8');
    const before = readFileSync(configPathOf(projectRoot), 'utf8');
    const mtimeBefore = statSync(configPathOf(projectRoot)).mtimeMs;

    const outcome = applyCodegraphExcludeRepair(projectRoot, []);

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
        trackCallSites: false,
      },
      null,
      2
    )}\n`;
    writeFileSync(configPathOf(projectRoot), original, 'utf8');

    const outcome = applyCodegraphExcludeRepair(projectRoot, ['**/vendor/**', '**/artifacts/**']);

    expect(outcome.applied).toBe(true);

    // byte-exact rollback copy
    expect(readFileSync(`${configPathOf(projectRoot)}${CODEGRAPH_CONFIG_BACKUP_SUFFIX}`, 'utf8')).toBe(original);

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
      'trackCallSites',
    ]);
  });

  it('should be a no-op the second time — the backup is not rewritten', () => {
    const projectRoot = makeProjectRoot('peaks-cg-s2-twice-');
    mkdirSync(join(projectRoot, '.codegraph'), { recursive: true });
    writeFileSync(configPathOf(projectRoot), '{"exclude":["**/vendor/**","**/dist/**"]}\n', 'utf8');

    expect(applyCodegraphExcludeRepair(projectRoot, ['**/vendor/**']).applied).toBe(true);
    const afterFirst = readFileSync(configPathOf(projectRoot), 'utf8');
    const backupAfterFirst = readFileSync(`${configPathOf(projectRoot)}${CODEGRAPH_CONFIG_BACKUP_SUFFIX}`, 'utf8');

    const second = applyCodegraphExcludeRepair(projectRoot, ['**/vendor/**']);

    expect(second.applied).toBe(false);
    expect(readFileSync(configPathOf(projectRoot), 'utf8')).toBe(afterFirst);
    expect(readFileSync(`${configPathOf(projectRoot)}${CODEGRAPH_CONFIG_BACKUP_SUFFIX}`, 'utf8')).toBe(backupAfterFirst);
  });
});

// ── integration: the real defect, on the real template ───────────────

describe('repairCodegraphExcludeFromProject (fresh clone self-heal)', () => {
  it('the pinned upstream template really ships the five offender rules', () => {
    for (const rule of OFFENDER_RULES) {
      expect(UPSTREAM_DEFAULT_CONFIG.exclude).toContain(rule);
    }
  });

  it('reproduces the defect from the upstream template, then converges to zero violations', async () => {
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
    expect(excludeAfter.length).toBe(UPSTREAM_DEFAULT_CONFIG.exclude.length - OFFENDER_RULES.length);

    // second run has nothing left to do and writes nothing
    const second = await repairCodegraphExcludeFromProject(projectRoot, stubRunner);
    expect(second.applied).toBe(false);
    expect(second.warning).toBeNull();
  });

  it('never counts — and never removes a rule for — an untracked file', () => {
    const projectRoot = makeFreshCloneFixture();

    // `vendor/untracked.ts` exists on disk but git does not track it, so
    // removing `**/vendor/**` must be justified by `vendor/vendor.ts` alone.
    const impact = inspectCodegraphExcludeIntegrity(projectRoot).ruleImpacts.find(
      (entry) => entry.rule === '**/vendor/**'
    );
    expect(impact?.blockedCount).toBe(1);

    expect(inspectCodegraphExcludeIntegrity(projectRoot).violations.map((v) => v.path)).not.toContain(
      'vendor/untracked.ts'
    );
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
    writeFileSync(configPathOf(projectRoot), '{"include":["**/*.ts"],"exclude":["**/vendor/**"]}\n', 'utf8');

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

  it('with reindex:false, should repair the config but leave the index rebuild to the caller', async () => {
    // The pre-dispatch preflight and the post-slice autorefresh both run
    // `index` immediately after this step, so asking for a second rebuild
    // here would index the same tree twice (5-30 s each).
    const projectRoot = makeFreshCloneFixture();
    let runnerCalls = 0;
    const countingRunner = async () => {
      runnerCalls += 1;
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    const report = await repairCodegraphExcludeFromProject(projectRoot, countingRunner, { reindex: false });

    expect(report.applied).toBe(true);
    expect(runnerCalls).toBe(0);
    expect(report.reindexed).toBe(false);
    // Not a degradation: nothing went wrong, so there is nothing to warn about.
    expect(report.warning).toBeNull();
    // The config repair itself still landed.
    expect(inspectCodegraphExcludeIntegrity(projectRoot).gap).toBe(false);
  });
});
