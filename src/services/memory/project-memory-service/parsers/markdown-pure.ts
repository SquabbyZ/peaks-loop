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
  MemoryBlockDrop,
  ProjectMemoryBackupResult,
  ProjectMemoryBackupSummary,
  ProjectMemoryExtractResult,
  ProjectMemoryExtractSummary,
  SessionScanFailure
} from '../types.js';
import { assertSafeMemory } from '../store/atomic-write.js';
import { parseBlockResult, slugify, VALID_MEMORY_KINDS } from './frontmatter.js';

export const START_MARKER = '<!-- peaks-memory:start -->';
export const END_MARKER = '<!-- peaks-memory:end -->';

/**
 * A marker-shaped HTML comment: `<!--` then horizontal space then
 * `peaks-memory:start` / `:end`, then anything up to the closing `-->`.
 *
 * This deliberately matches the exact markers TOO — the caller skips those by
 * comparing against `START_MARKER` / `END_MARKER`, so the two literals stay the
 * single source of truth instead of being re-spelled here.
 *
 * Anchoring on `peaks-memory:` immediately after the comment open is what keeps
 * this from firing on prose: a comment that merely *mentions* the marker
 * (`<!-- see the peaks-memory:start docs -->`) does not match, because the text
 * after `<!--` is `see`, not `peaks-memory:`. Only an attempted marker matches.
 */
const MARKER_SHAPED_COMMENT = /<!--[ \t]*peaks-memory:(start|end)\b[^>]*-->/g;

/**
 * Why a marker-shaped comment was not usable, as a warning line. Names both the
 * text that was found and the literal the locator wanted, because the whole
 * failure is "these two differ in a way nothing told you about".
 */
function describeUnrecognizedMarker(found: string): string {
  const wanted = found.includes(':end') ? END_MARKER : START_MARKER;
  return `found ${JSON.stringify(found)}, which is not the exact marker ${JSON.stringify(wanted)} — the locator searches for that literal, so any block this opens is never found`;
}

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

/** Extracted memories plus the blocks that were found and rejected. */
export type ExtractedMemoryBlocks = {
  memories: ExtractedProjectMemory[];
  dropped: MemoryBlockDrop[];
};

/**
 * Same scan as `extractStableProjectMemories`, but also reports the blocks
 * that were found between the markers and rejected by the parser.
 *
 * `extractStableProjectMemories` is the `.memories` projection of this, so the
 * extracted set is identical by construction — the diagnostics cannot change
 * which blocks are accepted.
 */
export function extractStableProjectMemoriesWithDiagnostics(content: string, sourceArtifact: string): ExtractedMemoryBlocks {
  const memories: ExtractedProjectMemory[] = [];
  // Kept as `{index, drop}` pairs so located-block drops and near-miss-marker
  // drops can be reported in DOCUMENT order through one channel. The index is
  // ordering metadata only — it never reaches the caller.
  const drops: Array<{ index: number; drop: MemoryBlockDrop }> = [];
  const locatedRanges: Array<readonly [number, number]> = [];
  let searchStart = 0;

  while (searchStart < content.length) {
    const start = content.indexOf(START_MARKER, searchStart);
    if (start < 0) break;
    const bodyStart = start + START_MARKER.length;
    const end = content.indexOf(END_MARKER, bodyStart);
    if (end < 0) break;

    locatedRanges.push([start, end + END_MARKER.length]);
    const parsed = parseBlockResult(content.slice(bodyStart, end).trim(), sourceArtifact);
    if (parsed.ok) {
      assertSafeMemory(parsed.memory);
      memories.push(parsed.memory);
    } else {
      drops.push({ index: start, drop: { sourceArtifact, reason: parsed.reason, detail: parsed.detail } });
    }
    searchStart = end + END_MARKER.length;
  }

  // Near-miss markers. These are invisible to the loop above by construction —
  // it navigates by exact `indexOf` — so before this pass an artifact written
  // with, say, an attribute inside the marker reported `extractedCount: 0` with
  // `warnings: []`, indistinguishable from an artifact that had no blocks at
  // all. Nothing is extracted here: this pass only names what was not found.
  //
  // A near-miss INSIDE a located block's span is the block's own body text, not
  // an attempted marker, so it is skipped rather than reported.
  for (const match of content.matchAll(MARKER_SHAPED_COMMENT)) {
    const found = match[0];
    if (found === START_MARKER || found === END_MARKER) continue;
    const index = match.index ?? 0;
    if (locatedRanges.some(([from, to]) => index >= from && index < to)) continue;
    drops.push({ index, drop: { sourceArtifact, reason: 'unrecognized-marker', detail: describeUnrecognizedMarker(found) } });
  }

  drops.sort((left, right) => left.index - right.index);

  return {
    memories: memories.sort((left, right) => slugify(left.title).localeCompare(slugify(right.title))),
    dropped: drops.map((entry) => entry.drop)
  };
}

export function extractStableProjectMemories(content: string, sourceArtifact: string): ExtractedProjectMemory[] {
  return extractStableProjectMemoriesWithDiagnostics(content, sourceArtifact).memories;
}

/**
 * Render one warning line per rejected block, for the CLI envelope's
 * `warnings` channel. `unknown-kind` additionally names the accepted
 * vocabulary, because that is the failure whose remedy is a value change.
 */
export function describeMemoryBlockDrops(dropped: ReadonlyArray<MemoryBlockDrop>): string[] {
  return dropped.map((drop) => {
    const hint = drop.reason === 'unknown-kind'
      ? ` Accepted kinds: ${[...VALID_MEMORY_KINDS].join(', ')}.`
      : '';
    return `Skipped a memory block in ${drop.sourceArtifact}: ${drop.detail}.${hint}`;
  });
}

/**
 * Render one warning line per session artifact that could not be read. The
 * sibling of `describeMemoryBlockDrops`, for the failure one level coarser: a
 * whole file that never yielded blocks at all.
 */
export function describeSessionScanFailures(failures: ReadonlyArray<SessionScanFailure>): string[] {
  return failures.map((failure) => `Could not read the session artifact ${failure.file}: ${failure.detail}.`);
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