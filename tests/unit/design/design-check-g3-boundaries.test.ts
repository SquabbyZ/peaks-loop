import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import type { ExemplarEntry } from '../../../src/services/design/exemplars.js';
import type { FidelityRunResult } from '../../../src/services/design/fidelity.js';
import {
  type EvaluateG3aInput,
  type G3ADeps,
  evaluateG3a,
  evaluateG3b,
  readBaselineState,
  routeSlug
} from '../../../src/services/design/design-check-g3.js';

import type * as G3ModuleTypes from '../../../src/services/design/design-check-g3.js';

type G3Module = typeof G3ModuleTypes;

declareDimensions('tests/unit/design/design-check-g3-boundaries.test.ts', [
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

const EXEMPLAR: ExemplarEntry = {
  archetype: 'list',
  route: ROUTE,
  sourceFile: 'design/exemplars/list/list.tsx',
  screenshotPath: null,
  metaPath: 'design/exemplars/list/meta.json'
};

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

function makeStore(): string {
  const dir = mkdtempSync(join(tmpdir(), 'peaks-g3-b-'));
  roots.push(dir);
  return dir;
}

function writeEntry(storeDir: string, body: unknown): void {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  writeFileSync(join(storeDir, `${routeSlug(ROUTE)}.json`), text, 'utf8');
}

function okResult(score = 92): FidelityRunResult {
  return {
    ok: true,
    score,
    visual: 91,
    motion: 94,
    grade: 'A',
    generatedAt: '2026-11-24T00:00:00.000Z',
    reportPath: 'fidelity.json'
  };
}

function depsFor(result: FidelityRunResult): G3ADeps {
  return { fidelity: async () => result };
}

function inputFor(storeDir: string, overrides: Partial<EvaluateG3aInput> = {}): EvaluateG3aInput {
  return {
    storeDir,
    route: ROUTE,
    candidateUrl: CANDIDATE,
    deps: depsFor(okResult()),
    ...overrides
  };
}

/**
 * The SUT is imported per test after `vi.resetModules()` so its module-level
 * constants (the slug regexes and the default slug) initialise INSIDE a test
 * body, where Stryker's per-test coverage can schedule a mutant.
 */
async function loadG3(): Promise<G3Module> {
  vi.resetModules();
  return import('../../../src/services/design/design-check-g3.js');
}

describe('Scenario: behavior — the baseline fields must be non-empty strings', () => {
  it('should refuse an empty, blank or non-string baseCommit', () => {
    // given: three recorded baselines whose baseCommit is unusable
    // when: each store is read
    // then: each issue is the exact base-commit-missing reason, not an accepted entry
    for (const baseCommit of ['', '   ', 5]) {
      const store = makeStore();
      writeEntry(store, { ...ENTRY, baseCommit });

      const read = readBaselineState(store, ROUTE);

      expect(read.entry).toBeNull();
      expect(read.issue?.reason).toBe('base-commit-missing');
    }
  });

  it('should refuse an empty or null baselineUrl', () => {
    // given: two recorded baselines whose baselineUrl is unusable
    // when: each store is read
    // then: each issue is the exact baseline-url-missing reason
    for (const baselineUrl of ['', null]) {
      const store = makeStore();
      writeEntry(store, { ...ENTRY, baselineUrl });

      const read = readBaselineState(store, ROUTE);

      expect(read.entry).toBeNull();
      expect(read.issue?.reason).toBe('baseline-url-missing');
    }
  });

  it('should trim both recorded field values into the entry', () => {
    // given: a baseline whose commit and URL are padded with spaces
    // when: the store is read
    // then: the entry carries the trimmed values, not the raw fields
    const store = makeStore();
    writeEntry(store, { ...ENTRY, baseCommit: '  abc1234  ', baselineUrl: `  ${BASELINE}  ` });

    const read = readBaselineState(store, ROUTE);

    expect(read.entry).toEqual(ENTRY);
  });
});

describe('Scenario: behavior — a baseline body that is not a JSON object', () => {
  it('should record not-an-object for every non-object top level', () => {
    // given: baseline files that hold an array, null, a number and a boolean
    // when: each store is read
    // then: every one is the exact not-an-object issue
    for (const body of ['[]', 'null', '42', 'true']) {
      const store = makeStore();
      writeEntry(store, body);

      const read = readBaselineState(store, ROUTE);

      expect(read.entry).toBeNull();
      expect(read.issue?.reason).toBe('not-an-object');
    }
  });
});

describe('Scenario: render — the route slug the baseline file is named from', () => {
  it('should map the root route and collapse separators on a fresh import', async () => {
    // given: a module imported after a reset, so the slug regexes are built now
    // when: the root, an uppercase route and a doubled-separator route are slugged
    // then: the slug is lowercased, collapsed and trimmed at both edges
    const fresh = await loadG3();

    expect(fresh.routeSlug('/')).toBe('root');
    expect(fresh.routeSlug('/Features//CHANNELS')).toBe('features-channels');
    expect(fresh.routeSlug('/--drafts--/a_b')).toBe('drafts-a-b');
    expect(fresh.routeSlug('/a b?x=1#y')).toBe('a-b');
  });
});

describe('Scenario: integration — the threshold boundary in G3a', () => {
  it('should pass at exactly the minimum and fail one point below', async () => {
    // given: fidelity scores equal to and one below the default 90 minimum
    // when: G3a evaluates each against an explicit baseline URL
    // then: the score at the minimum passes and one point below fails
    const explicit = 'http://127.0.0.1:4311/explicit';

    const atMin = await evaluateG3a(
      inputFor(makeStore(), { baselineUrl: explicit, deps: depsFor(okResult(90)) })
    );
    const below = await evaluateG3a(
      inputFor(makeStore(), { baselineUrl: explicit, deps: depsFor(okResult(89)) })
    );

    expect(atMin.status).toBe('pass');
    expect(below.status).toBe('fail');
  });
});

describe('Scenario: a11y — the refusal text is the exact text a reader fixes from', () => {
  it('should pin the invalid-threshold message with the refused value', async () => {
    // given: a fractional threshold and a store with a valid baseline
    // when: G3a evaluates the route
    // then: the blocked message is the full pinned sentence
    const store = makeStore();
    writeEntry(store, ENTRY);

    const result = await evaluateG3a(inputFor(store, { min: 1.5 }));

    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.code).toBe('DESIGN_FIDELITY_MIN_INVALID');
      expect(result.message).toBe('The G3a threshold must be an integer 0..100; refusing 1.5.');
    }
  });

  it('should pin the missing-rubric message for the route and archetype', () => {
    // given: a matched exemplar and no rubric text
    // when: G3b evaluates the route
    // then: the blocked message names the route, the archetype and who writes the rubric
    const result = evaluateG3b({
      rubricText: null,
      rid: 'r1',
      route: ROUTE,
      exemplar: EXEMPLAR
    });

    expect(result.status).toBe('blocked');
    expect(result.code).toBe('DESIGN_RUBRIC_MISSING');
    expect(result.message).toBe(
      `No archetype rubric was written for ${ROUTE} against the list exemplar. ` +
        'The peaks-ui role writes the rubric JSON under the session design directory; the CLI ' +
        'validates it and never scores aesthetics itself.'
    );
  });
});
