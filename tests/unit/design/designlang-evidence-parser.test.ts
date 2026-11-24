import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  evidenceRefusal,
  isEvidenceObject,
  parseJsonObject,
  type EvidenceExpectation
} from '../../../src/services/design/designlang-evidence.js';

declareDimensions(
  'tests/unit/design/designlang-evidence-parser.test.ts',
  ['behavior', 'a11y'],
  [
    {
      dim: 'render',
      reason: 'the module returns refusal strings and parsed records, not render output'
    },
    { dim: 'integration', reason: 'no filesystem, clock, process or network boundary is crossed' }
  ]
);

const URL = 'http://127.0.0.1:4321/';
const TOKENS = resolve('/tmp/app/design/tokens.json');
const EXPECT: EvidenceExpectation = { url: URL, tokensFile: TOKENS };

/** A complete drift payload; overrides replace one field at a time. */
function drift(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    url: URL,
    tokensFile: TOKENS,
    verdict: 'in-sync',
    driftRatio: 0,
    drifted: [],
    matched: [{ token: 'color.primary' }],
    summary: { total: 1, drifted: 0, matched: 1 },
    ...overrides
  };
}

describe('Scenario: behavior — the evidence-object shape', () => {
  it('when the value is a non-empty plain object, should accept only that shape', () => {
    // given: scalars, null, arrays, an empty object and a populated object
    // when: each is tested
    // then: only a non-empty non-array object is evidence
    for (const value of [null, undefined, 0, 'x', true, [], [1], {}]) {
      expect(isEvidenceObject(value), JSON.stringify(value)).toBe(false);
    }
    expect(isEvidenceObject({ a: 1 })).toBe(true);
    expect(isEvidenceObject({ a: undefined })).toBe(true);
  });
});

