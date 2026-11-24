import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import type { ExemplarEntry } from '../../../src/services/design/exemplars.js';
import type { FidelityRunResult } from '../../../src/services/design/fidelity.js';
import {
  type EvaluateG3aInput,
  type EvaluateG3bInput,
  type G3ADeps,
  evaluateG3a,
  evaluateG3b,
  readBaseline,
  readBaselineState,
  routeSlug
} from '../../../src/services/design/design-check-g3.js';

declareDimensions('tests/unit/design/design-check-g3.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

const ROUTE = '/features/channels';
const BASELINE = 'http://127.0.0.1:4311/features/channels';
const CANDIDATE = 'http://127.0.0.1:4312/features/channels';

const ENTRY = {
  schemaVersion: 1,
  route: ROUTE,
  baseCommit: 'abc1234',
  baselineUrl: BASELINE
};

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

function makeStore(): string {
  const dir = mkdtempSync(join(tmpdir(), 'peaks-g3-'));
  roots.push(dir);
  return dir;
}

function writeEntry(storeDir: string, route: string, body: unknown): void {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  writeFileSync(join(storeDir, `${routeSlug(route)}.json`), text, 'utf8');
}

type Call = { baselineUrl: string; candidateUrl: string; min: number };

function okResult(
  overrides: Partial<Extract<FidelityRunResult, { ok: true }>> = {}
): FidelityRunResult {
  return {
    ok: true,
    score: 92,
    visual: 91,
    motion: 94,
    grade: 'A',
    generatedAt: '2026-11-24T00:00:00.000Z',
    reportPath: '.peaks/_runtime/sid-1/design/fidelity/run/fidelity.json',
    ...overrides
  };
}

function depsFor(result: FidelityRunResult, calls: Call[] = []): G3ADeps {
  return {
    fidelity: async (input) => {
      calls.push(input);
      return result;
    }
  };
}

function inputFor(
  storeDir: string,
  deps: G3ADeps,
  overrides: Partial<EvaluateG3aInput> = {}
): EvaluateG3aInput {
  return { storeDir, route: ROUTE, candidateUrl: CANDIDATE, deps, ...overrides };
}

const RID = 'peaks-design-s4';

const EXEMPLAR: ExemplarEntry = {
  archetype: 'list',
  route: ROUTE,
  sourceFile: 'design/exemplars/list/list.tsx',
  screenshotPath: null,
  metaPath: 'design/exemplars/list/meta.json'
};

function rubricBody(
  dimensions: Record<string, number>,
  overrides: Record<string, unknown> = {}
): string {
  return JSON.stringify({
    schemaVersion: 1,
    rid: RID,
    archetype: EXEMPLAR.archetype,
    dimensions,
    ...overrides
  });
}

function g3bInput(overrides: Partial<EvaluateG3bInput> = {}): EvaluateG3bInput {
  return { rubricText: null, rid: RID, route: ROUTE, exemplar: EXEMPLAR, ...overrides };
}

describe('Scenario: behavior — the threshold decides pass, fail or skip', () => {
  it('when the score is at the threshold, should pass and keep the split', async () => {
    // given: a recorded baseline and a fidelity score of 92 against min 90
    // when: G3a evaluates the route
    // then: the verdict passes and records visual, motion and grade
    const store = makeStore();
    writeEntry(store, ROUTE, ENTRY);

    const result = await evaluateG3a(inputFor(store, depsFor(okResult())));

    expect(result.status).toBe('pass');
    if (result.status === 'pass') {
      expect(result.score).toBe(92);
      expect(result.visual).toBe(91);
      expect(result.motion).toBe(94);
      expect(result.grade).toBe('A');
    }
  });

  it('when the score is below the threshold, should fail with reason below-min', async () => {
    // given: a recorded baseline and a fidelity score of 89 against min 90
    // when: G3a evaluates the route
    // then: the verdict fails and the score is preserved for the evidence
    const store = makeStore();
    writeEntry(store, ROUTE, ENTRY);

    const result = await evaluateG3a(inputFor(store, depsFor(okResult({ score: 89, grade: 'B' }))));

    expect(result.status).toBe('fail');
    if (result.status === 'fail') {
      expect(result.reason).toBe('below-min');
      expect(result.score).toBe(89);
      expect(result.grade).toBe('B');
    }
  });

  it('when no baseline is recorded, should skip without calling the engine', async () => {
    // given: an empty baseline store and no explicit baseline URL
    // when: G3a evaluates the route
    // then: the verdict is skipped(no-baseline) and no fidelity run happens
    const calls: Call[] = [];
    const result = await evaluateG3a(inputFor(makeStore(), depsFor(okResult(), calls)));

    expect(result).toEqual({ status: 'skipped', route: ROUTE, reason: 'no-baseline' });
    expect(calls).toHaveLength(0);
  });

  it('when the engine is unavailable, should block with its code', async () => {
    // given: a recorded baseline and a fidelity run blocked on a missing engine
    // when: G3a evaluates the route
    // then: the blocked code is passed through unchanged
    const store = makeStore();
    writeEntry(store, ROUTE, ENTRY);
    const blocked: FidelityRunResult = {
      ok: false,
      code: 'DESIGN_ENGINE_UNAVAILABLE',
      message: 'designlang is unavailable'
    };

    const result = await evaluateG3a(inputFor(store, depsFor(blocked)));

    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.code).toBe('DESIGN_ENGINE_UNAVAILABLE');
      expect(result.message).toContain('unavailable');
    }
  });

  it('when min is NaN, should block before running the engine', async () => {
    // given: a NaN threshold and a store with a valid baseline
    // when: G3a evaluates the route
    // then: the run is blocked and the engine is never called
    const store = makeStore();
    writeEntry(store, ROUTE, ENTRY);
    const calls: Call[] = [];

    const result = await evaluateG3a(
      inputFor(store, depsFor(okResult(), calls), { min: Number.NaN })
    );

    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') expect(result.code).toBe('DESIGN_FIDELITY_MIN_INVALID');
    expect(calls).toHaveLength(0);
  });
});

