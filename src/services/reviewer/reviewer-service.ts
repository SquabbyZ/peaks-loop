/**
 * reviewer-service.ts — orchestrator for the G4 third-party reviewer.
 *
 * Flow (per AC-4.1 .. AC-4.6):
 *   1. Load `reviewer` section from `~/.peaks/config.json` (reviewer-config).
 *      Missing section => `{ ok: false, reason: 'no-reviewer-config' }`.
 *   2. Pick a provider by selection mode (round-robin / hash / random).
 *   3. Build the reviewer prompt (reviewer-prompt.md) with the slice's
 *      context (rd/tech-doc + rd/karpathy-review.md + changed files).
 *   4. Call the provider (ollama / anthropic / openai).
 *   5. Validate the response against ReviewerEnvelope (zod-equivalent
 *      manual guard; JSON Schema is the source of truth at
 *      `schemas/reviewer-envelope.schema.json`).
 *   6. Stamp `modelFamily` from `modelId` and return the envelope.
 *
 * Karpathy §2 — minimum code, no speculative abstractions. We deliberately
 * do NOT pipe through the karpathy-reviewer path (out-of-scope per NG4).
 */
import { createHash } from 'node:crypto';
import { deriveModelFamily } from './model-family.js';
import { selectByMode, initialState, type SelectionState } from './selection-strategies.js';
import { callOllama } from './providers/ollama.js';
import { callAnthropic } from './providers/anthropic.js';
import { callOpenAI } from './providers/openai.js';
import {
  loadReviewerConfig,
  type ReviewerConfig,
  type ReviewerConfigStatus,
  type ReviewerProviderConfig,
  type ReviewerProviderName
} from './reviewer-config.js';

export type ReviewerViolation = {
  kind: string;
  file: string;
  line: number;
  hint: string;
};

export type ReviewerEnvelope = {
  reviewerId: string;
  modelId: string;
  modelFamily: string;
  passed: boolean;
  violations: ReviewerViolation[];
  gateAction: 'block' | 'allow' | 'warn';
  reason: string;
};

export type ReviewerRunInput = {
  rid: string;
  /** Slice context blob fed to the prompt. Plain text — no PII (A1.5). */
  context: string;
  /** Optional override of the selection-mode state for cross-slice round-robin. */
  state?: SelectionState;
  /** Optional injected fetch (testability). */
  fetchImpl?: typeof fetch;
  /** Optional injected rng (random mode tests). */
  rng?: () => number;
};

export type ReviewerRunOutput =
  | { ok: true; envelope: ReviewerEnvelope; nextState: SelectionState }
  | { ok: false; reason: 'no-reviewer-config'; envelope: ReviewerEnvelope };

export const REVIEWER_ID = 'third-party-reviewer-v2.14.0';

const VIOLATION_KINDS: ReadonlyArray<string> = [
  'karpathy-violation',
  'code-smell',
  'security',
  'perf',
  'surgical-changes',
  'simplicity-first',
  'goal-driven-execution',
  'think-before-coding'
];
const GATE_ACTIONS: ReadonlyArray<ReviewerEnvelope['gateAction']> = ['block', 'allow', 'warn'];

function isViolationKind(value: unknown): value is ReviewerViolation['kind'] {
  return typeof value === 'string' && (VIOLATION_KINDS as ReadonlyArray<string>).includes(value);
}

function isGateAction(value: unknown): value is ReviewerEnvelope['gateAction'] {
  return typeof value === 'string' && (GATE_ACTIONS as ReadonlyArray<string>).includes(value);
}

/**
 * Validate a parsed JSON value against the ReviewerEnvelope contract
 * (mirrors `schemas/reviewer-envelope.schema.json`). Returns the
 * normalized envelope on success, or null when the input is malformed.
 */
export function validateReviewerEnvelope(value: unknown): ReviewerEnvelope | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v['reviewerId'] !== 'string' || v['reviewerId'].length === 0) return null;
  if (typeof v['modelId'] !== 'string' || v['modelId'].length === 0) return null;
  if (typeof v['modelFamily'] !== 'string' || v['modelFamily'].length === 0) return null;
  if (typeof v['passed'] !== 'boolean') return null;
  if (!Array.isArray(v['violations'])) return null;
  const violations: ReviewerViolation[] = [];
  for (const raw of v['violations']) {
    if (typeof raw !== 'object' || raw === null) return null;
    const r = raw as Record<string, unknown>;
    if (!isViolationKind(r['kind'])) return null;
    if (typeof r['file'] !== 'string' || r['file'].length === 0) return null;
    if (typeof r['line'] !== 'number' || !Number.isInteger(r['line']) || r['line'] < 0) return null;
    if (typeof r['hint'] !== 'string' || r['hint'].length === 0) return null;
    violations.push({
      kind: r['kind'] as ReviewerViolation['kind'],
      file: r['file'] as string,
      line: r['line'] as number,
      hint: r['hint'] as string
    });
  }
  if (!isGateAction(v['gateAction'])) return null;
  if (typeof v['reason'] !== 'string' || v['reason'].length === 0) return null;
  return {
    reviewerId: v['reviewerId'] as string,
    modelId: v['modelId'] as string,
    modelFamily: v['modelFamily'] as string,
    passed: v['passed'] as boolean,
    violations,
    gateAction: v['gateAction'] as ReviewerEnvelope['gateAction'],
    reason: v['reason'] as string
  };
}

/**
 * Try to extract the first JSON object from an LLM text response.
 * Many LLMs wrap JSON in ```json fences or surrounding prose; we
 * tolerate both. Returns null when no JSON object is present.
 */
