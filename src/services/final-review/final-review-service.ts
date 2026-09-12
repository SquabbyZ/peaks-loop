import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// Inline copy of LlmRunner interface from src/services/audit/audit-goal-service.ts.
// Carried into peaks-loop/final-review so the module stays self-contained.
// (no back-dep on main peaks-loop, which would create a workspace:* circular
// trap). Source of truth lives in audit/audit-goal-service.ts.
export interface LlmRunner {
  call(
    systemPrompt: string,
    userPrompt: string,
    opts: { maxTokens: number }
  ): Promise<{
    output: string;
    tokens: { input: number; output: number };
  }>;
}
type _LlmRunnerRef = LlmRunner;
import type {
  DimensionEvidence,
  DimensionKind,
  FinalReviewOutput
} from './final-review-types.js';
import { isStale } from '../capability-audit-service/staleness.js';
import type { CapabilityAuditResult } from '../capability-audit-service/types.js';

export interface PrepareFinalReviewOptions {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly llmRunner: LlmRunner;
}

const REQUIRED_DIMENSIONS: readonly DimensionKind[] = [
  'functional-completeness',
  'problem-resolution',
  'no-new-bugs',
  'existing-functionality-intact'
];

const SYSTEM_PROMPT = `You are preparing a 4-dimension business review for human acceptance. Produce a JSON response with EXACTLY these fields:
- rid (string)
- generatedAt (ISO timestamp)
- dimensions (array of EXACTLY 4 objects, one per dimension: functional-completeness, problem-resolution, no-new-bugs, existing-functionality-intact; each with dimension, verdict (pass | fail | inconclusive), summary, evidence (list of {kind, description, [artifact], [link]}), confidence (high | medium | low))
- overallSummary (one paragraph)
- allPass (boolean)
- needsAttention (list of dimension names that need human attention)

Output ONLY valid JSON, no prose.`;

export class IncompleteFinalReviewError extends Error {
  readonly code = 'INCOMPLETE_FINAL_REVIEW' as const;
  constructor(message: string) {
    super(message);
    this.name = 'IncompleteFinalReviewError';
  }
}

/**
 * N4 — the reply carried no text block at all.
 *
 * Measured 2/3 on this repo's own machine, and it is NOT truncation: the
 * provider answered with a response whose `content` has no `text` block (a
 * reasoning-only turn, a refusal, or a content filter), so there is no JSON to
 * parse and no budget to raise — an operator sent to "raise the budget" for
 * this failure would be sent the wrong way. It gets its own class, its own
 * `code`, and a message that says so, so it is diagnosable instead of being
 * flattened into "not valid JSON".
 */
export class EmptyReviewReplyError extends Error {
  readonly code = 'EMPTY_FINAL_REVIEW_REPLY' as const;
  constructor(message: string) {
    super(message);
    this.name = 'EmptyReviewReplyError';
  }
}

/**
 * How many times an empty reply is retried before it is reported. The failure
 * was 2/3 on the observed machine — intermittent, not systematic — so a small
 * bounded retry converts most of it into a completed review, while 3 attempts
 * keeps a genuinely broken provider from being hammered.
 */
export const MAX_EMPTY_REPLY_ATTEMPTS = 3;