describe('Scenario: behavior — drift evidence is verdict, ratio, arithmetic, provenance', () => {
  it('when the ratio is exactly 0 or exactly 1, should accept both boundaries', () => {
    // given: the two ends of drift's own proportion
    // when: each is judged
    // then: a valid proportion is accepted and nothing beyond it is
    expect(evidenceRefusal('drift', drift({ driftRatio: 0 }), EXPECT)).toBeNull();
    expect(evidenceRefusal('drift', drift({ driftRatio: 1 }), EXPECT)).toBeNull();
    expect(evidenceRefusal('drift', drift({ driftRatio: 1.0001 }), EXPECT)).toBe(
      'drift driftRatio was not a finite number in 0..1.'
    );
    expect(evidenceRefusal('drift', drift({ driftRatio: -0.0001 }), EXPECT)).toBe(
      'drift driftRatio was not a finite number in 0..1.'
    );
  });

  it('when the ratio is NaN, Infinity or a string, should refuse each as non-finite', () => {
    // given: three representations that are not a finite number
    // when: each is judged
    // then: the ratio refusal is the same sentence every time
    for (const driftRatio of [Number.NaN, Number.POSITIVE_INFINITY, '0.5']) {
      expect(evidenceRefusal('drift', drift({ driftRatio }), EXPECT), String(driftRatio)).toBe(
        'drift driftRatio was not a finite number in 0..1.'
      );
    }
  });

  it('when the verdict is outside the four real values, should name the allowed set', () => {
    // given: an unknown verdict and a case variant of a real one
    // when: each is judged
    // then: the refusal spells every documented value
    expect(evidenceRefusal('drift', drift({ verdict: 'looks-fine' }), EXPECT)).toBe(
      'drift verdict looks-fine was not one of in-sync, minor-drift, notable-drift, major-drift.'
    );
    expect(evidenceRefusal('drift', drift({ verdict: 'In-Sync' }), EXPECT)).toContain(
      'was not one of in-sync, minor-drift, notable-drift, major-drift.'
    );
  });

  it('when the summary total is not an integer of at least one, should refuse each shape', () => {
    // given: total 0, 1.5, -1, and a non-numeric string
    // when: each is judged
    // then: a comparison of nothing is never evidence
    for (const total of [0, 1.5, -1, '2']) {
      expect(
        evidenceRefusal('drift', drift({ summary: { total, drifted: 0, matched: 0 } }), EXPECT),
        String(total)
      ).toBe('drift summary.total was not an integer >= 1.');
    }
  });

  it('when the summary is absent or not an object, should refuse it by name', () => {
    // given: no summary and a summary that is a string
    // when: each is judged
    // then: the missing object is refused before any arithmetic
    for (const summary of [undefined, 'nope']) {
      expect(evidenceRefusal('drift', drift({ summary }), EXPECT)).toBe(
        'drift summary was not an object.'
      );
    }
  });

  it('when a drifted or matched count is missing, should refuse instead of inventing zero', () => {
    // given: a payload with no arrays and a summary missing matched
    // when: it is judged
    // then: the absent count is refused by its own sentence
    const payload = {
      url: URL,
      tokensFile: TOKENS,
      verdict: 'in-sync',
      driftRatio: 0,
      summary: { total: 1, drifted: 0 }
    };
    expect(evidenceRefusal('drift', payload, EXPECT)).toBe(
      'drift payload carried no drifted/matched counts.'
    );
  });

  it('when both lists and summary counts exist, should let the lists win', () => {
    // given: one drifted and one matched list against agreeing summary counts
    // when: the payload is judged
    // then: the arrays decide and the arithmetic holds
    expect(
      evidenceRefusal(
        'drift',
        drift({
          drifted: [{ token: 'a' }],
          matched: [{ token: 'b' }],
          summary: { total: 2, drifted: 1, matched: 1 }
        }),
        EXPECT
      )
    ).toBeNull();
    expect(
      evidenceRefusal(
        'drift',
        drift({
          drifted: [{ token: 'a' }],
          matched: [],
          summary: { total: 2, drifted: 1, matched: 1 }
        }),
        EXPECT
      )
    ).toBe('drift summary.total 2 did not equal drifted 1 + matched 0.');
  });

  it('when the lists are absent, should count the summary fields instead', () => {
    // given: a payload whose only counts live in its summary
    // when: it is judged
    // then: the summary counts are accepted when they add up
    const payload = {
      url: URL,
      tokensFile: TOKENS,
      verdict: 'in-sync',
      driftRatio: 0,
      summary: { total: 2, drifted: 0, matched: 2 }
    };
    expect(evidenceRefusal('drift', payload, EXPECT)).toBeNull();
  });

  it('when provenance is missing from the expectation or payload, should refuse it', () => {
    // given: no expectation, a partial expectation, and a mismatched page
    // when: each is judged
    // then: drift refuses rather than accepting unchecked provenance
    expect(evidenceRefusal('drift', drift(), undefined)).toBe(
      'the drift check needs the requested url and tokens file to verify the payload echo.'
    );
    expect(evidenceRefusal('drift', drift(), { url: URL })).toBe(
      'the drift check needs the requested url and tokens file to verify the payload echo.'
    );
    expect(evidenceRefusal('drift', drift(), { tokensFile: TOKENS })).toBe(
      'the drift check needs the requested url and tokens file to verify the payload echo.'
    );
    expect(evidenceRefusal('drift', drift({ url: 'http://127.0.0.1:1/other' }), EXPECT)).toBe(
      `drift url http://127.0.0.1:1/other did not echo the requested page ${URL}.`
    );
  });

  it('when the echoed tokens file is wrong or not a string, should refuse it', () => {
    // given: another path and a numeric value
    // when: each is judged
    // then: the echoed tokens file must resolve to the one that was passed
    expect(evidenceRefusal('drift', drift({ tokensFile: '/tmp/other/tokens.json' }), EXPECT)).toBe(
      'drift tokensFile /tmp/other/tokens.json did not echo the tokens file passed to it.'
    );
    expect(evidenceRefusal('drift', drift({ tokensFile: 42 }), EXPECT)).toBe(
      'drift tokensFile 42 did not echo the tokens file passed to it.'
    );
  });
});

