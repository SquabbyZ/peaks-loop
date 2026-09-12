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

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ts from 'typescript';
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
  assertFloorReservationAffordable,
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

/** Read-only git, for the fixtures themselves (never for the service). */
function git(root: string, args: readonly string[]): void {
  execFileSync('git', [...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * A project that is ALSO a git work tree with a comparable base (two commits,
 * no remote, so the producer's last-resort `HEAD~1` resolves).
 *
 * Only the fixtures that assert `allPass === true` use it. Since the
 * pre-post-diff gate covers every reason a baseline can be missing — including
 * "this project is not a git work tree" — a project with no computable baseline
 * can no longer reach `allPass` at all, however complete its evidence is
 * otherwise. The `makeProject()` fixtures stay non-git on purpose: they pin the
 * allocation, prompt-shape and failure-path behaviour, where a tenth
 * `pre-post-diff` source block would be an unrelated variable.
 */
function makeGitProject(): string {
  const root = makeProject();
  git(root, ['init', '-q', '.']);
  git(root, ['config', 'user.email', 'fixture@peaks.local']);
  git(root, ['config', 'user.name', 'peaks fixture']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(root, 'README.md'), '# fixture\n', 'utf8');
  git(root, ['add', 'README.md']);
  git(root, ['commit', '-q', '-m', 'baseline']);
  writeFileSync(join(root, 'README.md'), '# fixture\n\nsecond line\n', 'utf8');
  git(root, ['add', 'README.md']);
  git(root, ['commit', '-q', '-m', 'second']);
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

/**
 * The full evidence set, one distinct marker per source.
 *
 * `exactBodyBytes` pads every source to an EXACT byte length, which is what the
 * budget tests need: a fixture that lands the remaining budget on a specific
 * value is the only way to reproduce the allocation edge cases (and, before the
 * all-or-nothing fix, the "1 byte left" one). The marker is never truncated —
 * the pad is appended after it.
 */
function writeAllEvidence(root: string, filler = '', exactBodyBytes?: number): void {
  const body = (marker: string): string => {
    const base = `# fixture\n\n${marker}\n${filler}`;
    if (exactBodyBytes === undefined) return base;
    return base + 'X'.repeat(Math.max(0, exactBodyBytes - base.length));
  };
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

describe('prepareFinalReview — on-disk evidence (D1)', () => {
  it('inlines every present evidence source into the prompt', async () => {
    const root = makeGitProject();
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

    // Evidence existed and backed the passes — including the pre/post baseline
    // the 4th dimension needs — so an honest 4/4 pass survives.
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
    // Bounded by the byte budget plus the FIXED scaffolding, not by the 360 KB
    // that is actually on disk. The scaffolding is what is left after the
    // allocator spends the whole budget on the first four cap-sized units:
    // measured 8,646 bytes here — the evidence rules, nine status blocks and,
    // new in H2, the reachability block that names this fixture's four
    // undeliverable dimensions (~1.5 KB, 13 source lines). The allowance is
    // 10 KiB rather than 8 KiB for exactly that reason, and it is still an
    // order of magnitude below what a 360 KB evidence set would put here.
    expect(Buffer.byteLength(prompt, 'utf8')).toBeLessThanOrEqual(
      MAX_EVIDENCE_BYTES_TOTAL + 10 * 1024
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
// F3 — the pre/post-diff gate exempted one cause of a missing baseline.
//
// The gate's job is structural: a `pass` on `existing-functionality-intact`
// whose supporting evidence is absent must be downgraded. It excluded one cause
// of absence — "this project is not a git work tree" — on the reasoning that a
// non-git consumer would otherwise be permanently red. Both halves of that are
// wrong. The permanently red verdict is the HONEST one (nothing was ever
// compared: the dimension really has not been assessed), and green-with-no-
// evidence is a forged clean handoff. And supplying a REASON for the missing
// evidence is exactly the exemption the structural gate exists to refuse — a
// `pass` whose evidence is all missing is downgraded elsewhere, and it must not
// be let through here by explaining the absence away.
//
// Measured, before the change: non-git project, every evidence source present,
// model replies 4/4 pass ⇒ `existing-functionality-intact` verdict=pass,
// evidence.length=0, allPass=true.
// ---------------------------------------------------------------------------
describe('prepareFinalReview — the pre/post-diff gate covers every cause (F3)', () => {
  it('downgrades an evidence-free pass on a non-git project instead of relaying it', async () => {
    const root = makeProject(); // deliberately NOT a git work tree
    writeAuditGoal(root, ['AC1: the widget renders']);
    writeAllEvidence(root);

    const { runner, calls } = captureRunner(
      reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
    );
    const out = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    });

    // The reviewer is told the baseline cannot exist, and told why.
    const prompt = calls[0]?.userPrompt ?? '';
    expect(prompt).toContain('STATUS: UNAVAILABLE');
    expect(prompt).toContain('not inside a git work tree');

    const dimension = out.dimensions.find(d => d.dimension === 'existing-functionality-intact');
    // The three measured facts of the defect, asserted directly: the verdict is
    // downgraded, there is no fabricated `pre-post-diff` evidence, and the
    // envelope is not a clean handoff.
    expect(dimension?.verdict).toBe('inconclusive');
    expect(dimension?.confidence).toBe('low');
    expect((dimension?.evidence ?? []).filter(item => item.kind === 'pre-post-diff')).toHaveLength(0);
    expect(out.allPass).toBe(false);
    expect(out.needsAttention).toContain('existing-functionality-intact');
    // The CAUSE of the missing evidence is named in the reason — named as the
    // cause, not treated as the licence to trust the claim.
    expect(dimension?.summary).toContain('pre-post-diff-gate');
    expect(dimension?.summary).toContain('not a git work tree');

    // Exactly one dimension is narrowed: this gate must not redden the review.
    const others = out.dimensions.filter(d => d.dimension !== 'existing-functionality-intact');
    expect(others).toHaveLength(3);
    for (const other of others) expect(other.verdict).toBe('pass');
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
    writeAllEvidence(bigRoot, 'X'.repeat(40 * 1024)); // saturates the 40 KB input cap

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
// dimension actually receives some. The allocator spent the cap strictly in
// source order, and with a full-size evidence set the first four sources
// consumed it to the byte (4 x 8,192 = 32,768 of the then-32 KiB cap) — leaving
// sources 5-9 OMITTED. `existing-functionality-intact` is supplied ONLY by
// `rd/tech-doc.md` (7th), `prd/handoff.md` (9th) and the appended
// `final-review-pre-post-diff` (10th), so that dimension came back with zero
// evidence on every run and was structurally locked to `inconclusive`. The gate
// could never go green; a gate that can never go green is one operators learn
// to ignore.
//
// All three tests FAIL against the pre-fix allocator:
//   - test 1: `existing-functionality-intact` gets no FOUND source, so its
//     `pass` is downgraded (the gate's own honesty rule) and `allPass` is false;
//   - test 2: the last source in the order is OMITTED, so the dimension whose
//     only remaining evidence it is has nothing at all;
//   - test 3: the 5th source is FOUND pre-fix (it is only omitted because of the
//     reservation now), and no reason mentioning a reservation exists.
//
// F-BLOCK then attached the delivery rule to the same fixtures: with every
// source oversized, the appended pre/post-diff block is still the first one the
// budget drops, and a dropped baseline means `existing-functionality-intact` is
// `inconclusive` however complete the other nine sources are. That these
// fixtures can no longer reach `allPass` at all is not a regression — it is the
// honest reading of a run whose baseline was never shown to the reviewer, and
// the F-BLOCK describe below pins both non-delivery and delivery.
// ---------------------------------------------------------------------------
describe('prepareFinalReview — evidence budget (D2: no dimension is starved)', () => {
  it('gives all four dimensions evidence when the sources saturate the budget', async () => {
    // A git fixture so the 4th dimension's `pre-post-diff` source exists at all
    // (see `makeGitProject`); it is allocated LAST and is one of the sources F1
    // gives a floor to.
    const root = makeGitProject();
    writeAuditGoal(root, ['AC1: the widget renders']);
    // Every fixed source is EXACTLY the per-file cap, so each one is a WHOLE
    // document — which is the delivery rule for a source whose producer
    // publishes no conclusion literal — while the ten of them together are far
    // past the total budget. That is the configuration the reservation exists
    // for: four units fit and six do not, and the four that fit have to be the
    // ones whose dimensions could not be judged without them.
    writeAllEvidence(root, '', MAX_EVIDENCE_BYTES_PER_FILE);

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
    const covered = dimensionsCovered(prompt);
    for (const dimension of REQUIRED) {
      expect([...covered]).toContain(dimension);
    }

    // The two sources the DELIVERY GATES rest on, named explicitly. Pre-F1 they
    // were the two the budget omitted on every saturated run; the floor is what
    // makes them reachable, and reachability is the whole point — a gate whose
    // source never fits is a gate that is always red.
    expect(rendered.find(s => s.key === 'prd-handoff')?.status).toBe('found');
    expect(rendered.find(s => s.key === 'final-review-pre-post-diff')?.status).toBe('found');
    // ...and the source F1 took the floor AWAY from is the one that loses now:
    // `rd-tech-doc.md` supports the 4th dimension, which prompt rule 6 declares
    // it insufficient for (a design-intent document is not a before/after
    // comparison), so it is the legitimate casualty.
    expect(rendered.find(s => s.key === 'rd-tech-doc')?.status).toBe('omitted');
    expect(prompt).toContain('MISSING (omitted)');

    // Delivery was restored for all four dimensions, so a clean 4/4 survives —
    // "achievability", not "green": the reviewer's own verdicts still have to
    // be backed by what arrived, and everything that arrived arrived whole.
    expect(out.allPass).toBe(true);
    expect(out.needsAttention).toEqual([]);
    expect(out.dimensions.find(d => d.dimension === 'functional-completeness')?.verdict).toBe('pass');
    expect(out.dimensions.find(d => d.dimension === 'existing-functionality-intact')?.verdict).toBe('pass');

    // The reservation is a floor, not a quota: the first source still gets the
    // full per-file cap before any floor is drawn on.
    expect(rendered[0]?.includedBytes).toBe(MAX_EVIDENCE_BYTES_PER_FILE);
  });

  it('reaches a dimension whose only evidence is the very last source in the order', async () => {
    const root = makeGitProject();
    writeAuditGoal(root, ['AC1: the widget renders']);
    writeAllEvidence(root, '', MAX_EVIDENCE_BYTES_PER_FILE);
    // Drop the EARLIER of the sources that can back
    // `existing-functionality-intact`, so its only remaining chances are the
    // 9th and LAST two sources. First-come-first-served reaches neither.
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
    // All ten blocks are still rendered — nine fixed sources plus the
    // pre/post-diff artifact — and a missing file is stated, not skipped.
    expect(rendered).toHaveLength(10);
    expect(rendered.find(s => s.key === 'rd-tech-doc')?.status).toBe('missing');

    // The 8th and 9th sources are this dimension's last chances, and the floors
    // reach them: reserving the source a GATE depends on is what keeps the
    // dimension from being blind, which is exactly what F1 fixed.
    const handoff = rendered.find(s => s.key === 'prd-handoff');
    const ppd = rendered.find(s => s.key === 'final-review-pre-post-diff');
    expect(handoff?.status).toBe('found');
    expect(handoff?.includedBytes).toBeGreaterThan(0);
    expect(ppd?.status).toBe('found');
    expect(ppd?.includedBytes).toBeGreaterThan(0);

    for (const dimension of REQUIRED) {
      expect([...dimensionsCovered(prompt)]).toContain(dimension);
    }

    // ...so the dimension keeps a `pass` the reviewer did back with evidence:
    // the comparison it names is among the blocks, delivered whole, and the
    // fixture's own baseline reports no drift.
    const dimension = out.dimensions.find(d => d.dimension === 'existing-functionality-intact');
    expect(dimension?.verdict).toBe('pass');
    expect(dimension?.summary).not.toContain('pre-post-diff-gate');
    expect(out.allPass).toBe(true);
    expect(out.needsAttention).toEqual([]);
  });

  it('states the reservation as the reason when a source is held back by it', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1: the widget renders']);
    // Every fixed source is the full per-file cap, so the four units the four
    // dimensions need are the whole budget and the rest cannot fit.
    writeAllEvidence(root, '', MAX_EVIDENCE_BYTES_PER_FILE);

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

    // Which sources are held back is the allocator's business; the property
    // under test is that a source held back BY THE RESERVATION says so. Losing
    // a redundant source is acceptable; losing it SILENTLY is not — the block
    // names the reservation as the reason, so it is never confused with a
    // missing file or an empty one.
    const omitted = rendered.filter(source => source.status === 'omitted');
    expect(omitted.length).toBeGreaterThan(0);
    expect(prompt).toContain('bytes of the budget are reserved for dimension(s)');
    // The reservation names the dimensions it is holding the bytes FOR, so an
    // operator can see which gate the spent budget belongs to.
    expect(prompt).toMatch(/reserved for dimension\(s\) [^\n]*existing-functionality-intact/);
    expect(prompt).toMatch(/reserved for dimension\(s\) [^\n]*functional-completeness/);
    expect(prompt).toContain('MISSING (omitted)');

    // And the reservation costs the cap nothing: the budget is still spent, not
    // stranded, and never overspent.
    const inlined = rendered.reduce((sum, source) => sum + source.includedBytes, 0);
    expect(inlined).toBe(MAX_EVIDENCE_BYTES_TOTAL);
  });
});

// ---------------------------------------------------------------------------
// F-BLOCK — the gate keyed on "the baseline was computed", not on "the reviewer
// was given it", and those two facts separate exactly when the budget omits the
// block. The observed output (QA probe, reproduced below) was self-contradicting
// in adjacent lines:
//
//   ### [10] final-review-pre-post-diff … STATUS: MISSING (omitted)
//   producer block: STATUS: COMPUTED — …
//   EFI: {"v":"pass","c":"high", evidence 含 service 附上的 kind:"pre-post-diff"}
//   allPass: true | needsAttention: []
//
// The model never saw the baseline and was handed a `pass`; the service even
// attached the artifact as evidence; and the pass was propped up by
// `prd/handoff.md`, a design-intent document — the very mismatch
// `pre-post-diff.ts` complains about in its own header. `computed` was being
// used as a proxy for `delivered`.
//
// Both tests below FAIL against the pre-fix service: the first asserts the
// downgrade that did not happen, the second asserts the annotation that the
// early return swallowed.
// ---------------------------------------------------------------------------
describe('prepareFinalReview — the pre/post-diff gate keys on DELIVERY (F-BLOCK)', () => {
  it('delivers the baseline the gate rests on, so the gate is not the only defence', async () => {
    // The QA probe's shape: a real git work tree (so a baseline IS computed)
    // with every source at the per-file cap, i.e. a run that saturates the
    // budget. Pre-F1 the appended block was the FIRST thing the budget dropped
    // on exactly this fixture, every run, and the delivery gate had to catch it
    // afterwards. F1 reserves the block's unit for the dimension whose contract
    // names it, so the bytes are there and the gate never has to fire.
    const root = makeGitProject();
    writeAuditGoal(root, ['AC1: the widget renders']);
    writeAllEvidence(root, '', MAX_EVIDENCE_BYTES_PER_FILE);

    const { runner, calls } = captureRunner(
      reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
    );
    const out = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    });

    const prompt = calls[0]?.userPrompt ?? '';
    const ppd = parseRenderedSources(prompt).find(s => s.key === 'final-review-pre-post-diff');
    expect(ppd?.status).toBe('found');
    // Whole, and the conclusion came with it: the artifact opens with its
    // `VERDICT:` line, which is the `conclusion` delivery rule for this source.
    expect(ppd?.includedBytes).toBeGreaterThan(0);
    expect(prompt).toContain('VERDICT: ');
    // The producer block and the source block agree, which was the whole
    // F-BLOCK point — and now they agree because the block WAS delivered.
    expect(prompt).toContain('STATUS: COMPUTED —');
    expect(prompt).not.toContain('STATUS: COMPUTED ON DISK, NOT DELIVERED');

    const dimension = out.dimensions.find(d => d.dimension === 'existing-functionality-intact');
    expect(dimension?.verdict).toBe('pass');
    expect(dimension?.summary).not.toContain('pre-post-diff-gate');
    // The artifact the verdict rests on IS attached, because the reviewer had
    // it: the attachment follows the same delivery judgement as the gate.
    expect((dimension?.evidence ?? []).filter(i => i.kind === 'pre-post-diff')).toHaveLength(1);

    // Neither delivery gate fires on this run, and nothing else moves.
    for (const other of out.dimensions) {
      expect(other.verdict).toBe('pass');
      expect(other.summary).not.toContain('gate');
    }
    expect(out.allPass).toBe(true);
    expect(out.needsAttention).toEqual([]);
  });

  it('leaves its marker when the evidence gate already downgraded the same dimension', async () => {
    // No evidence at all AND no computable baseline: both gates fire on the
    // same dimension. The pre-fix gate returned early on "already non-pass", so
    // only the evidence gate left a trace and the envelope could not tell that
    // this gate had run.
    const root = makeProject();
    writeAuditGoal(root, ['AC1: the widget renders']);

    const { runner } = captureRunner(
      reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
    );
    const out = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    });

    const dimension = out.dimensions.find(d => d.dimension === 'existing-functionality-intact');
    expect(dimension?.verdict).toBe('inconclusive');
    expect(dimension?.summary).toContain('evidence-gate');
    expect(dimension?.summary).toContain('pre-post-diff-gate');
    expect(dimension?.summary).toContain('is already non-"pass" and is left unchanged');
  });

  it('does not let an "inconclusive" verdict keep "high" confidence (F-NIT)', async () => {
    const root = makeGitProject();
    writeAuditGoal(root, ['AC1: the widget renders']);
    writeAllEvidence(root);

    // The reviewer itself returns the contradiction the schema allows but the
    // meaning does not: "high" confidence that it could not tell.
    const verdicts = { ...allVerdicts('pass'), 'no-new-bugs': 'inconclusive' as Verdict };
    const { runner } = captureRunner(
      reviewJson(verdicts, { allPass: true, needsAttention: [] })
    );
    const out = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    });

    const noNewBugs = out.dimensions.find(d => d.dimension === 'no-new-bugs');
    expect(noNewBugs?.verdict).toBe('inconclusive');
    expect(noNewBugs?.confidence).toBe('medium');
    expect(noNewBugs?.summary).toContain('confidence-gate');
    // A verdict that says something real keeps its confidence.
    expect(out.dimensions.find(d => d.dimension === 'functional-completeness')?.confidence).toBe(
      'high'
    );
    expect(out.allPass).toBe(false);
    expect(out.needsAttention).toEqual(['no-new-bugs']);
  });
});

// ---------------------------------------------------------------------------
// F-BLOCK-1BYTE — "found" (>= 1 byte inlined) was still being read as "the
// reviewer saw it", so the fourth hole in this primitive was the same hole with
// a new threshold. The QA round-4 probe: nine 4,551-byte sources leave exactly
// ONE byte of the budget before the appended baseline, and the pre-fix output
// was
//
//   [10] final-review-pre-post-diff  FOUND … TRUNCATED, showing the first 1 of 4226 bytes
//   producer block: STATUS: COMPUTED … Cite it
//   dim4: pass / high, with the ppd EvidenceItem attached
//   allPass: true, needsAttention: []
//
// — the reviewer's entire evidence being the character `#`. The fix is not
// another threshold: the allocator no longer hands out partial slices at all, so
// there is no `includedBytes` between 0 and a source's unit, and the baseline
// gate asks the delivered BYTES for the conclusion instead of asking a counter
// whether it is non-zero.
//
// All four tests here FAIL against the pre-fix service: the first on the
// fragment-as-delivered reading, the second on the half-source the old
// allocator handed out, the third on the missing scope-contract gate, and the
// fourth on the arithmetic the reservation now depends on.
// ---------------------------------------------------------------------------
describe('prepareFinalReview — a source is delivered whole or not at all (F-BLOCK-1BYTE)', () => {
  const NINE_SOURCE_KEYS = [
    'qa-test-report',
    'qa-test-cases',
    'qa-security-findings',
    'qa-performance-findings',
    'rd-code-review',
    'rd-security-review',
    'rd-tech-doc',
    'rd-bug-analysis',
    'prd-handoff'
  ] as const;

  const PP_DIFF_KEY = 'final-review-pre-post-diff';
  const ppDiffPath = (root: string): string =>
    join(root, '.peaks', '_runtime', SESSION_ID, 'final-review', 'api-diff.txt');

  it('never treats a fragment of the baseline as a delivered baseline (the 1-byte repro)', async () => {
    const root = makeGitProject();
    writeAuditGoal(root, ['AC1: the widget renders']);
    // The QA probe's shape: nine sources of exactly 4,551 B — 9 x 4,551 = 40,959
    // — leave 1 byte of the 40,960-byte budget free when the appended baseline
    // is reached.
    writeAllEvidence(root, '', 4551);

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
    const ppd = rendered.find(s => s.key === PP_DIFF_KEY);

    // Ten blocks are rendered, and the tenth is delivered WHOLE. The one byte
    // the old allocator had left is no longer what the block rests on: F1
    // reserves this source's unit for the dimension whose contract names it,
    // and under all-or-nothing a reserved unit is served or the reservation is
    // a lie. What matters here is that the old reading is unreachable — no
    // source is ever delivered as a fragment (1 byte of 4,226 was the repro).
    expect(rendered).toHaveLength(10);
    expect(prompt).not.toMatch(/showing the first \d+ of/);
    expect(prompt).not.toContain('showing the first 1 of');
    expect(ppd?.status).toBe('found');
    expect(ppd?.includedBytes).toBe(statSync(ppDiffPath(root)).size);
    expect(prompt).toContain('VERDICT: ');
    expect(prompt).toContain('STATUS: COMPUTED —');

    // ...so the baseline the pass rests on is one the reviewer actually had,
    // and the artifact is attached because of it.
    const dimension = out.dimensions.find(d => d.dimension === 'existing-functionality-intact');
    expect(dimension?.verdict).toBe('pass');
    expect((dimension?.evidence ?? []).filter(i => i.kind === 'pre-post-diff')).toHaveLength(1);
    expect(out.allPass).toBe(true);
  });

  it('delivers the CONCLUSION even when the artifact is over the per-file cap', async () => {
    // A baseline bigger than the cap arrives truncated — legitimately, because
    // the FILE is the thing that is too big. Truncation is only survivable
    // because the verdict is the first thing in the artifact: the head slice
    // contains the conclusion, so the dimension can still be judged. With the
    // verdict back at the END of the file (where it used to live), every
    // over-cap delivery deterministically lost it and this test goes red.
    const root = makeGitProject();
    mkdirSync(join(root, 'tests'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
    for (let i = 0; i < 240; i += 1) {
      writeFileSync(
        join(root, 'tests', `case-${String(i)}.test.ts`),
        `it('case ${String(i)}', () => {});\n`,
        'utf8'
      );
      writeFileSync(
        join(root, 'src', `module-${String(i)}.ts`),
        `export const value${String(i)} = ${String(i)};\n`,
        'utf8'
      );
    }
    writeAuditGoal(root, ['AC1: the widget renders']);
    writeAllEvidence(root);

    const { runner, calls } = captureRunner(
      reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
    );
    const out = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    });

    const artifact = statSync(ppDiffPath(root)).size;
    expect(artifact).toBeGreaterThan(MAX_EVIDENCE_BYTES_PER_FILE);

    const prompt = calls[0]?.userPrompt ?? '';
    const ppd = parseRenderedSources(prompt).find(s => s.key === PP_DIFF_KEY);
    expect(ppd?.status).toBe('found');
    expect(ppd?.includedBytes).toBe(MAX_EVIDENCE_BYTES_PER_FILE);
    expect(prompt).toContain('TRUNCATED');
    // The whole point: the delivered slice CARRIES the conclusion.
    expect(prompt).toContain('VERDICT: ');

    const dimension = out.dimensions.find(d => d.dimension === 'existing-functionality-intact');
    expect(dimension?.verdict).toBe('pass');
    expect(out.allPass).toBe(true);
  });

  it('inlines every source whole or omits it — never a slice in between', async () => {
    const root = makeGitProject();
    writeAuditGoal(root, ['AC1: the widget renders']);
    // Every source is EXACTLY the 8 KiB per-file cap, so "a source stopped
    // strictly between 0 and its own size" is unambiguous: it is a slice the
    // budget cut, not a file the cap trimmed. Pre-fix the fifth source was cut
    // to the 4,096 bytes the reservation left free.
    writeAllEvidence(root, '', MAX_EVIDENCE_BYTES_PER_FILE);

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
    const onDisk: Record<string, number> = Object.fromEntries(
      NINE_SOURCE_KEYS.map(key => [key, MAX_EVIDENCE_BYTES_PER_FILE])
    );
    onDisk[PP_DIFF_KEY] = statSync(ppDiffPath(root)).size;

    let omitted = 0;
    for (const source of rendered) {
      if (source.status === 'omitted') {
        omitted += 1;
        expect(source.includedBytes).toBe(0);
        continue;
      }
      // The invariant: whatever a FOUND block carries is its WHOLE unit —
      // `min(file bytes, per-file cap)` — never a fragment of it.
      expect(source.includedBytes).toBe(Math.min(onDisk[source.key] ?? 0, MAX_EVIDENCE_BYTES_PER_FILE));
    }

    // The fixture is genuinely saturated (the invariant is not vacuous), and the
    // sources it holds back are F1's deliberate casualties, not fragments.
    expect(omitted).toBeGreaterThan(0);
    expect(rendered.find(s => s.key === 'rd-code-review')?.status).toBe('omitted');
    expect(prompt).not.toMatch(/showing the first \d+ of/);
  });

  it('does not let a pass on functional-completeness outlive a contract that never arrived', async () => {
    const root = makeGitProject();
    writeAuditGoal(root, ['AC1: the widget renders']);
    writeAllEvidence(root, '', MAX_EVIDENCE_BYTES_PER_FILE);
    // F4's repro, kept as the shell of the F-BLOCK-1BYTE one: the contract is
    // NOT absent (that is the test below), it is ON DISK for this run and the
    // reviewer received none of it. `qa-test-report` — which also backs this
    // dimension, and is first in the order — is delivered whole, which is the
    // exact configuration in which the pre-fix rule let the pass stand.
    writeFileSync(
      join(root, '.peaks', '_runtime', SESSION_ID, 'prd', 'handoff.md'),
      '',
      'utf8'
    );

    const { runner, calls } = captureRunner(
      reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
    );
    const out = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    });

    // The contract that defines the dimension ("complete" = the APPROVED scope,
    // non-goals included) exists and carried nothing — the dimension may not
    // report a pass on the strength of a test report alone.
    const handoff = parseRenderedSources(calls[0]?.userPrompt ?? '').find(
      s => s.key === 'prd-handoff'
    );
    expect(handoff?.status).toBe('empty');

    const dimension = out.dimensions.find(d => d.dimension === 'functional-completeness');
    expect(dimension?.verdict).toBe('inconclusive');
    expect(dimension?.confidence).toBe('low');
    expect(dimension?.summary).toContain('scope-contract-gate');
    expect(out.allPass).toBe(false);
    expect(out.needsAttention).toContain('functional-completeness');
  });

  it('does not redden that dimension when there is no contract to deliver', async () => {
    // The gate is a DELIVERY gate, not a blanket red: a workflow with no PRD
    // phase has no contract to lose, and a gate that can never go green is one
    // operators learn to ignore. `missing` (ENOENT) is therefore not a delivery
    // failure — F4's other half: the file that exists and could not be READ is.
    const root = makeGitProject();
    writeAuditGoal(root, ['AC1: the widget renders']);
    writeAllEvidence(root, '', MAX_EVIDENCE_BYTES_PER_FILE);
    rmSync(join(root, '.peaks', '_runtime', SESSION_ID, 'prd', 'handoff.md'));

    const { runner } = captureRunner(
      reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
    );
    const out = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    });

    const dimension = out.dimensions.find(d => d.dimension === 'functional-completeness');
    expect(dimension?.verdict).toBe('pass');
    expect(dimension?.summary).not.toContain('scope-contract-gate');
    expect(out.allPass).toBe(true);
    expect(out.needsAttention).toEqual([]);
  });

  it('keeps the reservation affordable for every dimension, by construction', () => {
    // The allocator reserves one UNIT per pending holder and promises the holder
    // is served when reached. That promise holds only while the whole set of
    // holder units fits the budget — four dimensions, one unit each. F5: the
    // cap is DIVIDED OUT OF the total, so the inequality cannot be typed wrong,
    // and the assertion at the point of use checks the division is exact and
    // still affordable.
    expect(REQUIRED.length * MAX_EVIDENCE_BYTES_PER_FILE).toBeLessThanOrEqual(
      MAX_EVIDENCE_BYTES_TOTAL
    );
    expect(() => assertFloorReservationAffordable()).not.toThrow();
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
    writeAllEvidence(root, 'X'.repeat(40 * 1024)); // saturates the 40 KB input cap

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

// ---------------------------------------------------------------------------
// Round 6 — the module-level sweep.
//
// Six rounds of this primitive each fixed the instance QA named and left the
// same SHAPE next door, because "was it delivered?" had as many answers as
// there were call sites. These four blocks pin the four things that make the
// shape impossible to re-create: the floor protects the source the GATE needs
// (F1), delivery is one content judgement (1.3), the conclusion the reviewer
// received is READ and not merely counted (F2), and the three ways a source can
// carry nothing are three different facts (F4). The fifth is the guard.
// ---------------------------------------------------------------------------

/**
 * The ten evidence files at the sizes this repo's own run measured
 * (`2026-09-12-session-e37ef0`, rid `2026-09-12-codegraph-exclude-integrity`),
 * which is the input every "reachable on the real machine" claim is about.
 */
function writeRealSizedEvidence(root: string): void {
  const sized = (marker: string, bytes: number): string => {
    const head = `# ${marker}\n\n${marker}\n`;
    return head + 'X'.repeat(Math.max(0, bytes - head.length));
  };
  writeUnderProject(root, ['qa', 'test-reports', `${RID}.md`], sized('QA-REPORT', 9492));
  writeUnderProject(root, ['qa', 'test-cases', `${RID}.md`], sized('QA-CASES', 20543));
  writeUnderProject(root, ['qa', `security-findings-${RID}.md`], sized('QA-SEC', 13852));
  writeUnderProject(root, ['qa', `performance-findings-${RID}.md`], sized('QA-PERF', 10839));
  writeUnderProject(root, ['rd', 'code-review.md'], sized('RD-CODE-REVIEW', 17745));
  writeUnderProject(root, ['rd', 'security-review.md'], sized('RD-SEC-REVIEW', 11422));
  writeUnderProject(root, ['rd', 'tech-doc.md'], sized('RD-TECH-DOC', 13462));
  writeUnderProject(root, ['rd', 'bug-analysis.md'], sized('RD-BUG-ANALYSIS', 13050));
  writeUnderProject(root, ['prd', 'handoff.md'], sized('PRD-HANDOFF', 8164));
}

describe('prepareFinalReview — the floor protects the source the GATE needs (F1)', () => {
  it('delivers BOTH contract sources whole at the real machine sizes', async () => {
    // Measured on this repo's own run: the ten units sum to ~78 KB against a
    // 40,960-byte budget, so six sources must lose. Pre-F1 the two that lost
    // were the two the delivery gates rest on — necessarily, because both sit
    // last in the order and neither was a floor holder — and two of the four
    // dimensions were `inconclusive` on every run.
    const root = makeGitProject();
    writeAuditGoal(root, ['AC1: the widget renders']);
    writeRealSizedEvidence(root);

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
    const handoff = rendered.find(s => s.key === 'prd-handoff');
    const ppd = rendered.find(s => s.key === 'final-review-pre-post-diff');

    // The approved-scope contract arrives WHOLE — 8,164 of 8,164 bytes, which is
    // the `whole` delivery rule and, before F1, was unreachable because the
    // budget was spent before source 8 was opened.
    expect(handoff?.status).toBe('found');
    expect(handoff?.includedBytes).toBe(8164);
    // The baseline the 4th dimension is defined by arrives too, whole, and the
    // conclusion travels with it.
    expect(ppd?.status).toBe('found');
    expect(prompt).toContain('VERDICT: ');

    // The two dimensions that were structurally locked to `inconclusive` are
    // judged on delivered evidence, and neither delivery gate fires.
    const functional = out.dimensions.find(d => d.dimension === 'functional-completeness');
    const intact = out.dimensions.find(d => d.dimension === 'existing-functionality-intact');
    expect(functional?.verdict).toBe('pass');
    expect(functional?.confidence).toBe('high');
    expect(functional?.summary).not.toContain('scope-contract-gate');
    expect(intact?.verdict).toBe('pass');
    expect(intact?.summary).not.toContain('pre-post-diff-gate');

    // All four dimensions have delivered evidence — 4/4, not 2/4.
    expect([...dimensionsCovered(prompt)].sort()).toEqual([...REQUIRED].sort());
    expect(out.allPass).toBe(true);
    expect(out.needsAttention).toEqual([]);

    // The floor is what makes it affordable, and the arithmetic is the one QA
    // verified: the three gate-source units fit the total.
    const artifact = join(
      root,
      '.peaks',
      '_runtime',
      SESSION_ID,
      'final-review',
      'api-diff.txt'
    );
    expect(8164 + statSync(artifact).size).toBeLessThan(MAX_EVIDENCE_BYTES_TOTAL);
  });

  it('keeps a floor on the gate sources even when the gate source is not the first mention', async () => {
    // The property, stated as arithmetic rather than as an example: whatever
    // the allocator does, the sources whose delivery the gates depend on may
    // not be the ones it starves. Pre-F1 `qa-test-report` (index 0) held
    // `functional-completeness`'s floor and `rd/tech-doc` (index 6) held
    // `existing-functionality-intact`'s — the first is the source the budget can
    // never starve anyway, and the second is the source prompt rule 6 declares
    // INSUFFICIENT for that dimension.
    const root = makeGitProject();
    writeAuditGoal(root, ['AC1: the widget renders']);
    writeRealSizedEvidence(root);

    const { runner, calls } = captureRunner(
      reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
    );
    await prepareFinalReview(RID, { projectRoot: root, sessionId: SESSION_ID, llmRunner: runner });

    const rendered = parseRenderedSources(calls[0]?.userPrompt ?? '');
    // `rd/tech-doc.md` is the source F1 took the floor from, and it is the one
    // that loses now — a redundant design-intent document, not the comparison.
    expect(rendered.find(s => s.key === 'rd-tech-doc')?.status).toBe('omitted');
    expect(rendered.find(s => s.key === 'prd-handoff')?.status).toBe('found');
    expect(rendered.find(s => s.key === 'final-review-pre-post-diff')?.status).toBe('found');
  });
});

// ---------------------------------------------------------------------------
// H2 — an always-red gate that does not say why.
//
// Measured (stub LLM against a real session's artifacts, real prompt captured):
// only 4 of the 10 sources reached the prompt and 3 survived the `whole` rule,
// so `problem-resolution` and `no-new-bugs` had exactly ONE deliverable source
// between them — `qa/test-reports/<rid>.md`, 9,492 bytes — against a per-file
// cap of 10,240. 748 bytes of margin, on a file that is rewritten every round
// and only grows. The moment it crosses 10,240 both dimensions go red
// permanently, and `assertFloorReservationAffordable()` cannot see it: that
// assertion only checks the constant-level relation (`4 x cap <= total`), never
// whether an ACTUAL source fits the cap it must live under. So the handoff read
// as "the reviewer was unsure" when the truth was "no evidence for these two
// dimensions can EVER reach the reviewer".
//
// The tests below assert both halves of the fix: the impossibility is STATED
// (prompt + envelope + needsAttention), and it is stated only when it is real —
// a source that merely lost the budget today must not be tarred with it, or the
// report becomes the next always-red signal to be tuned out.
// ---------------------------------------------------------------------------
describe('prepareFinalReview — an undeliverable dimension is stated, never silent (H2)', () => {
  /** One byte over the cap: the smallest file the `whole` rule can never deliver. */
  const OVER_CAP = MAX_EVIDENCE_BYTES_PER_FILE + 1;

  /**
   * The reachability section's own lines, or '' when the service emitted none.
   * The bullet lines are matched with their leading `- `, which appears nowhere
   * else in the prompt.
   */
  function reachabilityBullets(prompt: string): string {
    const at = prompt.indexOf('## Evidence delivery reachability');
    return at === -1 ? '' : prompt.slice(at);
  }

  it('names the byte arithmetic in the prompt and the envelope instead of going quietly red', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1: the widget renders']);
    // The ONLY source on disk, and it is one byte over the per-file cap — so
    // under the `whole` delivery rule it can never be delivered, on this run or
    // on any other, whatever the total budget is raised to.
    writeUnderProject(root, ['qa', 'test-reports', `${RID}.md`], 'X'.repeat(OVER_CAP));

    const { runner, calls } = captureRunner(
      reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
    );
    const out = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    });

    const prompt = calls[0]?.userPrompt ?? '';
    // (1) The ARTIFACT the reviewer is given states the fact...
    expect(prompt).toContain('## Evidence delivery reachability (structural)');
    expect(prompt).toContain('qa-test-report');
    expect(prompt).toContain(`${OVER_CAP} bytes`);
    expect(prompt).toContain(`per-file cap of ${MAX_EVIDENCE_BYTES_PER_FILE} bytes`);
    expect(prompt).toContain('WHOLE or not at all');
    expect(reachabilityBullets(prompt)).toContain('- problem-resolution: NO deliverable source.');
    expect(reachabilityBullets(prompt)).toContain('- no-new-bugs: NO deliverable source.');

    // (2) ...and the ENVELOPE repeats it on each dimension it is true of, so the
    // human is told WHY it is red rather than left to read it as uncertainty.
    for (const dimension of ['functional-completeness', 'problem-resolution', 'no-new-bugs'] as const) {
      const entry = out.dimensions.find(d => d.dimension === dimension);
      expect(entry?.verdict).toBe('inconclusive');
      expect(entry?.summary).toContain('delivery-reachability');
      expect(entry?.summary).toContain(String(OVER_CAP));
      expect(entry?.summary).toContain(`cap of ${MAX_EVIDENCE_BYTES_PER_FILE} bytes`);
      // Named in `needsAttention` — the field the CLI envelope prints — and it
      // clears `allPass` like any other non-`pass` verdict does.
      expect(out.needsAttention).toContain(dimension);
    }
    expect(out.allPass).toBe(false);
  });

  it('reports only the dimensions that really have nothing deliverable left', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1: the widget renders']);
    writeUnderProject(root, ['qa', 'test-reports', `${RID}.md`], 'X'.repeat(OVER_CAP));
    // A second, small source for ONE of the three dimensions the oversize
    // report backs. It arrives whole, so `problem-resolution` is judged on
    // delivered evidence and must not be reported — the gate is targeted, not a
    // blanket over every dimension named by an oversize file.
    writeUnderProject(root, ['rd', 'bug-analysis.md'], '# bug analysis\n\noriginal repro\n');

    const { runner, calls } = captureRunner(
      reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
    );
    const out = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    });

    const section = reachabilityBullets(calls[0]?.userPrompt ?? '');
    expect(section).toContain('- functional-completeness: NO deliverable source.');
    expect(section).toContain('- no-new-bugs: NO deliverable source.');
    expect(section).not.toContain('- problem-resolution:');
    const resolved = out.dimensions.find(d => d.dimension === 'problem-resolution');
    expect(resolved?.verdict).toBe('pass');
    expect(resolved?.summary).not.toContain('delivery-reachability');
  });

  it('does not cry undeliverable over a source that only lost the budget today', async () => {
    // Every source is EXACTLY the per-file cap, so all nine are structurally
    // DELIVERABLE and what starves them is the reservation: four units fit
    // 40,960 bytes and five do not. `existing-functionality-intact`'s two
    // sources are both in the part that does not fit, so that dimension is red
    // on this run — for a reason the allocator already states per source, and
    // which a larger budget or a smaller document would fix. Calling that
    // "undeliverable forever" would be a false claim, and a report that cries
    // wolf is the noise the floor was built to remove.
    const root = makeProject();
    writeAuditGoal(root, ['AC1: the widget renders']);
    writeAllEvidence(root, '', MAX_EVIDENCE_BYTES_PER_FILE);

    const { runner, calls } = captureRunner(
      reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
    );
    const out = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    });

    const prompt = calls[0]?.userPrompt ?? '';
    expect(prompt).not.toContain('## Evidence delivery reachability');
    // The starvation is still stated, by the layer that owns it.
    expect(prompt).toContain('bytes of the budget are reserved for dimension(s)');
    const intact = out.dimensions.find(d => d.dimension === 'existing-functionality-intact');
    expect(intact?.verdict).toBe('inconclusive');
    expect(intact?.summary).not.toContain('delivery-reachability');
  });

  it('says nothing when no source was ever written (there is no delivery to fail)', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1: the widget renders']);

    const { runner, calls } = captureRunner(
      reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
    );
    await prepareFinalReview(RID, { projectRoot: root, sessionId: SESSION_ID, llmRunner: runner });

    // A run with no QA phase has no report to lose — the same reasoning the
    // scope-contract gate uses for `missing`. Nothing is claimed about a
    // document that was never written.
    expect(calls[0]?.userPrompt ?? '').not.toContain('## Evidence delivery reachability');
  });
});