describe('Scenario: integration — the baseline store on disk', () => {
  it('should read a valid entry and hand its URL to the fidelity run', async () => {
    // given: a valid baseline file for the route
    // when: the store is read and G3a evaluates the route
    // then: the entry is returned and its baselineUrl is the one compared
    const store = makeStore();
    writeEntry(store, ROUTE, ENTRY);
    const calls: Call[] = [];

    const read = readBaselineState(store, ROUTE);
    const result = await evaluateG3a(inputFor(store, depsFor(okResult(), calls)));

    expect(read).toEqual({ entry: ENTRY, issue: null });
    expect(readBaseline(store, ROUTE)).toEqual(ENTRY);
    expect(result.status).toBe('pass');
    expect(calls[0]?.baselineUrl).toBe(BASELINE);
    expect(calls[0]?.candidateUrl).toBe(CANDIDATE);
    expect(calls[0]?.min).toBe(90);
  });

  it('should report a missing file as an absent baseline, not an issue', async () => {
    // given: a store that holds no file for the route
    // when: the store is read
    // then: both the entry and the issue are null
    const store = makeStore();
    const read = readBaselineState(store, ROUTE);

    expect(read).toEqual({ entry: null, issue: null });
    expect(readBaseline(store, ROUTE)).toBeNull();
  });

  it('should report invalid JSON as a malformed entry and block', async () => {
    // given: a baseline file whose body is truncated
    // when: the store is read and G3a evaluates the route
    // then: the read carries an issue and the verdict blocks instead of skipping
    const store = makeStore();
    writeEntry(store, ROUTE, '{ "route": "/features/channels",');

    const read = readBaselineState(store, ROUTE);
    const result = await evaluateG3a(inputFor(store, depsFor(okResult())));

    expect(read.entry).toBeNull();
    expect(read.issue?.reason).toBe('not-json');
    expect(readBaseline(store, ROUTE)).toBeNull();
    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') expect(result.code).toBe('DESIGN_BASELINE_INVALID');
  });

  it('should report a baseline recorded for another route as malformed', async () => {
    // given: a baseline file whose route key names a different route
    // when: the store is read for the slug-matched route
    // then: the entry is refused with route-mismatch
    const store = makeStore();
    writeEntry(store, ROUTE, { ...ENTRY, route: '/features/other' });

    const read = readBaselineState(store, ROUTE);

    expect(read.entry).toBeNull();
    expect(read.issue?.reason).toBe('route-mismatch');
    expect(readBaseline(store, ROUTE)).toBeNull();
  });

  it('should use an explicit baseline URL when no entry is recorded', async () => {
    // given: an empty store and an explicit baseline URL
    // when: G3a evaluates the route
    // then: the explicit URL is compared instead of skipping
    const calls: Call[] = [];
    const explicit = 'http://127.0.0.1:4313/features/channels';

    const result = await evaluateG3a(
      inputFor(makeStore(), depsFor(okResult(), calls), { baselineUrl: explicit })
    );

    expect(result.status).toBe('pass');
    expect(calls[0]?.baselineUrl).toBe(explicit);
  });
});

