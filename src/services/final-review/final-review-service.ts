import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LlmRunner } from '../audit/audit-goal-service.js';
import type {
  DimensionEvidence,
  DimensionKind,
  FinalReviewOutput
} from './final-review-types.js';

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

  const userPrompt = `Approved goal's success criteria: ${JSON.stringify(
    approvedGoal.successCriteria
  )}\n\nPrepare the 4-dim review evidence.`;

  const response = await opts.llmRunner.call(SYSTEM_PROMPT, userPrompt, {
    maxTokens: 3000
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.output);
  } catch (err) {
    throw new IncompleteFinalReviewError(
      `LLM output is not valid JSON: ${(err as Error).message}`
    );
  }

  const output = parsed as FinalReviewOutput;
  const presentDimensions = new Set<DimensionKind>(
    output.dimensions.map((d: DimensionEvidence) => d.dimension)
  );
  const missing = REQUIRED_DIMENSIONS.filter(d => !presentDimensions.has(d));
  if (missing.length > 0) {
    throw new IncompleteFinalReviewError(
      `Missing required dimensions: ${missing.join(', ')}`
    );
  }

  return output;
}
