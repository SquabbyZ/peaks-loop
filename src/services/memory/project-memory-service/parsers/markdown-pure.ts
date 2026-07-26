// ---------------------------------------------------------------------------
// Pure (no-filesystem) markdown helpers used by the extract + summarize paths.
//
// Three concerns live here:
//
//   1. `extractStableProjectMemories` — top-level entry point called by
//      `peaks memory extract --apply` / `--dry-run`. Walks an artifact's
//      text, finds every `<!-- peaks-memory:start/end -->` block, and
//      hands each one to the frontmatter parser. Sorted output is part of
//      the contract (callers rely on deterministic order).
//
//   2. `summarizeMemoryBody` — deterministic one-sentence summary used to
//      populate `MemoryIndexEntry.description`. No LLM call, just markdown
//      strip + sentence selection + length truncation.
//
//   3. `summarizeExtractResult` / `summarizeBackupResult` — projector
//      functions that take the rich extract / backup plan and trim it down
//      to the small JSON-friendly shape consumed by the CLI layer.
//
// No filesystem imports. Pure functions only — easy to unit-test.
// ---------------------------------------------------------------------------

import type {
  ExtractedProjectMemory,
  ProjectMemoryBackupResult,
  ProjectMemoryBackupSummary,
  ProjectMemoryExtractResult,
  ProjectMemoryExtractSummary
} from '../types.js';
import { assertSafeMemory } from '../store/atomic-write.js';
import { parseBlock, slugify } from './frontmatter.js';

export const START_MARKER = '<!-- peaks-memory:start -->';
export const END_MARKER = '<!-- peaks-memory:end -->';

// Length bounds for index entry descriptions. The numbers were chosen when
// summarizeMemoryBody was first introduced; locking them in as named
// constants is a doc-as-code move so the truncation rule is no longer
// "magic". Bump MAX_DESCRIPTION_LENGTH deliberately if downstream UIs grow.
const MIN_BODY_SENTENCE_LENGTH = 20;   // skip fragments shorter than this when picking a leading sentence
const MAX_DESCRIPTION_LENGTH = 120;    // hard cap on description length in the memory index entry
const ELLIPSIS_RESERVE = 3;             // length of the trailing "..." when truncating with an ellipsis

export function summarizeMemoryBody(body: string): string {
  const cleaned = body
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\n+/g, ' ')
    .trim();

  const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(
    (s) => s.length > MIN_BODY_SENTENCE_LENGTH && !/^\[.+\]$/.test(s)
  );
  if (sentences.length === 0) {
    return cleaned.slice(0, MAX_DESCRIPTION_LENGTH) || 'Project memory';
  }

  const first = sentences[0]!;
  if (first.length <= MAX_DESCRIPTION_LENGTH) {
    return first;
  }
  return first.slice(0, MAX_DESCRIPTION_LENGTH - ELLIPSIS_RESERVE) + '...';
}

export function extractStableProjectMemories(content: string, sourceArtifact: string): ExtractedProjectMemory[] {
  const memories: ExtractedProjectMemory[] = [];
  let searchStart = 0;

  while (searchStart < content.length) {
    const start = content.indexOf(START_MARKER, searchStart);
    if (start < 0) break;
    const bodyStart = start + START_MARKER.length;
    const end = content.indexOf(END_MARKER, bodyStart);
    if (end < 0) break;

    const memory = parseBlock(content.slice(bodyStart, end).trim(), sourceArtifact);
    if (memory) {
      assertSafeMemory(memory);
      memories.push(memory);
    }
    searchStart = end + END_MARKER.length;
  }

  return memories.sort((left, right) => slugify(left.title).localeCompare(slugify(right.title)));
}

export function summarizeExtractResult(result: ProjectMemoryExtractResult): ProjectMemoryExtractSummary {
  return {
    apply: result.apply,
    projectRoot: result.projectRoot,
    primaryMemoryDir: result.primaryMemoryDir,
    backupPolicy: result.backupPolicy,
    extractedCount: result.extractedMemories.length,
    plannedWrites: result.plannedWrites.map((write) => ({
      filePath: write.filePath,
      title: write.memory.title,
      kind: write.memory.kind,
      sourceArtifact: write.memory.sourceArtifact
    })),
    writtenFiles: result.writtenFiles
  };
}

export function summarizeBackupResult(result: ProjectMemoryBackupResult): ProjectMemoryBackupSummary {
  return {
    apply: result.apply,
    projectRoot: result.projectRoot,
    artifactWorkspacePath: result.artifactWorkspacePath,
    primaryMemoryDir: result.primaryMemoryDir,
    backupMemoryDir: result.backupMemoryDir,
    plannedCopies: result.plannedCopies,
    copiedFiles: result.copiedFiles
  };
}