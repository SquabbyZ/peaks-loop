import { describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  RUBRIC_DIMENSIONS,
  readRubric,
  rubricVerdict
} from '../../../src/services/design/rubric.js';

import type * as RubricModuleTypes from '../../../src/services/design/rubric.js';

type RubricModule = typeof RubricModuleTypes;

/**
 * The SUT is imported per test after `vi.resetModules()` so its module-level
 * constants (RAW_MAX, the calibration scale) initialise INSIDE a test body.
 * Under Stryker's per-test coverage a module-scope initialiser runs before any
 * test, so a mutant in it would read as unexecuted.
 */
async function loadRubric(): Promise<RubricModule> {
  vi.resetModules();
  return import('../../../src/services/design/rubric.js');
}

declareDimensions(
  'tests/unit/design/rubric.test.ts',
  ['behavior', 'render', 'a11y'],
  [
    {
      dim: 'integration',
      reason:
        'readRubric validates text handed in by the caller; it touches no filesystem, subprocess or clock.'
    }
  ]
);

const RID = 'peaks-design-s4';
const ARCHETYPE = 'list';
const EXPECTED = { rid: RID, archetype: ARCHETYPE };

const PERFECT = { layout: 5, type: 5, color: 5, states: 5, responsive: 5, a11y: 5 };
const UNIFORM_FOUR = { layout: 4, type: 4, color: 4, states: 4, responsive: 4, a11y: 4 };
const MIXED = { layout: 2, type: 5, color: 5, states: 5, responsive: 5, a11y: 5 };

function rubricText(dimensions: unknown, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 1,
    rid: RID,
    archetype: ARCHETYPE,
    dimensions,
    ...overrides
  });
}

describe('Scenario: behavior — a valid rubric reads and the recorded threshold decides', () => {
  it('when every dimension is a 5, should read a perfect total and minimum', () => {
    // given: a well-formed rubric scoring all six dimensions 5
    // when: it is read against the request and archetype it names
    // then: the read succeeds with a 40 total and a 5 minimum dimension
    const read = readRubric(rubricText(PERFECT), EXPECTED);

    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.total).toBe(40);
      expect(read.minDimension).toBe(5);
      expect(read.rubric.dimensions).toEqual(PERFECT);
    }
  });

  it('when the total sits at the threshold boundary, should pass at 32 and warn at 31', () => {
    // given: totals one below and exactly at the recorded threshold
    // when: the advisory verdict is computed
    // then: 31 warns and 32 passes, with nothing below the 3 floor
    expect(rubricVerdict(31, 4)).toBe('warn');
    expect(rubricVerdict(32, 4)).toBe('pass');
  });

  it('when a uniform 4 is read, should land exactly on the threshold and pass', () => {
    // given: a rubric scoring every dimension 4
    // when: the rubric is read and its verdict computed
    // then: the normalised total is 32 and the verdict passes
    const read = readRubric(rubricText(UNIFORM_FOUR), EXPECTED);

    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.total).toBe(32);
      expect(read.minDimension).toBe(4);
      expect(rubricVerdict(read.total, read.minDimension)).toBe('pass');
    }
  });

  it('when one dimension is a 2, should warn despite a total above the threshold', () => {
    // given: five dimensions at 5 and one at 2
    // when: the rubric is read and its verdict computed
    // then: the total clears 32 but the 2 floor forces a warn
    const read = readRubric(rubricText(MIXED), EXPECTED);

    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.total).toBe(36);
      expect(read.minDimension).toBe(2);
      expect(rubricVerdict(read.total, read.minDimension)).toBe('warn');
    }
  });

  it('when the body is not JSON, should refuse it', () => {
    // given: a truncated rubric envelope
    // when: it is read
    // then: the read fails with DESIGN_RUBRIC_INVALID and names JSON
    const read = readRubric('{ "schemaVersion": 1,', EXPECTED);

    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.code).toBe('DESIGN_RUBRIC_INVALID');
      expect(read.message).toContain('JSON');
    }
  });

  it('when the body is not a JSON object, should refuse it', () => {
    // given: a rubric whose body is a JSON array
    // when: it is read
    // then: the read fails and asks for the envelope object
    const read = readRubric('[]', EXPECTED);

    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.message).toContain('JSON object');
  });

  it('when schemaVersion is not 1, should refuse it', () => {
    // given: a rubric written with schemaVersion 2
    // when: it is read
    // then: the read fails and names the expected schemaVersion
    const read = readRubric(rubricText(PERFECT, { schemaVersion: 2 }), EXPECTED);

    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.code).toBe('DESIGN_RUBRIC_INVALID');
      expect(read.message).toContain('schemaVersion');
    }
  });

  it('when the rid differs, should refuse to re-attribute the rubric', () => {
    // given: a rubric written for another request
    // when: it is read for this rid
    // then: the read fails and names the rid mismatch
    const read = readRubric(rubricText(PERFECT, { rid: 'another-request' }), EXPECTED);

    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.message).toContain('rid');
  });

  it('when the archetype differs, should refuse to re-attribute the rubric', () => {
    // given: a rubric scored against another archetype
    // when: it is read for the matched exemplar's archetype
    // then: the read fails and names the archetype mismatch
    const read = readRubric(rubricText(PERFECT, { archetype: 'form' }), EXPECTED);

    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.code).toBe('DESIGN_RUBRIC_INVALID');
      expect(read.message).toContain('archetype');
    }
  });

  it('when a dimension is missing, should refuse the incomplete rubric', () => {
    // given: a rubric without the a11y dimension
    // when: it is read
    // then: the read fails and names the missing dimension
    const incomplete = { layout: 5, type: 5, color: 5, states: 5, responsive: 5 };

    const read = readRubric(rubricText(incomplete), EXPECTED);

    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.message).toContain('a11y');
  });

  it('when dimensions is not an object, should refuse it', () => {
    // given: a rubric whose dimensions are an array
    // when: it is read
    // then: the read fails and asks for the dimensions object
    const read = readRubric(rubricText([]), EXPECTED);

    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.message).toContain('dimensions');
  });

  it('when a score is outside the 1..5 integer range, should refuse it', () => {
    // given: rubrics scoring layout as 6, 0 and 3.5
    // when: each is read
    // then: each read fails, names layout and repeats the accepted range
    for (const score of [6, 0, 3.5]) {
      const read = readRubric(rubricText({ ...PERFECT, layout: score }), EXPECTED);

      expect(read.ok).toBe(false);
      if (!read.ok) {
        expect(read.code).toBe('DESIGN_RUBRIC_INVALID');
        expect(read.message).toContain('layout');
        expect(read.message).toContain('1..5');
      }
    }
  });
});

