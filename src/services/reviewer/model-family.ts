/**
 * model-family.ts — derive `modelFamily` from a `modelId` for the G4
 * third-party reviewer. AC-4.4 requires that
 * `third-party-review.json.modelFamily !== karpathy-review.json.modelFamily`,
 * so the family bucket must be stable, provider-distinguishing, and
 * version-tolerant (e.g. `claude-opus-4-8` and `claude-haiku-4-5` both
 * bucket to `claude`, while `gpt-4o-mini` and `gpt-3.5-turbo` bucket
 * separately).
 *
 * Karpathy §2 — minimum code that solves the problem. We pattern-match
 * on a small set of well-known vendor prefixes. Anything that does not
 * match falls into an `unknown-<slug>` bucket so the family remains
 * distinct-by-default (two unknown models still hash to different
 * families).
 */
import { createHash } from 'node:crypto';

export type ModelFamilyDerivation = {
  modelId: string;
  modelFamily: string;
  source: 'rule' | 'fallback-hash';
};

/**
 * Stable prefix-ordered rules. First match wins. Order matters: more
 * specific prefixes (e.g. `bedrock/.../claude-...`) MUST precede the
 * generic family rule they overlap with (e.g. `claude`), otherwise the
 * generic rule shadows them.
 */
const RULES: ReadonlyArray<{ family: string; test: (m: string) => boolean }> = [
  // Anthropic (incl. bedrock-hosted anthropic) — most specific first.
  { family: 'claude', test: (m) => /^(claude|anthropic\.)/i.test(m) || /^anthropic\.claude-/i.test(m) || /^us\.anthropic\./i.test(m) || /^bedrock\/.+\/claude-/i.test(m) },
  // OpenAI / o-series — order: most specific prefix first.
  { family: 'gpt-5', test: (m) => /^gpt-5/i.test(m) },
  { family: 'gpt-4o', test: (m) => /^gpt-4o/i.test(m) },
  { family: 'gpt-4', test: (m) => /^gpt-4/i.test(m) },
  { family: 'gpt-3.5', test: (m) => /^gpt-3\.5/i.test(m) },
  { family: 'o1', test: (m) => /^o1/i.test(m) },
  { family: 'o3', test: (m) => /^o3/i.test(m) },
  { family: 'azure-openai', test: (m) => /azure/i.test(m) && /openai|gpt/i.test(m) },
  // Vertex / Bedrock non-anthropic — MUST precede generic llama/mistral rules.
  { family: 'bedrock-llama', test: (m) => /bedrock/i.test(m) && /llama/i.test(m) },
  { family: 'bedrock-mistral', test: (m) => /bedrock/i.test(m) && /mistral/i.test(m) },
  // Local / ollama families.
  { family: 'llama', test: (m) => /llama/i.test(m) },
  { family: 'mistral', test: (m) => /mistral|mixtral/i.test(m) },
  { family: 'qwen', test: (m) => /qwen/i.test(m) },
  { family: 'deepseek', test: (m) => /deepseek/i.test(m) },
  { family: 'gemini', test: (m) => /gemini/i.test(m) }
];

/**
 * Resolve a modelId to its provider-family bucket. Pure, deterministic,
 * and total (returns `unknown-<slug>` for unrecognised ids). The slug
 * is the first 8 hex chars of the sha256 of the lowercased modelId —
 * stable across processes and stable across minor version bumps.
 */
export function deriveModelFamily(modelId: string): ModelFamilyDerivation {
  const trimmed = modelId.trim();
  if (trimmed.length === 0) {
    return { modelId, modelFamily: 'unknown-empty', source: 'fallback-hash' };
  }
  for (const rule of RULES) {
    if (rule.test(trimmed)) {
      return { modelId, modelFamily: rule.family, source: 'rule' };
    }
  }
  const slug = createHash('sha256').update(trimmed.toLowerCase()).digest('hex').slice(0, 8);
  return { modelId, modelFamily: `unknown-${slug}`, source: 'fallback-hash' };
}

/**
 * Convenience: returns only the family string. Use `deriveModelFamily`
 * when the caller also wants to know whether a rule matched or whether
 * the fallback path was taken.
 */
export function modelFamily(modelId: string): string {
  return deriveModelFamily(modelId).modelFamily;
}
