// tests/unit/final-review/final-review-service.test.ts
//
// D1 regression suite for `prepareFinalReview()`.
//
// The gate this service implements is the ONLY terminator of the 10% human /
// 90% LLM loop, so a dishonest gate is worse than no gate: SKILL.md reads
// `allPass === true` as a clean handoff. Before this fix the service handed the
// reviewer LLM nothing but the approval criteria — no tools, no diff, no test
// results, no filesystem — so the honest answer was 4/4 `inconclusive` and the
// dangerous answer was an invented `pass`.
//
// Every test here is written to FAIL against the pre-fix service. The one that
// carries the defect's core property is "never returns pass when every evidence
// source is missing": the fake runner shouts 4/4 pass and the service must
// refuse to relay it.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EmptyReviewReplyError,
  HARD_MAX_OUTPUT_TOKENS,
  IncompleteFinalReviewError,
  MAX_EMPTY_REPLY_ATTEMPTS,
  MAX_EVIDENCE_BYTES_PER_FILE,
  MAX_EVIDENCE_BYTES_TOTAL,
  MAX_OUTPUT_TOKENS,
  MAX_OUTPUT_TOKENS_ENV,
  MIN_OUTPUT_TOKENS,
  REASONING_HEADROOM_TOKENS,
  outputBudgetForEvidence,
  prepareFinalReview,
  resolveOutputBudget,
  type LlmRunner
} from '~/src/services/final-review/final-review-service';

const RID = '2026-09-12-d1-fixture';
const SESSION_ID = '2026-09-12-session-fixture';

const REQUIRED = [
  'functional-completeness',
  'problem-resolution',
  'no-new-bugs',
  'existing-functionality-intact'
] as const;
type RequiredDimension = (typeof REQUIRED)[number];
type Verdict = 'pass' | 'fail' | 'inconclusive';

let tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
  tempRoots = [];
});

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-final-review-'));
  tempRoots.push(root);
  return root;
}

function writeUnderProject(
  root: string,
  segments: readonly string[],
  content: string
): string {
  const dir = join(root, '.peaks', '_runtime', SESSION_ID, ...segments.slice(0, -1));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, segments[segments.length - 1] as string);
  writeFileSync(file, content, 'utf8');
  return file;
}

function writeAuditGoal(root: string, criteria: readonly string[]): void {
  writeUnderProject(
    root,
    ['audit-goal', `${RID}.json`],
    JSON.stringify({ successCriteria: criteria })
  );
}

/** The full evidence set, one distinct marker per source. */
function writeAllEvidence(root: string, filler = ''): void {
  const body = (marker: string): string => `# fixture\n\n${marker}\n${filler}`;
  writeUnderProject(root, ['qa', 'test-reports', `${RID}.md`], body('MARKER-QA-TEST-REPORT 48 files / 406 tests passed'));
  writeUnderProject(root, ['qa', 'test-cases', `${RID}.md`], body('MARKER-QA-TEST-CASES AC1 -> tests/unit/x.test.ts'));
  writeUnderProject(root, ['qa', `security-findings-${RID}.md`], body('MARKER-QA-SECURITY 0 findings'));
  writeUnderProject(root, ['qa', `performance-findings-${RID}.md`], body('MARKER-QA-PERFORMANCE no regression'));
  writeUnderProject(root, ['rd', 'code-review.md'], body('MARKER-RD-CODE-REVIEW 0 blockers'));
  writeUnderProject(root, ['rd', 'security-review.md'], body('MARKER-RD-SECURITY-REVIEW 0 findings'));
  writeUnderProject(root, ['rd', 'tech-doc.md'], body('MARKER-RD-TECH-DOC no public API change'));
  writeUnderProject(root, ['rd', 'bug-analysis.md'], body('MARKER-RD-BUG-ANALYSIS original repro'));
  writeUnderProject(root, ['prd', 'handoff.md'], body('MARKER-PRD-HANDOFF scope + non-goals'));
}

interface CapturedCall {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly maxTokens: number;
}

/**
 * Capturing fake — records the exact prompt; never touches a real LLM.
 *
 * `outputTokens` is what the provider would report as `usage.output_tokens`.
 * It is a number, or a function of the budget the service asked for (a truncating
 * provider reports exactly what it was allowed). Defaults to 0.
 */
