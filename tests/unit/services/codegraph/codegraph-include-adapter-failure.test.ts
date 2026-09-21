// tests/unit/services/codegraph/codegraph-include-adapter-failure.test.ts
//
// The "never throws" contract of `repairCodegraphExcludeFromProject`
// (slice-002 repair round, code review LOW-1 / brief S4).
//
// `upstreamUnnamedIncludeExtensions()` reaches into the INSTALLED
// `@colbymchenry/codegraph` package (`package.json`, then `dist/types.js` and
// `dist/extraction/grammars.js`) and throws when the pinned install is damaged
// or its `dist/` layout moves. It used to be called OUTSIDE the `try` that
// guards the reads, in a function documented "Never throws. Every failure
// becomes a populated `warning` field" — so the two contradicted each other,
// and the throw escaped to the CLI's generic `UNHANDLED_ERROR` envelope:
// `repair-exclude` / `repair-index` failed with a stack-shaped error, and
// `peaks codegraph init` printed a FAILURE envelope for an init that had
// already succeeded.
//
// Whole-fixture injection, not a mocked `node:fs`: the adapter module is
// replaced by the REAL module with one export wrapped by a flag, so the read,
// the reconciliation, the rewrite and the report are all the shipped code.
// The control case flips the SAME flag back off against the SAME fixture,
// which is what makes the warning attributable to the injected throw rather
// than to a fixture that could not repair anyway.
//
// Dimensions covered:
//   - behavior:    never throws; a failure becomes a populated `warning`
//   - integration: real git work tree, real config read
//   - a11y:        the warning NAMES the upstream cause for the operator
//   - render:      omitted — this module prints nothing; it returns a report

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/codegraph/codegraph-include-adapter-failure.test.ts',
  ['behavior', 'integration', 'a11y'],
  [{ dim: 'render', reason: 'the module writes a config but prints nothing; it returns a report' }]
);

const adapter = vi.hoisted(() => ({ fail: false }));

vi.mock(
  '../../../../src/services/codegraph/codegraph-include-reconciler.js',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('../../../../src/services/codegraph/codegraph-include-reconciler.js')
      >();

    return {
      ...actual,
      upstreamUnnamedIncludeExtensions: (): readonly string[] => {
        if (adapter.fail) {
          // What an upstream `dist/` layout change or a broken install produces:
          // `require` of a path inside the package that no longer exists.
          throw new Error('injected upstream dist-layout failure');
        }

        return actual.upstreamUnnamedIncludeExtensions();
      }
    };
  }
);

import { repairCodegraphExcludeFromProject } from '../../../../src/services/codegraph/codegraph-exclude-repair.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../../_setup/subprocess-timeouts.js';

const cleanups: string[] = [];

afterEach(() => {
  adapter.fail = false;
  while (cleanups.length > 0) {
    const dir = cleanups.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function makeFixture(): string {
  const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-cg-adapter-fail-'));
  cleanups.push(projectRoot);
  const git = (args: readonly string[]): void => {
    execFileSync('git', ['-C', projectRoot, ...args], { stdio: 'ignore', windowsHide: true });
  };
  git(['init', '-q']);
  git(['config', 'user.email', 'peaks-test@example.com']);
  git(['config', 'user.name', 'peaks test']);

  mkdirSync(join(projectRoot, 'src'), { recursive: true });
  writeFileSync(join(projectRoot, 'src', 'ok.ts'), 'export const ok = 1;\n', 'utf8');
  git(['add', '-A']);
  git(['commit', '-qm', 'fixture']);

  mkdirSync(join(projectRoot, '.codegraph'), { recursive: true });
  writeFileSync(
    join(projectRoot, '.codegraph', 'config.json'),
    `${JSON.stringify({ include: ['**/*.ts'], exclude: ['**/node_modules/**'] }, null, 2)}\n`,
    'utf8'
  );

  return projectRoot;
}

const runner = async (): Promise<{ exitCode: number; stdout: string; stderr: string }> => ({
  exitCode: 0,
  stdout: '',
  stderr: ''
});

describe('repairCodegraphExcludeFromProject — an upstream adapter failure is a warning, not a throw', () => {
  it(
    'should resolve with a warning naming the upstream cause instead of throwing',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const projectRoot = makeFixture();
      const before = readFileSync(join(projectRoot, '.codegraph', 'config.json'), 'utf8');
      adapter.fail = true;

      // The load-bearing assertion: before the fix this REJECTED, and the
      // rejection escaped past every caller (the repair verbs have no
      // surrounding try, and init's caller is inside its own catch).
      const report = await repairCodegraphExcludeFromProject(projectRoot, runner);

      expect(report.applied).toBe(false);
      expect(report.warning).toContain('reconcile skipped');
      expect(report.warning).toContain('injected upstream dist-layout failure');
      // Nothing was written and no upstream process ran: an unreadable oracle
      // must not silently produce a "clean" repair either.
      expect(report.includePatternsAdded).toEqual([]);
      expect(report.reindexed).toBe(false);
      expect(readFileSync(join(projectRoot, '.codegraph', 'config.json'), 'utf8')).toBe(before);
    }
  );

  it(
    'should repair the SAME fixture when the adapter does not fail — the clean control',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const projectRoot = makeFixture();

      const report = await repairCodegraphExcludeFromProject(projectRoot, runner);

      // Without this control the warning above would be consistent with a
      // fixture that could never be repaired for some other reason.
      expect(report.applied).toBe(true);
      expect(report.warning).toBeNull();
      expect(report.includePatternsAdded.length).toBeGreaterThan(0);
    }
  );
});
