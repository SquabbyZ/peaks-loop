// tests/unit/services/karpathy-cost/karpathy-cost-check-service.test.ts
//
// 4-dimension unit test for the karpathy-cost self-review service
// in src/services/karpathy-cost/karpathy-cost-check-service.ts.
//
// Dimensions covered:
//   - render:    decision-kind discriminator + reason-line text
//   - behavior:  costRatio 10/50 boundaries, 24h-mode override,
//                missing-cost-data fallback
//   - integration: real fs read of a small JSON envelope in tmp
//   - a11y:      reasonLine is human-readable, single-line, no
//                stack-trace fragment, and never tells the
//                user to type a CLI verb
//
// Run with: pnpm vitest run tests/unit/services/karpathy-cost/karpathy-cost-check-service.test.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';
import { withEnv } from '../../_setup/io.js';

declareDimensions(
  'tests/unit/services/karpathy-cost/karpathy-cost-check-service.test.ts',
  ['render', 'behavior', 'integration', 'a11y'],
);

import {
  KARPATHY_COST_DOWNGRADE_THRESHOLD,
  KARPATHY_COST_REPORT_THRESHOLD,
  decideKarpathyCostCheck,
  runKarpathyCostCheck,
  type EvaluationCost,
  type KarpathyReviewEnvelope,
} from '~/src/services/karpathy-cost/karpathy-cost-check-service';

const COST: EvaluationCost = {
  wallMs: 5_000,
  subAgentsDispatched: 3,
  tokensEstimated: 8_000,
  sliceCodeSize: 50,
};

const ENVELOPE_BLOCK: KarpathyReviewEnvelope = {
  passed: false,
  violations: [{ kind: 'surgical-changes', line: 0, snippet: '', hint: 'test' }],
  gateAction: 'block',
  evaluationCost: COST,
  costRatio: COST.wallMs / COST.sliceCodeSize, // = 100
};

const ENVELOPE_PASS: KarpathyReviewEnvelope = {
  passed: true,
  violations: [],
  gateAction: 'pass',
  evaluationCost: COST,
  costRatio: COST.wallMs / COST.sliceCodeSize,
};

const NO_COST: KarpathyReviewEnvelope = {
  passed: true,
  violations: [],
  gateAction: 'pass',
  // no evaluationCost, no costRatio
};

describe('render — constants + decision shape', () => {
  it('downgrade threshold is the documented 10', () => {
    expect(KARPATHY_COST_DOWNGRADE_THRESHOLD).toBe(10);
  });

  it('report threshold is the documented 50', () => {
    expect(KARPATHY_COST_REPORT_THRESHOLD).toBe(50);
  });

  it('every decision includes a `kind` discriminator', () => {
    const out = decideKarpathyCostCheck({
      reviewFileContent: JSON.stringify(ENVELOPE_BLOCK),
      is24hModeActive: () => false,
    });
    expect(out.decision).toHaveProperty('kind');
    expect(typeof (out.decision as { kind: string }).kind).toBe('string');
  });

  it('reasonLine is a non-empty single line', () => {
    const out = decideKarpathyCostCheck({
      reviewFileContent: JSON.stringify(ENVELOPE_PASS),
      is24hModeActive: () => false,
    });
    expect(out.reasonLine.length).toBeGreaterThan(0);
    expect(out.reasonLine).not.toMatch(/\n/);
  });
});