function captureRunner(
  output: string | (() => string),
  outputTokens: number | ((maxTokens: number) => number) = 0
): { runner: LlmRunner; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const runner: LlmRunner = {
    async call(systemPrompt, userPrompt, opts) {
      calls.push({ systemPrompt, userPrompt, maxTokens: opts.maxTokens });
      const raw = typeof output === 'function' ? output() : output;
      const emitted = typeof outputTokens === 'function' ? outputTokens(opts.maxTokens) : outputTokens;
      return { output: raw, tokens: { input: 0, output: emitted } };
    }
  };
  return { runner, calls };
}

function reviewJson(
  verdicts: Readonly<Record<RequiredDimension, Verdict>>,
  flags: { readonly allPass: boolean; readonly needsAttention: readonly string[] }
): string {
  return JSON.stringify({
    rid: RID,
    generatedAt: '2026-09-12T00:00:00.000Z',
    dimensions: REQUIRED.map(dimension => ({
      dimension,
      verdict: verdicts[dimension],
      summary: `model summary for ${dimension}`,
      evidence: [{ kind: 'test-result', description: `${dimension} evidence from [1]` }],
      confidence: 'high'
    })),
    overallSummary: 'model overall summary',
    allPass: flags.allPass,
    needsAttention: flags.needsAttention
  });
}

function allVerdicts(verdict: Verdict): Record<RequiredDimension, Verdict> {
  return {
    'functional-completeness': verdict,
    'problem-resolution': verdict,
    'no-new-bugs': verdict,
    'existing-functionality-intact': verdict
  };
}

describe('prepareFinalReview — on-disk evidence (D1)', () => {
  it('inlines every present evidence source into the prompt', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1: the widget renders', 'AC2: exit code 0']);
    writeAllEvidence(root);

    const { runner, calls } = captureRunner(
      reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
    );
    const out = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    });

    expect(calls).toHaveLength(1);
    const prompt = calls[0]?.userPrompt ?? '';
    for (const marker of [
      'MARKER-QA-TEST-REPORT',
      'MARKER-QA-TEST-CASES',
      'MARKER-QA-SECURITY',
      'MARKER-QA-PERFORMANCE',
      'MARKER-RD-CODE-REVIEW',
      'MARKER-RD-SECURITY-REVIEW',
      'MARKER-RD-TECH-DOC',
      'MARKER-RD-BUG-ANALYSIS',
      'MARKER-PRD-HANDOFF'
    ]) {
      expect(prompt).toContain(marker);
    }
    expect(prompt).toContain('AC1: the widget renders');
    expect(prompt).toContain('STATUS: FOUND');

    // Evidence existed and backed the passes, so an honest 4/4 pass survives.
    expect(out.allPass).toBe(true);
    expect(out.needsAttention).toEqual([]);
  });

  it('never returns pass when every evidence source is missing (core D1 property)', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1: the widget renders']);
    // No evidence files at all.

    const { runner, calls } = captureRunner(
      reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
    );
    const out = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    });

    // (a) The prompt must SAY what is missing, not silently skip it.
    const prompt = calls[0]?.userPrompt ?? '';
    expect(prompt).toContain('MISSING');
    expect(prompt).toContain('no evidence available from');
    expect(prompt).toContain('qa/test-reports');
    expect(prompt).toContain('rd/tech-doc.md');
    expect(prompt).toContain('prd/handoff.md');

    // (b) The model answered 4/4 pass + allPass:true. The service must not relay
    //     that: with nothing on disk, no dimension can be a pass.
    expect(out.dimensions).toHaveLength(4);
    for (const dimension of out.dimensions) {
      expect(dimension.verdict).toBe('inconclusive');
      expect(dimension.confidence).toBe('low');
    }
    expect(out.allPass).toBe(false);
    expect([...out.needsAttention].sort()).toEqual([...REQUIRED].sort());
  });

  it('downgrades only the pass verdicts; an honest fail is never softened', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1: the widget renders']);

    const verdicts = { ...allVerdicts('pass'), 'problem-resolution': 'fail' as Verdict };
    const { runner } = captureRunner(
      reviewJson(verdicts, { allPass: false, needsAttention: ['problem-resolution'] })
    );
    const out = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    });

    const byDimension = new Map(out.dimensions.map(d => [d.dimension, d.verdict]));
    expect(byDimension.get('problem-resolution')).toBe('fail');
    expect(byDimension.get('functional-completeness')).toBe('inconclusive');
    expect(out.allPass).toBe(false);
    expect(out.needsAttention).toContain('problem-resolution');
    expect(out.needsAttention).toContain('functional-completeness');
  });

  it('keeps the prompt bounded when the evidence files are oversized', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1: the widget renders']);
    // 9 sources x 40 KB on disk = 360 KB of raw evidence.
    writeAllEvidence(root, 'X'.repeat(40 * 1024));

    const { runner, calls } = captureRunner(
      reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
    );
    await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    });

    const prompt = calls[0]?.userPrompt ?? '';
    // Bounded by the byte budget (plus the fixed prompt scaffolding), not by
    // the 360 KB that is actually on disk.
    expect(Buffer.byteLength(prompt, 'utf8')).toBeLessThanOrEqual(
      MAX_EVIDENCE_BYTES_TOTAL + 8 * 1024
    );
    expect(Buffer.byteLength(prompt, 'utf8')).toBeLessThan(MAX_EVIDENCE_BYTES_PER_FILE * 9);
    // Truncation and budget exhaustion are both stated, never silent.
    expect(prompt).toContain('TRUNCATED');
    expect(prompt).toContain('MISSING (omitted)');
  });

  it('does not widen a conservative verdict set the model already flagged', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1: the widget renders']);
    writeAllEvidence(root);

    // 4/4 pass but the model itself refuses to call it clean.
    const { runner } = captureRunner(
      reviewJson(allVerdicts('pass'), { allPass: false, needsAttention: ['no-new-bugs'] })
    );
    const out = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    });

    expect(out.allPass).toBe(false);
    expect(out.needsAttention).toContain('no-new-bugs');
  });
});

