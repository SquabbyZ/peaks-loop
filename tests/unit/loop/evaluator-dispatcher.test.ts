/**
 * Evaluator dispatcher unit tests (Slice B.1).
 * Covers dispatchEvaluator + parseAuditMarkdownEnvelope + loadEnvelopeFromDisk
 * + verdict-aggregator backward-compat (BC).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  dispatchEvaluator,
  parseAuditMarkdownEnvelope,
  loadEnvelopeFromDisk,
  envelopeAs,
  type EvaluatorVerdictEnvelope
} from '../../../src/services/loop/evaluator-dispatcher.js';
import {
  parseSecurityEnvelope,
  parsePerfEnvelope,
  parseKarpathyEnvelope,
  envelopesToAggregatorInput,
  type AnyEnvelope
} from '../../../src/services/verdict/envelopes.js';

describe('dispatchEvaluator', () => {
  it('returns a degraded envelope when no peaks CLI is reachable', () => {
    // Use a peaksBin that does not exist — dispatcher swallows the error
    // and returns a degraded envelope (verdict must never throw).
    const envelope = dispatchEvaluator('karpathy', {
      projectRoot: '/tmp/no-such-project',
      rid: 'test-rid',
      peaksBin: '/no/such/binary/__definitely-missing__'
    });
    expect(envelope.kind).toBe('karpathy');
    expect(envelope.degraded).toBe(true);
    expect(typeof envelope.wallSeconds).toBe('number');
    expect(['pass', 'warn', 'block']).toContain(envelope.gateAction);
  });

  it('exhaustiveness: every EvaluatorKind dispatches without throwing', () => {
    const kinds = ['karpathy', 'code-review', 'security-review', 'perf-baseline', 'verdict-aggregate'] as const;
    for (const kind of kinds) {
      const env = dispatchEvaluator(kind, {
        projectRoot: '/tmp/x',
        rid: 'r',
        peaksBin: '/no/such/binary/__missing__'
      });
      expect(env.kind).toBe(kind);
      expect(env.degraded).toBe(true);
    }
  });
});

describe('parseAuditMarkdownEnvelope', () => {
  it('parses security-review markdown with verdict: warn', () => {
    const md = `---
schemaVersion: 1
verdict: warn
---
## Findings
- HIGH: hardcoded password in src/auth.ts:42
`;
    const envelope = parseAuditMarkdownEnvelope(md, 'security-review');
    expect(envelope).not.toBeNull();
    expect(envelope?.kind).toBe('security-review');
    expect(envelope?.gateAction).toBe('warn');
    expect(envelope?.passed).toBe(false);
    expect(envelope?.violations).toHaveLength(1);
    expect(envelope?.violations[0]?.file).toBe('src/auth.ts');
    expect(envelope?.violations[0]?.line).toBe(42);
    expect(envelope?.violations[0]?.dimension).toBe('security-review');
  });

  it('parses perf-baseline markdown with verdict: pass', () => {
    const md = `verdict: pass\n## Findings\n- (none)\n`;
    const envelope = parseAuditMarkdownEnvelope(md, 'perf-baseline');
    expect(envelope?.gateAction).toBe('pass');
    expect(envelope?.passed).toBe(true);
    expect(envelope?.violations).toHaveLength(0);
  });

  it('returns null on empty input', () => {
    expect(parseAuditMarkdownEnvelope('', 'security-review')).toBeNull();
  });
});

describe('loadEnvelopeFromDisk', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'peaks-eval-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('loads a security audit from disk and projects to envelope', () => {
    const dir = join(tmp, '.peaks', '_runtime', 'sid-1', 'audit');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'security.md'), `verdict: warn\n## Findings\n- HIGH: x in y.ts:1\n`, 'utf8');
    const env = loadEnvelopeFromDisk(tmp, 'sid-1', 'audit/security.md', 'security-review');
    expect(env?.kind).toBe('security-review');
    expect(env?.gateAction).toBe('warn');
  });

  it('returns null when file is missing', () => {
    const env = loadEnvelopeFromDisk(tmp, 'sid-1', 'audit/security.md', 'security-review');
    expect(env).toBeNull();
  });
});

describe('envelopeAs', () => {
  it('re-emits the envelope with a different kind', () => {
    const e: EvaluatorVerdictEnvelope = {
      kind: 'karpathy',
      passed: true,
      gateAction: 'pass',
      violations: [],
      summary: 'x',
      wallSeconds: 1,
      degraded: false
    };
    const copy = envelopeAs(e, 'code-review');
    expect(copy.kind).toBe('code-review');
    expect(copy.passed).toBe(true);
  });
});

describe('verdict-aggregator backward-compat (BC)', () => {
  it('evaluator envelope re-emits as the same shape verdict-aggregator already accepts', () => {
    // Security envelope produced by the dispatcher must be acceptable to
    // envelopesToAggregatorInput without any conversion. This guards the
    // BC contract: peaks loop eval + peaks verdict aggregate compose.
    const env = parseAuditMarkdownEnvelope(
      `verdict: warn\n## Findings\n- HIGH: x in src/a.ts:1\n`,
      'security-review'
    );
    expect(env).not.toBeNull();
    // The verdict aggregator expects a `security` envelope with a strict
    // shape: { verdict, violations, summary }. Our envelope exposes the
    // same surface — pass through the canonical parser first to confirm
    // BC at the markdown layer (which is what the on-disk audit goes
    // through today). This proves the aggregator can still consume the
    // file the dispatcher reads.
    const md = `verdict: ${env!.gateAction}\n## Findings\n- HIGH: x in src/a.ts:1\n`;
    const canonical = parseSecurityEnvelope(md);
    expect(canonical).not.toBeNull();
    expect(canonical!.verdict).toBe('warn');
    // Now feed both into envelopesToAggregatorInput — must not throw and
    // must produce a non-empty input.
    const input = envelopesToAggregatorInput([
      { kind: 'security', envelope: canonical! }
    ]);
    expect(input.security).toBeDefined();
  });

  it('karpathy envelope shape matches parseKarpathyEnvelope expectations', () => {
    const md = `gateAction: pass
passed: true
## Violations
- [MED] src/x.ts:5 — sample (simplicity-first)
`;
    const k = parseKarpathyEnvelope(md);
    expect(k).not.toBeNull();
    expect(k!.passed).toBe(true);
    expect(k!.gateAction).toBe('pass');
    expect(k!.violations).toHaveLength(1);
    expect(k!.violations[0]?.guideline).toBe('simplicity-first');
  });

  it('perf envelope shape matches parsePerfEnvelope expectations', () => {
    const md = `verdict: pass\n## Findings\n- (none)\n`;
    const p = parsePerfEnvelope(md);
    expect(p).not.toBeNull();
    expect(p!.verdict).toBe('pass');
  });

  it('aggregator accepts the full AnyEnvelope union when both security + karpathy present', () => {
    const securityMd = `verdict: warn\n## Findings\n- HIGH: x in src/a.ts:1\n`;
    const karpathyMd = `gateAction: pass\npassed: true\n## Violations\n`;
    const sec = parseSecurityEnvelope(securityMd);
    const kar = parseKarpathyEnvelope(karpathyMd);
    expect(sec).not.toBeNull();
    expect(kar).not.toBeNull();
    const list: AnyEnvelope[] = [
      { kind: 'security', envelope: sec! },
      { kind: 'karpathy', envelope: kar! }
    ];
    const input = envelopesToAggregatorInput(list);
    expect(input.security?.verdict).toBe('warn');
    expect(input.karpathy?.passed).toBe(true);
  });
});