describe('Scenario: render — the rubric envelope the reader returns', () => {
  it('should keep the schema version and drop unknown dimension keys', () => {
    // given: a valid rubric carrying an extra dimension the contract does not name
    // when: it is read
    // then: the returned envelope is version 1 and holds exactly the six dimensions
    const read = readRubric(rubricText({ ...PERFECT, motion: 5 }), EXPECTED);

    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.rubric.schemaVersion).toBe(1);
      expect(Object.keys(read.rubric.dimensions).sort()).toEqual([...RUBRIC_DIMENSIONS].sort());
      expect(read.rubric.dimensions.a11y).toBe(5);
    }
  });

  it('should bind the returned envelope to the expected rid and archetype', () => {
    // given: a valid rubric for this request and archetype
    // when: it is read
    // then: the returned envelope echoes the expected identifiers
    const read = readRubric(rubricText(PERFECT), EXPECTED);

    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.rubric.rid).toBe(RID);
      expect(read.rubric.archetype).toBe(ARCHETYPE);
    }
  });
});

describe('Scenario: a11y — a refusal tells its reader what to regenerate', () => {
  it('should name the dimension that was scored outside the scale', () => {
    // given: a rubric scoring color as 9
    // when: it is read
    // then: the message names color and the accepted range
    const read = readRubric(rubricText({ ...PERFECT, color: 9 }), EXPECTED);

    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.message).toContain('color');
      expect(read.message).toContain('1..5');
      expect(read.message).toContain('9');
    }
  });

  it('should carry the same code on every refusal', () => {
    // given: a malformed body and a foreign archetype
    // when: each is read
    // then: both refusals carry DESIGN_RUBRIC_INVALID for the caller to surface
    const notJson = readRubric('not json', EXPECTED);
    const foreign = readRubric(rubricText(PERFECT, { archetype: 'form' }), EXPECTED);

    expect(notJson.ok).toBe(false);
    expect(foreign.ok).toBe(false);
    if (!notJson.ok) expect(notJson.code).toBe('DESIGN_RUBRIC_INVALID');
    if (!foreign.ok) expect(foreign.code).toBe('DESIGN_RUBRIC_INVALID');
  });
});