/** The runner's own wording for "the response had no text block to return". */
function isEmptyReplyError(error: unknown): boolean {
  return error instanceof Error && /no text block/i.test(error.message);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* ------------------------------------------------------------------ *
 * D1 — on-disk evidence collection.
 *
 * The reviewer LLM has NO tools and NO filesystem access: whatever the
 * service does not inline into the prompt does not exist for it. Feeding it
 * only the success criteria forced a guess — the observed failure mode was a
 * 4/4 `inconclusive` verdict, and the dangerous one is an invented `pass`
 * that SKILL.md would read as a clean handoff. Everything below exists so the
 * verdicts rest on what is actually on disk, and so a missing artifact is
 * reported as MISSING instead of being silently skipped.
 * ------------------------------------------------------------------ */

/**
 * Per-file evidence cap. Real evidence artifacts in this repo run 11–18 KB
 * (`rd/tech-doc.md`, `rd/code-review.md`, `qa/*-findings-*.md`); 8 KB keeps the
 * head of every file (header + verdict + first tables) without letting one
 * verbose artifact crowd out the other sources. Enforced in BYTES against the
 * raw buffer, so multi-byte (CJK) content cannot slip past the cap.
 */
export const MAX_EVIDENCE_BYTES_PER_FILE = 8 * 1024;

/**
 * Total evidence budget across all sources. 32 KB ≈ 8k tokens of input, which
 * keeps the prompt far inside any modern context window. Sources that do not
 * fit are reported as OMITTED — never dropped silently.
 *
 * This is an INPUT cap and stays fixed. The output ceiling that has to sit
 * opposite it is derived per call by `outputBudgetForEvidence()` below — the
 * two used to drift apart, and that drift was the defect.
 */
export const MAX_EVIDENCE_BYTES_TOTAL = 32 * 1024;

/**
 * Reserved floor per dimension — the anti-starvation guarantee.
 *
 * The allocator below used to be strictly first-come-first-served: each source
 * took `min(perFileCap, budgetLeft)` in source order. With this repo's own
 * 9-source evidence set (`2026-09-12-session-e37ef0`, measured) sources 1-4
 * consumed the whole 32 KiB — 4 x 8,192 = 32,768, the cap to the byte — before
 * source 5 was even opened. `existing-functionality-intact` is supplied ONLY by
 * `rd/tech-doc.md` (6th) and `prd/handoff.md` (9th), so that one dimension
 * reached the reviewer with zero evidence on every run and its verdict was
 * structurally locked to `inconclusive` no matter how good the work was. A gate
 * that is always red is noise, and an operator trained to ignore noise has no
 * gate at all — the same harm as a gate that never fires, only quieter.
 *
 * So each dimension with at least one readable source on disk gets one floor
 * reserved for the FIRST such source, and no source that is not that holder may
 * spend it. The reservation is a floor, never a quota: it is released the
 * instant its holder is served, and whatever the holder does not use flows back
 * into the sequential allocation unchanged.
 *
 * Why 4 KiB: the per-file cap exists to keep the "header + verdict + first
 * tables" — the part a reviewer actually cites. Measured on the same run's
 * artifacts (9 files, 8,164-20,543 bytes each): every one of them states its
 * verdict inside the first ~700 bytes. 4 KiB is ~5x that, so a floor holder is
 * not there for depth — it is there so its dimension is not blind. Four
 * dimensions x 4 KiB = 16 KiB of the 32 KiB cap, so at least half the budget
 * still flows through the sequential path below.
 */
export const MIN_EVIDENCE_BYTES_PER_DIMENSION = 4 * 1024;

/* ------------------------------------------------------------------ *
 * D1 layer 3 — the OUTPUT budget.
 *
 * The input side above was raised to 32 KiB of inlined evidence, but the
 * output ceiling stayed hard-coded at 3000 tokens. Measured on this repo's own
 * run (rid `2026-09-12-codegraph-exclude-integrity`, 9 sources, 32 KiB
 * inlined, real anthropic provider): 3/3 attempts failed — 2x
 * INCOMPLETE_FINAL_REVIEW with the JSON cut off mid-string, 1x a reply with no
 * text block. A 4-dimension envelope (4 x `summary` + `evidence[]` +
 * `confidence`, plus `overallSummary`) does not fit in 3000 tokens once the
 * model has ~8k tokens of evidence it is required to cite.
 *
 * N4 — the first fix of this layer derived the ceiling as "3000 + bytes/8" and
 * called 8192 "a backstop only: it does not bind today", citing a 4775-token
 * measurement. Both claims were falsified by re-measurement on the SAME
 * machine the gate ships on (`deepseek-flash[1M]` via
 * `api.deepseek.com/anthropic`, 2026-09-12, QA run 3/3 red + orchestrator
 * re-run 3/3 red, rid `2026-09-12-codegraph-exclude-integrity`, byte-identical
 * prompt):
 *
 *   max_tokens=7096 (what the old formula produced for the 32 KiB pack)
 *       -> TRUNCATED. `output_tokens=7096`, 14078 characters.
 *   max_tokens=8192 -> TRUNCATED, `output_tokens=8192`, 574 characters.
 *   max_tokens=16000 -> COMPLETE, `output_tokens=10108`.
 *   max_tokens=32000 -> COMPLETE, `output_tokens=8883`.
 *
 * So 8192 WAS the binding constraint and was BELOW the requirement: a gate
 * whose budget is short is worse than a red gate, because it releases the
 * envelope only when the model happens to be terse.
 *
 * The 8:1 bytes-per-token term prices the VISIBLE envelope against the evidence
 * the model must cite, but it was never the whole cost. On a reasoning model
 * `max_tokens` also caps the hidden reasoning that precedes the first character
 * of output, and that cost is invisible to a bytes-per-token formula (the
 * 574-character run above is exactly that: the whole budget consumed before the
 * envelope began). `REASONING_HEADROOM_TOKENS` below is that missing term.
 *
 * A 16384 ceiling with 6144 of headroom (derived 13240) was then measured on
 * the SAME machine and shown to be too thin too: 10 real-machine runs, 2
 * failures, BOTH genuine truncation — and the second one reported BOTH signals
 * at once ("reply ends mid-structure AND provider-reported output reached the
 * ceiling") with `maxTokens=13240`. The requirement is therefore not "derived
 * >= the one 10108 sample" but "derived comfortably above every observed
 * truncation point", which is what the constants below are now sized for.
 * ------------------------------------------------------------------ */

/**
 * Floor — also the value that shipped before this fix, so no evidence set can
 * end up with a smaller budget than it had. ~3000 tokens is enough for the
 * envelope skeleton plus a short paragraph per dimension.
 */
export const MIN_OUTPUT_TOKENS = 3_000;

/**
 * Headroom for the part of the reply that is not the envelope.
 *
 * A Messages-API-compatible endpoint applies `max_tokens` to the WHOLE
 * response, and a reasoning model spends it on hidden reasoning before it
 * emits a single character of the 4-dim envelope. Measured on this repo's own
 * machine (2026-09-12, rid `2026-09-12-codegraph-exclude-integrity`,
 * `deepseek-flash[1M]` via `api.deepseek.com/anthropic`): `max_tokens=8192`
 * came back with `output_tokens=8192` and only **574** visible characters —
 * the entire budget went to reasoning. A bytes-per-token estimate of the
 * visible output cannot see that cost, which is why the previous formula
 * budgeted 7096 for a reply that needs 10108 — and why a 13240 budget still
 * truncated on 2 of 10 real runs.
 *
 * 12288 (12 KiB) is sized so the largest evidence pack the input caps allow
 * lands at 23480 (see the formula below) — about 1.8x the largest value ever
 * OBSERVED to truncate (13240), which is the margin the observed variance
 * asks for. The numbers are in the block comment above.
 */
export const REASONING_HEADROOM_TOKENS = 12 * 1024;

/**
 * Ceiling, 32_000: the value a real run on this machine was forced to in order
 * to complete the envelope at all, and the largest this endpoint was observed
 * to accept. 16384 was tried first and truncated 2/10 — a ceiling that is
 * merely "above the last successful measurement" is not above the requirement,
 * because the requirement moves with the model's reasoning spend.
 *
 * A model that caps output at 8192 will refuse this. That is still strictly
 * better than shipping a budget measured to be too small, and the env lever
 * below lets an operator pull it down without a code change.
 */
export const MAX_OUTPUT_TOKENS = 32_000;

/**
 * Environment lever. The old failure message told the operator to "raise the
 * budget" while the budget was a module constant with no CLI flag and no env
 * var — an instruction that could not be carried out from any surface the
 * operator has. This is that lever.
 *
 * The value is the output ceiling in tokens; it OVERRIDES the derivation below
 * (it is not a bonus added to it). Unset/invalid/out-of-range handling is in
 * `resolveOutputBudget`.
 */
export const MAX_OUTPUT_TOKENS_ENV = 'PEAKS_FINAL_REVIEW_MAX_OUTPUT_TOKENS';

/**
 * Absolute upper bound the env lever may reach. An endpoint that accepts
 * `max_tokens` at all accepts this; anything above it is a typo (a stray extra
 * digit), not an intent, and clamping is safer than sending it.
 */
export const HARD_MAX_OUTPUT_TOKENS = 64_000;

/**
 * Inlined bytes that buy one extra output token — 4:1.
 *
 * This term prices the visible envelope (4 x `summary` + `evidence[]` +
 * `confidence` + `overallSummary`) against the evidence the model is required
 * to cite. It was 8:1, which put the 32 KiB pack at 4096 tokens of visible
 * output; the same pack has been observed to complete at 10108 and to truncate
 * at 13240, so 8:1 was pricing the visible side BELOW its own measurement.
 * 4:1 doubles it to 8192. It is still not treated as the whole budget — see
 * `REASONING_HEADROOM_TOKENS`.
 */
export const EVIDENCE_BYTES_PER_OUTPUT_TOKEN = 4;

/**
 * Output ceiling for a call whose prompt carries `includedEvidenceBytes` bytes
 * of inlined evidence. Pure, total, and clamped on both ends — the same
 * evidence pack always yields the same budget.
 */
export function outputBudgetForEvidence(includedEvidenceBytes: number): number {
  const scaled =
    MIN_OUTPUT_TOKENS +
    REASONING_HEADROOM_TOKENS +
    Math.ceil(Math.max(0, includedEvidenceBytes) / EVIDENCE_BYTES_PER_OUTPUT_TOKEN);
  return Math.min(MAX_OUTPUT_TOKENS, Math.max(MIN_OUTPUT_TOKENS, scaled));
}

/**
 * The budget the call actually uses: the derived one, unless
 * `PEAKS_FINAL_REVIEW_MAX_OUTPUT_TOKENS` overrides it.
 *
 * An override that is not a positive integer THROWS rather than being ignored:
 * a silent fallback would leave an operator who passed a bad value with the
 * exact experience this lever exists to remove — a budget they cannot move.
 * Out-of-range values are clamped, not rejected, so a model needing more than
 * `HARD_MAX_OUTPUT_TOKENS` (or a model needing less than `MIN_OUTPUT_TOKENS`)
 * still gets a call made.
 */
export function resolveOutputBudget(
  includedEvidenceBytes: number,
  env: NodeJS.ProcessEnv = process.env
): number {
  const derived = outputBudgetForEvidence(includedEvidenceBytes);
  const raw = env[MAX_OUTPUT_TOKENS_ENV];
  if (raw === undefined || raw.trim() === '') return derived;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== raw.trim()) {
    throw new Error(
      `${MAX_OUTPUT_TOKENS_ENV} must be a positive integer number of output tokens (got "${raw}"); ` +
        `unset it to use the derived budget of ${String(derived)} tokens.`
    );
  }
  return Math.min(HARD_MAX_OUTPUT_TOKENS, Math.max(MIN_OUTPUT_TOKENS, parsed));
}

