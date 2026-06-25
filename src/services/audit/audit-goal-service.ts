/**
 * `auditGoal()` — the audit + goal primitive that gates autonomous
 * LLM execution in the 10% human / 90% LLM workflow.
 *
 * Contract:
 *   - Calls an injected `LlmRunner` exactly once.
 *   - Parses the LLM output as JSON and validates that the `audit`
 *     array covers ALL six required dimensions
 *     (correctness, completeness, scope, risks, alternatives, constraints).
 *   - Throws `IncompleteAuditError` if the JSON is malformed or any
 *     required dimension is missing. Callers MUST treat this as a
 *     gate failure (return to human for re-prompting) — autonomous
 *     work must never proceed on a partial audit.
 *
 * The `LlmRunner` interface is intentionally minimal so this
 * service is reusable by `final-review-service` and the slice
 * LLMArbitrator without forcing a particular provider implementation.
 */

import type {
  AuditDimensionKind,
  AuditGoalInput,
  AuditGoalOutput
} from './audit-goal-types.js';

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

export class IncompleteAuditError extends Error {
  readonly code = 'INCOMPLETE_AUDIT' as const;
  constructor(message: string) {
    super(message);
    this.name = 'IncompleteAuditError';
  }
}

const REQUIRED_DIMENSIONS: readonly AuditDimensionKind[] = [
  'correctness',
  'completeness',
  'scope',
  'risks',
  'alternatives',
  'constraints'
];

const SYSTEM_PROMPT = `You are auditing a software development need. Produce a structured JSON response with EXACTLY these fields:
- summary (1-2 sentence summary of the need)
- audit (array of EXACTLY 6 objects, one per dimension: correctness, completeness, scope, risks, alternatives, constraints; each with dimension, finding, severity)
- proposedGoal (what success looks like)
- successCriteria (list of acceptance criteria)
- roughEffort (small | medium | large | epic)
- confidence (high | medium | low)
- rationale (one paragraph tying audit to goal)

Output ONLY valid JSON, no prose.`;

export async function auditGoal(
  input: AuditGoalInput,
  llmRunner: LlmRunner
): Promise<AuditGoalOutput> {
  const userPrompt = `Need: ${input.need}\n\nAudit this need across the 6 dimensions and propose a goal.`;
  const response = await llmRunner.call(SYSTEM_PROMPT, userPrompt, { maxTokens: 2000 });

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.output);
  } catch (err) {
    throw new IncompleteAuditError(
      `LLM output is not valid JSON: ${(err as Error).message}`
    );
  }

  if (!isAuditGoalOutput(parsed)) {
    throw new IncompleteAuditError(
      'LLM output is missing required top-level fields (summary, audit, proposedGoal, successCriteria, roughEffort, confidence, rationale).'
    );
  }

  const presentDimensions = new Set(parsed.audit.map(d => d.dimension));
  const missing = REQUIRED_DIMENSIONS.filter(d => !presentDimensions.has(d));
  if (missing.length > 0) {
    throw new IncompleteAuditError(
      `Missing required audit dimensions: ${missing.join(', ')}`
    );
  }

  return parsed;
}

function isAuditGoalOutput(value: unknown): value is AuditGoalOutput {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.summary === 'string' &&
    Array.isArray(v.audit) &&
    typeof v.proposedGoal === 'string' &&
    Array.isArray(v.successCriteria) &&
    typeof v.roughEffort === 'string' &&
    typeof v.confidence === 'string' &&
    typeof v.rationale === 'string'
  );
}
