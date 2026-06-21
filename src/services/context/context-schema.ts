/**
 * Runtime validator for context.json. Per spec §4.1 + H8 (audit trail
 * hashable). When this schema changes, version field must bump.
 */
import { z } from 'zod';

export const ContextJsonSchema = z.object({
  version: z.literal('1.0'),
  goal: z.string().min(1),
  generatedAt: z.string().datetime(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  collector: z.object({
    files: z.array(z.object({
      path: z.string(),
      kind: z.enum(['source', 'test', 'config', 'doc']),
      lines: z.number().int().nonnegative(),
      hash: z.string(),
    })),
    gitStatus: z.object({
      branch: z.string(),
      lastCommit: z.string(),
      dirty: z.boolean(),
    }),
    memoryEntries: z.array(z.object({
      path: z.string(),
      title: z.string(),
      relevanceScore: z.number().min(0).max(1),
      excerptHash: z.string(),
    })),
    deps: z.record(z.string(), z.object({
      version: z.string(),
      source: z.enum(['package.json', 'pnpm-lock.yaml', 'yarn.lock']),
      resolved: z.string(),
    })),
  }),
  docRetriever: z.object({
    fetchedDocs: z.array(z.object({
      dep: z.string(),
      version: z.string(),
      source: z.enum(['local-cache', 'remote-fetch']),
      url: z.string().optional(),
      fetchedAt: z.string().datetime(),
      contentHash: z.string(),
      sections: z.array(z.object({
        title: z.string(),
        tokenEstimate: z.number().int().nonnegative(),
        excerpt: z.string(),
      })),
      stale: z.boolean(),
    })),
    skipped: z.array(z.object({
      dep: z.string(),
      reason: z.enum(['unconfigured', 'network_error', 'version_unknown']),
    })),
  }),
  tokenizer: z.object({
    metadata: z.array(z.object({
      id: z.string(),
      kind: z.enum(['doc', 'code', 'memory', 'git']),
      version: z.string().optional(),
      blastRadius: z.array(z.string()),
      conflictScore: z.number().min(0).max(1),
      timeDecayScore: z.number().min(0).max(1),
      tags: z.array(z.string()),
    })),
  }),
  renderer: z.object({
    audience: z.enum(['peaks-rd', 'peaks-qa', 'peaks-mut', 'all']),
    renderedAt: z.string().datetime(),
    sizeBytes: z.number().int().nonnegative(),
    truncated: z.boolean(),
    truncatedReason: z.enum(['doc_budget_exceeded', 'section_count_exceeded']).optional(),
  }),
});