/**
 * v2.13.1 Group A — verdict-aggregator unit tests.
 *
 * Pins AC-2 of the v2.13.1 verdict-aggregator PRD with 8 cases
 * (A through H). The aggregator is pure — no I/O, no clock —
 * so we exercise it with hand-built envelopes.
 */
import { describe, test, expect } from 'vitest';
import {
  aggregateVerdict,
  type AggregatorInput,
  type KarpathyEnvelope,
  type MutEnvelope,
  type QaEnvelope
} from '../../../../src/services/verdict/verdict-aggregator.js';
import type { SecurityAuditEnvelope } from 'peaks-loop-audit-independent';
import type { PerfAuditEnvelope } from 'peaks-loop-audit-independent';

// ─── Hand-built envelope fixtures ──────────────────────────────────────

function passSecurity(): SecurityAuditEnvelope {
  return { verdict: 'pass', violations: [], summary: 'all clean' };
}

function blockSecurity(file: string, line: number, hint: string): SecurityAuditEnvelope {
  return {
    verdict: 'block',
    violations: [{ dimension: 'auth', severity: 'CRITICAL', file, line, hint }],
    summary: 'one blocker'
  };
}

function warnSecurity(file: string, line: number, hint: string): SecurityAuditEnvelope {
  return {
    verdict: 'warn',
    violations: [{ dimension: 'auth', severity: 'HIGH', file, line, hint }],
    summary: 'one warn'
  };
}

function passPerf(): PerfAuditEnvelope {
  return { verdict: 'pass', violations: [], summary: 'all clean' };
}

function warnPerf(file: string, line: number, hint: string): PerfAuditEnvelope {
  return {
    verdict: 'warn',
    violations: [{ dimension: 'render', severity: 'HIGH', file, line, hint }],
    summary: 'one warn'
  };
}

function criticalPerf(file: string, line: number, hint: string): PerfAuditEnvelope {
  return {
    verdict: 'block',
    violations: [{ dimension: 'render', severity: 'CRITICAL', file, line, hint }],
    summary: 'one critical'
  };
}

function passKarpathy(): KarpathyEnvelope {
  return { passed: true, violations: [], gateAction: 'pass' };
}

function warnKarpathy(file: string, line: number, hint: string): KarpathyEnvelope {
  return {
    passed: false,
    violations: [
      {
        guideline: 'simplicity-first',
        severity: 'HIGH',
        file,
        line,
        hint
      }
    ],
    gateAction: 'warn'
  };
}

function passMut(): MutEnvelope {
  return { passed: true, killRate: 0.92, weakRate: 0.02, violations: [] };
}

function failingMut(killRate: number): MutEnvelope {
  return {
    passed: false,
    killRate,
    weakRate: 0.04,
    violations: [
      { kind: 'mutationKillRateMin', actual: killRate, threshold: 0.8 }
    ]
  };
}

function passQa(): QaEnvelope {
  return { verdict: 'pass' };
}

function returnToRdQa(): QaEnvelope {
  return { verdict: 'return-to-rd', reportPath: '.peaks/_runtime/sid/qa/test-reports/rid.md' };
}

function blockedQa(): QaEnvelope {
  return { verdict: 'blocked', reportPath: '.peaks/_runtime/sid/qa/test-reports/rid.md' };
}

// ─── 8 PRD-mandated cases (AC-2 behavior A through H) ─────────────────

