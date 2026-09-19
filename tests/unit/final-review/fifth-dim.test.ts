import { describe, expect, it } from 'vitest';
// addFifthDim is exported by re-export from final-review-service.ts.
// If your tsconfig path alias differs, use a relative import.
import { decideFifthDimension } from '~/src/services/final-review/final-review-service';
import { isStale } from '~/src/services/capability-audit-service/staleness';
import type { AuditCoverage } from '~/src/services/capability-audit-service/types';
import { P0_JOURNEY_IDS } from '~/src/services/capability-baseline/types';

// `CapabilityAuditResult` requires three fields that `decideFifthDimension`
// never reads: `degraded`, `findings`, `coverage`. They are still required by
// the type, and their values are derived from the producer
// (`runAudit` + `runIndependentCheck` in src/services/capability-audit-service/)
// rather than guessed:
//   - `degraded: false` — `degraded` is true only for a stub scorer
//     (`input.scorerMode === 'stub'`), and `runAudit` forces a degraded run's
//     verdict to `'inconclusive'`. Every fixture below asserts `'consistent'`
//     or `'drifted'`, which a degraded audit can never carry.
//   - `findings` — `runIndependentCheck` sets the verdict as
//     `findings.length === 0 ? 'consistent' : 'drifted'`, so a `'consistent'`
//     fixture must carry an empty array and the `'drifted'` fixture a non-empty
//     one.
//   - `coverage` — non-null on any live (non-degraded) run. `observations`
//     matches `observationsExpected`, which the producer derives from
//     `P0_JOURNEY_IDS.length`.
// The fixtures' `dimensions: []` is their own pre-existing minimal shape; these
// three fields are inert for the unit under test either way.
const LIVE_COVERAGE: AuditCoverage = {
  observations: P0_JOURNEY_IDS.length,
  observationsExpected: P0_JOURNEY_IDS.length,
  invariantsFrozen: 0,
  invariantsArmed: 0,
  forbiddenChangesUnverified: 0
};

describe('Scenario: decideFifthDimension', () => {
  it('when invoked, should returns inconclusive when audit is missing', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const v = decideFifthDimension({ audit: null, nowMs: Date.parse('2026-08-04T00:00:00.000Z') });
    expect(v.verdict).toBe('inconclusive');
  });
  it('when invoked, should returns inconclusive when audit is stale', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const v = decideFifthDimension({
      audit: {
        auditId: 'a',
        auditedAt: '2026-08-01T00:00:00.000Z',
        verdict: 'consistent',
        dimensions: [],
        crossCheck: { guardVsAudit: 'agree', karpathyVsAudit: 'agree' },
        requiresUserDecision: false,
        degraded: false,
        findings: [],
        coverage: LIVE_COVERAGE
      },
      nowMs: Date.parse('2026-08-04T00:00:00.000Z')
    });
    expect(v.verdict).toBe('inconclusive');
  });
  it('when invoked, should returns pass on consistent', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const v = decideFifthDimension({
      audit: {
        auditId: 'a',
        auditedAt: '2026-08-03T23:00:00.000Z',
        verdict: 'consistent',
        dimensions: [],
        crossCheck: { guardVsAudit: 'agree', karpathyVsAudit: 'agree' },
        requiresUserDecision: false,
        degraded: false,
        findings: [],
        coverage: LIVE_COVERAGE
      },
      nowMs: Date.parse('2026-08-04T00:00:00.000Z')
    });
    expect(v.verdict).toBe('pass');
  });
  it('when invoked, should returns fail on drifted', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const v = decideFifthDimension({
      audit: {
        auditId: 'a',
        auditedAt: '2026-08-03T23:00:00.000Z',
        verdict: 'drifted',
        dimensions: [],
        crossCheck: { guardVsAudit: 'agree', karpathyVsAudit: 'agree' },
        requiresUserDecision: true,
        degraded: false,
        // A `drifted` verdict implies at least one finding (see the derivation
        // note at the top of this file). Drift via a missing frozen source file
        // is independent of the observation count, so full coverage is a
        // coherent companion here.
        findings: [
          {
            code: 'SOURCE_FILE_MISSING',
            journeyId: 'J01',
            detail: 'frozen sourceFiles entry no longer exists on disk'
          }
        ],
        coverage: LIVE_COVERAGE
      },
      nowMs: Date.parse('2026-08-04T00:00:00.000Z')
    });
    expect(v.verdict).toBe('fail');
  });
  it('when invoked, should returns inconclusive on cross-check diverge', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const v = decideFifthDimension({
      audit: {
        auditId: 'a',
        auditedAt: '2026-08-03T23:00:00.000Z',
        verdict: 'consistent',
        dimensions: [],
        crossCheck: { guardVsAudit: 'diverge', karpathyVsAudit: 'agree' },
        requiresUserDecision: true,
        degraded: false,
        findings: [],
        coverage: LIVE_COVERAGE
      },
      nowMs: Date.parse('2026-08-04T00:00:00.000Z')
    });
    expect(v.verdict).toBe('inconclusive');
  });
  it('when invoked, should isStale is exposed for cross-check', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(isStale('2026-08-02T00:00:00.000Z', Date.parse('2026-08-04T00:00:00.000Z'))).toBe(true);
  });
});