describe('prepareFinalReview — delivery is a content judgement (1.3)', () => {
  it('does not count a truncated document as delivered evidence for its dimension', async () => {
    // The QA round-5 probe, reproduced: ONE source, 20,545 bytes, whose first
    // 10,240 bytes are front matter with no findings in them. Pre-fix the
    // service answered "functional-completeness has evidence" from the source
    // merely being INLINED, so all four verdicts came back `pass`/`high` — the
    // service could not tell "the model read the findings" from "the model read
    // the table of contents".
    const root = makeGitProject();
    writeAuditGoal(root, ['AC1: the widget renders']);
    writeUnderProject(root, ['qa', 'test-reports', `${RID}.md`], `# front matter\n\n${
      'table of contents '.repeat(700)
    }\n`);

    const { runner } = captureRunner(
      reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
    );
    const out = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    });

    // The dimension's only supporting source was inlined as a head slice, so the
    // dimension has no DELIVERED evidence and the pass cannot stand. The three
    // dimensions that source backs are all downgraded for the same reason; the
    // 4th is delivered its baseline and keeps its pass.
    for (const dimension of ['functional-completeness', 'problem-resolution', 'no-new-bugs'] as const) {
      const entry = out.dimensions.find(d => d.dimension === dimension);
      expect(entry?.verdict).toBe('inconclusive');
      expect(entry?.confidence).toBe('low');
      expect(entry?.summary).toContain('evidence-gate');
    }
    expect(out.allPass).toBe(false);
    expect([...out.needsAttention].sort()).toEqual([
      'functional-completeness',
      'no-new-bugs',
      'problem-resolution'
    ]);
  });

  it('counts a source that arrived WHOLE as delivered evidence', async () => {
    // The other half of the same judgement, so the rule cannot be satisfied by
    // making everything red: 9,492 bytes is under the per-file cap, so the
    // source arrives whole and the dimension it backs is judgeable.
    const root = makeGitProject();
    writeAuditGoal(root, ['AC1: the widget renders']);
    writeRealSizedEvidence(root);

    const { runner } = captureRunner(
      reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
    );
    const out = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    });

    const report = out.dimensions.find(d => d.dimension === 'no-new-bugs');
    expect(report?.verdict).toBe('pass');
    expect(report?.summary).not.toContain('evidence-gate');
  });
});

