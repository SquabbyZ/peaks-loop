/**
 * TDD coverage for the ECC code-review bridge (`src/services/code-review/ecc-bridge.ts`).
 *
 * Covers:
 *   - 3 gateActions × verdict rendering (pass / warn / block)
 *   - Envelope shape validation (`isEccEnvelope`)
 *   - Markdown safety (no code-fence injection, no bullet-list breakage)
 *   - 5-state `detectEcc` (ready / plugin-missing / agent-missing / dispatch-failed / envelope-malformed)
 *   - Convenience `runEccCodeReview` aggregator (detect + adapt in one call)
 *
 * No real ECC plugin required — all envelopes are synthetic.
 */
import { describe, expect, test } from 'vitest';
import {
  adaptEccEnvelopeToRdCodeReview,
  detectEcc,
  isEccEnvelope,
  runEccCodeReview,
  type EccEnvelope,
  type EccViolation
} from '../../../../src/services/code-review/ecc-bridge.js';

const ISO = '2026-06-26T15:00:00.000Z';

function makeViolation(over: Partial<EccViolation> = {}): EccViolation {
  return {
    kind: 'correctness',
    line: 42,
    snippet: 'const x = value;',
    hint: 'shadowed variable name',
    ...over
  };
}

function makeEnvelope(over: Partial<EccEnvelope> = {}): EccEnvelope {
  return {
    passed: true,
    violations: [],
    gateAction: 'pass',
    ...over
  };
}

describe('isEccEnvelope — strict shape validator', () => {
  test('accepts the canonical envelope shape', () => {
    expect(isEccEnvelope(makeEnvelope())).toBe(true);
    expect(isEccEnvelope(makeEnvelope({ gateAction: 'warn', passed: false, violations: [makeViolation()] }))).toBe(true);
    expect(isEccEnvelope(makeEnvelope({ gateAction: 'block', passed: false, violations: [makeViolation(), makeViolation()] }))).toBe(true);
  });

  test('rejects null and non-objects', () => {
    expect(isEccEnvelope(null)).toBe(false);
    expect(isEccEnvelope(undefined)).toBe(false);
    expect(isEccEnvelope('pass')).toBe(false);
    expect(isEccEnvelope(42)).toBe(false);
    expect(isEccEnvelope([])).toBe(false);
  });

  test('rejects missing or wrong-typed fields', () => {
    expect(isEccEnvelope({})).toBe(false);
    expect(isEccEnvelope({ passed: true, gateAction: 'pass' })).toBe(false); // missing violations
    expect(isEccEnvelope({ passed: true, violations: 'nope', gateAction: 'pass' })).toBe(false);
    expect(isEccEnvelope({ passed: 'yes', violations: [], gateAction: 'pass' })).toBe(false);
    expect(isEccEnvelope({ passed: true, violations: [], gateAction: 'fail' })).toBe(false); // bad enum
  });

  test('rejects malformed violation entries', () => {
    const base = { passed: true, gateAction: 'pass' };
    expect(isEccEnvelope({ ...base, violations: [null] })).toBe(false);
    expect(isEccEnvelope({ ...base, violations: [{ kind: 'x' }] })).toBe(false); // missing fields
    expect(isEccEnvelope({ ...base, violations: [{ kind: 'x', line: 'oops', snippet: '', hint: '' }] })).toBe(false);
    expect(isEccEnvelope({ ...base, violations: [{ kind: 'x', line: NaN, snippet: '', hint: '' }] })).toBe(false);
  });

  test('tolerates unknown top-level fields (forward-compat)', () => {
    expect(isEccEnvelope({ ...makeEnvelope(), newField: 'whatever', futureFlag: true })).toBe(true);
  });
});

