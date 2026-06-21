/**
 * Per spec §4.1 Step 3 — Tokenizer (non-mutating).
 *
 * Hard constraint H3: structured metadata > bare strings. Each collector
 * artifact and each fetched doc gets a tokenized metadata record so
 * peaks-rd/qa can do relative-anomaly detection later.
 *
 * Immutability H (common/coding-style): the output is frozen so callers
 * cannot mutate it. Use spread to derive new outputs in future slices.
 */
import type {
  CollectorOutput, DocRetrieverOutput, TokenizedItem, TokenizerOutput,
} from './types.js';

function freshDecayScore(fetchedAt: string, now: Date): number {
  const ageMs = now.getTime() - new Date(fetchedAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  // Linear decay: 1.0 at day 0, 0.5 at day 30, 0.0 at day 60+
  if (ageDays >= 60) return 0;
  return Math.max(0, 1 - ageDays / 60);
}

export function tokenize(
  collector: CollectorOutput,
  docRetriever: DocRetrieverOutput,
  now: Date = new Date(),
): TokenizerOutput {
  const metadata: TokenizedItem[] = [];

  for (const doc of docRetriever.fetchedDocs) {
    metadata.push({
      id: `doc:${doc.dep}@${doc.version}`,
      kind: 'doc',
      version: doc.version,
      blastRadius: doc.sections.map((s) => s.title),
      conflictScore: 0, // v1: no cross-source conflict detection yet
      timeDecayScore: freshDecayScore(doc.fetchedAt, now),
      tags: ['fetched', doc.source, doc.stale ? 'stale' : 'fresh'],
    });
  }

  for (const mem of collector.memoryEntries) {
    metadata.push({
      id: `memory:${mem.path}`,
      kind: 'memory',
      blastRadius: [mem.title],
      conflictScore: 0,
      timeDecayScore: mem.relevanceScore,
      tags: ['memory'],
    });
  }

  for (const file of collector.files) {
    metadata.push({
      id: `code:${file.path}`,
      kind: 'code',
      blastRadius: [file.path],
      conflictScore: 0,
      timeDecayScore: 1,
      tags: [file.kind],
    });
  }

  return Object.freeze({ metadata: Object.freeze(metadata) as ReadonlyArray<TokenizedItem> });
}