describe('prepareFinalReview — a delivered drift conclusion is read (F2)', () => {
  /**
   * A real structural removal on the compared surface: the file exists at the
   * base ref and the working tree no longer exports it — which is the one
   * change class `pre-post-diff.ts` exists to detect, and the one QA used.
   */
  function makeDriftedGitProject(): string {
    const root = makeGitProject();
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'surface.ts'), 'export const kept = 1;\nexport const dropped = 2;\n', 'utf8');
    git(root, ['add', 'src/surface.ts']);
    git(root, ['commit', '-q', '-m', 'add surface']);
    // A second commit, so the resolved base (`HEAD~1`, there is no remote) is
    // the state that still HAS both exports: the removal has to be measured
    // against that, not against a revision where the file did not exist yet.
    writeFileSync(join(root, 'README.md'), '# fixture\n\nthird line\n', 'utf8');
    git(root, ['add', 'README.md']);
    git(root, ['commit', '-q', '-m', 'third']);
    writeFileSync(join(root, 'src', 'surface.ts'), 'export const kept = 1;\n', 'utf8');
    return root;
  }

  it('forces a detected structural drift into needsAttention, however the model answered', async () => {
    const root = makeDriftedGitProject();
    writeAuditGoal(root, ['AC1: the widget renders']);
    writeRealSizedEvidence(root);

    const { runner, calls } = captureRunner(
      reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
    );
    const out = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    });

    // The precondition, so the test cannot pass vacuously: the delivered
    // comparison really does report a removal.
    expect(calls[0]?.userPrompt ?? '').toContain('STRUCTURAL DRIFT DETECTED');
    expect(calls[0]?.userPrompt ?? '').toContain('1 export name(s)');

    const dimension = out.dimensions.find(d => d.dimension === 'existing-functionality-intact');
    // The verdict is NOT forced to `fail` — an authorized removal is the
    // reviewer's and the human's call. What is refused is SILENCE.
    expect(dimension?.verdict).toBe('pass');
    expect(dimension?.summary).toContain('pre-post-diff-drift-gate');
    expect(out.needsAttention).toContain('existing-functionality-intact');
    // A handoff with a machine-detected drift in it is not a clean one.
    expect(out.allPass).toBe(false);
  });

  it('does not claim a conclusion was unreadable when no baseline was delivered at all', async () => {
    // The trap `null` exists to avoid: a project with no baseline has delivered
    // NO conclusion, which is a different fact from "delivered a conclusion I
    // could not classify" — and only the second is this gate's business. The
    // delivery gate already left its own marker here.
    const root = makeProject(); // deliberately NOT a git work tree
    writeAuditGoal(root, ['AC1: the widget renders']);
    writeRealSizedEvidence(root);

    const { runner } = captureRunner(
      reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
    );
    const out = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    });

    const dimension = out.dimensions.find(d => d.dimension === 'existing-functionality-intact');
    expect(dimension?.summary).toContain('pre-post-diff-gate');
    expect(dimension?.summary).not.toContain('drift-gate');
    expect(dimension?.summary).not.toContain('never actually read');
  });

  it('says nothing extra when the delivered comparison reports no drift', async () => {
    const root = makeGitProject();
    writeAuditGoal(root, ['AC1: the widget renders']);
    writeRealSizedEvidence(root);

    const { runner, calls } = captureRunner(
      reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
    );
    const out = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    });

    expect(calls[0]?.userPrompt ?? '').toContain('NO STRUCTURAL DRIFT');
    expect(out.needsAttention).toEqual([]);
    expect(out.allPass).toBe(true);
    for (const dimension of out.dimensions) {
      expect(dimension.summary).not.toContain('drift-gate');
    }
  });
});