interface EvidenceSource {
  /** Stable id quoted by the model in its citations. */
  readonly key: string;
  readonly label: string;
  /** Path segments under `.peaks/_runtime/<sessionId>/`. */
  readonly segments: readonly string[];
  /** Dimensions this source can supply evidence for. */
  readonly supports: readonly DimensionKind[];
}

function evidenceSourcesFor(rid: string): readonly EvidenceSource[] {
  return [
    {
      key: 'qa-test-report',
      label: 'QA execution report (per-command pass/fail counts)',
      segments: ['qa', 'test-reports', `${rid}.md`],
      supports: ['functional-completeness', 'problem-resolution', 'no-new-bugs']
    },
    {
      key: 'qa-test-cases',
      label: 'QA test cases (acceptance-criterion to test mapping)',
      segments: ['qa', 'test-cases', `${rid}.md`],
      supports: ['functional-completeness', 'problem-resolution']
    },
    {
      key: 'qa-security-findings',
      label: 'QA security findings',
      segments: ['qa', `security-findings-${rid}.md`],
      supports: ['no-new-bugs']
    },
    {
      key: 'qa-performance-findings',
      label: 'QA performance findings',
      segments: ['qa', `performance-findings-${rid}.md`],
      supports: ['no-new-bugs']
    },
    {
      key: 'rd-code-review',
      label: 'RD code review',
      segments: ['rd', 'code-review.md'],
      supports: ['no-new-bugs']
    },
    {
      key: 'rd-security-review',
      label: 'RD security review',
      segments: ['rd', 'security-review.md'],
      supports: ['no-new-bugs']
    },
    {
      key: 'rd-tech-doc',
      label: 'RD tech doc (public surface / design intent)',
      segments: ['rd', 'tech-doc.md'],
      supports: ['existing-functionality-intact']
    },
    {
      key: 'rd-bug-analysis',
      label: 'RD bug analysis (original problem statement)',
      segments: ['rd', 'bug-analysis.md'],
      supports: ['problem-resolution']
    },
    {
      key: 'prd-handoff',
      label: 'PRD handoff (approved scope + non-goals)',
      segments: ['prd', 'handoff.md'],
      supports: ['functional-completeness', 'existing-functionality-intact']
    }
  ];
}

