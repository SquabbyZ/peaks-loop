import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import type { DesignCheckResult } from '../../../src/services/design/design-check.js';
import {
  completeG3,
  EMPTY_G3_EXEMPLAR,
  type G3CheckInput,
  type G3SuiteDeps
} from '../../../src/services/design/design-check-g3-suite.js';

import type * as G3SuiteModuleTypes from '../../../src/services/design/design-check-g3-suite.js';

type G3SuiteModule = typeof G3SuiteModuleTypes;

declareDimensions('tests/unit/design/design-check-g3-suite-hardening.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

const BASELINE = 'http://127.0.0.1:4311/';
const CANDIDATE = 'http://127.0.0.1:4312/';

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-g3-sh-'));
  roots.push(root);
  mkdirSync(join(root, 'design'), { recursive: true });
  writeFileSync(
    join(root, 'design', 'paved-road.json'),
    JSON.stringify({ pageRoots: ['src/routes'] }),
    'utf8'
  );
  return root;
}

function contractRootOf(root: string) {
  return { appRoot: root, designRoot: join(root, 'design'), appRelPath: '' };
}

function baseResult(overrides: Partial<DesignCheckResult> = {}): DesignCheckResult {
  return {
    schemaVersion: 1,
    rid: 'r1',
    verdict: 'pass',
    surface: { isUi: true, reasons: ['changed: src/routes/a.tsx'] },
    checks: {
      g1_source: { status: 'pass', findings: [] },
      g2_render: { status: 'pass', pages: 1, evidence: ['ok'] },
      g3_exemplar: EMPTY_G3_EXEMPLAR
    },
    findings: [],
    coverage: null,
    ...overrides
  };
}

function writeBaseline(root: string, body: unknown): void {
  const dir = join(root, '.peaks', '_runtime', 'sid-1', 'design', 'baseline');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'root.json'), JSON.stringify(body), 'utf8');
}

function writeExemplar(root: string): void {
  const dir = join(root, 'design', 'exemplars', 'list');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ route: '/', sourceFile: 'list.tsx' }));
  writeFileSync(join(dir, 'list.tsx'), 'export {};', 'utf8');
}

/** A machine-owned engine.json naming the render pages, and nothing else. */
function writeEnginePages(root: string, pages: string[]): void {
  mkdirSync(join(root, 'design'), { recursive: true });
  writeFileSync(
    join(root, 'design', 'engine.json'),
    JSON.stringify({ schemaVersion: 1, render: { pages } }),
    'utf8'
  );
}

type Spies = {
  candidateRoutes: string[];
  rubricPaths: string[];
  fidelityCalls: number;
};

function suiteDeps(overrides: Partial<G3SuiteDeps> = {}, spies: Spies = emptySpies()): G3SuiteDeps {
  return {
    fidelity: async () => {
      spies.fidelityCalls += 1;
      return {
        ok: true,
        score: 92,
        visual: 91,
        motion: 94,
        grade: 'A',
        generatedAt: '2026-11-24T00:00:00.000Z',
        reportPath: 'fidelity.json'
      };
    },
    candidateUrl: (route) => {
      spies.candidateRoutes.push(route);
      return { ok: true, url: CANDIDATE };
    },
    rubricText: (path) => {
      spies.rubricPaths.push(path);
      return null;
    },
    ...overrides
  };
}

function emptySpies(): Spies {
  return { candidateRoutes: [], rubricPaths: [], fidelityCalls: 0 };
}

function inputFor(root: string, overrides: Partial<G3CheckInput> = {}): G3CheckInput {
  return {
    projectRoot: root,
    changedFiles: ['src/routes/index.tsx'],
    sessionId: 'sid-1',
    rid: 'r1',
    ...overrides
  };
}

const ENTRY = { schemaVersion: 1, route: '/', baseCommit: 'abc1234', baselineUrl: BASELINE };

/**
 * The SUT is imported per test after `vi.resetModules()` so its module-level
 * constants (the local session fallback and the empty slot) initialise INSIDE a
 * test body, where Stryker's per-test coverage can schedule a mutant.
 */
async function loadSuite(): Promise<G3SuiteModule> {
  vi.resetModules();
  return import('../../../src/services/design/design-check-g3-suite.js');
}

