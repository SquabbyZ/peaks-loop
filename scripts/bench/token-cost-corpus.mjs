/**
 * token-cost-corpus.mjs — corpus fixtures and loader for the Slice Z-A
 * token-cost benchmark (`scripts/bench/memory-search-token-cost.mjs`).
 *
 * Relocated verbatim to keep that script under the 300-line file cap — no
 * behaviour change. The benchmark imports MEMORY_DIR, QUERIES and
 * loadMemoryCorpus from here.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const MEMORY_DIR = join(process.cwd(), '.peaks', 'memory');

export const QUERIES = [
  'idempotency',
  'sub-agent context',
  'audit decision',
  'headroom compression',
  'red line rule',
  'workspace underscore',
  'ide adapter',
  'gitignore peaks',
  'rerank LLM',
  'skill first CLI'
];

export function parseMemoryFrontmatter(text) {
  const fmMatch = /^---\n([\s\S]*?)\n---/.exec(text);
  if (fmMatch === null) return null;
  const block = fmMatch[1];
  const nameMatch = /^name:\s*(.+)$/m.exec(block);
  const descMatch = /^description:\s*(.+)$/m.exec(block);
  if (nameMatch === null) return null;
  return {
    name: nameMatch[1].trim(),
    description: descMatch !== null ? descMatch[1].trim() : ''
  };
}

export function loadMemoryCorpus() {
  let files;
  try {
    files = readdirSync(MEMORY_DIR).filter((f) => f.endsWith('.md'));
  } catch (e) {
    console.error(`ERROR: cannot read ${MEMORY_DIR}: ${e.message}`);
    process.exit(1);
  }
  const corpus = [];
  for (const f of files) {
    const text = readFileSync(join(MEMORY_DIR, f), 'utf8');
    const fm = parseMemoryFrontmatter(text);
    if (fm === null) continue;
    corpus.push(fm);
  }
  return corpus;
}