/**
 * `found` is the only status that counts as evidence. The other three exist so
 * the prompt can name *why* a source carries nothing: an absent file, an empty
 * one, and one that did not fit the byte budget are different facts, and the
 * model is told all three explicitly.
 */
type EvidenceStatus = 'found' | 'empty' | 'missing' | 'omitted';

interface CollectedEvidence {
  readonly source: EvidenceSource;
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly status: EvidenceStatus;
  /** Full size on disk (0 when missing). */
  readonly totalBytes: number;
  /** Bytes actually inlined into the prompt. */
  readonly includedBytes: number;
  readonly content: string;
  /** Why this source carries no evidence (non-`found` statuses only). */
  readonly reason: string;
}

/**
 * A source plus the bytes it turned out to hold. Reading and spending are two
 * separate phases because the allocator has to know which sources are actually
 * readable BEFORE it can promise any of them a byte: a floor reserved for a file
 * that does not exist is a floor spent on nothing.
 */
interface EvidenceCandidate {
  readonly source: EvidenceSource;
  readonly relativePath: string;
  readonly absolutePath: string;
  /** File bytes, or `null` when the file could not be read. */
  readonly raw: Buffer | null;
  /** Read failure message (`raw === null` only). */
  readonly error: string;
  /** A file whose content is all whitespace carries no evidence whichever
   *  slice of it the budget would have paid for. */
  readonly blank: boolean;
}

