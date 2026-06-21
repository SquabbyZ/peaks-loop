/**
 * Per spec §4.1 — ContextBuilder.
 *
 * Orchestrates Collector → DocRetriever → Tokenizer → Renderer.
 * Computes sha256 over the content (excluding the sha256 field itself —
 * H8 audit-trail integrity). Atomic write: tmp file + rename, so a crash
 * mid-write leaves no partial context.json on disk.
 */
import { createHash } from 'node:crypto';
import { writeFile, rename, unlink } from 'node:fs/promises';
import { z } from 'zod';
import { collectContext } from './collector.js';
import { retrieveDocs, type DocFetcher } from './doc-retriever.js';
import { tokenize } from './tokenizer.js';
import { render, type RenderInput } from './renderer.js';
import { ContextJsonSchema } from './context-schema.js';
import type { Audience, ContextJson } from './types.js';

const BuildInputSchema = z.object({
  goal: z.string().min(1),
  project: z.string().min(1),
  audience: z.enum(['peaks-rd', 'peaks-qa', 'peaks-mut', 'all']),
  depsMode: z.enum(['locked', 'latest']),
  docBudgetTokens: z.number().int().positive().default(8000),
  out: z.string().min(1),
  fetcher: z.function(),
});

export type BuildInput = z.infer<typeof BuildInputSchema>;

function sha256OfContent(content: object): string {
  // Exclude `sha256` field from the hash (else chicken-and-egg).
  const { sha256: _omit, ...rest } = content as { sha256?: string };
  void _omit;
  const canonical = JSON.stringify(rest, Object.keys(rest).sort());
  return createHash('sha256').update(canonical).digest('hex');
}

export async function buildContext(rawInput: unknown): Promise<ContextJson> {
  const input = BuildInputSchema.parse(rawInput) as BuildInput & { fetcher: DocFetcher };

  const collected = await collectContext({
    goal: input.goal,
    project: input.project,
    depsMode: input.depsMode,
  });

  const docs = await retrieveDocs(collected.collector.deps, { fetcher: input.fetcher });
  const tok = tokenize(collected.collector, docs);

  const renderInput: RenderInput = {
    goal: input.goal,
    audience: input.audience as Audience,
    docBudgetTokens: input.docBudgetTokens,
    collector: collected.collector,
    docRetriever: docs,
    tokenizer: tok,
  };
  const renderer = render(renderInput);

  // First pass: placeholder sha256 so we can hash the rest.
  const partial = {
    version: '1.0' as const,
    goal: input.goal,
    generatedAt: new Date().toISOString(),
    sha256: '',
    collector: collected.collector,
    docRetriever: docs,
    tokenizer: tok,
    renderer,
  };
  const sha256 = sha256OfContent(partial);
  const finalCtx: ContextJson = { ...partial, sha256 };

  // Validate before write (H8: garbage context.json must never land).
  ContextJsonSchema.parse(finalCtx);

  // Atomic write: tmp + rename.
  const tmp = `${input.out}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(finalCtx, null, 2), 'utf8');
    await rename(tmp, input.out);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }

  return finalCtx;
}