describe('Scenario: behavior — routes come from the changed files', () => {
  it('should judge the route derived from the changed page, not the engine pages', async () => {
    // given: an engine.json naming another page and a changed page under src/routes
    // when: G3 completes a passing result
    // then: only the changed route is judged
    const root = makeRoot();
    writeEnginePages(root, ['/from-engine']);

    const result = await completeG3(
      inputFor(root),
      baseResult(),
      contractRootOf(root),
      suiteDeps()
    );

    expect(result.checks.g3_exemplar.g3a.map((run) => run.route)).toEqual(['/']);
  });

  it('should skip a changed page with no recorded baseline instead of the engine page', async () => {
    // given: engine pages and a changed page whose route differs
    // when: G3 completes a passing result
    // then: the changed route is skipped and the engine page is never seen
    const root = makeRoot();
    writeEnginePages(root, ['/from-engine']);

    const result = await completeG3(
      inputFor(root, { changedFiles: ['src/routes/about.tsx'] }),
      baseResult(),
      contractRootOf(root),
      suiteDeps()
    );

    expect(result.checks.g3_exemplar.g3a).toEqual([
      { status: 'skipped', route: '/about', reason: 'no-baseline' }
    ]);
  });
});

describe('Scenario: render — the rubric path is the session design directory', () => {
  it('should read rubric-<rid>.json from <session>/design', async () => {
    // given: a registered exemplar, a request id and a session id
    // when: G3 completes the result
    // then: the rubric reader is handed exactly the session's rubric path
    const root = makeRoot();
    writeExemplar(root);
    const spies = emptySpies();

    await completeG3(inputFor(root), baseResult(), contractRootOf(root), suiteDeps({}, spies));

    expect(spies.rubricPaths).toEqual([
      join(root, '.peaks', '_runtime', 'sid-1', 'design', 'rubric-r1.json')
    ]);
  });

  it('should not read a rubric for a route without an exemplar', async () => {
    // given: a registered exemplar for / and a route that matches no exemplar
    // when: G3 completes the result
    // then: no rubric is read and G3b skips the unmatched route
    const root = makeRoot();
    writeExemplar(root);
    const spies = emptySpies();

    const result = await completeG3(
      inputFor(root, { changedFiles: ['src/routes/no-exemplar.tsx'] }),
      baseResult(),
      contractRootOf(root),
      suiteDeps({}, spies)
    );

    expect(spies.rubricPaths).toEqual([]);
    expect(result.checks.g3_exemplar.g3b[0]).toEqual({
      route: '/no-exemplar',
      status: 'skipped',
      reason: 'no-exemplar-for-archetype'
    });
  });
});

describe('Scenario: behavior — an unusable request id reads no rubric', () => {
  it('should never touch the rubric for a null, absent or multi-segment rid', async () => {
    // given: a registered exemplar and request ids that name no safe file
    // when: G3 completes each result
    // then: no rubric is read and G3b blocks on the missing rubric
    const cases: Array<(root: string) => G3CheckInput> = [
      (root) => inputFor(root, { rid: null }),
      (root) => ({ projectRoot: root, changedFiles: ['src/routes/index.tsx'], sessionId: 'sid-1' }),
      (root) => inputFor(root, { rid: 'a/b' })
    ];
    for (const build of cases) {
      const root = makeRoot();
      writeExemplar(root);
      const spies = emptySpies();

      const result = await completeG3(
        build(root),
        baseResult(),
        contractRootOf(root),
        suiteDeps({}, spies)
      );

      expect(spies.rubricPaths).toEqual([]);
      expect(result.checks.g3_exemplar.g3b[0]?.code).toBe('DESIGN_RUBRIC_MISSING');
    }
  });
});

