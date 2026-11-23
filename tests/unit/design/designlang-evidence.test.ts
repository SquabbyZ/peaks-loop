import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/design/designlang-evidence.test.ts',
  ['behavior'],
  [
    { dim: 'render', reason: 'the parser returns evidence records, not render artifacts' },
    { dim: 'integration', reason: 'the parser has no filesystem, process, or network boundary' },
    { dim: 'a11y', reason: 'the refusal text is pinned in designlang.test.ts' }
  ]
);

import { parseDesignlangEvidence } from '../../../src/services/design/designlang.js';

describe('Scenario: behavior — the evidence parser', () => {
  it('when stdout is a timestamped json object, should accept it with one page by default', () => {
    // given: a drift JSON document with a timestamp and no pages array
    // when: the evidence is parsed
    // then: it is accepted with a single page and the raw document kept
    const result = parseDesignlangEvidence({
      kind: 'drift',
      stdout: '{"url":"http://127.0.0.1:4321/","drift":[],"generatedAt":"2026-11-23T00:00:00.000Z"}'
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.pages).toBe(1);
    expect(result.raw).toEqual({
      url: 'http://127.0.0.1:4321/',
      drift: [],
      generatedAt: '2026-11-23T00:00:00.000Z'
    });
  });

  it('when the object has neither a timestamp nor pages, should report no evidence', () => {
    // given: a non-empty JSON object whose only key is an error
    // when: the evidence is parsed
    // then: without the Q5 timestamp or page list it is never evidence
    const result = parseDesignlangEvidence({
      kind: 'grade',
      stdout: '{"error":"extraction failed"}'
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected no evidence');
    expect(result.code).toBe('DESIGN_RENDER_NO_EVIDENCE');
    expect(result.message).toContain('generatedAt');
  });

  it('when stdout carries a pages array, should count its entries', () => {
    // given: a JSON document describing two rendered pages
    // when: the evidence is parsed
    // then: the page count is the array length, not one
    const result = parseDesignlangEvidence({
      kind: 'verify-ui',
      stdout: '{"pages":[{"path":"/"},{"path":"/about"}]}'
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.pages).toBe(2);
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

  it('when the valid object follows log noise, should parse the last balanced block', () => {
    // given: a browser log line before and a trailer after a JSON document
    // when: the evidence is parsed
    // then: the embedded object is recovered instead of the whole stdout
    const result = parseDesignlangEvidence({
      kind: 'slop',
      stdout: 'Launching browser...\n{"url":"x","generatedAt":"t","generic":3}\nDone.'
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.raw).toEqual({ url: 'x', generatedAt: 't', generic: 3 });
  });

  it('when stdout is a JSON scalar or null, should refuse it as non-evidence', () => {
    // given: null, a number, and a string — all valid JSON, none an object
    // when: each is parsed as evidence
    // then: the object shape is required and the parser never throws
    for (const stdout of ['null', '42', '"plain text"']) {
      const result = parseDesignlangEvidence({ kind: 'drift', stdout });
      expect(result.ok, stdout).toBe(false);
      if (result.ok) throw new Error(`expected ${stdout} to be refused`);
      expect(result.code).toBe('DESIGN_RENDER_NO_EVIDENCE');
    }
  });

  it('when an unbalanced closing brace precedes the document, should still recover it', () => {
    // given: a stray `}` before an otherwise valid top-level object
    // when: the balanced blocks are scanned
    // then: the stray brace never opens a block and the document is accepted
    const result = parseDesignlangEvidence({
      kind: 'drift',
      stdout: 'noise } more {"generatedAt":"2026-11-23T00:00:00Z"}'
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.raw).toEqual({ generatedAt: '2026-11-23T00:00:00Z' });
  });

  it('when the js object has no keys, should report DESIGN_RENDER_NO_EVIDENCE', () => {
    // given: an empty object and an array (not an object) on stdout
    // when: each is parsed as evidence
    // then: a document with nothing in it never counts as evidence
    for (const stdout of ['{}', '[]']) {
      const result = parseDesignlangEvidence({ kind: 'grade', stdout });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected no evidence');
      expect(result.code).toBe('DESIGN_RENDER_NO_EVIDENCE');
    }
  });

  it('when pages is an EMPTY array and no timestamp exists, should refuse the stamp', () => {
    // given: a document whose only stamp is an empty rendered-page list
    // when: the evidence is parsed
    // then: an empty page list is not positive evidence (spec §7.3 Q5)
    const result = parseDesignlangEvidence({ kind: 'drift', stdout: '{"pages":[]}' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected no evidence');
    expect(result.code).toBe('DESIGN_RENDER_NO_EVIDENCE');
  });

  it('when pages is empty but generatedAt is set, should accept the timestamp stamp', () => {
    // given: an empty page list plus a non-empty timestamp
    // when: the evidence is parsed
    // then: the timestamp satisfies the stamp and the empty list counts zero pages
    const result = parseDesignlangEvidence({
      kind: 'drift',
      stdout: '{"pages":[],"generatedAt":"2026-11-23T00:00:00Z"}'
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.pages).toBe(0);
  });

  it('when the log noise carries braces and quotes, should find the real document', () => {
    // given: log lines with a fake JSON-ish blob, a quoted brace, and an escaped quote
    // when: the last balanced block is recovered
    // then: only the genuine top-level object parses to the evidence
    const document = JSON.stringify({ url: 'x', note: 'say "hi" }', generatedAt: 't' });
    const stdout = `log {not json} ${document} trailer {`;
    const result = parseDesignlangEvidence({ kind: 'slop', stdout });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.raw).toEqual({ url: 'x', note: 'say "hi" }', generatedAt: 't' });
    expect(result.pages).toBe(1);
  });

  it('when an earlier block is invalid or nested, should pick the last valid one', () => {
    // given: a malformed block, an array, a nested object, then the real document
    // when: the blocks are scanned in reverse
    // then: the first parsable non-empty object from the end wins
    const stdout = '{"broken":} [] {"a":{"b":1}} {"note":"done","pages":[{"path":"/"}]}';
    const result = parseDesignlangEvidence({ kind: 'verify-ui', stdout });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.raw).toEqual({ note: 'done', pages: [{ path: '/' }] });
    expect(result.pages).toBe(1);
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