// ---------------------------------------------------------------------------
// D1 layer 3 — the OUTPUT budget.
//
// Layer 1 (above) raised the prompt to 32 KiB of inlined evidence but left the
// output ceiling hard-coded at 3000 tokens, so 3/3 real provider runs returned
// no usable envelope (2x JSON cut off mid-string). These three tests pin the
// fix: the ceiling follows the evidence, and a truncated reply says so.
//
// All three FAIL against the pre-fix service (a constant `maxTokens: 3000` and
// a bare "LLM output is not valid JSON" message).
// ---------------------------------------------------------------------------
describe('prepareFinalReview — output budget (D1 layer 3)', () => {
  /**
   * Measured against the REAL provider on this repo's own machine, rid
   * `2026-09-12-codegraph-exclude-integrity`, 9 sources / 32,768 bytes
   * inlined, `deepseek-flash[1M]` via `api.deepseek.com/anthropic`.
   *
   * The 4775 this used to hold was the number that produced the FIRST fix —
   * and it did not reproduce. Re-measured 2026-09-12 (QA 3/3 red, orchestrator
   * 3/3 red on a byte-identical prompt), the same pack needs **10108** output
   * tokens: `max_tokens=7096` (what the old formula derived) truncated,
   * `max_tokens=8192` truncated with only 574 visible characters, and only
   * `16000`/`32000` completed. Pinning the budget to the disproven 4775 is
   * what left the shipped gate flaky.
   */
  const MEASURED_OUTPUT_TOKENS_FOR_MAX_PACK = 10108;
  const PRE_FIX_MAX_TOKENS = 3000;

  const fourPasses = (): string =>
    reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] });

  it('scales the output ceiling with the inlined evidence, never below the pre-fix value', async () => {
    const smallRoot = makeProject();
    writeAuditGoal(smallRoot, ['AC1']);
    writeAllEvidence(smallRoot); // ~0.6 KB of markers: nothing to cite in depth

    const bigRoot = makeProject();
    writeAuditGoal(bigRoot, ['AC1']);
    writeAllEvidence(bigRoot, 'X'.repeat(40 * 1024)); // saturates the 32 KB input cap

    const small = captureRunner(fourPasses());
    await prepareFinalReview(RID, {
      projectRoot: smallRoot,
      sessionId: SESSION_ID,
      llmRunner: small.runner
    });
    const big = captureRunner(fourPasses());
    await prepareFinalReview(RID, {
      projectRoot: bigRoot,
      sessionId: SESSION_ID,
      llmRunner: big.runner
    });

    const smallBudget = small.calls[0]?.maxTokens ?? 0;
    const bigBudget = big.calls[0]?.maxTokens ?? 0;

    // No evidence set is worse off than it was before this fix.
    expect(smallBudget).toBeGreaterThanOrEqual(PRE_FIX_MAX_TOKENS);
    expect(smallBudget).toBeGreaterThanOrEqual(MIN_OUTPUT_TOKENS);
    // A bigger pack buys a bigger ceiling — the property the constant broke.
    expect(bigBudget).toBeGreaterThan(smallBudget);
    // Tied to the measurement, not to a magic number: the biggest pack the input
    // caps allow must clear what the real provider actually needed for it.
    expect(bigBudget).toBeGreaterThanOrEqual(MEASURED_OUTPUT_TOKENS_FOR_MAX_PACK);
    // ...while staying inside what a Messages-API-compatible model will accept.
    expect(bigBudget).toBeLessThanOrEqual(MAX_OUTPUT_TOKENS);
    // The saturated pack is priced by its inlined bytes, not by the 360 KB on disk.
    expect(bigBudget).toBe(outputBudgetForEvidence(MAX_EVIDENCE_BYTES_TOTAL));
  });

  it('reports a truncated reply as an output-budget failure, not as bad JSON', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1']);
    writeAllEvidence(root);

    const full = fourPasses();
    // The observed failure mode: the reply stops in the middle of the envelope,
    // which lands mid-string and with the root object still open.
    const truncated = full.slice(0, Math.floor(full.length * 0.7));

    const { runner } = captureRunner(truncated);
    const error: unknown = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(IncompleteFinalReviewError);
    const message = (error as Error).message;
    // A reader must be able to tell "raise the budget" from "fix the schema".
    expect(message).toContain('TRUNCATED');
    expect(message).toContain('OUTPUT-BUDGET');
    expect(message).toContain('maxTokens=');
    expect(message).not.toContain('is not valid JSON');
  });

  it('names the exhausted budget when a parseable reply is missing a dimension', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1']);
    writeAllEvidence(root);

    const partial = JSON.stringify({
      rid: RID,
      generatedAt: '2026-09-12T00:00:00.000Z',
      dimensions: REQUIRED.slice(0, 3).map(dimension => ({
        dimension,
        verdict: 'pass',
        summary: 's',
        evidence: [],
        confidence: 'high'
      })),
      overallSummary: 'cut short after the third dimension',
      allPass: false,
      needsAttention: []
    });

    // The provider reports it stopped exactly at the ceiling it was given.
    const { runner } = captureRunner(partial, maxTokens => maxTokens);
    const error: unknown = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(IncompleteFinalReviewError);
    const message = (error as Error).message;
    expect(message).toContain('Missing required dimensions');
    expect(message).toContain('hit the output budget');
    expect(message).toContain('maxTokens=');
  });
});

