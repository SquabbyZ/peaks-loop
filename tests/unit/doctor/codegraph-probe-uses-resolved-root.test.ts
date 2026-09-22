// tests/unit/doctor/codegraph-probe-uses-resolved-root.test.ts
//
// The codegraph doctor probes must inspect the doctor's RESOLVED project root,
// never `process.cwd()`.
//
// THE DEFECT
//
// `codegraph-index-integrity.ts` and `codegraph-exclude-integrity.ts` both
// resolved their own root with `const projectRoot = process.cwd()` inside the
// default probe. A caller that injects `projectRootResolver` — which is how
// every test aims the doctor at a throwaway tree — therefore got every OTHER
// check pointed at the temp root while these two opened the OPERATOR'S
// `.codegraph/`. The index probe opens the sqlite database, which materialises
// `codegraph.db-shm` / `codegraph.db-wal` sidecars, so a unit run mutated the
// operator's checkout and the verdict depended on which repository you happened
// to run it in.
//
// WHY THIS TEST MOCKS INSTEAD OF USING A REAL TREE
//
// Measured against a real fixture, this would be un-detectable in CI: a
// regression back to `process.cwd()` is only observable if `cwd` HAS a
// `.codegraph/` index, and `.codegraph/` is gitignored — so on a clean CI
// checkout the regressed probe and the fixed probe both report "not
// initialized" and the test would pass while proving nothing. Asserting the
// CALL ARGUMENT is the only form that fails on the mutation everywhere.
//
// Run with:
//   pnpm vitest run tests/unit/doctor/codegraph-probe-uses-resolved-root.test.ts

import { describe, expect, it, vi } from 'vitest';

// `vi.mock` is hoisted above the imports, so the spies must be created inside
// `vi.hoisted` — a plain top-level `const` is still in its temporal dead zone
// when the factory runs.
const mocks = vi.hoisted(() => ({
  isCodegraphInitialized: vi.fn((_root: string) => false),
  inspectCodegraphIndexIntegrity: vi.fn((_root: string) => ({
    gap: false,
    trackedSourceCount: 0,
    admittedTrackedCount: 0,
    includeGap: [] as string[],
    indexedFileCount: 0,
    deadRows: [] as string[]
  })),
  isCodegraphExcludeConfigPresent: vi.fn((_root: string) => false),
  inspectCodegraphExcludeIntegrity: vi.fn((_root: string) => ({
    configPath: '',
    gap: false,
    trackedSourceCount: 0,
    excludedTrackedCount: 0,
    rulesToRemove: [] as string[],
    violations: [] as { path: string; matchedRule: string }[]
  }))
}));

const { isCodegraphInitialized, isCodegraphExcludeConfigPresent } = mocks;

vi.mock('~/src/services/codegraph/codegraph-service.js', () => ({
  isCodegraphInitialized: mocks.isCodegraphInitialized
}));
vi.mock('~/src/services/codegraph/codegraph-index-integrity.js', () => ({
  CODEGRAPH_INDEX_STRICT_ENV_VAR: 'PEAKS_CODEGRAPH_INDEX_STRICT',
  CODEGRAPH_REPAIR_INDEX_COMMAND: 'peaks codegraph repair-index',
  inspectCodegraphIndexIntegrity: mocks.inspectCodegraphIndexIntegrity,
  isCodegraphIndexStrictMode: () => false
}));
vi.mock('~/src/services/codegraph/codegraph-exclude-integrity.js', () => ({
  inspectCodegraphExcludeIntegrity: mocks.inspectCodegraphExcludeIntegrity,
  isCodegraphExcludeConfigPresent: mocks.isCodegraphExcludeConfigPresent
}));

import { check as indexCheck } from '~/src/services/doctor/doctor-service/checks/codegraph-index-integrity';
import { check as excludeCheck } from '~/src/services/doctor/doctor-service/checks/codegraph-exclude-integrity';
import type {
  DoctorCheck,
  DoctorContext,
  DoctorOptions
} from '~/src/services/doctor/doctor-service/types';
import { isArray } from '~/src/shared/array-guards';
import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/doctor/codegraph-probe-uses-resolved-root.test.ts',
  ['behavior', 'integration'],
  [
    {
      dim: 'render',
      reason: 'the check returns a DoctorCheck record; no output of its own is rendered here'
    },
    {
      dim: 'a11y',
      reason:
        'no operator-facing message is asserted; the message text is covered by the sibling codegraph check suites'
    }
  ]
);

const RESOLVED_ROOT = '/tmp/resolved-doctor-root';

