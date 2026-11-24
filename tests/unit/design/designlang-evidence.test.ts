import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/design/designlang-evidence.test.ts',
  ['behavior'],
  [
    { dim: 'render', reason: 'the parser returns evidence records, not render artifacts' },
    { dim: 'integration', reason: 'the parser has no filesystem, process, or network boundary' },
    { dim: 'a11y', reason: 'the refusal text is pinned through its observable fields' }
  ]
);

import { parseDesignlangEvidence } from '../../../src/services/design/designlang.js';

const URL = 'http://127.0.0.1:4321/';
const TOKENS = '/tmp/app/design/tokens.json';

/** The exact drift payload the spike recorded for a content page. */
function driftPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    url: URL,
    tokensFile: TOKENS,
    tolerance: 0,
    verdict: 'notable-drift',
    driftRatio: 0.25,
    drifted: [{ token: 'color.surface', local: '#f8fafc', nearestLive: '#ffffff', distance: 9 }],
    matched: [
      { token: 'color.primary', local: '#2563eb', liveMatch: '#2563eb', distance: 0 },
      { token: 'color.ink', local: '#0f172a', liveMatch: '#0f172a', distance: 0 },
      { token: 'color.muted', local: '#64748b', liveMatch: '#64748b', distance: 0 }
    ],
    unknown: [],
    summary: { total: 4, drifted: 1, matched: 3, unknown: 0 },
    ...overrides
  };
}

const EXPECT = { url: URL, tokensFile: TOKENS };