describe('prepareFinalReview — output contract', () => {
  it('throws IncompleteFinalReviewError on non-JSON output', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1']);
    writeAllEvidence(root);

    const { runner } = captureRunner('not json at all');
    await expect(
      prepareFinalReview(RID, { projectRoot: root, sessionId: SESSION_ID, llmRunner: runner })
    ).rejects.toBeInstanceOf(IncompleteFinalReviewError);
  });

  it('throws IncompleteFinalReviewError when a required dimension is absent', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1']);
    writeAllEvidence(root);

    const partial = JSON.stringify({
      rid: RID,
      generatedAt: '2026-09-12T00:00:00.000Z',
      dimensions: REQUIRED.slice(0, 3).map(dimension => ({
        dimension,
        verdict: 'pass',
        summary: 's',
        evidence: [],
        confidence: 'high'
      })),
      overallSummary: 'partial',
      allPass: false,
      needsAttention: []
    });
    const { runner } = captureRunner(partial);
    await expect(
      prepareFinalReview(RID, { projectRoot: root, sessionId: SESSION_ID, llmRunner: runner })
    ).rejects.toBeInstanceOf(IncompleteFinalReviewError);
  });

  it('still throws when the approved audit goal is unreadable', async () => {
    const root = makeProject();
    const { runner } = captureRunner(
      reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
    );
    await expect(
      prepareFinalReview(RID, { projectRoot: root, sessionId: SESSION_ID, llmRunner: runner })
    ).rejects.toThrow(/Cannot read approved goal/);
  });
});