describe('Scenario: behavior — verify-ui, slop and grade keep their own shapes', () => {
  it('when verify-ui carries a boolean and a finite score, should accept it', () => {
    // given: pass false with an onBrand score of zero
    // when: it is judged
    // then: false is a real verdict and zero is a real finite score
    expect(evidenceRefusal('verify-ui', { pass: false, onBrand: 0 })).toBeNull();
    expect(evidenceRefusal('verify-ui', { pass: true, onBrand: 99 })).toBeNull();
  });

  it('when verify-ui lacks a boolean or a finite score, should refuse each', () => {
    // given: a string pass, a missing pass, and non-finite scores
    // when: each is judged
    // then: each field has its own refusal sentence
    expect(evidenceRefusal('verify-ui', { pass: 'true', onBrand: 9 })).toBe(
      'verify-ui payload had no boolean pass.'
    );
    expect(evidenceRefusal('verify-ui', { onBrand: 9 })).toBe(
      'verify-ui payload had no boolean pass.'
    );
    for (const onBrand of [Number.NaN, Number.POSITIVE_INFINITY, '9', undefined]) {
      expect(evidenceRefusal('verify-ui', { pass: true, onBrand }), String(onBrand)).toBe(
        'verify-ui payload had no finite onBrand score.'
      );
    }
  });

  it('when slop nests its score in generic, should prefer that score over the top level', () => {
    // given: a generic score and a non-object generic beside a top-level score
    // when: each is judged
    // then: the nested score wins and the top-level one is the fallback shape
    expect(evidenceRefusal('slop', { readAt: 't', generic: { score: 18 } })).toBeNull();
    expect(evidenceRefusal('slop', { readAt: 't', score: 18 })).toBeNull();
    expect(evidenceRefusal('slop', { readAt: 't', generic: { score: 'x' }, score: 18 })).toBe(
      'slop payload had no finite score.'
    );
  });

  it('when slop has no finite score or no non-empty readAt, should refuse each', () => {
    // given: a missing score, a blank readAt, and a numeric readAt
    // when: each is judged
    // then: both the score and the timestamp are required
    expect(evidenceRefusal('slop', { readAt: 't' })).toBe('slop payload had no finite score.');
    for (const readAt of [undefined, '', '   ', 5]) {
      expect(evidenceRefusal('slop', { readAt, generic: { score: 1 } }), String(readAt)).toBe(
        'slop payload had no readAt timestamp.'
      );
    }
  });

  it('when grade has a real stamp or pages list, should accept only those', () => {
    // given: a timestamp, a non-empty pages list, and the shapes without either
    // when: each is judged
    // then: grade keeps the written-report rule unchanged
    expect(evidenceRefusal('grade', { generatedAt: 't' })).toBeNull();
    expect(evidenceRefusal('grade', { pages: [1] })).toBeNull();
    for (const payload of [
      { generatedAt: '' },
      { generatedAt: '   ' },
      { generatedAt: 7 },
      { pages: [] },
      { pages: 'x' },
      { overall: 'A' }
    ]) {
      expect(evidenceRefusal('grade', payload), JSON.stringify(payload)).toBe(
        'stdout carried no generatedAt timestamp or pages list.'
      );
    }
  });

  it('when stats evidence is requested, should refuse it by name', () => {
    // given: the stats kind, which emits no verdict document
    // when: it is judged
    // then: the refusal says stats is a probe, not evidence
    expect(evidenceRefusal('stats', { fontFamilyCount: 1 })).toBe(
      'designlang stats is a usability probe, not a verdict document.'
    );
  });
});

describe('Scenario: behavior — parseJsonObject recovers the tool document from noise', () => {
  it('when a JSON object is surrounded by log lines, should recover the object', () => {
    // given: a browser log line before and a trailer after the document
    // when: the stream is parsed
    // then: the embedded object is returned instead of a refusal
    expect(parseJsonObject('Launching browser...\n{"a":1}\nDone.')).toEqual({ a: 1 });
  });

  it('when several objects appear, should return the last parseable one', () => {
    // given: two valid objects and one invalid trailing block
    // when: the stream is parsed
    // then: the last complete object wins and an incomplete tail is ignored
    expect(parseJsonObject('{"a":1} {"b":2}')).toEqual({ b: 2 });
    expect(parseJsonObject('{"a":1} junk {"b":2')).toEqual({ a: 1 });
  });

  it('when braces and quotes live inside strings, should not mistake them for structure', () => {
    // given: an object whose string value contains a closing brace and a quote
    // when: the stream is parsed
    // then: the string is skipped as one token
    const doc = { note: 'a } " b { c', nested: { deep: true } };
    expect(parseJsonObject(`log ${JSON.stringify(doc)} tail`)).toEqual(doc);
  });

  it('when the stream is empty or holds only a non-object, should return null', () => {
    // given: blank text, scalars, an array, an empty object and stray braces
    // when: each is parsed
    // then: only a non-empty object is ever evidence
    for (const text of ['', '   ', 'null', '42', '"x"', '[]', '{}', 'log {} tail', 'not json']) {
      expect(parseJsonObject(text), JSON.stringify(text)).toBeNull();
    }
  });

  it('when a string or block never closes, should not emit a partial object', () => {
    // given: an unterminated string and an unterminated object
    // when: each is parsed
    // then: no partial document is invented
    expect(parseJsonObject('log {"a":"unterminated')).toBeNull();
    expect(parseJsonObject('{"a":1')).toBeNull();
    expect(parseJsonObject('}} {"a":1}')).toEqual({ a: 1 });
  });
});