describe('prepareFinalReview — missing, empty and unreadable are three facts (F4)', () => {
  it('tells the reviewer a contract exists but could not be read, and fires the gate', async () => {
    // EACCES / EBUSY / EISDIR used to collapse into the same `raw === null` as
    // ENOENT, so a contract that is ON DISK and unreadable was reported — and
    // gated — as "this run had no PRD phase". A directory at the contract's
    // path is the portable way to make the read fail with something other than
    // ENOENT.
    const root = makeGitProject();
    writeAuditGoal(root, ['AC1: the widget renders']);
    writeRealSizedEvidence(root);
    const contractPath = join(root, '.peaks', '_runtime', SESSION_ID, 'prd', 'handoff.md');
    rmSync(contractPath);
    mkdirSync(contractPath, { recursive: true });

    const { runner, calls } = captureRunner(
      reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
    );
    const out = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    });

    const prompt = calls[0]?.userPrompt ?? '';
    expect(prompt).toContain('STATUS: UNREADABLE');
    expect(prompt).not.toContain(`STATUS: MISSING (unreadable)`);
    expect(prompt).toContain(contractPath.split('\\').join('/').split('/').slice(-4).join('/'));

    const dimension = out.dimensions.find(d => d.dimension === 'functional-completeness');
    expect(dimension?.verdict).toBe('inconclusive');
    expect(dimension?.summary).toContain('scope-contract-gate');
    expect(dimension?.summary).toContain('unreadable');
  });

  it('distinguishes a contract that is absent from one that is empty', async () => {
    // ZERO bytes — QA's literal repro. The file EXISTS for this run, so the
    // `totalBytes === 0` early return was wrong (it stopped the gate on a fact
    // that is true of an absent file AND of an empty one) and the gate must
    // fire. The whitespace-only case is the same status and is covered by the
    // read phase's `blank` rule.
    const emptyRoot = makeGitProject();
    writeAuditGoal(emptyRoot, ['AC1']);
    writeRealSizedEvidence(emptyRoot);
    writeFileSync(
      join(emptyRoot, '.peaks', '_runtime', SESSION_ID, 'prd', 'handoff.md'),
      '',
      'utf8'
    );

    const empty = captureRunner(
      reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
    );
    const emptyOut = await prepareFinalReview(RID, {
      projectRoot: emptyRoot,
      sessionId: SESSION_ID,
      llmRunner: empty.runner
    });
    expect(empty.calls[0]?.userPrompt ?? '').toContain('STATUS: MISSING (empty)');
    expect(
      emptyOut.dimensions.find(d => d.dimension === 'functional-completeness')?.summary
    ).toContain('scope-contract-gate');

    // ...while an absent contract stays a non-event: no PRD phase, no gate.
    const absentRoot = makeGitProject();
    writeAuditGoal(absentRoot, ['AC1']);
    writeRealSizedEvidence(absentRoot);
    rmSync(join(absentRoot, '.peaks', '_runtime', SESSION_ID, 'prd', 'handoff.md'));

    const absent = captureRunner(
      reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
    );
    const absentOut = await prepareFinalReview(RID, {
      projectRoot: absentRoot,
      sessionId: SESSION_ID,
      llmRunner: absent.runner
    });
    expect(absent.calls[0]?.userPrompt ?? '').toContain('STATUS: MISSING (missing)');
    expect(
      absentOut.dimensions.find(d => d.dimension === 'functional-completeness')?.summary
    ).not.toContain('scope-contract-gate');
  });
});