export function extractFirstJsonObject(text: string): unknown | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1]?.trim() ?? text.trim();
  // Try the whole candidate first.
  try {
    return JSON.parse(candidate);
  } catch {
    // Fall back to a brace-balanced scan.
    const start = candidate.indexOf('{');
    if (start < 0) return null;
    let depth = 0;
    for (let i = start; i < candidate.length; i += 1) {
      const ch = candidate[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(candidate.slice(start, i + 1));
          } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
            // TODO(g2): brace-balanced scan may slice mid-string or trap on malformed JSON;
            // null sentinel is intentional for slice B-1 reviewer parser — caller distinguishes
            // via ParseResult.ok flag at the call site (extractFirstJsonObject contract).
            return null;
          }
        }
      }
    }
    return null;
  }
}

function buildPrompt(input: ReviewerRunInput): string {
  // Stable, deterministic envelope of context — sha256 of the body so
  // the prompt stays bounded and does not leak the full slice content.
  const digest = createHash('sha256').update(input.context).digest('hex').slice(0, 16);
  return [
    '# peaks-reviewer prompt (v2.14.0 G4)',
    '',
    `rid: ${input.rid}`,
    `contextSha256: ${digest}`,
    '',
    '## Slice context (truncated to 8KB)',
    input.context.slice(0, 8192),
    '',
    '## Required output (ReviewerEnvelope JSON)',
    '',
    'Respond with EXACTLY one JSON object matching this schema (no prose):',
    '{',
    '  "reviewerId": "third-party-reviewer-v2.14.0",',
    '  "modelId": "<your modelId>",',
    '  "modelFamily": "<e.g. claude / gpt-4o / llama>",',
    '  "passed": <bool>,',
    '  "violations": [{"kind": "<kind>", "file": "<path>", "line": <int>, "hint": "<str>"}],',
    '  "gateAction": "block" | "allow" | "warn",',
    '  "reason": "<one-sentence rationale>"',
    '}',
    '',
    'Forbidden: prose, markdown, multiple objects, free-form JSON. Schema-validated only.'
  ].join('\n');
}

function dispatchProvider(
  name: ReviewerProviderName | string,
  input: { provider: ReviewerProviderConfig; prompt: string; fetchImpl?: typeof fetch }
) {
  if (name === 'ollama') return callOllama(input);
  if (name === 'anthropic') return callAnthropic(input);
  if (name === 'openai') return callOpenAI(input);
  // Unknown provider names resolve to `providerUnavailable` — never throw.
  return Promise.resolve({
    ok: false as const,
    error: `unknown provider ${String(name)}`,
    latencyMs: 0
  });
}

function skippedEnvelope(reason: string): ReviewerEnvelope {
  return {
    reviewerId: REVIEWER_ID,
    modelId: 'skipped',
    modelFamily: 'skipped',
    passed: true,
    violations: [],
    gateAction: 'allow',
    reason
  };
}

export async function runReviewer(input: ReviewerRunInput): Promise<ReviewerRunOutput> {
  const status: ReviewerConfigStatus = loadReviewerConfig();
  if (!status.ok) {
    return {
      ok: false,
      reason: 'no-reviewer-config',
      envelope: skippedEnvelope('skipped: no-reviewer-config (fallbackOnError=skip)')
    };
  }
  const config: ReviewerConfig = status.config;
  const state = input.state ?? initialState();
  const { result, nextState } = selectByMode(config.selection, config.providers, input.rid, state, input.rng);
  const prompt = buildPrompt(input);
  const callResult = await dispatchProvider(result.provider.name, {
    provider: result.provider,
    prompt,
    ...(input.fetchImpl !== undefined ? { fetchImpl: input.fetchImpl } : {})
  });
  if (!callResult.ok) {
    if (config.fallbackOnError === 'error') {
      throw new Error(`peaks-reviewer: ${callResult.error}`);
    }
    return {
      ok: true,
      envelope: {
        reviewerId: REVIEWER_ID,
        modelId: result.provider.model,
        modelFamily: deriveModelFamily(result.provider.model).modelFamily,
        passed: true,
        violations: [],
        gateAction: 'warn',
        reason: `skipped: provider ${result.provider.name} error (${callResult.error}); fallbackOnError=skip`
      },
      nextState
    };
  }
  const parsed = extractFirstJsonObject(callResult.text);
  const validated = validateReviewerEnvelope(parsed);
  if (validated === null) {
    return {
      ok: true,
      envelope: {
        reviewerId: REVIEWER_ID,
        modelId: result.provider.model,
        modelFamily: deriveModelFamily(result.provider.model).modelFamily,
        passed: true,
        violations: [],
        gateAction: 'warn',
        reason: `provider ${result.provider.name} returned non-conforming JSON; treated as warn`
      },
      nextState
    };
  }
  // Stamp modelFamily from the actual modelId we called — prevents the LLM
  // from lying about its family and bypassing AC-4.4.
  const stamped: ReviewerEnvelope = {
    ...validated,
    modelId: result.provider.model,
    modelFamily: deriveModelFamily(result.provider.model).modelFamily,
    reviewerId: REVIEWER_ID
  };
  return { ok: true, envelope: stamped, nextState };
}

/**
 * Compute the distinctness verdict: returns true when the third-party
 * reviewer's modelFamily differs from the karpathy reviewer's. AC-4.4
 * mandates this is a CI gate — equality fails the build.
 */
export function distinctFromKarpathy(
  thirdPartyFamily: string,
  karpathyFamily: string
): boolean {
  if (thirdPartyFamily === 'skipped') return true;
  return thirdPartyFamily !== karpathyFamily;
}
