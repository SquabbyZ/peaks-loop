/**
 * Conformance runner — Phase 3 Task 3.4.
 *
 * Runs all `ConformanceCase` definitions against a fake-host harness and
 * a recorded capability profile. The runner is vendor-neutral — the
 * fake-host harness is the only place a host model could leak.
 */
import type { CapabilityProfile } from '../compact-core/protocol/capability-profile.js';
import { ALL_CASES, type ConformanceCase, type FakeHostHarness } from './conformance-cases.js';
import type { CompactConformanceCaseResult, CompactConformanceReport } from './conformance-types.js';
import { buildReport } from './evidence-recorder.js';

export interface ConformanceRunnerOptions {
  readonly h: FakeHostHarness;
  readonly profile: CapabilityProfile;
  readonly now?: () => Date;
}

export class ConformanceRunner {
  private readonly h: FakeHostHarness;
  private readonly profile: CapabilityProfile;
  private readonly now: () => Date;

  constructor(opts: ConformanceRunnerOptions) {
    this.h = opts.h;
    this.profile = opts.profile;
    this.now = opts.now ?? (() => new Date());
  }

  /** Run a single case by id. Returns the case's result or marks it skipped if absent. */
  async runOne(caseId: string): Promise<CompactConformanceCaseResult> {
    const c = ALL_CASES.find((x) => x.caseId === caseId);
    const start = this.now();
    if (!c) {
      return {
        caseId,
        status: 'skipped',
        startedAt: start.toISOString(),
        completedAt: this.now().toISOString(),
        evidence: []
      };
    }
    return c.run({ h: this.h, profile: this.profile });
  }

  /** Run every registered case. */
  async runAll(): Promise<CompactConformanceReport> {
    const results: CompactConformanceCaseResult[] = [];
    for (const c of ALL_CASES) {
      const r = await c.run({ h: this.h, profile: this.profile });
      results.push(r);
    }
    return buildReport(results, this.now());
  }

  /** Run only the cases marked as required for `certified-strong`. */
  async runStrong(): Promise<CompactConformanceCaseResult[]> {
    const out: CompactConformanceCaseResult[] = [];
    for (const c of ALL_CASES.filter((x) => x.strong)) {
      out.push(await c.run({ h: this.h, profile: this.profile }));
    }
    return out;
  }
}