describe('behavior — costRatio boundaries', () => {
  it('costRatio == downgrade threshold (10) does NOT downgrade (strict >)', () => {
    const envelope: KarpathyReviewEnvelope = {
      ...ENVELOPE_BLOCK,
      evaluationCost: { ...COST, sliceCodeSize: COST.wallMs / 10 }, // ratio exactly 10
      costRatio: 10,
    };
    const out = decideKarpathyCostCheck({
      reviewFileContent: JSON.stringify(envelope),
      is24hModeActive: () => false,
    });
    expect(out.decision.kind).toBe('unchanged');
  });

  it('costRatio slightly above 10 downgrades block -> warn', () => {
    // costRatio = wallMs / sliceCodeSize. wallMs=5000, sliceCodeSize=400
    // -> ratio = 12.5 (just above 10).
    const envelope: KarpathyReviewEnvelope = {
      ...ENVELOPE_BLOCK,
      evaluationCost: { ...COST, sliceCodeSize: 400 },
      costRatio: 12.5,
    };
    const out = decideKarpathyCostCheck({
      reviewFileContent: JSON.stringify(envelope),
      is24hModeActive: () => false,
    });
    expect(out.decision.kind).toBe('downgraded');
    if (out.decision.kind === 'downgraded') {
      expect(out.decision.originalGateAction).toBe('block');
      expect(out.decision.newGateAction).toBe('warn');
    }
  });

  it('costRatio > 50 with block reports (kind=downgraded) — block still downgraded', () => {
    const envelope: KarpathyReviewEnvelope = {
      ...ENVELOPE_BLOCK,
      evaluationCost: { ...COST, sliceCodeSize: 10 }, // ratio = 500
      costRatio: 500,
    };
    const out = decideKarpathyCostCheck({
      reviewFileContent: JSON.stringify(envelope),
      is24hModeActive: () => false,
    });
    // costRatio > 10 AND gateAction='block' → downgraded. The 'reported' kind
    // only fires when gateAction is NOT 'block' (e.g. 'pass' or 'warn').
    expect(out.decision.kind).toBe('downgraded');
  });

  it('costRatio > 50 with pass gate is `reported` (sediment-line kind)', () => {
    const envelope: KarpathyReviewEnvelope = {
      gateAction: 'pass',
      passed: true,
      violations: [],
      evaluationCost: { ...COST, sliceCodeSize: 10 },
      costRatio: 500,
    };
    const out = decideKarpathyCostCheck({
      reviewFileContent: JSON.stringify(envelope),
      is24hModeActive: () => false,
    });
    expect(out.decision.kind).toBe('reported');
  });

  it('costRatio <= 10 with any gate is `unchanged`', () => {
    const envelope: KarpathyReviewEnvelope = {
      gateAction: 'block',
      passed: false,
      violations: [],
      evaluationCost: { ...COST, sliceCodeSize: 10_000 }, // ratio = 0.5
      costRatio: 0.5,
    };
    const out = decideKarpathyCostCheck({
      reviewFileContent: JSON.stringify(envelope),
      is24hModeActive: () => false,
    });
    expect(out.decision.kind).toBe('unchanged');
  });
});

describe('behavior — 24h-mode override', () => {
  it('24h-mode active returns `24h-mode-active` regardless of envelope contents', () => {
    const out = decideKarpathyCostCheck({
      reviewFileContent: JSON.stringify(ENVELOPE_BLOCK),
      is24hModeActive: () => true,
    });
    expect(out.decision.kind).toBe('24h-mode-active');
  });

  it('24h-mode override is the OUTER check (envelope contents are NOT parsed)', () => {
    // The override is decided BEFORE JSON.parse — the CLI does not
    // need to load the envelope when 24h-mode is active.
    const out = decideKarpathyCostCheck({
      reviewFileContent: 'not even JSON',
      is24hModeActive: () => true,
    });
    expect(out.decision.kind).toBe('24h-mode-active');
  });

  it('24h-mode inactive falls through to envelope-based decision', () => {
    const out = decideKarpathyCostCheck({
      reviewFileContent: JSON.stringify(ENVELOPE_BLOCK),
      is24hModeActive: () => false,
    });
    expect(out.decision.kind).toBe('downgraded');
  });
});