// ---------------------------------------------------------------------------
// D2 — the EVIDENCE budget was first-come-first-served.
//
// Layer 1 above gave the reviewer on-disk evidence; this layer makes sure every
// dimension actually receives some. The allocator spent the 32 KiB cap strictly
// in source order, and with a full-size evidence set the first four sources
// consumed it to the byte (4 x 8,192 = 32,768) — leaving sources 5-9 OMITTED.
// `existing-functionality-intact` is supplied ONLY by `rd/tech-doc.md` (6th) and
// `prd/handoff.md` (9th), so that dimension came back with zero evidence on
// every run and was structurally locked to `inconclusive`. The gate could never
// go green; a gate that can never go green is one operators learn to ignore.
//
// All three tests FAIL against the pre-fix allocator:
//   - test 1: `existing-functionality-intact` gets no FOUND source, so its
//     `pass` is downgraded (the gate's own honesty rule) and `allPass` is false;
//   - test 2: the last source in the order is OMITTED, so the dimension whose
//     only remaining evidence it is has nothing at all;
//   - test 3: the 5th source is FOUND pre-fix (it is only omitted because of the
//     reservation now), and no reason mentioning a reservation exists.
// ---------------------------------------------------------------------------
describe('prepareFinalReview — evidence budget (D2: no dimension is starved)', () => {
  interface RenderedSource {
    readonly key: string;
    readonly supports: readonly string[];
    readonly status: string;
    readonly includedBytes: number;
  }

  /**
   * Re-reads the prompt the way the reviewer reads it: one block per source,
   * each carrying its SUPPORTS list and its STATUS line. Asserting on this keeps
   * the test honest about what the model could actually see, rather than about
   * what the allocator intended.
   */
  function parseRenderedSources(prompt: string): readonly RenderedSource[] {
    return prompt
      .split(/^### \[/m)
      .slice(1)
      .map(block => {
        const key = block.match(/^\d+\]\s+(\S+)/)?.[1] ?? '';
        const supports = (block.match(/^SUPPORTS: (.+)$/m)?.[1] ?? '')
          .split(',')
          .map(part => part.trim())
          .filter(Boolean);
        const truncated = block.match(/showing the first (\d+) of (\d+) bytes/);
        if (truncated) {
          return {
            key,
            supports,
            status: 'found',
            includedBytes: Number(truncated[1])
          };
        }
        const whole = block.match(/^STATUS: FOUND at .* — (\d+) bytes$/m);
        if (whole) {
          return { key, supports, status: 'found', includedBytes: Number(whole[1]) };
        }
        return {
          key,
          supports,
          status: block.match(/^STATUS: MISSING \((\w+)\)/m)?.[1] ?? 'absent',
          includedBytes: 0
        };
      });
  }

  /** Dimensions a FOUND source backs — the same set the service's gate uses. */
  function dimensionsCovered(prompt: string): ReadonlySet<string> {
    const covered = new Set<string>();
    for (const source of parseRenderedSources(prompt)) {
      if (source.status !== 'found') continue;
      for (const dimension of source.supports) covered.add(dimension);
    }
    return covered;
  }

  it('gives all four dimensions evidence when every source is oversized', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1: the widget renders']);
    // 9 sources x ~40 KB on disk = ~360 KB, every one of them far past the
    // 8 KiB per-file cap. This is the fixture the old allocator starved.
    writeAllEvidence(root, 'X'.repeat(40 * 1024));

    const { runner, calls } = captureRunner(
      reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
    );
    const out = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    });

    const prompt = calls[0]?.userPrompt ?? '';
    const covered = dimensionsCovered(prompt);
    for (const dimension of REQUIRED) {
      expect([...covered]).toContain(dimension);
    }

    // The starved one, named explicitly: it is backed only by `rd/tech-doc.md`
    // (6th) and `prd/handoff.md` (9th) — both past the point where the first
    // four sources used to have spent the whole cap.
    const techDoc = parseRenderedSources(prompt).find(s => s.key === 'rd-tech-doc');
    expect(techDoc?.status).toBe('found');
    expect(techDoc?.includedBytes).toBeGreaterThan(0);

    // With evidence behind every dimension, the gate's own honesty rule has
    // nothing to downgrade and the honest 4/4 pass survives.
    expect(out.allPass).toBe(true);
    expect(out.needsAttention).toEqual([]);

    // The reservation is a floor, not a quota: the first source still gets the
    // full per-file cap before any floor is drawn on.
    expect(parseRenderedSources(prompt)[0]?.includedBytes).toBe(MAX_EVIDENCE_BYTES_PER_FILE);
  });

  it('reaches a dimension whose only evidence is the very last source in the order', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1: the widget renders']);
    writeAllEvidence(root, 'X'.repeat(40 * 1024));
    // Drop the EARLIER of the two sources that can back
    // `existing-functionality-intact`, so its only remaining chance is the 9th
    // and last source. First-come-first-served cannot reach it at all.
    rmSync(join(root, '.peaks', '_runtime', SESSION_ID, 'rd', 'tech-doc.md'));

    const { runner, calls } = captureRunner(
      reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
    );
    const out = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    });

    const prompt = calls[0]?.userPrompt ?? '';
    const rendered = parseRenderedSources(prompt);
    // All nine blocks are still rendered — a missing file is stated, not skipped.
    expect(rendered).toHaveLength(9);
    expect(rendered.find(s => s.key === 'rd-tech-doc')?.status).toBe('missing');

    const handoff = rendered.find(s => s.key === 'prd-handoff');
    expect(handoff?.status).toBe('found');
    expect(handoff?.includedBytes).toBeGreaterThan(0);

    for (const dimension of REQUIRED) {
      expect([...dimensionsCovered(prompt)]).toContain(dimension);
    }
    expect(out.allPass).toBe(true);
  });

  it('states the reservation as the reason when a source is held back by it', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1: the widget renders']);
    writeAllEvidence(root, 'X'.repeat(40 * 1024));

    const { runner, calls } = captureRunner(
      reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
    );
    await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    });

    const prompt = calls[0]?.userPrompt ?? '';
    const rendered = parseRenderedSources(prompt);

    // `rd/code-review` is the 5th source and `no-new-bugs` is already backed by
    // the 1st, so its bytes are the ones the floor for the starving dimension
    // legitimately holds back. Losing a redundant source is acceptable; losing
    // it SILENTLY is not — the block names the reservation as the reason, so it
    // is never confused with a missing file or an empty one.
    expect(rendered.find(s => s.key === 'rd-code-review')?.status).toBe('omitted');
    expect(prompt).toMatch(/reserved for dimension\(s\) existing-functionality-intact/);
    expect(prompt).toContain('MISSING (omitted)');

    // And the reservation costs the cap nothing: the budget is still spent, not
    // stranded, and never overspent.
    const inlined = rendered.reduce((sum, source) => sum + source.includedBytes, 0);
    expect(inlined).toBe(MAX_EVIDENCE_BYTES_TOTAL);
  });
});