// ---------------------------------------------------------------------------
// C — the guard. The sixth instance of this shape was found in code the fifth
// fix did not touch, so the fix is not another instance: it is a check that the
// shape cannot be re-created. "Was it delivered?" must be asked in exactly one
// place, and a new local predicate — a status comparison, a byte comparison, an
// existence test — must fail this suite rather than pass review.
//
// H1 — the first version of this guard was itself the seventh instance of the
// shape it was written to catch: it validated a PROXY ("is this line shaped
// like a hand-written `function`?") instead of the PROPERTY ("is this a
// delivery judgement?"). It recognised `function` at column 0 only, so an
// arrow, a generator, a class method or a default export carrying the exact
// same proxy went through untouched, and a `}` at column 0 inside a template
// literal closed a block early so everything after it was skipped. Measured
// against the real guard: 8 equivalent rewrites ALL passed, and an arrow
// function at top level carrying two proxy literals scored 3 passed / exit 0
// where the same proxies inside `function` scored 1 failed / exit 1.
//
// The guard therefore no longer slices the file by a lexical shape. It parses
// it (the repo's own `typescript` devDependency — no new dependency, and the
// same tool `bdd-test-style-verifier.ts` uses) and asks the AST for every
// function-like definition by NAME. Arrow / generator / class method / default
// export / getter / object method all land in the same list, so the check is
// about the tokens in a body, not about the syntax that wraps them.
// ---------------------------------------------------------------------------