describe('Scenario: render — the evidence a verdict carries', () => {
  it('should persist the score split, grade, report path and both URLs', async () => {
    // given: a passing fidelity result with full evidence
    // when: G3a evaluates the route
    // then: every persisted field is the one the engine reported
    const store = makeStore();
    writeEntry(store, ROUTE, ENTRY);

    const result = await evaluateG3a(inputFor(store, depsFor(okResult())));

    expect(result.status).toBe('pass');
    if (result.status === 'pass') {
      expect(result.route).toBe(ROUTE);
      expect(result.min).toBe(90);
      expect(result.generatedAt).toBe('2026-11-24T00:00:00.000Z');
      expect(result.reportPath.endsWith('fidelity.json')).toBe(true);
      expect(result.baselineUrl).toBe(BASELINE);
      expect(result.candidateUrl).toBe(CANDIDATE);
      expect(result.baseCommit).toBe('abc1234');
    }
  });

  it('should record a null baseCommit when only an explicit baseline URL names it', async () => {
    // given: an empty store and an explicit baseline URL
    // when: G3a evaluates the route
    // then: the score passes with no recorded commit to attribute it to
    const explicit = 'http://127.0.0.1:4313/features/channels';

    const result = await evaluateG3a(
      inputFor(makeStore(), depsFor(okResult()), { baselineUrl: explicit })
    );

    expect(result.status).toBe('pass');
    if (result.status === 'pass') expect(result.baseCommit).toBeNull();
  });

  it('should map the route to a file-safe slug', () => {
    // given: routes with slashes, a query string and the root route
    // when: the slug is computed
    // then: the filename carries no separator or query character
    expect(routeSlug('/features/channels?tab=1')).toBe('features-channels');
    expect(routeSlug('/')).toBe('root');
    expect(routeSlug('/a/b/c')).toBe('a-b-c');
  });
});

describe('Scenario: a11y — a blocked reader is told what to fix', () => {
  it('should name the unusable baseline file and its reason', async () => {
    // given: a baseline file that fails its schema check
    // when: G3a evaluates the route
    // then: the message names the file and the failed field
    const store = makeStore();
    writeEntry(store, ROUTE, { ...ENTRY, schemaVersion: 2 });

    const result = await evaluateG3a(inputFor(store, depsFor(okResult())));

    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.message).toContain('features-channels.json');
      expect(result.message).toContain('schema-version');
    }
  });

  it('should carry the engine refusal message verbatim', async () => {
    // given: a blocked fidelity result whose message explains the fix
    // when: G3a evaluates the route
    // then: the verdict repeats that message rather than inventing text
    const store = makeStore();
    writeEntry(store, ROUTE, ENTRY);
    const blocked: FidelityRunResult = {
      ok: false,
      code: 'DESIGN_FIDELITY_URL_UNREACHABLE',
      message: 'The fidelity URL did not answer; start the app and re-run.'
    };

    const result = await evaluateG3a(inputFor(store, depsFor(blocked)));

    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.code).toBe('DESIGN_FIDELITY_URL_UNREACHABLE');
      expect(result.message).toBe('The fidelity URL did not answer; start the app and re-run.');
    }
  });
});

