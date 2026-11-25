import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/design/route-observation.test.ts',
  ['render', 'behavior', 'a11y'],
  [
    {
      dim: 'integration',
      reason: 'the reader is a pure function over one parsed payload: no fs or network boundary'
    }
  ]
);

import { readRenderedIdentity } from '../../../src/services/design/route-observation.js';

/** The pilot sign-in payload shape: headings are empty, buttons and inputs are not. */
const PILOT_SIGNIN = {
  meta: { url: 'http://127.0.0.1:7423/channels', title: 'ModelMatrix' },
  voice: {
    sampleHeadings: [],
    buttonPatterns: [
      { value: '➔', count: 58 },
      { value: 'sign in', count: 1 }
    ]
  },
  components: { inputs: { count: 2 } },
  componentAnatomy: [
    {
      kind: 'button',
      variants: [{ sampleText: ['Sign in'] }, { sampleText: ['Go Back', 'Back to Home'] }]
    }
  ]
};

describe('Scenario: render — the payload maps to the observed identity', () => {
  it('when the pilot sign-in payload is read, should map every exposed field', () => {
    // given: the measured pilot payload with empty headings, buttons, inputs and anatomy text
    // when: the identity document is read
    // then: each field comes from its measured location and none is invented
    expect(readRenderedIdentity(PILOT_SIGNIN)).toEqual({
      observation: {
        title: 'ModelMatrix',
        buttonPatterns: ['➔', 'sign in'],
        sampleText: ['Sign in', 'Go Back', 'Back to Home'],
        renderedInputs: 2
      }
    });
  });

  it('when a heading sits in a semantic section, should keep it as a heading', () => {
    // given: a rendered page whose section heading is "No About Content Set"
    // when: the identity document is read
    // then: the heading is exposed and no other field is invented
    const document = readRenderedIdentity({
      meta: { title: 'ModelMatrix' },
      voice: { sampleHeadings: ['No About Content Set'] }
    });
    expect(document.observation).toEqual({
      title: 'ModelMatrix',
      headings: ['No About Content Set']
    });
  });
});

describe('Scenario: behavior — a missing field is absent, never guessed', () => {
  it('when the payload carries none of the observed fields, should return an empty observation', () => {
    // given: an empty payload
    // when: the identity document is read
    // then: the title is null and the observation carries no field at all
    expect(readRenderedIdentity({})).toEqual({ observation: {} });
  });

  it('when only meta.url is present, should not mistake the request URL for a title', () => {
    // given: a payload whose only meta value is the requested URL
    // when: the identity document is read
    // then: meta.url is never read and no identity is invented
    expect(readRenderedIdentity({ meta: { url: 'http://127.0.0.1:7423/sign-in' } })).toEqual({
      observation: {}
    });
  });

  it('when a button or a sample text has the wrong shape, should drop only that entry', () => {
    // given: button records without a string value and anatomy variants with no text
    // when: the identity document is read
    // then: the usable values survive and the malformed ones add nothing
    const document = readRenderedIdentity({
      voice: { buttonPatterns: [{ value: '' }, { value: 3 }, 'sign in', { value: 'back' }] },
      componentAnatomy: [{ variants: [{ sampleText: 'not-an-array' }, {}] }, { variants: null }]
    });
    expect(document.observation).toEqual({ buttonPatterns: ['back'] });
  });

  it('when the input count is not a finite number, should leave renderedInputs absent', () => {
    // given: input counts written as a string, null, NaN and Infinity
    // when: each identity document is read
    // then: none is turned into a count, because an unusable field stays absent
    for (const count of ['2', null, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        readRenderedIdentity({ components: { inputs: { count } } }).observation,
        String(count)
      ).toEqual({});
    }
  });

  it('when a list mixes usable headings with blanks and non-strings, should keep only the text', () => {
    // given: a headings list mixing real text with an empty string, blanks, a number and null
    // when: the identity document is read
    // then: only the non-empty strings survive, in their original order
    const document = readRenderedIdentity({
      voice: { sampleHeadings: ['Reconciliation', '', '   ', 3, null] }
    });
    expect(document.observation).toEqual({ headings: ['Reconciliation'] });
  });

  it('when a payload branch is explicitly null, should treat it as absent', () => {
    // given: a payload whose meta, voice and components are all null
    // when: the identity document is read
    // then: every branch is absent and no field is guessed or thrown over
    expect(readRenderedIdentity({ meta: null, voice: null, components: null })).toEqual({
      observation: {}
    });
  });

  it('when the title is not a non-empty string, should leave it absent', () => {
    // given: titles written as a number, an empty string and only whitespace
    // when: each identity document is read
    // then: none is echoed as a title and no other field is invented
    for (const title of [3, '', '   ']) {
      expect(readRenderedIdentity({ meta: { title } }).observation, String(title)).toEqual({});
    }
  });
});

describe('Scenario: a11y — every mapping names its payload location', () => {
  it('when a heading is read, should not also treat it as button or sample text', () => {
    // given: a heading-only payload
    // when: the identity document is read
    // then: each surface stays separate so a block can name where it found the text
    const document = readRenderedIdentity({ voice: { sampleHeadings: ['Sign in'] } });
    expect(document.observation.headings).toEqual(['Sign in']);
    expect(document.observation.buttonPatterns).toBeUndefined();
    expect(document.observation.sampleText).toBeUndefined();
  });
});