describe('behavior — missing cost data', () => {
  it('envelope without evaluationCost returns `no-cost-data`', () => {
    const out = decideKarpathyCostCheck({
      reviewFileContent: JSON.stringify(NO_COST),
      is24hModeActive: () => false,
    });
    expect(out.decision.kind).toBe('no-cost-data');
    if (out.decision.kind === 'no-cost-data') {
      expect(out.decision.reason).toBe('envelope-missing-evaluationCost');
    }
  });

  it('envelope with evaluationCost but missing costRatio returns `no-cost-data`', () => {
    const envelope = { ...COST, gateAction: 'block' } as unknown as KarpathyReviewEnvelope;
    const out = decideKarpathyCostCheck({
      reviewFileContent: JSON.stringify(envelope),
      is24hModeActive: () => false,
    });
    expect(out.decision.kind).toBe('no-cost-data');
  });

  it('non-JSON content returns `no-cost-data` with reason=envelope-not-json', () => {
    const out = decideKarpathyCostCheck({
      reviewFileContent: 'not even JSON {',
      is24hModeActive: () => false,
    });
    expect(out.decision.kind).toBe('no-cost-data');
    if (out.decision.kind === 'no-cost-data') {
      expect(out.decision.reason).toBe('envelope-not-json');
    }
  });
});

describe('integration — runKarpathyCostCheck over real fs', () => {
  withTmpWorkspacePerTest();
  withEnv('USERPROFILE', process.cwd());
  withEnv('HOME', process.cwd());

  it('reads a real envelope from disk and returns `downgraded`', () => {
    const p = join(process.cwd(), 'karpathy-review.json');
    writeFileSync(p, JSON.stringify(ENVELOPE_BLOCK), 'utf8');
    const out = runKarpathyCostCheck({
      reviewFilePath: p,
      is24hModeActive: () => false,
    });
    expect(out.decision.kind).toBe('downgraded');
  });

  it('returns `no-cost-data` with reason=file-missing when the file does not exist', () => {
    const out = runKarpathyCostCheck({
      reviewFilePath: join(process.cwd(), 'no-such-file.json'),
      is24hModeActive: () => false,
    });
    expect(out.decision.kind).toBe('no-cost-data');
    if (out.decision.kind === 'no-cost-data') {
      expect(out.decision.reason).toBe('file-missing');
    }
  });

  it('reads a real `unchanged` envelope (costRatio <= 10)', () => {
    const p = join(process.cwd(), 'cheap-review.json');
    const envelope: KarpathyReviewEnvelope = {
      gateAction: 'pass',
      passed: true,
      violations: [],
      evaluationCost: { ...COST, sliceCodeSize: 10_000 },
      costRatio: 0.5,
    };
    writeFileSync(p, JSON.stringify(envelope), 'utf8');
    const out = runKarpathyCostCheck({
      reviewFilePath: p,
      is24hModeActive: () => false,
    });
    expect(out.decision.kind).toBe('unchanged');
  });

  it('passes through the 24h-mode flag without touching the file', () => {
    const p = join(process.cwd(), 'would-not-be-read.json');
    writeFileSync(p, JSON.stringify(ENVELOPE_BLOCK), 'utf8');
    const out = runKarpathyCostCheck({
      reviewFilePath: p,
      is24hModeActive: () => true,
    });
    expect(out.decision.kind).toBe('24h-mode-active');
  });

  it('reads a directory as a "file" — fs read fails → no-cost-data', () => {
    mkdirSync(join(process.cwd(), 'a-dir'), { recursive: true });
    const out = runKarpathyCostCheck({
      reviewFilePath: join(process.cwd(), 'a-dir'),
      is24hModeActive: () => false,
    });
    expect(out.decision.kind).toBe('no-cost-data');
  });
});

describe('a11y — reason-line hygiene', () => {
  it('every reason line is single-line, English, imperative, no CLI verbs to type', () => {
    const cases = [
      JSON.stringify(ENVELOPE_BLOCK),
      JSON.stringify(ENVELOPE_PASS),
      JSON.stringify(NO_COST),
      'not-json',
    ];
    const is24h = [false, false, false, false];
    for (let i = 0; i < cases.length; i++) {
      const out = decideKarpathyCostCheck({
        reviewFileContent: cases[i]!,
        is24hModeActive: () => is24h[i]!,
      });
      expect(out.reasonLine).not.toMatch(/\n/);
      expect(out.reasonLine).not.toMatch(/at .+:\d+/);
      expect(out.reasonLine).toMatch(/^karpathy-cost-check:/);
      // Must NOT tell the user to type a CLI verb (Human-NL-Choice-Only).
      expect(out.reasonLine).not.toMatch(/peaks\s+[a-z][a-z-]+/);
    }
  });
});