describe('Scenario: behavior — G3b skips, blocks or warns without failing', () => {
  it('when the route has no exemplar, should skip with the reason', () => {
    // given: no exemplar for the route and a rubric that must not be read
    // when: G3b evaluates the route
    // then: the verdict is skipped(no-exemplar-for-archetype)
    const result = evaluateG3b(
      g3bInput({
        exemplar: null,
        rubricText: rubricBody({ layout: 4, type: 4, color: 4, states: 4, responsive: 4, a11y: 4 })
      })
    );

    expect(result).toEqual({ status: 'skipped', reason: 'no-exemplar-for-archetype' });
  });

  it('when an exemplar has no rubric, should block and say who writes it', () => {
    // given: a matched exemplar and no rubric text
    // when: G3b evaluates the route
    // then: the verdict blocks on DESIGN_RUBRIC_MISSING and names peaks-ui
    const result = evaluateG3b(g3bInput());

    expect(result.status).toBe('blocked');
    expect(result.code).toBe('DESIGN_RUBRIC_MISSING');
    expect(result.message).toContain('peaks-ui');
  });

  it('when the rubric is below the threshold, should warn rather than fail', () => {
    // given: a matched exemplar and a rubric of all 3s
    // when: G3b evaluates the route
    // then: the verdict warns with the total and per-dimension scores
    const result = evaluateG3b(
      g3bInput({
        rubricText: rubricBody({ layout: 3, type: 3, color: 3, states: 3, responsive: 3, a11y: 3 })
      })
    );

    expect(result.status).toBe('warn');
    expect(result.reason).toBe('below-threshold');
    expect(result.total).toBe(24);
    expect(result.dimensions?.layout).toBe(3);
  });

  it('when the rubric clears the threshold, should pass', () => {
    // given: a matched exemplar and a rubric of all 4s
    // when: G3b evaluates the route
    // then: the verdict passes with a total on the 40-point scale
    const result = evaluateG3b(
      g3bInput({
        rubricText: rubricBody({ layout: 4, type: 4, color: 4, states: 4, responsive: 4, a11y: 4 })
      })
    );

    expect(result.status).toBe('pass');
    expect(result.total).toBe(32);
    expect(result.reason).toBeUndefined();
  });
});

describe('Scenario: integration — the rubric is bound to the matched exemplar', () => {
  it('should refuse a rubric written for another archetype', () => {
    // given: a matched list exemplar and a rubric scored for the form archetype
    // when: G3b evaluates the route
    // then: the verdict blocks on DESIGN_RUBRIC_INVALID and names the archetype
    const result = evaluateG3b(
      g3bInput({
        rubricText: rubricBody(
          { layout: 4, type: 4, color: 4, states: 4, responsive: 4, a11y: 4 },
          { archetype: 'form' }
        )
      })
    );

    expect(result.status).toBe('blocked');
    expect(result.code).toBe('DESIGN_RUBRIC_INVALID');
    expect(result.message).toContain('archetype');
  });

  it('should carry the validator refusal verbatim', () => {
    // given: a rubric for another rid
    // when: G3b evaluates the route
    // then: the blocked message is the validator's own text
    const result = evaluateG3b(
      g3bInput({
        rubricText: rubricBody(
          { layout: 4, type: 4, color: 4, states: 4, responsive: 4, a11y: 4 },
          { rid: 'another-request' }
        )
      })
    );

    expect(result.status).toBe('blocked');
    expect(result.code).toBe('DESIGN_RUBRIC_INVALID');
    expect(result.message).toContain('another-request');
  });
});

describe('Scenario: a11y — a blocked rubric tells its writer what to fix', () => {
  it('should name the dimension the rubric forgot', () => {
    // given: a rubric without the responsive dimension
    // when: G3b evaluates the route
    // then: the blocked message names responsive so peaks-ui can complete it
    const result = evaluateG3b(
      g3bInput({ rubricText: rubricBody({ layout: 4, type: 4, color: 4, states: 4, a11y: 4 }) })
    );

    expect(result.status).toBe('blocked');
    expect(result.code).toBe('DESIGN_RUBRIC_INVALID');
    expect(result.message).toContain('responsive');
  });
});
