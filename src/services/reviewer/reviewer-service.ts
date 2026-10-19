/**
 * reviewer-service.ts — orchestrator for the G4 third-party reviewer.
 *
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
import { selectByMode, initialState } from './selection-strategies.js';
import { callOllama } from './providers/ollama.js';
import { callAnthropic } from './providers/anthropic.js';
import { callOpenAI } from './providers/openai.js';
import {
  loadReviewerConfig,
  resolveReviewerSchema,
  type ReviewerConfig,
  type ReviewerConfigStatus,
  type ReviewerProviderConfig
} from './reviewer-config.js';
import {
  buildInvalidReplyEnvelope,
  buildProviderErrorEnvelope,
  buildSkippedEnvelope,
  stampEnvelope
} from './reviewer-envelopes.js';
import {
  type ReviewerViolation,
  type ReviewerEnvelope,
  type ReviewerRunInput,
  type ReviewerRunOutput
} from './reviewer-types.js';

export type {
  ReviewerViolation,
  ReviewerEnvelope,
  ReviewerRunInput,
  ReviewerRunOutput
} from './reviewer-types.js';
export { REVIEWER_ID, buildSkippedEnvelope } from './reviewer-envelopes.js';

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
  return typeof value === 'string' && VIOLATION_KINDS.includes(value);
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
      kind: r['kind'],
      file: r['file'],
      line: r['line'],
      hint: r['hint']
    });
  }
  if (!isGateAction(v['gateAction'])) return null;
  if (typeof v['reason'] !== 'string' || v['reason'].length === 0) return null;
  return {
    reviewerId: v['reviewerId'],
    modelId: v['modelId'],
    modelFamily: v['modelFamily'],
    passed: v['passed'],
    violations,
    gateAction: v['gateAction'],
    reason: v['reason']
  };
}

/**
 * Try to extract the first JSON object from an LLM text response.
 * Many LLMs wrap JSON in ```json fences or surrounding prose; we
 * tolerate both. Returns null when no JSON object is present.
 */
export function extractFirstJsonObject(text: string): unknown {
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
          } catch {
            // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
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
  name: string,
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

function skipReason(status: Extract<ReviewerConfigStatus, { ok: false }>): string {
  return status.reason === 'insufficient-providers'
    ? `skipped: insufficient-providers (${status.providerCount} valid, >=${status.requiredProviders} required; fallbackOnError=skip)`
    : 'skipped: no-reviewer-config (fallbackOnError=skip)';
}

/**
 * The refusal for an unresolvable schema. Presence/configuration check only:
 * the hand-rolled validator mirrors the schema, so this proves the deployment
 * ships the file it mirrors. The content of the resolved file is NOT read here
 * and does not drive validation — that stays `validateReviewerEnvelope`'s job.
 */
function schemaMissingOutput(searched: string[]): Extract<ReviewerRunOutput, { ok: false }> {
  return {
    ok: false,
    reason: 'schema-missing',
    schemaCandidates: searched,
    envelope: buildSkippedEnvelope(`refused: schema-missing (searched ${searched.join(', ')})`)
  };
}

export async function runReviewer(input: ReviewerRunInput): Promise<ReviewerRunOutput> {
  const status = loadReviewerConfig(
    input.configPath !== undefined ? { path: input.configPath } : {}
  );
  if (!status.ok) {
    return { ok: false, reason: status.reason, envelope: buildSkippedEnvelope(skipReason(status)) };
  }
  const config: ReviewerConfig = status.config;
  const projectRoot = input.projectRoot ?? process.cwd();
  const schema = resolveReviewerSchema(projectRoot, config.schemaPath);
  if (!schema.ok) return schemaMissingOutput(schema.searched);
  const { result, nextState } = selectByMode(
    config.selection,
    config.providers,
    input.rid,
    input.state ?? initialState(),
    input.rng
  );
  const callResult = await dispatchProvider(result.provider.name, {
    provider: result.provider,
    prompt: buildPrompt(input),
    ...(input.fetchImpl !== undefined ? { fetchImpl: input.fetchImpl } : {})
  });
  if (!callResult.ok) {
    if (config.fallbackOnError === 'error') {
      throw new Error(`peaks-reviewer: ${callResult.error}`);
    }
    return {
      ok: true,
      skipped: true,
      envelope: buildProviderErrorEnvelope(result.provider, callResult.error),
      nextState
    };
  }
  const validated = validateReviewerEnvelope(extractFirstJsonObject(callResult.text));
  if (validated === null) {
    return {
      ok: true,
      skipped: true,
      envelope: buildInvalidReplyEnvelope(result.provider),
      nextState
    };
  }
  return {
    ok: true,
    skipped: false,
    envelope: stampEnvelope(validated, result.provider),
    nextState
  };
}

/**
 * The `requireDistinctModelFamily` verdict, over three inputs per side: a
 * real family, an empty family, or a SKIP. Either side may be missing a
 * family, and "not comparable" must NOT be reported as "distinct" — that
 * would let a skip satisfy a distinctness gate. Returns true only when both
 * families are present and differ.
 */
export function distinctFromKarpathy(thirdPartyFamily: string, karpathyFamily: string): boolean {
  if (thirdPartyFamily === 'skipped' || thirdPartyFamily === '') return false;
  if (karpathyFamily === 'skipped' || karpathyFamily === '') return false;
  return thirdPartyFamily !== karpathyFamily;
}