// ---------------------------------------------------------------------------
// N4 — the output budget was BELOW what the bound model needs, and the gate it
// controls was therefore flaky (measured 3/3 red twice, independently).
//
// The first fix derived `3000 + bytes/8` and called 8192 "a backstop only: it
// does not bind today". Both halves of that were wrong on the machine the gate
// ships on: the 4775-token measurement did not reproduce (the same pack needs
// 10108), and 8192 did bind. Two aggravating facts the model has to account
// for: `max_tokens` also caps hidden reasoning on a reasoning model (8192
// bought 574 visible characters), and the endpoint's usage reporting is not
// trustworthy in either direction (~32 KiB prompt reported as
// `input_tokens: 150`), so a single arithmetic signal cannot carry the
// diagnosis.
// ---------------------------------------------------------------------------
describe('prepareFinalReview — the output budget survives the real provider (N4)', () => {
  /**
   * The value that was EMPIRICALLY OBSERVED to truncate, on the same machine
   * and prompt, AFTER the first raise: 10 real runs, 2 failures, both genuine
   * truncation, and the second one reported BOTH the structural and the usage
   * signal at `maxTokens=13240`.
   *
   * This is the assertion that matters. A budget merely above the last
   * SUCCESS (10108) is not above the requirement, because the requirement
   * moves with the model's reasoning spend.
   */
  const OBSERVED_TRUNCATION_AT_MAX_PACK = 13_240;

  const fourPasses = (): string =>
    reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] });

  it('should derive a budget that clears the RE-MEASURED need for the largest pack', () => {
    const derived = outputBudgetForEvidence(MAX_EVIDENCE_BYTES_TOTAL);

    // Before the fix this was 7096 — below the 10108 the same pack actually
    // needed, which is why the shipped gate truncated 3/3.
    expect(derived).toBeGreaterThanOrEqual(10108);
    // ...and above the value that was still truncating after the first raise.
    expect(derived).toBeGreaterThan(OBSERVED_TRUNCATION_AT_MAX_PACK);
    // The ceiling no longer "does not bind": it is above the derived value.
    expect(derived).toBeLessThanOrEqual(MAX_OUTPUT_TOKENS);
    // The reasoning headroom the 8:1 bytes-per-token term cannot see.
    expect(outputBudgetForEvidence(0)).toBeGreaterThanOrEqual(
      MIN_OUTPUT_TOKENS + REASONING_HEADROOM_TOKENS
    );
  });

  it('should pass the re-measured budget to the runner for a saturated evidence pack', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1']);
    writeAllEvidence(root, 'X'.repeat(40 * 1024)); // saturates the 32 KB input cap

    const { runner, calls } = captureRunner(fourPasses());
    await prepareFinalReview(RID, { projectRoot: root, sessionId: SESSION_ID, llmRunner: runner });

    expect(calls[0]?.maxTokens).toBeGreaterThanOrEqual(10108);
  });

  it(`should let ${MAX_OUTPUT_TOKENS_ENV} raise the ceiling without a code change`, () => {
    const derived = outputBudgetForEvidence(MAX_EVIDENCE_BYTES_TOTAL);
    // The failure message told the operator to "raise the budget" while no
    // surface could raise it. It can now.
    expect(resolveOutputBudget(MAX_EVIDENCE_BYTES_TOTAL, { [MAX_OUTPUT_TOKENS_ENV]: '32000' })).toBe(
      32000
    );
    expect(
      resolveOutputBudget(MAX_EVIDENCE_BYTES_TOTAL, { [MAX_OUTPUT_TOKENS_ENV]: '32000' })
    ).toBeGreaterThan(derived);
    // Unset keeps the derived budget.
    expect(resolveOutputBudget(MAX_EVIDENCE_BYTES_TOTAL, {})).toBe(derived);
    expect(
      resolveOutputBudget(MAX_EVIDENCE_BYTES_TOTAL, { [MAX_OUTPUT_TOKENS_ENV]: '   ' })
    ).toBe(derived);
    // Out-of-range is clamped, not refused: a call still gets made.
    expect(resolveOutputBudget(0, { [MAX_OUTPUT_TOKENS_ENV]: '999999' })).toBe(
      HARD_MAX_OUTPUT_TOKENS
    );
    expect(resolveOutputBudget(0, { [MAX_OUTPUT_TOKENS_ENV]: '1' })).toBe(MIN_OUTPUT_TOKENS);
  });

  it(`should fail LOUDLY on an unusable ${MAX_OUTPUT_TOKENS_ENV} instead of ignoring it`, () => {
    // A lever that silently does nothing is the defect this lever exists to
    // fix, so a bad value names itself instead of falling back.
    for (const bad of ['abc', '0', '-1', '12.5', '10k']) {
      expect(() => resolveOutputBudget(0, { [MAX_OUTPUT_TOKENS_ENV]: bad })).toThrow(
        new RegExp(MAX_OUTPUT_TOKENS_ENV)
      );
    }
  });

  it('should use the env budget for the real call', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1']);
    writeAllEvidence(root, 'X'.repeat(40 * 1024));

    const { runner, calls } = captureRunner(fourPasses());
    const saved = process.env[MAX_OUTPUT_TOKENS_ENV];
    process.env[MAX_OUTPUT_TOKENS_ENV] = '32000';
    try {
      await prepareFinalReview(RID, {
        projectRoot: root,
        sessionId: SESSION_ID,
        llmRunner: runner
      });
    } finally {
      if (saved === undefined) delete process.env[MAX_OUTPUT_TOKENS_ENV];
      else process.env[MAX_OUTPUT_TOKENS_ENV] = saved;
    }

    expect(calls[0]?.maxTokens).toBe(32000);
  });
});