/** Pure read: no commands, no git, no test execution — files only. */
function readEvidence(
  projectRoot: string,
  sessionId: string,
  rid: string
): readonly EvidenceCandidate[] {
  const runtimeRoot = join(projectRoot, '.peaks', '_runtime', sessionId);

  return evidenceSourcesFor(rid).map(source => {
    const relativePath = ['.peaks', '_runtime', sessionId, ...source.segments].join('/');
    const absolutePath = join(runtimeRoot, ...source.segments);
    let raw: Buffer | null = null;
    let error = '';
    try {
      raw = readFileSync(absolutePath);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    return {
      source,
      relativePath,
      absolutePath,
      raw,
      error,
      blank: raw === null || raw.toString('utf8').trim().length === 0
    };
  });
}

/**
 * The one source per dimension that the budget promises to reach: the first
 * non-blank candidate that can supply that dimension. A dimension with several
 * candidates needs exactly one of them to survive, and the earliest is the one
 * the sequential order would have reached anyway — so naming it costs the other
 * sources nothing they were not already losing.
 *
 * A blank source is deliberately not a holder — see `MIN_EVIDENCE_BYTES_PER_DIMENSION`.
 */
function floorHolders(
  candidates: readonly EvidenceCandidate[]
): ReadonlyMap<number, DimensionKind> {
  const holders = new Map<number, DimensionKind>();
  const covered = new Set<DimensionKind>();

  candidates.forEach((candidate, index) => {
    if (candidate.blank) return;
    for (const dimension of candidate.source.supports) {
      if (covered.has(dimension)) continue;
      covered.add(dimension);
      if (!holders.has(index)) holders.set(index, dimension);
    }
  });

  return holders;
}

function collectEvidence(
  projectRoot: string,
  sessionId: string,
  rid: string
): readonly CollectedEvidence[] {
  const candidates = readEvidence(projectRoot, sessionId, rid);
  const holders = floorHolders(candidates);
  /** Holders that have not been served yet — the floors still owed. */
  const pending = new Set<number>(holders.keys());
  const collected: CollectedEvidence[] = [];
  let budgetLeft = MAX_EVIDENCE_BYTES_TOTAL;

  for (const [index, candidate] of candidates.entries()) {
    const { source, relativePath, absolutePath, raw } = candidate;
    const base = { source, relativePath, absolutePath };

    if (raw === null) {
      collected.push({
        ...base,
        status: 'missing',
        totalBytes: 0,
        includedBytes: 0,
        content: '',
        reason: candidate.error
      });
      continue;
    }

    if (candidate.blank) {
      collected.push({
        ...base,
        status: 'empty',
        totalBytes: raw.byteLength,
        includedBytes: 0,
        content: '',
        reason: `file exists but contains no reviewable content (${raw.byteLength} bytes)`
      });
      continue;
    }

    // The floor owed to every dimension still waiting on its holder is spent
    // only on that holder. This is the whole fix: a source that needs no help
    // can no longer eat the last dimension's only chance at being reviewed.
    const holdsFloor = pending.has(index);
    const reservedElsewhere =
      (pending.size - (holdsFloor ? 1 : 0)) * MIN_EVIDENCE_BYTES_PER_DIMENSION;
    const allowance = budgetLeft - reservedElsewhere;

    if (allowance <= 0) {
      const waiting = [...pending]
        .filter(holder => holder !== index)
        .map(holder => `${holders.get(holder)} (source ${candidates[holder]?.source.key ?? '?'})`);
      collected.push({
        ...base,
        status: 'omitted',
        totalBytes: raw.byteLength,
        includedBytes: 0,
        content: '',
        reason:
          budgetLeft <= 0
            ? `total evidence budget (${MAX_EVIDENCE_BYTES_TOTAL} bytes) exhausted before this source`
            : `${reservedElsewhere} of the ${budgetLeft} bytes left are reserved for dimension(s) ${waiting.join(', ')} — their only remaining evidence comes later in the source order`
      });
      continue;
    }

    const includedBytes = Math.min(raw.byteLength, MAX_EVIDENCE_BYTES_PER_FILE, allowance);
    const content = raw.subarray(0, includedBytes).toString('utf8');
    budgetLeft -= includedBytes;
    pending.delete(index);
    collected.push({
      ...base,
      status: 'found',
      totalBytes: raw.byteLength,
      includedBytes,
      content,
      reason: ''
    });
  }

  return collected;
}

function renderEvidenceSection(collected: readonly CollectedEvidence[]): string {
  return collected
    .map((item, index) => {
      const heading = `### [${index + 1}] ${item.source.key} — ${item.source.label}`;
      const supports = `SUPPORTS: ${item.source.supports.join(', ')}`;
      if (item.status === 'found') {
        const status =
          item.includedBytes < item.totalBytes
            ? `FOUND at ${item.relativePath} — TRUNCATED, showing the first ${item.includedBytes} of ${item.totalBytes} bytes`
            : `FOUND at ${item.relativePath} — ${item.totalBytes} bytes`;
        return `${heading}\n${supports}\nSTATUS: ${status}\n<<<EVIDENCE\n${item.content}\n>>>EVIDENCE`;
      }
      return `${heading}\n${supports}\nSTATUS: MISSING (${item.status}) — no evidence available from ${item.relativePath}: ${item.reason}`;
    })
    .join('\n\n');
}

const EVIDENCE_RULES = `## Binding rules for the four verdicts
1. A dimension may be "pass" ONLY if at least one source in its SUPPORTS list has STATUS: FOUND above, and that source's content actually supports the verdict. The service re-checks this: a "pass" whose supporting sources are all missing/empty/omitted is downgraded to "inconclusive" before any human sees it.
2. If the evidence a dimension needs is MISSING, EMPTY, or OMITTED, return "inconclusive" with confidence "low". Do not guess "pass".
3. Absence of evidence is not evidence of absence: "no problem found in what I was given" is "inconclusive", never "pass".
4. Cite the bracketed source numbers (e.g. "[1]", "[5]") you relied on in each dimension's "evidence[].description"; use an empty list when the verdict is "inconclusive".
5. "allPass" may be true only when all four verdicts are "pass", and every non-"pass" dimension must be listed in "needsAttention".`;

/**
 * Which dimensions had at least one FOUND source. A dimension absent from this
 * set has no evidence at all behind it.
 */
function dimensionsWithEvidence(
  collected: readonly CollectedEvidence[]
): ReadonlySet<DimensionKind> {
  const available = new Set<DimensionKind>();
  for (const item of collected) {
    if (item.status !== 'found') continue;
    for (const dimension of item.source.supports) available.add(dimension);
  }
  return available;
}

/**
 * The honesty guarantee (D1), enforced after parsing rather than merely asked
 * for in the prompt. Prompt instructions are advisory — a model can still
 * answer `pass` — so this pass makes the property structural: a dimension with
 * no supporting evidence on disk is rewritten to `inconclusive` / `low`
 * regardless of what the model returned.
 *
 * A `fail` is never softened: it is already stricter than `inconclusive`.
 */
function enforceEvidenceBackedVerdicts(
  dimensions: readonly DimensionEvidence[],
  evidenceAvailableFor: ReadonlySet<DimensionKind>
): readonly DimensionEvidence[] {
  return dimensions.map(dimension => {
    if (dimension.verdict !== 'pass') return dimension;
    if (evidenceAvailableFor.has(dimension.dimension)) return dimension;
    const downgraded: DimensionEvidence = {
      ...dimension,
      verdict: 'inconclusive',
      confidence: 'low',
      summary: `${dimension.summary} [evidence-gate: verdict downgraded from "pass" to "inconclusive" — no on-disk evidence source supporting "${dimension.dimension}" was available to the reviewer.]`
    };
    return downgraded;
  });
}

/**
 * True when the reply ends INSIDE a JSON string or with brackets still open —
 * i.e. it was cut off mid-structure rather than being malformed. Distinguishing
 * the two is the whole point: "the reply is not JSON" sends an operator looking
 * for a schema bug, when the real cause is that nobody raised the output
 * budget after the prompt grew.
 *
 * A minimal scanner is enough — braces and quotes inside string literals are
 * skipped, escapes are honoured, and the text is never parsed.
 */
function looksTruncated(text: string): boolean {
  let inString = false;
  let escaped = false;
  let depth = 0;
  for (const char of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{' || char === '[') depth += 1;
    else if (char === '}' || char === ']') depth -= 1;
  }
  return inString || depth > 0;
}

/** The facts an operator needs to tell a budget problem from a format problem. */
function describeOutputBudget(maxTokens: number, outputTokens: number, characters: number): string {
  return `output budget: maxTokens=${maxTokens}, provider-reported output tokens=${outputTokens}, characters returned=${characters}`;
}

/**
 * N4 — say WHICH signal diagnosed the truncation, and flag the provider's usage
 * numbers when they are the only thing pointing at the ceiling. Measured on
 * this repo's machine: `input_tokens: 150` for a ~32 KiB prompt, so a reporter
 * that cannot count the input should not be trusted to count the output.
 */
function describeTruncationSignal(structurallyCut: boolean, ceilingReached: boolean): string {
  if (structurallyCut && ceilingReached) {
    return 'reply ends mid-structure AND provider-reported output reached the ceiling';
  }
  if (structurallyCut) {
    return 'reply ends mid-structure (structural)';
  }
  return 'provider-reported output reached the ceiling only — the provider’s usage reporting is not trustworthy on its own, so verify before raising anything';
}

/**
 * N4 — call the reviewer, retrying an EMPTY reply a bounded number of times.
 *
 * The empty reply is a separate failure mode from truncation and was measured
 * at 2/3 on this repo's machine. It is intermittent, so a bounded retry turns
 * most occurrences back into a completed review; when it does not, the caller
 * gets `EmptyReviewReplyError` — classified and diagnosable — instead of a
 * truncation message that sends the operator to raise a budget that was never
 * the problem.
 *
 * The classification reads the runner's message because `LlmRunner` is a
 * structural interface here (this module deliberately does not depend on the
 * concrete provider module); "no text block" is the runner's own fixed wording
 * for a response with no text content.
 */
async function callReviewer(
  runner: LlmRunner,
  userPrompt: string,
  budget: { readonly maxTokens: number; readonly derivedMaxTokens: number }
): Promise<{ output: string; tokens: { input: number; output: number } }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_EMPTY_REPLY_ATTEMPTS; attempt += 1) {
    try {
      return await runner.call(SYSTEM_PROMPT, userPrompt, { maxTokens: budget.maxTokens });
    } catch (error) {
      if (!isEmptyReplyError(error)) throw error;
      lastError = error;
    }
  }
  throw new EmptyReviewReplyError(
    `The provider returned NO TEXT BLOCK on ${String(MAX_EMPTY_REPLY_ATTEMPTS)}/${String(MAX_EMPTY_REPLY_ATTEMPTS)} attempts — this is an EMPTY-REPLY failure, NOT an output-budget truncation: the response carried no text content (a reasoning-only turn, a refusal, or a content filter), so there was no JSON to parse and raising the budget would not have helped. ${describeOutputBudget(budget.maxTokens, 0, 0)}. Last provider error: ${errorText(lastError)}`
  );
}

/**
 * `allPass` / `needsAttention` are DERIVED from the verdicts, never copied
 * verbatim from the model's own summary fields: a model that writes a fabricated
 * `pass` line plus a matching `allPass: true` would otherwise produce exactly
 * the forged clean handoff this primitive exists to prevent, and once the gate
 * above rewrites a verdict the two would silently disagree.
 *
 * Both fields are only ever NARROWED, never widened — `allPass` cannot become
 * true unless the model also said true and no dimension is non-`pass`, and a
 * dimension the model itself flagged is never dropped from `needsAttention`.
 */
function summarizeVerdicts(
  dimensions: readonly DimensionEvidence[],
  modelFlags: { readonly allPass: unknown; readonly needsAttention: unknown }
): {
  readonly allPass: boolean;
  readonly needsAttention: readonly DimensionKind[];
} {
  const nonPass = dimensions.filter(d => d.verdict !== 'pass').map(d => d.dimension);
  const flaggedByModel = Array.isArray(modelFlags.needsAttention)
    ? (modelFlags.needsAttention as readonly DimensionKind[])
    : [];
  return {
    allPass:
      modelFlags.allPass !== false && dimensions.length > 0 && nonPass.length === 0,
    needsAttention: [...new Set<DimensionKind>([...flaggedByModel, ...nonPass])]
  };
}

export async function prepareFinalReview(
  rid: string,
  opts: PrepareFinalReviewOptions
): Promise<FinalReviewOutput> {
  const auditGoalPath = join(
    opts.projectRoot,
    '.peaks',
    '_runtime',
    opts.sessionId,
    'audit-goal',
    `${rid}.json`
  );

  let approvedGoal: { successCriteria: readonly string[] };
  try {
    approvedGoal = JSON.parse(readFileSync(auditGoalPath, 'utf8')) as {
      successCriteria: readonly string[];
    };
  } catch (err) {
    throw new Error(
      `Cannot read approved goal from ${auditGoalPath}: ${(err as Error).message}`
    );
  }

  const evidence = collectEvidence(opts.projectRoot, opts.sessionId, rid);

  const userPrompt = [
    `Approved goal's success criteria: ${JSON.stringify(approvedGoal.successCriteria)}`,
    '',
    '## On-disk evidence',
    'You have NO tools and NO filesystem access — the blocks below are ALL the evidence that exists for this review. They were collected read-only by the service; nothing was executed.',
    '',
    renderEvidenceSection(evidence),
    '',
    EVIDENCE_RULES,
    '',
    'Prepare the 4-dim review evidence.'
  ].join('\n');

  // D1 layer 3: the ceiling follows the evidence actually inlined, so the two
  // sides of the call cannot drift apart again. N4 adds the env lever on top.
  const includedEvidenceBytes = evidence.reduce((sum, item) => sum + item.includedBytes, 0);
  const derivedMaxTokens = outputBudgetForEvidence(includedEvidenceBytes);
  const maxTokens = resolveOutputBudget(includedEvidenceBytes);

  const response = await callReviewer(opts.llmRunner, userPrompt, { maxTokens, derivedMaxTokens });

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.output);
  } catch (err) {
    const budget = describeOutputBudget(
      maxTokens,
      response.tokens.output,
      response.output.length
    );
    // N4 — the STRUCTURAL judgement is primary: `looksTruncated()` reads the
    // reply itself and needs no cooperation from the provider. The
    // `output_tokens >= maxTokens` comparison is kept as a corroborating
    // signal, but it cannot be the only one: this endpoint reported
    // `input_tokens: 150` for a ~32 KiB prompt, so its usage numbers are not
    // trustworthy on their own, and a provider that under-reports a truncated
    // reply would otherwise have it filed below as "not valid JSON" — sending
    // an operator to look for a schema bug that does not exist. Which signal
    // fired is reported, so the diagnosis is auditable rather than inferred.
    const structurallyCut = looksTruncated(response.output);
    const ceilingReached = response.tokens.output >= maxTokens;
    if (structurallyCut || ceilingReached) {
      throw new IncompleteFinalReviewError(
        `LLM output was TRUNCATED by the output budget before the 4-dim envelope was complete — this is an OUTPUT-BUDGET failure, not a malformed reply. Raise the budget: it scales with inlined evidence bytes, and ${MAX_OUTPUT_TOKENS_ENV} overrides it outright for this run. Signal: ${describeTruncationSignal(structurallyCut, ceilingReached)}. ${budget}. Parser said: ${(err as Error).message}`
      );
    }
    throw new IncompleteFinalReviewError(
      `LLM output is not valid JSON: ${(err as Error).message} (${budget})`
    );
  }

  const output = parsed as FinalReviewOutput;
  const presentDimensions = new Set<DimensionKind>(
    output.dimensions.map((d: DimensionEvidence) => d.dimension)
  );
  const missing = REQUIRED_DIMENSIONS.filter(d => !presentDimensions.has(d));
  if (missing.length > 0) {
    // A reply that stopped at the ceiling and still parsed is still a budget
    // problem, so the same diagnosis is attached here. N4: the structural
    // reading counts too — a reply cut off mid-array parses only because the
    // envelope it produced happened to be closed early.
    const budgetExhausted = response.tokens.output >= maxTokens || looksTruncated(response.output);
    throw new IncompleteFinalReviewError(
      `Missing required dimensions: ${missing.join(', ')}${
        budgetExhausted
          ? ` — the provider hit the output budget and the reply was cut short (${describeOutputBudget(maxTokens, response.tokens.output, response.output.length)}); raise the budget instead of retrying blindly.`
          : ''
      }`
    );
  }

  // D1: the verdicts must rest on evidence that actually existed, and the
  // derived summary flags must match the verdicts — see the two helpers above.
  const dimensions = enforceEvidenceBackedVerdicts(
    output.dimensions,
    dimensionsWithEvidence(evidence)
  );
  const { allPass, needsAttention } = summarizeVerdicts(dimensions, output);

  return { ...output, dimensions, allPass, needsAttention };
}

export function decideFifthDimension(input: { readonly audit: CapabilityAuditResult | null; readonly nowMs: number }): {
  readonly verdict: 'pass' | 'fail' | 'inconclusive';
  readonly reason: string;
} {
  if (input.audit === null) return { verdict: 'inconclusive', reason: 'AUDIT_GUARD_NOT_RUN' };
  if (isStale(input.audit.auditedAt, input.nowMs)) return { verdict: 'inconclusive', reason: 'AUDIT_STALE' };
  if (input.audit.crossCheck.guardVsAudit === 'diverge') return { verdict: 'inconclusive', reason: 'AUDIT_CROSS_CHECK_DIVERGE' };
  if (input.audit.verdict === 'consistent') return { verdict: 'pass', reason: 'audit consistent' };
  if (input.audit.verdict === 'drifted')    return { verdict: 'fail',  reason: 'audit drifted' };
  return { verdict: 'inconclusive', reason: 'audit inconclusive' };
}
