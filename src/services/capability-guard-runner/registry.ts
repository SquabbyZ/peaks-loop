// src/services/capability-guard-runner/registry.ts
//
// The single production entry point for the 15 P0 guard contracts.
//
// Why a registry: before this, `baseline run-guard` hard-coded `J01`, and the
// only caller of `runAllGuards` was its own unit test (which passed synthetic
// contracts against `projectRoot: '/'`). There was no production path that ran
// all fifteen journeys — so "15 pass / 0 fail" was an assertion nobody made.
//
// Each contract declares the baseline row AND the verbatim invariant text it
// enforces; `assertBaselineRef` resolves that against
// openspec/baselines/current/capability-baseline.json before the contract runs.
import { P0_JOURNEY_IDS, type JourneyId } from '../capability-baseline/types.js';
import type { ContractKind, GuardContract, GuardContext, GuardRunResult } from './types.js';
import { runJ01Contract } from './contracts/J01.js';
import { runJ02Contract } from './contracts/J02.js';
import { runJ03Contract } from './contracts/J03.js';
import { runJ04Contract } from './contracts/J04.js';
import { runJ05Contract } from './contracts/J05.js';
import { runJ06Contract } from './contracts/J06.js';
import { runJ07Contract } from './contracts/J07.js';
import { runJ08Contract } from './contracts/J08.js';
import { runJ09Contract } from './contracts/J09.js';
import { runJ10Contract } from './contracts/J10.js';
import { runJ11Contract } from './contracts/J11.js';
import { runJ12Contract } from './contracts/J12.js';
import { runJ13Contract } from './contracts/J13.js';
import { runJ14Contract } from './contracts/J14.js';
import { runJ15Contract } from './contracts/J15.js';

type ContractSpec = {
  readonly kind: ContractKind;
  readonly invariant: string;
  readonly execute: (ctx: GuardContext) => Promise<GuardRunResult>;
};

/** The integration test that pins each journey's contract. */
const ARTIFACTS: Readonly<Record<JourneyId, string>> = {
  J01: 'tests/integration/capability-guard/J01-envelope-arg-shapes.test.ts',
  J02: 'tests/integration/capability-guard/J02-workflow-trace.test.ts',
  J03: 'tests/integration/capability-guard/J03-problem-resolution-flow.test.ts',
  J04: 'tests/integration/capability-guard/J04-audit-goal-binding.test.ts',
  J05: 'tests/integration/capability-guard/J05-final-review-shape.test.ts',
  J06: 'tests/integration/capability-guard/J06-resume-deepest-gate.test.ts',
  J07: 'tests/integration/capability-guard/J07-test-runner-fidelity.test.ts',
  J08: 'tests/integration/capability-guard/J08-asset-roundtrip.test.ts',
  J09: 'tests/integration/capability-guard/J09-sop-register.test.ts',
  J10: 'tests/integration/capability-guard/J10-ide-install-assertion.test.ts',
  J11: 'tests/integration/capability-guard/J11-doctor-cli-snapshot.test.ts',
  J12: 'tests/integration/capability-guard/J12-lease-lifecycle.test.ts',
  J13: 'tests/integration/capability-guard/J13-content-pipeline-trace.test.ts',
  J14: 'tests/integration/capability-guard/J14-issue-orchestrator-trace.test.ts',
  J15: 'tests/integration/capability-guard/J15-spec-coverage.test.ts'
};

/** One row per P0 journey. `invariant` must be verbatim baseline text. */
const SPECS: Readonly<Record<JourneyId, ContractSpec>> = {
  J01: {
    kind: 'envelope-arg-shapes',
    invariant: 'The CLI verb is never shown to the user as a required input',
    execute: runJ01Contract
  },
  J02: {
    kind: 'workflow-trace',
    invariant: 'Every hard gate (audit / RD / QA / final-review) is enforced; a failure transitions state back to the prior role',
    execute: runJ02Contract
  },
  J03: {
    kind: 'workflow-trace',
    invariant: 'No silent-catch or fake-green pattern is reintroduced in src/services/**',
    execute: runJ03Contract
  },
  J04: {
    kind: 'hook-assertion',
    invariant: 'The audit covers exactly six dimensions: correctness, completeness, scope, risks, alternatives, constraints',
    execute: runJ04Contract
  },
  J05: {
    kind: 'workflow-trace',
    invariant: 'Every final review contains exactly four dimensions: functional-completeness, problem-resolution, no-new-bugs, existing-functionality-intact',
    execute: runJ05Contract
  },
  J06: {
    kind: 'workflow-trace',
    invariant: 'The resume option always identifies the deepest completed gate (audit / RD / QA / final-review)',
    execute: runJ06Contract
  },
  J07: {
    kind: 'cli-output-golden',
    invariant: "Per-test fingerprint cache never returns 'passed' for an unverified file (fileMtime + fileSha256 gate)",
    execute: runJ07Contract
  },
  J08: {
    kind: 'asset-roundtrip',
    invariant: 'Crystallization requires all gates (audit / RD / QA / final-review) to be in a passing state',
    execute: runJ08Contract
  },
  J09: {
    kind: 'sop-register',
    invariant: 'An SOP id must match SOP_ID_PATTERN (lowercase kebab, no dots/slashes) to prevent path traversal',
    execute: runJ09Contract
  },
  J10: {
    kind: 'hook-assertion',
    invariant: 'planHookInstall() runs before applyHookInstall() so the diff is reviewable',
    execute: runJ10Contract
  },
  J11: {
    kind: 'cli-output-golden',
    invariant: 'Doctor checks live under src/services/doctor/doctor-service/checks/ as a code-driven fixed-registry tree',
    execute: runJ11Contract
  },
  J12: {
    kind: 'concurrency-lease',
    invariant: 'Auto-release on terminal heartbeat is best-effort but idempotent: duplicate release is a no-op',
    execute: runJ12Contract
  },
  J13: {
    kind: 'workflow-trace',
    invariant: 'The skill does NOT import peaks-code internals; it reuses the Loop Engineering primitives',
    execute: runJ13Contract
  },
  J14: {
    kind: 'workflow-trace',
    invariant: 'Every fix carries an AI-modified declaration in the commit body (RL-3)',
    execute: runJ14Contract
  },
  J15: {
    kind: 'spec-coverage',
    invariant: 'Coverage-summary discovery order is fixed: <projectRoot>/coverage/coverage-summary.json then /openspec/coverage-summary.json',
    execute: runJ15Contract
  }
};

export const GUARD_CONTRACTS: ReadonlyArray<GuardContract> = P0_JOURNEY_IDS.map((journeyId) => {
  const spec = SPECS[journeyId];
  return {
    journeyId,
    kind: spec.kind,
    source: { baselineRow: journeyId, invariant: spec.invariant },
    execute: spec.execute,
    evidence: { kind: spec.kind, artifact: ARTIFACTS[journeyId] }
  } satisfies GuardContract;
});

export function getGuardContract(journeyId: JourneyId): GuardContract | undefined {
  return GUARD_CONTRACTS.find((c) => c.journeyId === journeyId);
}

export function isJourneyId(value: string): value is JourneyId {
  return (P0_JOURNEY_IDS as ReadonlyArray<string>).includes(value);
}