/**
 * `DoctorCheckPlugin.run` may return a promise; both checks here are
 * synchronous, so this narrows the union the same way the sibling doctor
 * suites do rather than indexing into the union directly.
 *
 * `isArray` (not `Array.isArray`): the built-in is declared
 * `(arg: any) => arg is any[]`, so its true branch narrowed the union to
 * `any[]` and the `return` was an unchecked `any` return — the finding was
 * caused by the guard, not by the value. `isArray` returns a plain `boolean`
 * and asserts nothing; the `instanceof` check is what drops the promise arm.
 */
function runPlugin(
  plugin: {
    run: (context: DoctorContext) => readonly DoctorCheck[] | Promise<readonly DoctorCheck[]>;
  },
  context: DoctorContext
): readonly DoctorCheck[] {
  const result = plugin.run(context);

  if (result instanceof Promise || !isArray(result)) return [];

  return result;
}

function makeContext(resolvedL3Root: string, options: DoctorOptions = {}): DoctorContext {
  return {
    options,
    registry: { skills: [], failures: [] },
    skills: [],
    schemaRoot: '',
    presence: null,
    workspaceInitialized: false,
    statusLineInstalled: false,
    platform: process.platform,
    resolvedL3Root,
    projectRootResolver: () => resolvedL3Root,
    isValidSessionId: () => true,
    accumulatedChecks: []
  };
}

/** First check emitted by a plugin, with the union narrowed away. */
function first(
  plugin: typeof indexCheck | typeof excludeCheck,
  resolvedL3Root: string,
  options: DoctorOptions = {}
): DoctorCheck {
  const checks = runPlugin(plugin, makeContext(resolvedL3Root, options));
  const found = checks[0];
  if (found === undefined) throw new Error(`plugin ${plugin.name} emitted no checks`);

  return found;
}

describe('Scenario: integration — the codegraph module boundary receives the resolved root', () => {
  it('the index probe asks about the resolved root, not process.cwd()', () => {
    isCodegraphInitialized.mockClear();
    runPlugin(indexCheck, makeContext(RESOLVED_ROOT));

    expect(isCodegraphInitialized).toHaveBeenCalledWith(RESOLVED_ROOT);
    expect(isCodegraphInitialized).not.toHaveBeenCalledWith(process.cwd());
  });

  it('the exclude probe asks about the resolved root, not process.cwd()', () => {
    isCodegraphExcludeConfigPresent.mockClear();
    runPlugin(excludeCheck, makeContext(RESOLVED_ROOT));

    expect(isCodegraphExcludeConfigPresent).toHaveBeenCalledWith(RESOLVED_ROOT);
    expect(isCodegraphExcludeConfigPresent).not.toHaveBeenCalledWith(process.cwd());
  });

  it('an unresolved root inspects nothing rather than falling back to cwd', () => {
    // `join('', '.codegraph', …)` resolves against `cwd`, so an empty root
    // used to be the same defect wearing a different hat. Nothing may be read.
    isCodegraphInitialized.mockClear();
    isCodegraphExcludeConfigPresent.mockClear();

    const indexResult = first(indexCheck, '');
    const excludeResult = first(excludeCheck, '');

    expect(isCodegraphInitialized).not.toHaveBeenCalled();
    expect(isCodegraphExcludeConfigPresent).not.toHaveBeenCalled();
    expect(indexResult.ok).toBe(true);
    expect(excludeResult.ok).toBe(true);
  });

  it('an injected probe still wins over the default', () => {
    // Back-compat: the injection seam the existing suites use is unchanged.
    isCodegraphInitialized.mockClear();
    const injected = {
      gap: false,
      trackedSourceCount: 1,
      admittedTrackedCount: 1,
      includeGap: [],
      indexedFileCount: 1,
      deadRows: []
    };
    const result = first(indexCheck, RESOLVED_ROOT, {
      codegraphIndexIntegrityProbe: () => injected
    });

    expect(isCodegraphInitialized).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });
});

describe('Scenario: behavior — the verdict the probes produce', () => {
  it('reports "not initialized" rather than a gap when the resolved root has no index', () => {
    // With the default probe wired to the resolved root, a root with no
    // `.codegraph/` yields the documented "nothing to inspect" verdict —
    // it does not borrow a verdict from whichever repository is the cwd.
    isCodegraphInitialized.mockReturnValue(false);
    const result = first(indexCheck, '/tmp/no-index-here');

    expect(result.ok).toBe(true);
    expect(result.message).toContain('not initialized');
  });

  it('reports a gap when the resolved root has one', () => {
    isCodegraphInitialized.mockReturnValue(true);
    mocks.inspectCodegraphIndexIntegrity.mockReturnValueOnce({
      gap: true,
      trackedSourceCount: 2,
      admittedTrackedCount: 1,
      includeGap: ['scripts/tool.mjs'],
      indexedFileCount: 1,
      deadRows: []
    });

    const result = first(indexCheck, '/tmp/has-index');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('scripts/tool.mjs');
  });
});
