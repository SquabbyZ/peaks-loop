// tests/unit/cli/cli-envelope.test.ts
//
// Slice S12 (2026-09-20). The guard for `src/cli/cli-envelope.ts`.
//
// WHY THIS TEST EXISTS. The schema's whole job is to be the thing that lets
// 18 test files stop writing `JSON.parse(stdout)` and reading `out.anything`.
// A schema that accepts everything would let every one of those call sites
// look validated while checking nothing — the `as T` costume in a new outfit.
// So this file pins the schema against the REAL printer (`printResult`), not
// against a hand-written literal that could drift from what the CLI emits,
// and it carries negative cases so it cannot pass by being unable to fail.
//
// Dimensions covered:
//   - render:    a real ok()/fail() envelope round-trips through the parser
//   - behavior:  the parser rejects what is not an envelope, keeps extra keys
//   - a11y:      a non-envelope failure is a thrown error with a readable
//                message, not a silent `undefined` handed to the caller
//   - integration: OMITTED — the module is pure; `printResult` is called with
//                an in-memory IO sink and touches no fs/env/clock boundary.

import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';

declareDimensions(
  'tests/unit/cli/cli-envelope.test.ts',
  ['render', 'behavior', 'a11y'],
  [{ dim: 'integration', reason: 'cli-envelope.ts is a pure parse/validate module.' }]
);

import { z } from 'zod';
import { fail, ok } from 'peaks-loop-shared/result';
import { parseCliEnvelope, parseCliEnvelopeWith } from '~/src/cli/cli-envelope';
import { printResult } from '~/src/cli/cli-helpers';

/** Print a real envelope exactly the way `peaks … --json` does. */
function printJson(result: Parameters<typeof printResult>[1]): string {
  const { io, captured } = makeCapturedIo();
  printResult(io, result, true);
  return captured.text();
}

describe('Scenario: render — a real envelope round-trips', () => {
  it('parses the envelope `printResult(…, asJson)` writes for ok()', () => {
    const stdout = printJson(
      ok('job status', { done: 8, total: 8 }, [], ['Run `peaks job watch` to follow along.'])
    );
    const out = parseCliEnvelope(stdout);
    expect(out.ok).toBe(true);
    expect(out.command).toBe('job status');
    expect(out.data).toEqual({ done: 8, total: 8 });
    expect(out.warnings).toEqual([]);
    expect(out.nextActions).toHaveLength(1);
  });

  it('parses the envelope `printResult(…, asJson)` writes for fail()', () => {
    // `fail` is called with all four leading args everywhere in `src/` (checked
    // by AST at the S12 census: 13 × fail(4) + 648 × fail(5), no 3-arg call to
    // THIS `fail`), so `data` is present on every envelope production emits.
    const stdout = printJson(
      fail('evolution evaluate', 'EVOLUTION_SELF_SCORE', 'scores match', {})
    );
    const out = parseCliEnvelope(stdout);
    expect(out.ok).toBe(false);
    expect(out.code).toBe('EVOLUTION_SELF_SCORE');
    expect(out.message).toBe('scores match');
    expect(out.errorId).toBeTypeOf('string');
  });

  it('keeps keys the schema does not name', () => {
    const out = parseCliEnvelope(
      JSON.stringify({ ok: true, data: {}, warnings: [], nextActions: [], futureField: 7 })
    );
    expect(out.futureField).toBe(7);
  });
});

describe('Scenario: behavior — the payload schema is checked when given', () => {
  const statusPayload = z.looseObject({
    target_kind: z.string(),
    byVerdict: z.record(z.string(), z.number())
  });

  it('accepts a payload that matches and types it', () => {
    const stdout = printJson(
      ok('evolution status', { target_kind: 'loop', byVerdict: { 'needs-user-decision': 1 } })
    );
    const out = parseCliEnvelopeWith(stdout, statusPayload);
    expect(out.data.target_kind).toBe('loop');
    expect(out.data.byVerdict['needs-user-decision']).toBe(1);
  });

  it('rejects a payload that does not match', () => {
    const stdout = printJson(ok('evolution status', { target_kind: 'loop' }));
    expect(() => parseCliEnvelopeWith(stdout, statusPayload)).toThrow();
  });
});

describe('Scenario: a11y — a non-envelope is a loud error, not undefined', () => {
  it('rejects a bare array (the `peaks skill search` stdout shape)', () => {
    expect(() => parseCliEnvelope(JSON.stringify([{ name: 'peaks-doctor' }]))).toThrow();
  });

  it('rejects an object with no `ok`', () => {
    expect(() => parseCliEnvelope(JSON.stringify({ result: 'fine' }))).toThrow();
  });

  it('rejects a non-boolean `ok`', () => {
    expect(() => parseCliEnvelope(JSON.stringify({ ok: 'yes', data: {} }))).toThrow();
  });

  it('rejects non-JSON text', () => {
    expect(() => parseCliEnvelope('not json at all')).toThrow();
  });
});
