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

describe('render — ResultEnvelope shape', () => {
  it('ok() returns a typed envelope with ok=true and the supplied data', () => {
    const out = ok('demo', 42);
    expect(out.ok).toBe(true);
    expect(out.command).toBe('demo');
    expect(out.data).toBe(42);
    expect(out.warnings).toEqual([]);
    expect(out.nextActions).toEqual([]);
  });

  it('fail() returns a typed envelope with code + message + opaque errorId', () => {
    const out = fail('demo', 'PEAKS_DEMO_CODE', 'something broke', null);
    expect(out.ok).toBe(false);
    expect(out.command).toBe('demo');
    expect(out.code).toBe('PEAKS_DEMO_CODE');
    expect(out.message).toBe('something broke');
    expect(typeof out.errorId).toBe('string');
    expect(out.errorId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('fail() mints a fresh errorId per call (no reuse)', () => {
    const a = fail('demo', 'CODE', 'msg', null);
    const b = fail('demo', 'CODE', 'msg', null);
    expect(a.errorId).not.toBe(b.errorId);
  });
});

describe('behavior — pure transformations', () => {
  it('ok() propagates warnings and nextActions through', () => {
    const out = ok('demo', 1, ['w1'], ['retry', 'escalate']);
    expect(out.warnings).toEqual(['w1']);
    expect(out.nextActions).toEqual(['retry', 'escalate']);
  });

  it('fail() redaction runs before the envelope is built (no leaky secret in message)', () => {
    const out = fail('demo', 'PEAKS_LEAK', 'token: abcdefghijklmnop', null);
    expect(out.message).not.toContain('abcdefghijklmnop');
    expect(out.message).toMatch(/\[redacted\]/);
  });

  it('getErrorMessage returns Error.message verbatim', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('getErrorMessage unwraps plain strings', () => {
    expect(getErrorMessage('plain')).toBe('plain');
  });

  it('getErrorMessage coerces non-string / non-Error values to a safe fallback', () => {
    expect(getErrorMessage(42)).toBe('Unexpected error');
    expect(getErrorMessage({})).toBe('Unexpected error');
  });

  it('redactSensitiveErrorMessage redacts the known token + key + JWT shapes', () => {
    const dirty = 'api_key=sk-abcdefghijklmnop and header Bearer eyJabcdefghij.abcdefghij.abcdefghij';
    const out = redactSensitiveErrorMessage(dirty);
    expect(out).toMatch(/\[redacted\]/);
    expect(out).not.toContain('sk-abcdefghijklmnop');
    expect(out).not.toContain('eyJabcdefghij');
  });
});

describe('a11y — human-visible error surface', () => {
  it('fail().message is human-readable text, not a stack trace fragment', () => {
    const out: ResultEnvelope<null> = fail('demo', 'CODE', 'user-facing description', null);
    expect(out.message).toMatch(/^[a-zA-Z]/);
    expect(out.message).not.toMatch(/at .+:\d+/);
  });

  it('errorId is opaque and never appears inside the human message', () => {
    const out = fail('demo', 'CODE', 'user-facing description', null);
    expect(out.errorId).toBeDefined();
    expect(out.message).not.toContain(out.errorId!);
  });
});
