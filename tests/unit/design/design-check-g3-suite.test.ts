import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { DesignBaselineUrlScopeError } from '../../../src/services/design/acceptance.js';
import type { DesignCheckResult } from '../../../src/services/design/design-check.js';
import {
  completeG3,
  EMPTY_G3_EXEMPLAR,
  type G3CheckInput,
  type G3SuiteDeps
} from '../../../src/services/design/design-check-g3-suite.js';

declareDimensions('tests/unit/design/design-check-g3-suite.test.ts', [
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
  const root = mkdtempSync(join(tmpdir(), 'peaks-g3-suite-'));
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

function baseResult(): DesignCheckResult {
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
    coverage: null
  };
}

function writeBaseline(root: string, body: unknown, slug = 'root'): void {
  const dir = join(root, '.peaks', '_runtime', 'sid-1', 'design', 'baseline');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${slug}.json`), JSON.stringify(body), 'utf8');
}

/** The engine's recorded render pages; G3 must ignore them. */
function writeEngine(root: string, pages: string[]): void {
  mkdirSync(join(root, 'design'), { recursive: true });
  writeFileSync(
    join(root, 'design', 'engine.json'),
    JSON.stringify({ schemaVersion: 1, render: { pages } }),
    'utf8'
  );
}

function writeExemplar(root: string): void {
  const dir = join(root, 'design', 'exemplars', 'list');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ route: '/', sourceFile: 'list.tsx' }));
  writeFileSync(join(dir, 'list.tsx'), 'export {};', 'utf8');
}

type FidelityCall = { baselineUrl: string; candidateUrl: string; min: number };

function suiteDeps(overrides: Partial<G3SuiteDeps> = {}, calls: FidelityCall[] = []): G3SuiteDeps {
  return {
    fidelity: async (input) => {
      calls.push(input);
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
    candidateUrl: () => ({ ok: true, url: CANDIDATE }),
    rubricText: () => null,
    ...overrides
  };
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

function rubricBody(dimensions: Record<string, number>): string {
  return JSON.stringify({ schemaVersion: 1, rid: 'r1', archetype: 'list', dimensions });
}

const WARN_RUBRIC = {
  layout: 3,
  type: 3,
  color: 3,
  states: 3,
  responsive: 3,
  a11y: 3
};

describe('Scenario: behavior — only G3a changes the top-level verdict', () => {
  it('when a route has no baseline, should skip without calling the engine', async () => {
    // given: an empty baseline store and a route with no exemplar
    // when: G3 completes a passing result
    // then: both checks skip and the verdict stays pass
    const calls: FidelityCall[] = [];
    const root = makeRoot();
    const result = await completeG3(
      inputFor(root),
      baseResult(),
      contractRootOf(root),
      suiteDeps({}, calls)
    );

    expect(calls).toHaveLength(0);
    expect(result.verdict).toBe('pass');
    expect(result.checks.g3_exemplar.g3a).toEqual([
      { status: 'skipped', route: '/', reason: 'no-baseline' }
    ]);
    expect(result.checks.g3_exemplar.g3b).toEqual([
      { route: '/', status: 'skipped', reason: 'no-exemplar-for-archetype' }
    ]);
  });

  it('when G3a scores below the minimum, should fail the whole check', async () => {
    // given: a recorded baseline and a fidelity score of 89 against min 90
    // when: G3 completes a passing result
    // then: the verdict flips to fail and the score is preserved
    const root = makeRoot();
    writeBaseline(root, ENTRY);
    const result = await completeG3(
      inputFor(root),
      baseResult(),
      contractRootOf(root),
      suiteDeps({
        fidelity: async () => ({
          ok: true,
          score: 89,
          visual: 88,
          motion: 91,
          grade: 'B',
          generatedAt: '2026-11-24T00:00:00.000Z',
          reportPath: 'fidelity.json'
        })
      })
    );

    expect(result.verdict).toBe('fail');
    const run = result.checks.g3_exemplar.g3a[0];
    expect(run?.status).toBe('fail');
    if (run?.status === 'fail') expect(run.score).toBe(89);
  });

  it('when a recorded baseline is malformed, should block rather than skip', async () => {
    // given: a baseline file with an unsupported schema version
    // when: G3 completes a passing result
    // then: the verdict flips to blocked and names the baseline code
    const root = makeRoot();
    writeBaseline(root, { ...ENTRY, schemaVersion: 2 });
    const result = await completeG3(
      inputFor(root),
      baseResult(),
      contractRootOf(root),
      suiteDeps()
    );

    expect(result.verdict).toBe('blocked');
    expect(result.errorCode).toBe('DESIGN_BASELINE_INVALID');
    expect(result.message).toContain('schema-version');
  });
});

describe('Scenario: integration — the baseline and rubric sources', () => {
  it('when --baseline-url is given, should hand it to the fidelity run', async () => {
    // given: an empty baseline store and an explicit baseline URL
    // when: G3 completes the result
    // then: the explicit URL is the one compared, not a skipped route
    const explicit = 'http://127.0.0.1:4313/';
    const calls: FidelityCall[] = [];
    const root = makeRoot();
    const result = await completeG3(
      inputFor(root, { baselineUrl: explicit }),
      baseResult(),
      contractRootOf(root),
      suiteDeps({}, calls)
    );

    expect(calls[0]?.baselineUrl).toBe(explicit);
    expect(result.checks.g3_exemplar.g3a[0]?.status).toBe('pass');
  });

  it('when a baseline is recorded, should use its URL and the candidate route', async () => {
    // given: a recorded baseline for the root route
    // when: G3 completes the result
    // then: the fidelity run compares the recorded URL with the resolved candidate
    const calls: FidelityCall[] = [];
    const root = makeRoot();
    writeBaseline(root, ENTRY);
    await completeG3(inputFor(root), baseResult(), contractRootOf(root), suiteDeps({}, calls));

    expect(calls[0]).toEqual({ baselineUrl: BASELINE, candidateUrl: CANDIDATE, min: 90 });
  });

  it('when an exemplar has a below-threshold rubric, should warn without failing', async () => {
    // given: a registered exemplar and an all-3 advisory rubric
    // when: G3 completes a passing result
    // then: G3b warns while the top-level verdict still passes
    const root = makeRoot();
    writeExemplar(root);
    const result = await completeG3(
      inputFor(root),
      baseResult(),
      contractRootOf(root),
      suiteDeps({ rubricText: () => rubricBody(WARN_RUBRIC) })
    );

    expect(result.verdict).toBe('pass');
    expect(result.checks.g3_exemplar.g3b[0]).toMatchObject({
      route: '/',
      status: 'warn',
      reason: 'below-threshold',
      total: 24
    });
  });

  it('when --skip-exemplar is accepted, should skip only the advisory rubric', async () => {
    // given: an accepted skip, a registered exemplar and a failing baseline score
    // when: G3 completes the result
    // then: G3b records the acceptance but the hard G3a failure still flips the verdict
    const root = makeRoot();
    writeBaseline(root, ENTRY);
    writeExemplar(root);
    const result = await completeG3(
      inputFor(root, { skipExemplar: true }),
      baseResult(),
      contractRootOf(root),
      suiteDeps({
        fidelity: async () => ({
          ok: true,
          score: 89,
          visual: 88,
          motion: 91,
          grade: 'B',
          generatedAt: '2026-11-24T00:00:00.000Z',
          reportPath: 'fidelity.json'
        })
      })
    );

    expect(result.checks.g3_exemplar.g3b[0]).toEqual({
      route: '/',
      status: 'skipped',
      reason: 'explicitly-accepted'
    });
    expect(result.verdict).toBe('fail');
    expect(result.acceptedBy).toBeUndefined();
  });

  it('when --skip-exemplar passes the check, should record the accepting session and note', async () => {
    // given: an accepted skip, the user's words, and a route with no baseline
    // when: G3 completes a passing result
    // then: the result names the session and carries the note verbatim
    const root = makeRoot();
    const result = await completeG3(
      inputFor(root, { skipExemplar: true, acceptNote: 'The rubric is not needed for this pilot' }),
      baseResult(),
      contractRootOf(root),
      suiteDeps()
    );

    expect(result.verdict).toBe('pass');
    expect(result.acceptedBy).toBe('sid-1');
    expect(result.acceptedNote).toBe('The rubric is not needed for this pilot');
    expect(result.checks.g3_exemplar.g3b[0]?.status).toBe('skipped');
  });
});

describe('Scenario: render — the g3_exemplar slot shape', () => {
  it('when no route changed, should keep the empty slot and the verdict', async () => {
    // given: an empty change set
    // when: G3 completes a passing result
    // then: the slot is empty and nothing was judged
    const root = makeRoot();
    const result = await completeG3(
      inputFor(root, { changedFiles: [] }),
      baseResult(),
      contractRootOf(root),
      suiteDeps()
    );

    expect(result.checks.g3_exemplar).toEqual(EMPTY_G3_EXEMPLAR);
    expect(result.verdict).toBe('pass');
  });

  it('when two routes changed, should pair each result with its route', async () => {
    // given: two changed pages with no baselines
    // when: G3 completes the result
    // then: both derived routes appear in order in the g3a slot
    const root = makeRoot();
    const result = await completeG3(
      inputFor(root, { changedFiles: ['src/routes/index.tsx', 'src/routes/about.tsx'] }),
      baseResult(),
      contractRootOf(root),
      suiteDeps()
    );

    expect(result.checks.g3_exemplar.g3a.map((run) => run.route)).toEqual(['/', '/about']);
  });
});

describe('Scenario: integration — G3 scope is the change, not the render configuration', () => {
  it('when an untouched configured page has a failing baseline, should not judge it', async () => {
    // given: a recorded baseline and a render page for a route this change never touched
    // when: G3 completes a change to a different page
    // then: only the changed route is judged and the verdict stays pass
    const root = makeRoot();
    writeBaseline(root, ENTRY);
    writeEngine(root, ['/']);
    const calls: FidelityCall[] = [];

    const result = await completeG3(
      inputFor(root, { changedFiles: ['src/routes/about.tsx'] }),
      baseResult(),
      contractRootOf(root),
      suiteDeps({}, calls)
    );

    expect(calls).toHaveLength(0);
    expect(result.verdict).toBe('pass');
    expect(result.checks.g3_exemplar.g3a).toEqual([
      { status: 'skipped', route: '/about', reason: 'no-baseline' }
    ]);
  });

  it('when a changed route is not in render.pages, should judge it and carry baseCommit', async () => {
    // given: engine pages naming only /, and a baseline recorded for /about
    // when: the changed page derives the /about route
    // then: the route is judged and its baseline commit reaches the evidence
    const root = makeRoot();
    writeEngine(root, ['/']);
    writeBaseline(root, { ...ENTRY, route: '/about', baseCommit: 'fedcba9' }, 'about');
    const calls: FidelityCall[] = [];

    const result = await completeG3(
      inputFor(root, { changedFiles: ['src/routes/about.tsx'] }),
      baseResult(),
      contractRootOf(root),
      suiteDeps({}, calls)
    );

    expect(calls[0]?.baselineUrl).toBe(BASELINE);
    expect(result.checks.g3_exemplar.g3a[0]).toMatchObject({
      status: 'pass',
      route: '/about',
      baseCommit: 'fedcba9'
    });
  });

  it('when a changed UI file maps to no route, should skip it as route-unknown', async () => {
    // given: a changed component file outside every page root
    // when: G3 completes the result
    // then: the file is recorded as a skip and cannot fail the verdict
    const root = makeRoot();

    const result = await completeG3(
      inputFor(root, { changedFiles: ['src/components/Button.tsx'] }),
      baseResult(),
      contractRootOf(root),
      suiteDeps()
    );

    expect(result.verdict).toBe('pass');
    expect(result.checks.g3_exemplar.g3a).toEqual([
      { status: 'skipped', route: 'src/components/Button.tsx', reason: 'route-unknown' }
    ]);
  });

  it('when --baseline-url names one route for two changed routes, should refuse', async () => {
    // given: an explicit baseline URL and a change touching two routes
    // when: G3 completes the result
    // then: the usage error is thrown before any comparison
    const root = makeRoot();

    await expect(
      completeG3(
        inputFor(root, {
          changedFiles: ['src/routes/a.tsx', 'src/routes/b.tsx'],
          baselineUrl: BASELINE
        }),
        baseResult(),
        contractRootOf(root),
        suiteDeps()
      )
    ).rejects.toBeInstanceOf(DesignBaselineUrlScopeError);
  });
});

describe('Scenario: a11y — an unusable exemplar names its recorded reason', () => {
  it('should surface the registry issue on the result', async () => {
    // given: an exemplar directory whose meta.json names no route
    // when: G3 completes the result
    // then: the issue is carried in the g3_exemplar slot instead of being dropped
    const root = makeRoot();
    const dir = join(root, 'design', 'exemplars', 'broken');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'meta.json'), JSON.stringify({ sourceFile: 'x.tsx' }), 'utf8');
    writeFileSync(join(dir, 'x.tsx'), 'export {};', 'utf8');

    const result = await completeG3(
      inputFor(root),
      baseResult(),
      contractRootOf(root),
      suiteDeps()
    );

    expect(result.checks.g3_exemplar.issues).toEqual([
      { archetype: 'broken', reason: 'meta-route-missing' }
    ]);
  });
});

describe('Scenario: a11y — a blocked G3a names what to fix', () => {
  it('should carry the blocked message and code into the result', async () => {
    // given: a candidate URL the route cannot be resolved against
    // when: G3 completes a passing result
    // then: the result blocks with the resolver's own code and message
    const root = makeRoot();
    writeBaseline(root, ENTRY);
    const result = await completeG3(
      inputFor(root),
      baseResult(),
      contractRootOf(root),
      suiteDeps({
        candidateUrl: () => ({
          ok: false,
          code: 'DESIGN_RENDER_URL_MISSING',
          message: 'No render URL is configured.'
        })
      })
    );

    expect(result.verdict).toBe('blocked');
    expect(result.errorCode).toBe('DESIGN_RENDER_URL_MISSING');
    expect(result.message).toBe('No render URL is configured.');
  });
});