describe('v2.13.1 verdict-aggregator (AC-2 behaviors A-H)', () => {
  test('A: all 5 inputs pass → verdict=pass, reasons empty', () => {
    const input: AggregatorInput = {
      security: passSecurity(),
      perf: passPerf(),
      karpathy: passKarpathy(),
      mut: passMut(),
      qa: passQa()
    };
    const out = aggregateVerdict(input);
    expect(out.verdict).toBe('pass');
    expect(out.reasons).toEqual([]);
  });

  test('B: security=block (1 violation) → verdict=block, reasons carry source/severity/file/line/hint', () => {
    const input: AggregatorInput = {
      security: blockSecurity('src/auth/login.ts', 42, 'plaintext password compare')
    };
    const out = aggregateVerdict(input);
    expect(out.verdict).toBe('block');
    expect(out.reasons).toHaveLength(1);
    const r = out.reasons[0]!;
    expect(r.source).toBe('security-audit');
    expect(r.signal).toBe('block');
    expect(r.severity).toBe('CRITICAL');
    expect(r.file).toBe('src/auth/login.ts');
    expect(r.line).toBe(42);
    expect(r.hint).toBe('plaintext password compare');
  });

  test('C: mut=passed:false (killRate < 0.8) → verdict=block, reasons carry kind/actual/threshold', () => {
    const input: AggregatorInput = {
      mut: failingMut(0.62)
    };
    const out = aggregateVerdict(input);
    expect(out.verdict).toBe('block');
    expect(out.reasons).toHaveLength(1);
    const r = out.reasons[0]!;
    expect(r.source).toBe('peaks-mut');
    expect(r.signal).toBe('block');
    expect(r.kind).toBe('mutationKillRateMin');
    expect(r.actual).toBe(0.62);
    expect(r.threshold).toBe(0.8);
    expect(r.hint).toMatch(/kill rate 0\.620 < 0\.800/);
  });

  test('D: qa=return-to-rd (no block) → verdict=return-to-rd, reasons carry qa reportPath', () => {
    const input: AggregatorInput = {
      qa: returnToRdQa()
    };
    const out = aggregateVerdict(input);
    expect(out.verdict).toBe('return-to-rd');
    expect(out.reasons).toHaveLength(1);
    const r = out.reasons[0]!;
    expect(r.source).toBe('peaks-qa');
    expect(r.signal).toBe('return-to-rd');
    expect(r.reportPath).toBe('.peaks/_runtime/sid/qa/test-reports/rid.md');
  });

  test('E: mixed warn (security + perf + karpathy all warn) → verdict=warn, reasons deduped to 3', () => {
    // Three distinct (file, line, hint) tuples — no dedup collisions.
    const input: AggregatorInput = {
      security: warnSecurity('src/auth/login.ts', 42, 'plaintext compare'),
      perf: warnPerf('src/ui/render.tsx', 17, 'layout thrash'),
      karpathy: warnKarpathy('src/services/aggregator.ts', 88, 'extra unused param')
    };
    const out = aggregateVerdict(input);
    expect(out.verdict).toBe('warn');
    expect(out.reasons).toHaveLength(3);
    const sources = new Set(out.reasons.map((r) => r.source));
    expect(sources.has('security-audit')).toBe(true);
    expect(sources.has('perf-audit')).toBe(true);
    expect(sources.has('karpathy-reviewer')).toBe(true);
  });

  test('F: 5 inputs all undefined (not run) → verdict=pass (degenerate safe)', () => {
    // The aggregator must NOT block a fresh session that hasn't yet
    // run any of the 5 audits — pre-existing happy path is preserved.
    const out = aggregateVerdict({});
    expect(out.verdict).toBe('pass');
    expect(out.reasons).toEqual([]);
  });

  test('G: precedence — block + pass + pass + pass + pass must yield block', () => {
    const input: AggregatorInput = {
      security: blockSecurity('src/auth/login.ts', 42, 'plaintext compare'),
      perf: passPerf(),
      karpathy: passKarpathy(),
      mut: passMut(),
      qa: passQa()
    };
    const out = aggregateVerdict(input);
    expect(out.verdict).toBe('block');
  });

  test('H: CRITICAL accumulation — security 2 CRITICAL + perf 1 CRITICAL → 3 reasons', () => {
    const security: SecurityAuditEnvelope = {
      verdict: 'block',
      violations: [
        { dimension: 'auth', severity: 'CRITICAL', file: 'src/a.ts', line: 1, hint: 'h1' },
        { dimension: 'auth', severity: 'CRITICAL', file: 'src/a.ts', line: 2, hint: 'h2' }
      ],
      summary: 'two critical'
    };
    const perf: PerfAuditEnvelope = {
      verdict: 'block',
      violations: [
        { dimension: 'render', severity: 'CRITICAL', file: 'src/b.ts', line: 1, hint: 'h3' }
      ],
      summary: 'one critical'
    };
    const out = aggregateVerdict({ security, perf });
    expect(out.verdict).toBe('block');
    expect(out.reasons).toHaveLength(3);
    expect(out.reasons.filter((r) => r.severity === 'CRITICAL')).toHaveLength(3);
  });
});

// ─── Extra precedence matrix (Karpathy §1: prove no ambiguity) ────────