describe('Scenario: behavior — the score scale is inclusive at both ends', () => {
  it('when every dimension is a 1, should accept the lowest legal score', () => {
    // given: a rubric scoring every dimension at the bottom of the 1..5 scale
    // when: it is read
    // then: the read succeeds with a minimum of 1 and the normalised total of 8
    const read = readRubric(
      rubricText({ layout: 1, type: 1, color: 1, states: 1, responsive: 1, a11y: 1 }),
      EXPECTED
    );

    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.minDimension).toBe(1);
      expect(read.total).toBe(8);
    }
  });

  it('when a score is a numeric string or a boolean, should refuse it', () => {
    // given: scores that are not numbers although they sit inside 1..5
    // when: each is read
    // then: every read is refused and names the offending dimension
    for (const score of ['4', true]) {
      const read = readRubric(rubricText({ ...PERFECT, states: score }), EXPECTED);

      expect(read.ok).toBe(false);
      if (!read.ok) expect(read.message).toContain('states');
    }
  });

  it('when the minimum dimension is exactly 3, should still pass', () => {
    // given: a total at the threshold whose floor dimension is exactly the 3 floor
    // when: the advisory verdict is computed
    // then: 3 passes and 2 warns, so the floor is inclusive
    expect(rubricVerdict(40, 3)).toBe('pass');
    expect(rubricVerdict(40, 2)).toBe('warn');
  });
});

describe('Scenario: behavior — a body that is valid JSON but not an envelope', () => {
  it('when the body is a primitive or an array, should name the object contract', () => {
    // given: JSON documents whose top level is null, a number, a string, a boolean or an array
    // when: each is read
    // then: each refusal is the exact object-contract message, not a field complaint
    const expected =
      'The design rubric must be a JSON object with schemaVersion, rid, archetype and dimensions.';
    for (const body of ['null', '42', '"text"', 'true', '[]']) {
      const read = readRubric(body, EXPECTED);

      expect(read.ok).toBe(false);
      if (!read.ok) {
        expect(read.code).toBe('DESIGN_RUBRIC_INVALID');
        expect(read.message).toBe(expected);
      }
    }
  });

  it('when dimensions is null or a number, should name the dimensions contract', () => {
    // given: an otherwise valid envelope whose dimensions are not an object
    // when: each is read
    // then: the refusal is the exact dimensions-object message
    const expected =
      'The design rubric needs a dimensions object scoring layout, type, color, states, responsive and a11y.';
    for (const dimensions of [null, 42, 'layout']) {
      const read = readRubric(rubricText(dimensions), EXPECTED);

      expect(read.ok).toBe(false);
      if (!read.ok) expect(read.message).toBe(expected);
    }
  });
});

describe('Scenario: a11y — the refusal text is the exact text a writer fixes from', () => {
  it('should pin the JSON, schema, rid, archetype and missing-dimension messages', () => {
    // given: one rubric per refusal reason
    // when: each is read
    // then: every message is the full pinned sentence the writer acts on
    const cases: Array<{ body: string; message: string }> = [
      {
        body: '{ "schemaVersion": 1,',
        message:
          'The design rubric is not valid JSON; peaks-ui must write the rubric envelope as strict JSON.'
      },
      {
        body: rubricText(PERFECT, { schemaVersion: 2 }),
        message:
          "The design rubric's schemaVersion must be 1; regenerate the envelope with schemaVersion 1."
      },
      {
        body: rubricText(PERFECT, { rid: 'another-request' }),
        message:
          'The design rubric names rid another-request but this check is for peaks-design-s4; write the rubric for this request.'
      },
      {
        body: rubricText(PERFECT, { archetype: 'form' }),
        message:
          "The design rubric names archetype form but the route's exemplar is list; score the matched archetype."
      },
      {
        body: rubricText({ layout: 5, type: 5, color: 5, states: 5, responsive: 5 }),
        message: 'The design rubric is missing the a11y dimension; all 6 dimensions are required.'
      }
    ];

    for (const entry of cases) {
      const read = readRubric(entry.body, EXPECTED);

      expect(read.ok).toBe(false);
      if (!read.ok) expect(read.message).toBe(entry.message);
    }
  });
});

describe('Scenario: render — the module constants initialise inside the test', () => {
  it('should scale a raw sum to the 40-point calibration scale on a fresh import', async () => {
    // given: a rubric module imported after a module reset, so RAW_MAX is computed now
    // when: a uniform 4 and a perfect rubric are read
    // then: the totals are 32 and 40 on the recorded calibration scale
    const fresh = await loadRubric();
    const uniform = fresh.readRubric(rubricText(UNIFORM_FOUR), EXPECTED);
    const perfect = fresh.readRubric(rubricText(PERFECT), EXPECTED);

    expect(uniform.ok).toBe(true);
    expect(perfect.ok).toBe(true);
    if (uniform.ok) expect(uniform.total).toBe(32);
    if (perfect.ok) expect(perfect.total).toBe(40);
  });
});
