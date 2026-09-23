// tests/unit/shared/json-parse.test.ts
//
// 4-dimension unit test for `src/shared/json-parse.ts`, pinning the
// `tryParseJson` contract as of 2026-09-23 — the slice in which it stopped
// returning `T | null` and started returning the discriminated `TryParse<S>`.
//
// WHY THIS FILE EXISTS. The primitive had NO unit test of its own before this
// slice; it was covered only indirectly, through the `session/` `skills/`
// `sediment/` readers that call it. That is how a contract change large enough
// to require revisiting every caller could ship with the primitive itself
// unasserted. The four input classes below ARE the contract.
//
// Dimensions covered:
//   - render:    the exact key set of each variant (`{ok,value}` vs
//                `{ok,reason}`) — output shape only, no input variation
//   - behavior:  input -> outcome for all four classes, plus the boundaries
//                (empty string, whitespace, JSON `null`) and the property the
//                type exists for: the two failures stay distinguishable
//   - integration: OMITTED — the primitive takes a string and touches no fs,
//                process, network, clock or env. The fs boundary belongs to its
//                callers, not to it
//   - a11y:      OMITTED — it prints nothing and owns no exit code; the only
//                human-facing surface is the sibling `parseJson` throwing, and
//                that is asserted here as behaviour
//
// Run with: pnpm exec vitest run tests/unit/shared/

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/shared/json-parse.test.ts',
  ['render', 'behavior'],
  [
    {
      dim: 'integration',
      reason:
        'the primitive takes a string; it has no fs/process/network/clock/env boundary. That boundary belongs to its callers.'
    },
    {
      dim: 'a11y',
      reason:
        'it prints nothing and owns no exit code; the only human-facing surface is `parseJson` throwing, asserted under behavior.'
    }
  ]
);

import { parseJson, tryParseJson } from '../../../src/shared/json-parse.js';

/** The schema every case below is checked against. Deliberately small. */
const CounterSchema = z.object({ count: z.number() });

describe('Scenario: render — the shape of each TryParse variant', () => {
  it('when the text parses, should return exactly { ok, value }', () => {
    // given: text that is JSON and satisfies the schema
    // when:  the primitive is invoked
    // then:  the success variant carries those two keys and no others
    const out = tryParseJson('{"count":3}', CounterSchema);
    expect(Object.keys(out).sort()).toEqual(['ok', 'value']);
    expect(out).toMatchObject({ ok: true, value: { count: 3 } });
  });

  it('when the text does not parse, should return exactly { ok, reason }', () => {
    // given: text that is not JSON at all
    // when:  the primitive is invoked
    // then:  the failure variant carries those two keys and no others
    const out = tryParseJson('{ nope', CounterSchema);
    expect(Object.keys(out).sort()).toEqual(['ok', 'reason']);
    expect(out).toMatchObject({ ok: false, reason: 'malformed' });
  });
});

describe('Scenario: behavior — which failure is which', () => {
  it('when the text is JSON of the wrong shape, should report shape rather than malformed', () => {
    // given: valid JSON that the schema rejects
    // when:  the primitive is invoked
    // then:  `shape` is reported — NOT `malformed`
    expect(tryParseJson('{"count":"x"}', CounterSchema)).toEqual({ ok: false, reason: 'shape' });
  });

  it('when parsing fails, should keep malformed and shape distinguishable', () => {
    // given: one input per failure class
    // when:  both are parsed
    // then:  they are told apart — the property the discriminated result exists
    //        for, and the one a `T | null` return could not express
    const malformed = tryParseJson('not json', CounterSchema);
    const shape = tryParseJson('{"count":[]}', CounterSchema);
    expect(malformed).toEqual({ ok: false, reason: 'malformed' });
    expect(shape).toEqual({ ok: false, reason: 'shape' });
    expect(malformed).not.toEqual(shape);
  });

  it('when the text is the JSON literal null, should report shape', () => {
    // given: `JSON.parse` SUCCEEDS here — this is not a parse failure
    // when:  the primitive is invoked
    // then:  the schema is what rejected it, so the reason is `shape`
    expect(tryParseJson('null', CounterSchema)).toEqual({ ok: false, reason: 'shape' });
  });

  it('when the text is empty, should report malformed', () => {
    // given: the empty-string boundary
    // when:  the primitive is invoked
    // then:  it is a parse failure, not a schema failure
    expect(tryParseJson('', CounterSchema)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('when the text is whitespace only, should report malformed', () => {
    // given: the whitespace boundary
    // when:  the primitive is invoked
    // then:  it is a parse failure, not a schema failure
    expect(tryParseJson('   ', CounterSchema)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('when the sibling parseJson is given either failure, should throw on both', () => {
    // given: the two failure classes that `tryParseJson` now separates
    // when:  the throwing sibling is invoked
    // then:  it collapses them — which is exactly why the discriminated result
    //        had to exist, and why `parseJson` is the wrong reach for a caller
    //        that needs the pair apart
    expect(() => parseJson('not json', CounterSchema)).toThrow();
    expect(() => parseJson('{"count":"x"}', CounterSchema)).toThrow();
  });
});
