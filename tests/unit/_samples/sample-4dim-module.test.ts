// tests/unit/_samples/sample-4dim-module.test.ts
//
// 4-dimension sample (per `.peaks/standards/typescript/testing.md`).
// Targets the real `peaks-loop-shared/result` public surface
// (ResultEnvelope / ok() / fail() / getErrorMessage /
// redactSensitiveErrorMessage). The earlier draft of this file asserted
// a Rust-style Result API (err/toOk/map/bimap) that does NOT exist in
// production — the kind of false-positive the 2026-07-30 test-rebuild
// epic was launched to surface. The current file is the corrected
// version.
//
// Dimensions covered:
//   - render:    ok()/fail() produce a ResultEnvelope with the expected
//                shape (ok, command, data, warnings, nextActions, errorId)
//   - behavior:  pure transformations; null data; redactor behavior
//   - a11y:      error envelope has user-readable message + opaque errorId
//   - integration: OMITTED — result is a pure module, no fs/clock/env
//                boundary. Recorded via declareDimensions() so the
//                omission is explicit.
//
// Run with: pnpm vitest run tests/unit/_samples/

import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/_samples/sample-4dim-module.test.ts',
  ['render', 'behavior', 'a11y'],
  [{ dim: 'integration', reason: 'result is a pure module; no fs/clock/env boundary to test.' }],
);

import {
  ok,
  fail,
  getErrorMessage,
  redactSensitiveErrorMessage,
  type ResultEnvelope,
} from 'peaks-loop-shared/result';

describe("Scenario: render — ResultEnvelope shape", () => {
  it("when invoked, should ok() returns a typed envelope with ok=true and the supplied data", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = ok('demo', 42);
    expect(out.ok).toBe(true);
    expect(out.command).toBe('demo');
    expect(out.data).toBe(42);
    expect(out.warnings).toEqual([]);
    expect(out.nextActions).toEqual([]);
  });

  it("when invoked, should fail() returns a typed envelope with code + message + opaque errorId", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = fail('demo', 'PEAKS_DEMO_CODE', 'something broke', null);
    expect(out.ok).toBe(false);
    expect(out.command).toBe('demo');
    expect(out.code).toBe('PEAKS_DEMO_CODE');
    expect(out.message).toBe('something broke');
    expect(typeof out.errorId).toBe('string');
    expect(out.errorId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("when invoked, should fail() mints a fresh errorId per call (no reuse)", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const a = fail('demo', 'CODE', 'msg', null);
    const b = fail('demo', 'CODE', 'msg', null);
    expect(a.errorId).not.toBe(b.errorId);
  });
});

describe("Scenario: behavior — pure transformations", () => {
  it("when invoked, should ok() propagates warnings and nextActions through", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = ok('demo', 1, ['w1'], ['retry', 'escalate']);
    expect(out.warnings).toEqual(['w1']);
    expect(out.nextActions).toEqual(['retry', 'escalate']);
  });

  it("when invoked, should fail() redaction runs before the envelope is built (no leaky secret in message)", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = fail('demo', 'PEAKS_LEAK', 'token: abcdefghijklmnop', null);
    expect(out.message).not.toContain('abcdefghijklmnop');
    expect(out.message).toMatch(/\[redacted\]/);
  });

  it("when invoked, should getErrorMessage returns Error.message verbatim", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
  });

  it("when invoked, should getErrorMessage unwraps plain strings", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(getErrorMessage('plain')).toBe('plain');
  });

  it("when invoked, should getErrorMessage coerces non-string / non-Error values to a safe fallback", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(getErrorMessage(42)).toBe('Unexpected error');
    expect(getErrorMessage({})).toBe('Unexpected error');
  });

  it("when invoked, should redactSensitiveErrorMessage redacts the known token + key + JWT shapes", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const dirty = 'api_key=sk-abcdefghijklmnop and header Bearer eyJabcdefghij.abcdefghij.abcdefghij';
    const out = redactSensitiveErrorMessage(dirty);
    expect(out).toMatch(/\[redacted\]/);
    expect(out).not.toContain('sk-abcdefghijklmnop');
    expect(out).not.toContain('eyJabcdefghij');
  });
});

describe("Scenario: a11y — human-visible error surface", () => {
  it("when invoked, should fail().message is human-readable text, not a stack trace fragment", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out: ResultEnvelope<null> = fail('demo', 'CODE', 'user-facing description', null);
    expect(out.message).toMatch(/^[a-zA-Z]/);
    expect(out.message).not.toMatch(/at .+:\d+/);
  });

  it("when invoked, should errorId is opaque and never appears inside the human message", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = fail('demo', 'CODE', 'user-facing description', null);
    expect(out.errorId).toBeDefined();
    expect(out.message).not.toContain(out.errorId!);
  });
});