describe('verdict-aggregator precedence matrix', () => {
  test('return-to-rd beats warn (no block in mix)', () => {
    const out = aggregateVerdict({
      security: warnSecurity('src/a.ts', 1, 'h'),
      qa: returnToRdQa()
    });
    expect(out.verdict).toBe('return-to-rd');
  });

  test('block beats return-to-rd', () => {
    const out = aggregateVerdict({
      security: blockSecurity('src/a.ts', 1, 'h'),
      qa: returnToRdQa()
    });
    expect(out.verdict).toBe('block');
  });

  test('dedup — same (file, line, hint) tuple from security + perf merges to one reason', () => {
    const out = aggregateVerdict({
      security: {
        verdict: 'warn',
        violations: [{ dimension: 'd', severity: 'HIGH', file: 'src/x.ts', line: 7, hint: 'shared' }],
        summary: ''
      },
      perf: {
        verdict: 'warn',
        violations: [{ dimension: 'd', severity: 'HIGH', file: 'src/x.ts', line: 7, hint: 'shared' }],
        summary: ''
      }
    });
    expect(out.verdict).toBe('warn');
    // v2.13.2 BLOCKER fix: dedup key is (file,line,hint) only — both
    // sources collapse into a single reason entry, with `sources`
    // listing every contributing source.
    expect(out.reasons).toHaveLength(1);
    const r = out.reasons[0]!;
    expect(r.source).toBe('security-audit');
    expect(r.sources).toEqual(['security-audit', 'perf-audit']);
  });

  test('qa=blocked → block; reportPath flows through', () => {
    const out = aggregateVerdict({ qa: blockedQa() });
    expect(out.verdict).toBe('block');
    expect(out.reasons[0]?.signal).toBe('blocked');
    expect(out.reasons[0]?.reportPath).toBe('.peaks/_runtime/sid/qa/test-reports/rid.md');
  });
});

// ─── Pre-2.13.1 regression: mut reports with passed:false do NOT crash ─

describe('mut envelope failure modes', () => {
  test('mut fails with both killRate and weakRate violations', () => {
    const env: MutEnvelope = {
      passed: false,
      killRate: 0.55,
      weakRate: 0.20,
      violations: [
        { kind: 'mutationKillRateMin', actual: 0.55, threshold: 0.8 },
        { kind: 'weakAssertionRateMax', actual: 0.20, threshold: 0.05 }
      ]
    };
    const out = aggregateVerdict({ mut: env });
    expect(out.verdict).toBe('block');
    expect(out.reasons).toHaveLength(2);
    expect(out.reasons[0]?.kind).toBe('mutationKillRateMin');
    expect(out.reasons[1]?.kind).toBe('weakAssertionRateMax');
  });
});

// ─── v2.13.2 AC-1 BLOCKER: cross-source dedup via (file,line,hint) only ──

describe('v2.13.2 cross-source dedup (AC-1)', () => {
  test('I: security + perf report identical (file,line,hint) → 1 reason, sources = [security-audit, perf-audit]', () => {
    const out = aggregateVerdict({
      security: {
        verdict: 'warn',
        violations: [{ dimension: 'auth', severity: 'HIGH', file: 'src/auth/login.ts', line: 42, hint: 'plaintext compare' }],
        summary: ''
      },
      perf: {
        verdict: 'warn',
        violations: [{ dimension: 'render', severity: 'HIGH', file: 'src/auth/login.ts', line: 42, hint: 'plaintext compare' }],
        summary: ''
      }
    });
    expect(out.verdict).toBe('warn');
    expect(out.reasons).toHaveLength(1);
    const r = out.reasons[0]!;
    expect(r.sources).toHaveLength(2);
    expect(r.sources).toContain('security-audit');
    expect(r.sources).toContain('perf-audit');
    expect(r.file).toBe('src/auth/login.ts');
    expect(r.line).toBe(42);
    expect(r.hint).toBe('plaintext compare');
  });

  test('J: karpathy + security share (file,line,hint) → 1 reason, sources = [security-audit, karpathy-reviewer]', () => {
    const out = aggregateVerdict({
      security: {
        verdict: 'warn',
        violations: [{ dimension: 'auth', severity: 'HIGH', file: 'src/x.ts', line: 7, hint: 'shared-hint' }],
        summary: ''
      },
      karpathy: {
        passed: false,
        violations: [
          { guideline: 'simplicity-first', severity: 'HIGH', file: 'src/x.ts', line: 7, hint: 'shared-hint' }
        ],
        gateAction: 'warn'
      }
    });
    expect(out.verdict).toBe('warn');
    expect(out.reasons).toHaveLength(1);
    expect(out.reasons[0]!.sources).toEqual(['security-audit', 'karpathy-reviewer']);
  });

  test('K: single source repeating same (file,line,hint) → 1 reason, sources has exactly 1 entry (no duplication)', () => {
    const out = aggregateVerdict({
      security: {
        verdict: 'warn',
        violations: [
          { dimension: 'auth', severity: 'HIGH', file: 'src/x.ts', line: 1, hint: 'h' },
          { dimension: 'auth', severity: 'HIGH', file: 'src/x.ts', line: 1, hint: 'h' },
          { dimension: 'auth', severity: 'HIGH', file: 'src/x.ts', line: 1, hint: 'h' }
        ],
        summary: ''
      }
    });
    expect(out.verdict).toBe('warn');
    expect(out.reasons).toHaveLength(1);
    expect(out.reasons[0]!.sources).toEqual(['security-audit']);
  });
});