describe('Scenario: behavior — drift evidence is shape, arithmetic and provenance', () => {
  it('when drift echoes its page, tokens file and real verdict, should accept it', () => {
    // given: the measured notable-drift payload with no timestamp at all
    // when: the drift evidence is parsed with the values the spawn was given
    // then: it is accepted (the old generatedAt rule would have refused it)
    const result = parseDesignlangEvidence({
      kind: 'drift',
      stdout: JSON.stringify(driftPayload()),
      expect: EXPECT
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.raw.verdict).toBe('notable-drift');
  });

  it('when drift reports an in-sync verdict, should accept every verdict value', () => {
    // given: one payload per real verdict value
    // when: each is parsed as drift evidence
    // then: the four documented verdicts are all accepted
    for (const verdict of ['in-sync', 'minor-drift', 'notable-drift', 'major-drift']) {
      const result = parseDesignlangEvidence({
        kind: 'drift',
        stdout: JSON.stringify(driftPayload({ verdict })),
        expect: EXPECT
      });
      expect(result.ok, verdict).toBe(true);
    }
  });

  it('when drift names an unknown verdict, should refuse it', () => {
    // given: a payload whose verdict is not one designlang emits
    // when: the drift evidence is parsed
    // then: the unknown verdict is not evidence
    const result = parseDesignlangEvidence({
      kind: 'drift',
      stdout: JSON.stringify(driftPayload({ verdict: 'looks-fine' })),
      expect: EXPECT
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected no evidence');
    expect(result.message).toContain('verdict');
  });

  it('when driftRatio is outside 0..1 or not finite, should refuse it', () => {
    // given: ratios of 1.5, -0.1 and a string
    // when: each payload is parsed
    // then: a ratio that cannot be a real proportion is no evidence
    for (const driftRatio of [1.5, -0.1, '0.25']) {
      const result = parseDesignlangEvidence({
        kind: 'drift',
        stdout: JSON.stringify(driftPayload({ driftRatio })),
        expect: EXPECT
      });
      expect(result.ok, String(driftRatio)).toBe(false);
    }
  });

  it('when the summary compared nothing, should refuse the vacuous payload', () => {
    // given: the pilot's matched 0 / total 0 payload
    // when: the drift evidence is parsed
    // then: a report that compared no token is never positive evidence
    const result = parseDesignlangEvidence({
      kind: 'drift',
      stdout: JSON.stringify(
        driftPayload({ drifted: [], matched: [], summary: { total: 0, drifted: 0, matched: 0 } })
      ),
      expect: EXPECT
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected no evidence');
    expect(result.message).toContain('total');
  });

  it('when the summary arithmetic does not hold, should refuse it', () => {
    // given: total 4 while only one drifted and one matched token are listed
    // when: the drift evidence is parsed
    // then: drift's own arithmetic is the non-vacuity test
    const result = parseDesignlangEvidence({
      kind: 'drift',
      stdout: JSON.stringify(driftPayload({ matched: [], drifted: [] })),
      expect: EXPECT
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected no evidence');
    expect(result.message).toContain('did not equal');
  });

  it('when drift echoes a different page, should refuse the provenance', () => {
    // given: a payload about a page the adapter never asked about
    // when: the drift evidence is parsed
    // then: the echoed url must be the requested one
    const result = parseDesignlangEvidence({
      kind: 'drift',
      stdout: JSON.stringify(driftPayload({ url: 'http://127.0.0.1:4321/other' })),
      expect: EXPECT
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected no evidence');
    expect(result.message).toContain('did not echo the requested page');
  });

  it('when drift echoes a different tokens file, should refuse the provenance', () => {
    // given: a payload compared against another project's tokens file
    // when: the drift evidence is parsed
    // then: the echoed tokensFile must resolve to the path passed
    const result = parseDesignlangEvidence({
      kind: 'drift',
      stdout: JSON.stringify(driftPayload({ tokensFile: '/tmp/other/design/tokens.json' })),
      expect: EXPECT
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected no evidence');
    expect(result.message).toContain('tokensFile');
  });

  it('when no expected echo was supplied, should refuse drift rather than guess', () => {
    // given: a well-formed drift payload and no provenance to compare it with
    // when: the drift evidence is parsed
    // then: the caller must say which page and tokens file it asked for
    const result = parseDesignlangEvidence({
      kind: 'drift',
      stdout: JSON.stringify(driftPayload())
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected no evidence');
    expect(result.message).toContain('requested url and tokens file');
  });
});

describe('Scenario: behavior — verify-ui evidence needs no timestamp', () => {
  it('when verify-ui reports pass true without any timestamp, should accept it', () => {
    // given: the measured payload — pass, onBrand, and no generatedAt
    // when: the verify-ui evidence is parsed
    // then: a real pass is accepted (this is the dead-gate fix)
    const result = parseDesignlangEvidence({
      kind: 'verify-ui',
      stdout: JSON.stringify({
        pass: true,
        onBrand: 99,
        generic: 18,
        genericBand: 'distinct',
        tells: [],
        issues: []
      })
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.raw.pass).toBe(true);
  });

  it('when verify-ui lacks a boolean pass, should refuse it', () => {
    // given: payloads whose pass is missing, a string, and null
    // when: each is parsed as verify-ui evidence
    // then: only a real boolean is evidence
    for (const pass of [undefined, 'true', null]) {
      const result = parseDesignlangEvidence({
        kind: 'verify-ui',
        stdout: JSON.stringify({ pass, onBrand: 99 })
      });
      expect(result.ok, String(pass)).toBe(false);
    }
  });

  it('when the page was unusable, should refuse the null onBrand payload', () => {
    // given: the measured unusable-page payload (onBrand null)
    // when: the verify-ui evidence is parsed
    // then: no score means no evidence, so the exit code decides the block
    const result = parseDesignlangEvidence({
      kind: 'verify-ui',
      stdout: JSON.stringify({
        pass: false,
        onBrand: null,
        generic: null,
        tells: [],
        issues: [],
        unreadable: { reason: 'blank', viewport: 390 }
      })
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected no evidence');
    expect(result.message).toContain('onBrand');
  });
});

describe('Scenario: behavior — slop evidence is its score plus readAt', () => {
  it('when slop carries readAt and a generic score, should accept it', () => {
    // given: the measured slop payload for a content page
    // when: the slop evidence is parsed
    // then: its own timestamp and score are the shape
    const result = parseDesignlangEvidence({
      kind: 'slop',
      stdout: JSON.stringify({
        url: URL,
        readAt: '2026-11-24T13:20:35.202Z',
        generic: { score: 18, band: 'distinct', flags: [] },
        unreadable: null
      })
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.raw.readAt).toBe('2026-11-24T13:20:35.202Z');
  });

  it('when readAt is missing or empty, should refuse the slop payload', () => {
    // given: payloads with no readAt and a blank readAt
    // when: each is parsed as slop evidence
    // then: the timestamp must be a non-empty string
    for (const readAt of [undefined, '', '   ']) {
      const result = parseDesignlangEvidence({
        kind: 'slop',
        stdout: JSON.stringify({ readAt, generic: { score: 18 } })
      });
      expect(result.ok, String(readAt)).toBe(false);
    }
  });

  it('when the score is missing or not a number, should refuse it', () => {
    // given: payloads with no score, a string score, and null
    // when: each is parsed as slop evidence
    // then: a finite score is required
    for (const score of [undefined, '18', null]) {
      const result = parseDesignlangEvidence({
        kind: 'slop',
        stdout: JSON.stringify({ readAt: '2026-11-24T13:20:35.202Z', generic: { score } })
      });
      expect(result.ok, String(score)).toBe(false);
    }
  });
});

describe('Scenario: behavior — grade keeps the written-report stamp it emits', () => {
  it('when grade carries a timestamp or a non-empty pages list, should accept it', () => {
    // given: a grade report with a timestamp and one with rendered pages
    // when: each is parsed as grade evidence
    // then: the report stamp is the grade rule, unchanged
    for (const body of [
      { overall: 'A', generatedAt: '2026-11-24T00:00:00Z' },
      { overall: 'A', pages: [{ path: '/' }] }
    ]) {
      const result = parseDesignlangEvidence({ kind: 'grade', stdout: JSON.stringify(body) });
      expect(result.ok).toBe(true);
    }
  });

  it('when grade carries neither stamp, should report no evidence', () => {
    // given: a non-empty JSON object whose only key is an error
    // when: the grade evidence is parsed
    // then: without a timestamp or page list it is never evidence
    const result = parseDesignlangEvidence({
      kind: 'grade',
      stdout: '{"error":"extraction failed"}'
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected no evidence');
    expect(result.code).toBe('DESIGN_RENDER_NO_EVIDENCE');
    expect(result.message).toContain('generatedAt');
  });
});

describe('Scenario: behavior — the shared JSON document recovery', () => {
  it('when the valid object follows log noise, should parse the last balanced block', () => {
    // given: a browser log line before and a trailer after the JSON document
    // when: the evidence is parsed
    // then: the embedded object is recovered instead of the whole stdout
    const slop = JSON.stringify({ readAt: 't', generic: { score: 3 } });
    const result = parseDesignlangEvidence({
      kind: 'slop',
      stdout: `Launching browser...\n${slop}\nDone.`
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.raw).toEqual({ readAt: 't', generic: { score: 3 } });
  });

  it('when stdout is empty or a bare log line, should report DESIGN_RENDER_NO_EVIDENCE', () => {
    // given: an empty stdout and a non-JSON log line
    // when: each is parsed as evidence
    // then: neither is accepted and the message says which shape failed
    const blank = parseDesignlangEvidence({ kind: 'drift', stdout: '   ' });
    expect(blank.ok).toBe(false);
    if (blank.ok) throw new Error('expected no evidence');
    expect(blank.message).toContain('stdout was empty');
    const noise = parseDesignlangEvidence({ kind: 'drift', stdout: 'not json' });
    expect(noise.ok).toBe(false);
    if (noise.ok) throw new Error('expected no evidence');
    expect(noise.message).toContain('non-empty JSON object');
  });

  it('when stdout is a JSON scalar, null, an array or an empty object, should refuse it', () => {
    // given: valid JSON that is not a non-empty object
    // when: each is parsed as evidence
    // then: the object shape is required and the parser never throws
    for (const stdout of ['null', '42', '"plain text"', '[]', '{}']) {
      const result = parseDesignlangEvidence({ kind: 'grade', stdout });
      expect(result.ok, stdout).toBe(false);
      if (result.ok) throw new Error(`expected ${stdout} to be refused`);
      expect(result.code).toBe('DESIGN_RENDER_NO_EVIDENCE');
    }
  });

  it('when a string never closes, should stop scanning without inventing a block', () => {
    // given: stdout whose quote opens a string that never terminates
    // when: the evidence is parsed
    // then: no balanced object is recovered and the verdict is no evidence
    const result = parseDesignlangEvidence({
      kind: 'grade',
      stdout: 'log {"note":"unterminated generatedAt: "t"'
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected no evidence');
    expect(result.code).toBe('DESIGN_RENDER_NO_EVIDENCE');
  });

  it('when a block is unterminated, should not emit a partial object', () => {
    // given: a document whose closing brace is missing
    // when: the evidence is parsed
    // then: the partial block is refused instead of parsed as if complete
    const result = parseDesignlangEvidence({
      kind: 'grade',
      stdout: '{"generatedAt":"2026-11-23T00:00:00Z"'
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected no evidence');
    expect(result.code).toBe('DESIGN_RENDER_NO_EVIDENCE');
  });
});

describe('Scenario: behavior — the parser wraps every refusal with the tool and kind', () => {
  it('when stdout is empty, should prefix the refusal with the exact tool sentence', () => {
    // given: empty drift stdout
    // when: the evidence is parsed
    // then: the message names the tool, the kind and the empty stdout
    expect(parseDesignlangEvidence({ kind: 'drift', stdout: '   ' })).toEqual({
      ok: false,
      code: 'DESIGN_RENDER_NO_EVIDENCE',
      message: 'designlang drift produced no evidence: stdout was empty.'
    });
  });

  it('when drift names an unknown verdict, should carry the full allowed set in the message', () => {
    // given: a drift payload whose verdict is not one designlang emits
    // when: the evidence is parsed
    // then: the wrapped message spells every value the tool can print
    const result = parseDesignlangEvidence({
      kind: 'drift',
      stdout: JSON.stringify(driftPayload({ verdict: 'looks-fine' })),
      expect: EXPECT
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected no evidence');
    expect(result.message).toBe(
      'designlang drift produced no evidence: drift verdict looks-fine was not one of in-sync, minor-drift, notable-drift, major-drift.'
    );
  });

  it('when drift is exactly in sync or fully drifted, should accept both ratio ends', () => {
    // given: the two boundary ratios with their matching verdicts
    // when: each payload is parsed
    // then: both ends of the proportion are real evidence
    for (const [verdict, drifted, matched, driftRatio] of [
      ['in-sync', [], [{ token: 'a' }], 0],
      ['major-drift', [{ token: 'a' }], [], 1]
    ] as const) {
      const result = parseDesignlangEvidence({
        kind: 'drift',
        stdout: JSON.stringify(
          driftPayload({
            verdict,
            driftRatio,
            drifted,
            matched,
            summary: { total: 1, drifted: drifted.length, matched: matched.length }
          })
        ),
        expect: EXPECT
      });
      expect(result.ok, verdict).toBe(true);
    }
  });

  it('when verify-ui reports pass false with a score, should accept it as evidence', () => {
    // given: the scored-fail payload shape
    // when: the evidence is parsed
    // then: a boolean false is evidence, and the classifier decides the fail
    const result = parseDesignlangEvidence({
      kind: 'verify-ui',
      stdout: JSON.stringify({ pass: false, onBrand: 40 })
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.raw.pass).toBe(false);
  });

  it('when the output is a JSON array with a valid object inside, should still refuse the stream', () => {
    // given: a document whose only object sits inside an array
    // when: the evidence is parsed
    // then: the recovered block is the object, so the shape rule decides
    const result = parseDesignlangEvidence({
      kind: 'grade',
      stdout: '[{"generatedAt":"2026-11-23T00:00:00Z"}]'
    });
    expect(result.ok).toBe(true);
  });
});