describe('adaptEccEnvelopeToRdCodeReview — verdict rendering', () => {
  test('pass envelope → verdict=pass, no Required Fixes, CRITICAL: 0 (Gate B3 still passes)', () => {
    const env = makeEnvelope({ passed: true, gateAction: 'pass' });
    const doc = adaptEccEnvelopeToRdCodeReview(env, { rid: '2026-06-26-test', generatedAt: ISO });
    expect(doc.verdict).toBe('pass');
    expect(doc.counts.total).toBe(0);
    expect(doc.counts.byKind).toEqual({});
    expect(doc.body).toContain('## Summary');
    expect(doc.body).toContain('## Findings');
    expect(doc.body).toContain('- (none)');
    expect(doc.body).toContain('verdict: pass');
    expect(doc.body).toContain('CRITICAL: 0');
    expect(doc.body).not.toContain('## Required Fixes');
    expect(doc.body).not.toContain('## Recommended');
  });

  test('warn envelope → verdict=warn, Findings + Required Fixes + Recommended listed', () => {
    const env = makeEnvelope({
      passed: false,
      gateAction: 'warn',
      violations: [
        makeViolation({ kind: 'mutation', line: 12, hint: 'array.sort mutates' }),
        makeViolation({ kind: 'naming', line: 88, hint: 'unclear variable name' })
      ]
    });
    const doc = adaptEccEnvelopeToRdCodeReview(env, { rid: '2026-06-26-test', generatedAt: ISO });
    expect(doc.verdict).toBe('warn');
    expect(doc.counts.total).toBe(2);
    expect(doc.counts.byKind).toEqual({ mutation: 1, naming: 1 });
    expect(doc.body).toContain('## Required Fixes');
    expect(doc.body).toContain('## Recommended');
    expect(doc.body).toContain('- [mutation @ line 12]');
    expect(doc.body).toContain('- [naming @ line 88]');
    expect(doc.body).toContain('verdict: warn');
    // Gate B3 `mustContain: ['CRITICAL']` is satisfied by the warn verdict (it always emits CRITICAL: 0).
    expect(doc.body).toContain('CRITICAL: 0');
  });

  test('block envelope → verdict=block, CRITICAL: <n> emitted, both Findings + Required Fixes listed', () => {
    const env = makeEnvelope({
      passed: false,
      gateAction: 'block',
      violations: [
        makeViolation({ kind: 'correctness', line: 1, hint: 'wrong return type' }),
        makeViolation({ kind: 'regression', line: 2, hint: 'breaks existing test' }),
        makeViolation({ kind: 'correctness', line: 3, hint: 'race condition' })
      ]
    });
    const doc = adaptEccEnvelopeToRdCodeReview(env, { rid: '2026-06-26-test', generatedAt: ISO });
    expect(doc.verdict).toBe('block');
    expect(doc.counts.total).toBe(3);
    expect(doc.counts.byKind).toEqual({ correctness: 2, regression: 1 });
    expect(doc.body).toContain('CRITICAL: 3');
    expect(doc.body).toContain('## Required Fixes');
    expect(doc.body).toContain('verdict: block');
  });

  test('preserves violation line / snippet / hint as bullets', () => {
    const env = makeEnvelope({
      passed: false,
      gateAction: 'warn',
      violations: [makeViolation({ kind: 'type-safety', line: 7, snippet: 'const x: any = ...', hint: 'avoid `any` at public boundary' })]
    });
    const doc = adaptEccEnvelopeToRdCodeReview(env, { rid: '2026-06-26-test', generatedAt: ISO });
    expect(doc.body).toMatch(/- \[type-safety @ line 7\].*avoid `any` at public boundary/);
    expect(doc.body).toContain('`const x: any = ...`');
  });

  test('escapes markdown-breaking chars in hint / snippet (no code-fence injection, no bullet-list breakage)', () => {
    const env = makeEnvelope({
      passed: false,
      gateAction: 'warn',
      violations: [
        makeViolation({
          kind: 'other',
          line: 99,
          snippet: '- already a bullet\nwith a newline',
          hint: '## fake heading\n- nested bullet\n```ts\ncode fence attempt'
        })
      ]
    });
    const doc = adaptEccEnvelopeToRdCodeReview(env, { rid: '2026-06-26-test', generatedAt: ISO });
    // Newlines collapse to spaces so a violation cannot span multiple lines.
    // The escaped snippet must not start with a bullet marker (we strip leading `- `).
    expect(doc.body).not.toContain('```'); // code fence attempt neutralised
    expect(doc.body).toContain('code fence attempt'); // content preserved
    // Hint escapes: `##` survives as text (not a heading), newlines collapse.
    const hintLineMatch = doc.body.match(/## fake heading/);
    expect(hintLineMatch).not.toBeNull();
    // No spurious nested bullets: after the outer bullet, no line begins with "- ".
    const lines = doc.body.split('\n');
    const hintBlockStart = lines.findIndex((l) => l.includes('## fake heading'));
    expect(hintBlockStart).toBeGreaterThan(-1);
    // The escaped snippet lives on the same line as its parent bullet.
    expect(lines[hintBlockStart]).toContain('code fence attempt');
  });
});

describe('detectEcc — 5-state detector (mirrors ocr-service.ts shape)', () => {
  test('plugin missing → state=plugin-missing, with install hint', () => {
    const r = detectEcc({ pluginInstalled: false, agentAvailable: false });
    expect(r.state).toBe('plugin-missing');
    expect(r.pluginInstalled).toBe(false);
    expect(r.agentAvailable).toBe(false);
    expect(r.warnings).toEqual([]);
    expect(r.nextActions.length).toBeGreaterThan(0);
    expect(r.nextActions.join(' ')).toContain('everything-claude-code');
  });

  test('plugin present but agent absent → state=agent-missing', () => {
    const r = detectEcc({ pluginInstalled: true, agentAvailable: false });
    expect(r.state).toBe('agent-missing');
    expect(r.pluginInstalled).toBe(true);
    expect(r.agentAvailable).toBe(false);
    expect(r.warnings[0]).toContain('code-review');
  });

  test('plugin + agent present but dispatch threw → state=dispatch-failed', () => {
    const err = new Error('agent registry timeout');
    const r = detectEcc({ pluginInstalled: true, agentAvailable: true, dispatchError: err });
    expect(r.state).toBe('dispatch-failed');
    expect(r.warnings[0]).toContain('agent registry timeout');
    expect(r.nextActions.join(' ')).toContain('inline code review');
  });

  test('dispatch returned a malformed envelope → state=envelope-malformed', () => {
    const r = detectEcc({ pluginInstalled: true, agentAvailable: true, envelope: { passed: 'yes' } });
    expect(r.state).toBe('envelope-malformed');
    expect(r.warnings[0]).toContain('envelope validation');
  });

  test('ready state when plugin + agent + envelope are all valid', () => {
    const env = makeEnvelope();
    const r = detectEcc({ pluginInstalled: true, agentAvailable: true, envelope: env });
    expect(r.state).toBe('ready');
    expect(r.warnings).toEqual([]);
    expect(r.nextActions).toEqual([]);
  });
});

describe('runEccCodeReview — detect + adapt aggregator', () => {
  test('ready state returns both detect and doc', () => {
    const env = makeEnvelope({ gateAction: 'warn', violations: [makeViolation()] });
    const result = runEccCodeReview({
      rid: '2026-06-26-test',
      generatedAt: ISO,
      pluginInstalled: true,
      agentAvailable: true,
      envelope: env
    });
    expect(result.detect.state).toBe('ready');
    expect(result.doc).not.toBeNull();
    expect(result.doc?.verdict).toBe('warn');
  });

  test('non-ready state returns detect + null doc (caller falls back to inline)', () => {
    const result = runEccCodeReview({
      rid: '2026-06-26-test',
      generatedAt: ISO,
      pluginInstalled: false,
      agentAvailable: false
    });
    expect(result.detect.state).toBe('plugin-missing');
    expect(result.doc).toBeNull();
  });
});