/**
 * Per spec §4.1 Step 4 — Renderer.
 *
 * Audience-scoped view: peaks-rd sees goal + docs + memory;
 * peaks-qa sees test files + coverage + (later) mut-report;
 * peaks-mut sees test files + source under test only.
 *
 * Hard constraint: budget truncation must be explicit, never silent.
 */
import type {
  Audience, CollectorOutput, DocRetrieverOutput, RendererOutput,
  TokenizerOutput,
} from './types.js';

export interface RenderInput {
  readonly goal: string;
  readonly audience: Audience;
  readonly docBudgetTokens: number;
  readonly collector: CollectorOutput;
  readonly docRetriever: DocRetrieverOutput;
  readonly tokenizer: TokenizerOutput;
  readonly now?: () => Date;
}

function pickDocsForAudience(
  audience: Audience,
  docs: DocRetrieverOutput['fetchedDocs'],
): DocRetrieverOutput['fetchedDocs'] {
  if (audience === 'peaks-mut') {
    // peaks-mut does NOT see docs — its job is purely test quality.
    return [];
  }
  return docs;
}

export function render(input: RenderInput): RendererOutput {
  const now = input.now ?? (() => new Date());
  const docs = pickDocsForAudience(input.audience, input.docRetriever.fetchedDocs);

  // Estimate size: rough heuristic — bytes = chars.
  // v1 serializes to a single string to compute sizeBytes.
  const serialized = JSON.stringify({
    goal: input.goal,
    audience: input.audience,
    docs: docs.map((d) => ({ dep: d.dep, version: d.version, excerpt: d.sections.map((s) => s.excerpt).join(' ') })),
    skipped: input.docRetriever.skipped,
  });
  const sizeBytes = Buffer.byteLength(serialized, 'utf8');
  const approxTokens = Math.ceil(sizeBytes / 4);

  const truncated = approxTokens > input.docBudgetTokens;
  const result: RendererOutput = {
    audience: input.audience,
    renderedAt: now().toISOString(),
    sizeBytes,
    truncated,
    ...(truncated ? { truncatedReason: 'doc_budget_exceeded' as const } : {}),
  };
  return Object.freeze(result);
}