describe('prepareFinalReview — an empty reply is its own failure mode (N4)', () => {
  /**
   * The runner's fixed wording for a response with no text block — measured
   * 2/3 on this repo's machine, alongside the truncation it was previously
   * conflated with.
   */
  function emptyReplyRunner(): { runner: LlmRunner; attempts: () => number } {
    let attempts = 0;
    const runner: LlmRunner = {
      async call() {
        attempts += 1;
        throw new Error('LLM reply from https://example.invalid/v1/messages carried no text block');
      }
    };
    return { runner, attempts: () => attempts };
  }

  it('should retry an empty reply and return the review when a later attempt answers', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1']);
    writeAllEvidence(root);

    let attempts = 0;
    const runner: LlmRunner = {
      async call() {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('LLM reply from https://example.invalid/v1/messages carried no text block');
        }
        return { output: fourPassesJson(), tokens: { input: 10, output: 10 } };
      }
    };

    const review = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    });

    // The 2/3 failure measured on this machine is intermittent — one retry
    // turns it back into a completed review instead of a red gate.
    expect(attempts).toBe(2);
    expect(review.dimensions).toHaveLength(4);
  });

  it('should classify a persistent empty reply as EMPTY, never as truncation', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1']);
    writeAllEvidence(root);

    const { runner, attempts } = emptyReplyRunner();
    const error: unknown = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    }).catch((caught: unknown) => caught);

    expect(attempts()).toBe(MAX_EMPTY_REPLY_ATTEMPTS);
    expect(error).toBeInstanceOf(EmptyReviewReplyError);
    const message = (error as Error).message;
    // The two failure modes must not be confused: "raise the budget" is the
    // WRONG advice for an empty reply.
    expect(message).toContain('NO TEXT BLOCK');
    expect(message).toContain('EMPTY-REPLY');
    expect(message).toContain('NOT an output-budget truncation');
    expect(message).toContain('no text block');
  });

  it('should not retry a transport failure that is not an empty reply', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1']);
    writeAllEvidence(root);

    let attempts = 0;
    const runner: LlmRunner = {
      async call() {
        attempts += 1;
        throw new Error('LLM request to https://example.invalid/v1/messages failed: HTTP 500');
      }
    };

    await expect(
      prepareFinalReview(RID, { projectRoot: root, sessionId: SESSION_ID, llmRunner: runner })
    ).rejects.toThrow(/HTTP 500/);
    expect(attempts).toBe(1);
  });
});