describe('Scenario: behavior — a skip does no URL or engine work', () => {
  it('should not resolve a candidate URL for a route with no baseline', async () => {
    // given: an empty baseline store and no explicit baseline URL
    // when: G3 completes a passing result
    // then: the route is skipped before the candidate resolver runs
    const root = makeRoot();
    const spies = emptySpies();

    const result = await completeG3(
      inputFor(root),
      baseResult(),
      contractRootOf(root),
      suiteDeps({}, spies)
    );

    expect(result.checks.g3_exemplar.g3a[0]?.status).toBe('skipped');
    expect(spies.candidateRoutes).toEqual([]);
    expect(spies.fidelityCalls).toBe(0);
  });

  it('should not resolve a candidate URL for a malformed baseline', async () => {
    // given: a baseline file with an unsupported schema version
    // when: G3 completes a passing result
    // then: the malformed entry blocks without resolving any URL
    const root = makeRoot();
    writeBaseline(root, { ...ENTRY, schemaVersion: 2 });
    const spies = emptySpies();

    const result = await completeG3(
      inputFor(root),
      baseResult(),
      contractRootOf(root),
      suiteDeps({}, spies)
    );

    expect(result.verdict).toBe('blocked');
    expect(result.errorCode).toBe('DESIGN_BASELINE_INVALID');
    expect(result.message).toContain('is not usable (schema-version)');
    expect(spies.candidateRoutes).toEqual([]);
  });
});

describe('Scenario: behavior — G3 never rewrites a non-passing base verdict', () => {
  it('should keep a failing result failing when a G3a run blocks', async () => {
    // given: a failing base result and a malformed baseline for the route
    // when: G3 completes the result
    // then: the verdict, error code and message stay the base result's own
    const root = makeRoot();
    writeBaseline(root, { ...ENTRY, schemaVersion: 2 });

    const result = await completeG3(
      inputFor(root),
      baseResult({ verdict: 'fail', errorCode: 'DESIGN_SOURCE_FAIL', message: 'g1 failed' }),
      contractRootOf(root),
      suiteDeps()
    );

    expect(result.verdict).toBe('fail');
    expect(result.errorCode).toBe('DESIGN_SOURCE_FAIL');
    expect(result.message).toBe('g1 failed');
  });
});

describe('Scenario: render — a passing result gains no failure keys', () => {
  it('should leave errorCode and message absent on a pass', async () => {
    // given: a passing base result carrying neither errorCode nor message
    // when: G3 completes it with every route skipped
    // then: the returned result has no own errorCode or message property
    const root = makeRoot();

    const result = await completeG3(
      inputFor(root),
      baseResult(),
      contractRootOf(root),
      suiteDeps()
    );

    expect(result.verdict).toBe('pass');
    expect(Object.prototype.hasOwnProperty.call(result, 'errorCode')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result, 'message')).toBe(false);
  });
});

describe('Scenario: integration — an invalid session id is refused before any work', () => {
  it('should keep the empty slot and never consult the injected deps', async () => {
    // given: a session id that is not one path segment
    // when: G3 completes a passing result
    // then: the empty slot is attached and no URL, engine or rubric is touched
    const root = makeRoot();
    const spies = emptySpies();

    const result = await completeG3(
      inputFor(root, { sessionId: '../escape' }),
      baseResult(),
      contractRootOf(root),
      suiteDeps({}, spies)
    );

    expect(result.checks.g3_exemplar).toBe(EMPTY_G3_EXEMPLAR);
    expect(spies.candidateRoutes).toEqual([]);
    expect(spies.fidelityCalls).toBe(0);
    expect(spies.rubricPaths).toEqual([]);
  });
});

describe('Scenario: render — the module constants initialise inside the test', () => {
  it('should build the empty slot and fall back to the local session on a fresh import', async () => {
    // given: a fresh suite module and a registered exemplar with no session id
    // when: the fresh module completes a result
    // then: the empty slot is empty and the rubric path sits under _runtime/local
    const root = makeRoot();
    writeExemplar(root);
    const fresh = await loadSuite();
    const spies = emptySpies();

    const noSession: G3CheckInput = {
      projectRoot: root,
      changedFiles: ['src/routes/index.tsx'],
      rid: 'r1'
    };
    const result = await fresh.completeG3(
      noSession,
      baseResult(),
      contractRootOf(root),
      suiteDeps({}, spies)
    );

    expect(fresh.EMPTY_G3_EXEMPLAR).toEqual({ g3a: [], g3b: [] });
    expect(result.checks.g3_exemplar.g3b[0]?.code).toBe('DESIGN_RUBRIC_MISSING');
    expect(spies.rubricPaths).toEqual([
      join(root, '.peaks', '_runtime', 'local', 'design', 'rubric-r1.json')
    ]);
  });
});