/** The one function allowed to decide delivery. */
const DELIVERY_PREDICATE = 'isDelivered';

interface ScannedFunction {
  readonly name: string;
  readonly body: string;
}

/**
 * Every function-like definition in `source`, by name, in EVERY syntax shape:
 * `function`, `async function`, `function*`, `export default function`, class
 * and object methods, getters/setters, and arrow / function expressions bound
 * to a `const`. An unnamed definition reports as `<anonymous>` — it is still a
 * body that must not decide delivery, so it is still scanned.
 */
function namedFunctionBodies(source: string): readonly ScannedFunction[] {
  const file = ts.createSourceFile(
    'guard-c-fixture.ts',
    source,
    ts.ScriptTarget.ESNext,
    /* setParentNodes */ true,
    ts.ScriptKind.TS
  );
  const scanned: ScannedFunction[] = [];
  const record = (node: ts.Node, name: string | undefined): void => {
    scanned.push({
      name: name ?? '<anonymous>',
      body: source.slice(node.getStart(file), node.getEnd())
    });
  };
  const identifierName = (node: ts.Node): string | undefined => {
    const named = (node as { readonly name?: ts.Node }).name;
    return named !== undefined && ts.isIdentifier(named) ? named.text : undefined;
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)
    ) {
      record(node, identifierName(node));
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      record(node.initializer, node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(file, visit);
  return scanned;
}

/**
 * Every way a delivery judgement has been faked in this module's history.
 * Each one is a PROXY that a source can satisfy without the reviewer having
 * received its conclusion.
 *
 * THIS LIST IS THE GUARD'S LIMIT, not its definition. It matches the TOKENS a
 * proxy comparison has been written with, so it now catches them in any syntax
 * shape — but a rewrite that never types those tokens is invisible to it. The
 * test below pins that residual blindness in both directions so nobody can
 * read this guard as "delivery has one home, guaranteed".
 */
const PROXIES: readonly { readonly name: string; readonly re: RegExp }[] = [
  { name: "status === 'found'", re: /status\s*[!=]==\s*'found'/ },
  { name: "status !== 'found'", re: /status\s*[!=]==\s*'found'/ },
  { name: 'includedBytes === totalBytes', re: /includedBytes\s*[!=]==\s*totalBytes/ },
  { name: 'totalBytes === 0', re: /totalBytes\s*[!=]==\s*0/ },
  { name: 'includedBytes > 0', re: /includedBytes\s*[<>]=?\s*0/ },
  { name: 'content.length > 0', re: /content\.length\s*[<>]=?\s*[0-9]/ }
];

/**
 * The one function allowed to branch on `status === 'found'` without deciding
 * delivery: it chooses which STATUS LINE to print, and its result is prompt
 * text, so it cannot gate a verdict. Pinned to exactly one entry on purpose —
 * widening this list is a decision someone has to make in the guard, in
 * daylight, rather than a judgement that appears in a helper nobody re-reads.
 */
const RENDER_ONLY = ['renderEvidenceSection'];

/** `"<owner> uses <proxy>"` for every proxy found in every function body. */
function deliveryProxyOffenders(source: string): readonly string[] {
  const offenders: string[] = [];
  for (const fn of namedFunctionBodies(source)) {
    for (const proxy of PROXIES) {
      if (proxy.re.test(fn.body)) offenders.push(`${fn.name} uses ${proxy.name}`);
    }
  }
  return offenders;
}

/**
 * The PRE-H1 scanner, kept verbatim in the test for one reason: the shape test
 * below asserts that it finds NOTHING in a source where the AST scanner finds
 * four proxies. That is the H1 defect reproduced as an assertion — it is what
 * makes "this test fails against the old guard" a fact rather than a claim.
 */
function legacyTopLevelFunctions(source: string): readonly { readonly name: string; readonly body: string }[] {
  const start = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/;
  const lines = source.split('\n');
  const blocks: { name: string; body: string }[] = [];
  let current: { name: string; body: string[] } | null = null;
  for (const line of lines) {
    const match = start.exec(line);
    if (match !== null) {
      if (current !== null) blocks.push({ name: current.name, body: current.body.join('\n') });
      current = { name: match[1] as string, body: [line] };
      continue;
    }
    if (current !== null) {
      current.body.push(line);
      if (line === '}') {
        blocks.push({ name: current.name, body: current.body.join('\n') });
        current = null;
      }
    }
  }
  if (current !== null) blocks.push({ name: current.name, body: current.body.join('\n') });
  return blocks;
}

describe('final-review — the delivery judgement has exactly one home (guard C)', () => {
  const SERVICE_PATH = resolve(__dirname, '..', '..', '..', 'src', 'services', 'final-review', 'final-review-service.ts');
  const source = readFileSync(SERVICE_PATH, 'utf8');

  it('keeps every delivery proxy inside the single predicate', () => {
    const offenders = deliveryProxyOffenders(source);
    // Only `isDelivered` may decide delivery; every other function must ASK it.
    expect(
      offenders.filter(
        entry =>
          !entry.startsWith(`${DELIVERY_PREDICATE} `) &&
          !RENDER_ONLY.some(name => entry.startsWith(`${name} `))
      )
    ).toEqual([]);
    // ...and the predicate itself must actually decide something, or this guard
    // is satisfied by deleting the judgement altogether.
    expect(offenders.some(entry => entry.startsWith(`${DELIVERY_PREDICATE} `))).toBe(true);
  });

  /**
   * H1's regression guard — the most important test in this file. A proxy
   * literal inside an arrow, a class method, a generator and a default export
   * must all be reported, and the pre-H1 scanner must be shown to have missed
   * every one of them.
   */
  it('catches a delivery proxy in every syntax shape, not just `function` at column 0', () => {
    const fourShapes = [
      `const arrowProxy = (item) => item.status === 'found';`,
      `class Holder { methodProxy(item) { return item.includedBytes === totalBytes; } }`,
      `function* generatorProxy(item) { return item.totalBytes === 0; }`,
      `export default function (item) { return item.includedBytes > 0; }`
    ].join('\n\n');

    expect(deliveryProxyOffenders(fourShapes)).toEqual([
      `arrowProxy uses status === 'found'`,
      `arrowProxy uses status !== 'found'`,
      `methodProxy uses includedBytes === totalBytes`,
      `generatorProxy uses totalBytes === 0`,
      `<anonymous> uses includedBytes > 0`
    ]);
    // The H1 defect, as an assertion: the shape-based scanner saw none of them.
    // (Under the old guard these four functions would have shipped unscanned,
    // which is how the seventh instance of the shape got in.)
    expect(legacyTopLevelFunctions(fourShapes)).toEqual([]);
  });

  /**
   * The same defect from the other direction: a `}` at column 0 INSIDE a
   * template literal closed the old scanner's block early, so every line after
   * it — including the proxy — was never scanned. The AST scanner has no
   * concept of a "line that is exactly `}`", so the body is scanned whole.
   */
  it('does not lose the rest of a body to a brace that only looks like a closing brace', () => {
    const templateBrace = [
      'function withTemplate(item) {',
      '  const text = `line one',
      '}',
      'line two`;',
      "  return item.status === 'found';",
      '}'
    ].join('\n');

    expect(deliveryProxyOffenders(templateBrace)).toEqual([
      `withTemplate uses status === 'found'`,
      `withTemplate uses status !== 'found'`
    ]);
    expect(legacyTopLevelFunctions(templateBrace).map(fn => fn.name)).toEqual(['withTemplate']);
    expect(
      legacyTopLevelFunctions(templateBrace).some(fn => PROXIES.some(proxy => proxy.re.test(fn.body)))
    ).toBe(false);
  });

  /**
   * KNOWN GAP — NOT A GUARANTEE. Recorded as a passing assertion on purpose:
   * the four rewrites below are semantically identical to the proxies above and
   * this guard does NOT catch any of them, because none of them contains the
   * token sequence the patterns match.
   *
   *   extracted variable  `const FOUND = 'found'; item.status === FOUND`
   *   loose equality      `item.status == 'found'`
   *   bracket access      `item['status'] === 'found'`
   *   concatenation       `item.status === 'fo' + 'und'`
   *
   * The guard stops SHAPE dependence; it does not and cannot stop SEMANTIC
   * rewrites by pattern matching, and pretending otherwise is the exact failure
   * this guard was fixed for. These four belong to code review, and the modules
   * they belong to say so in the source comment that states the same limit.
   */
  it('records what the guard does NOT catch (semantic rewrites — code review owns these)', () => {
    const semanticallyIdentical = [
      `const FOUND = 'found';\nconst extractedVariable = (item) => item.status === FOUND;`,
      `const looseEquality = (item) => item.status == 'found';`,
      `const bracketAccess = (item) => item['status'] === 'found';`,
      `const concatenation = (item) => item.status === 'fo' + 'und';`
    ].join('\n\n');

    expect(deliveryProxyOffenders(semanticallyIdentical)).toEqual([]);
  });

  it('routes every dimension-level judgement through the single predicate', () => {
    const bodies = new Map(namedFunctionBodies(source).map(fn => [fn.name, fn.body]));
    // The judgement points the round-6 dispatch names — plus
    // `enforcePrePostDiffAvailability`, which M3 found missing from this list
    // — by name, so a future refactor that drops one of them fails here rather
    // than silently re-introducing a local answer.
    expect(bodies.get('dimensionsWithEvidence') ?? '').toContain('isDelivered(');
    expect(bodies.get('prePostDiffDelivered') ?? '').toContain('isDelivered(');
    expect(bodies.get('enforceScopeContractDelivery') ?? '').toContain('isDelivered(');
    // Routed through the shared helper for the baseline, which is itself one
    // line on top of `isDelivered` — asserted by name because this judgement
    // point was missing from the list entirely (M3).
    expect(bodies.get('enforcePrePostDiffAvailability') ?? '').toContain('prePostDiffDelivered(');
    // The attachment path asks the same shared helper the gate does.
    expect(bodies.get('attachPrePostDiffEvidence') ?? '').toContain('prePostDiffDelivered(');
  });

  it('gives every evidence source a declared delivery rule', () => {
    // The type requires it, so a source without one is a compile error — this
    // is the second net: it catches a source added with `as EvidenceSource` or
    // through a widened type, where tsc would not.
    const table = /function evidenceSourcesFor[\s\S]*?\n}/.exec(source)?.[0] ?? '';
    const keys = [...table.matchAll(/key:\s*(?:'([^']*)'|([A-Z_]+))/g)].map(
      match => match[1] ?? match[2]
    );
    const rules = table.match(/delivery:\s*\{/g) ?? [];
    expect(keys.length).toBeGreaterThan(0);
    expect(rules).toHaveLength(keys.length);
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