describe('prepareFinalReview — which signal diagnosed the truncation (N4)', () => {
  it('should report the STRUCTURAL signal when the reply ends mid-structure', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1']);
    writeAllEvidence(root);

    const full = reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] });
    // Cut mid-string with the root object still open, and a provider that
    // reports nothing useful — the ONLY usable signal is the structure.
    const { runner } = captureRunner(full.slice(0, Math.floor(full.length * 0.7)), 0);
    const error: unknown = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(IncompleteFinalReviewError);
    const message = (error as Error).message;
    expect(message).toContain('TRUNCATED');
    expect(message).toContain('structural');
    // ...and it says where the lever is.
    expect(message).toContain(MAX_OUTPUT_TOKENS_ENV);
  });

  it('should NOT blame the budget for a malformed reply that is structurally closed', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1']);
    writeAllEvidence(root);

    // A complete-but-wrong document: braces closed, no truncation. The old
    // code said "not valid JSON" here and still must.
    const { runner } = captureRunner('{ "this is": not json }', 0);
    const error: unknown = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(IncompleteFinalReviewError);
    const message = (error as Error).message;
    expect(message).toContain('not valid JSON');
    expect(message).not.toContain('TRUNCATED');
  });
});

function fourPassesJson(): string {
  return JSON.stringify({
    rid: RID,
    generatedAt: '2026-09-12T00:00:00.000Z',
    dimensions: REQUIRED.map(dimension => ({
      dimension,
      verdict: 'pass',
      summary: 's',
      evidence: [{ kind: 'test-result', description: 'd' }],
      confidence: 'high'
    })),
    overallSummary: 'ok',
    allPass: true,
    needsAttention: []
  });
}
