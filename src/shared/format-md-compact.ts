/**
 * format-md-compact — single source of truth for whitespace / decoration
 * normalization across every CLI body-output path.
 *
 * Slice 023 (R3) — `peaks project memories:show`, `peaks retrospective show`,
 * and `peaks request show` (per-artifact) all funnel their `body` field through
 * this helper so the LLM-consumed output is free of blank-line padding,
 * decorative `---` rules, and frontmatter `description:` field-name repeats
 * while preserving every semantically meaningful construct (code fences,
 * setext heading underlines, GFM table syntax, frontmatter, list indentation,
 * inline emphasis, code spans).
 *
 * Pure function: no fs, no I/O. Easy to unit-test (see
 * `tests/unit/shared/format-md-compact.test.ts`).
 */

export interface FormatMdCompactOptions {
  /** Preserve code-fence (``` ... ```) and frontmatter (--- ... ---) content. Default true. */
  preserveCodeBlocks?: boolean;
  /** Preserve setext heading underlines (===, --- under a text line). Default true. */
  preserveSetextHeadings?: boolean;
  /** Preserve GFM table syntax (| ... | rows). Default true. */
  preserveTables?: boolean;
  /** Collapse 3+ blank lines to 1. Default true. */
  collapseBlankLines?: boolean;
  /** Strip trailing whitespace per line. Default true. */
  stripTrailingWhitespace?: boolean;
  /** Strip decorative `---` lines (lines surrounded by blanks OR trailing final line). Default true. */
  stripDecorativeHorizontalRules?: boolean;
  /** Strip frontmatter `description:` field-name repeat when same value already in body header. Default true. */
  stripFrontmatterDescriptionRepeat?: boolean;
}

import {
  ATX_HEADING_RE,
  collapseMultiBlanks,
  computeSetextUnderlines,
  isDecorativeHorizontalRule,
  isFenceCloseLine,
  isFenceOpenLine,
  isTableLine,
  splitFrontmatter
} from './format-md-compact-internals.js';

const FENCE_TRIPLE_BACKTICK = '```';
const FENCE_TRIPLE_TILDE = '~~~';

interface FrontmatterShape {
  raw: string;
  description: string | null;
  body: string;
}

export function formatMdCompact(input: string, options: FormatMdCompactOptions = {}): string {
  if (input.length === 0) return input;

  const opts: Required<FormatMdCompactOptions> = {
    preserveCodeBlocks: options.preserveCodeBlocks ?? true,
    preserveSetextHeadings: options.preserveSetextHeadings ?? true,
    preserveTables: options.preserveTables ?? true,
    collapseBlankLines: options.collapseBlankLines ?? true,
    stripTrailingWhitespace: options.stripTrailingWhitespace ?? true,
    stripDecorativeHorizontalRules: options.stripDecorativeHorizontalRules ?? true,
    stripFrontmatterDescriptionRepeat: options.stripFrontmatterDescriptionRepeat ?? true
  };

  // 1. Split frontmatter from body (if any). The YAML block lives between
  //    the first line `---` and the second line `---`. We carry it through
  //    unchanged.
  const fm = splitFrontmatter(input);
  const body = fm.body;

  // 2. Walk the body line-by-line, applying the protected-zone rules.
  const normalizedBody = normalizeBody(body, opts);

  // 3. Optional frontmatter `description:` repeat strip. The body's
  //    first ATX heading is compared to the frontmatter `description:`
  //    value; if the description text repeats the heading, the leading
  //    paragraph is dropped. Implemented as a one-shot post-pass.
  const finalBody = opts.stripFrontmatterDescriptionRepeat
    ? stripDescriptionRepeat(normalizedBody, fm.description)
    : normalizedBody;

  // 4. Re-assemble. The frontmatter stays verbatim; the body carries the
  //    normalized text. Match the original layout: if the input had
  //    frontmatter, output is `frontmatter + blank + body`; otherwise
  //    the body is the whole output.
  if (fm.raw === '') {
    return finalBody;
  }
  return fm.raw + '\n' + finalBody;
}

function normalizeBody(body: string, opts: Required<FormatMdCompactOptions>): string {
  // Walk line-by-line, tracking the protected-zone flags and emitting a
  // transformed line stream. We keep three flag bits:
  //   insideFence:   toggled on ``` / ~~~ lines
  //   insideFrontmatterYAML: handled by splitFrontmatter; body has none.
  //   insideTable:   detected by leading-pipe; carried until first non-pipe
  //                  line.
  const lines = body.split('\n');

  // 1. Pre-pass: compute the `setextUnderlined` markers so the decorative
  //    `---` strip can know when a line is a setext H2 underline (semantic)
  //    vs a decoration.
  const setextUnderlined = computeSetextUnderlines(lines);

  // 2. Protected zones — emit a per-line `protection` flag.
  type Protection = 'fence' | 'setext' | 'table' | 'plain';
  const protection: Protection[] = [];
  let insideFence = false;
  let insideTable = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (opts.preserveCodeBlocks && isFenceOpenLine(line) && !isFenceCloseLine(line, insideFence)) {
      insideFence = !insideFence;
      protection.push('fence');
      continue;
    }
    if (insideFence) {
      protection.push('fence');
      continue;
    }
    if (opts.preserveSetextHeadings && setextUnderlined.has(index)) {
      protection.push('setext');
      continue;
    }
    if (opts.preserveTables && isTableLine(line)) {
      // Entering / continuing a table — first row that looks like a table
      // starts the table zone; the alignment row (|---|) is included.
      insideTable = true;
      protection.push('table');
      continue;
    }
    if (insideTable && !isTableLine(line) && line.trim() !== '') {
      insideTable = false;
    }
    if (insideTable) {
      protection.push('table');
      continue;
    }
    protection.push('plain');
  }

  // 3. Per-line transforms: strip trailing whitespace outside protected
  //    zones; strip decorative `---` outside setext / table / fence zones.
  const out: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const zone = protection[index] ?? 'plain';

    let transformed = line;
    if (zone !== 'fence' && opts.stripTrailingWhitespace) {
      transformed = transformed.replace(/[ \t]+$/u, '');
    }
    if (
      zone !== 'fence' &&
      zone !== 'setext' &&
      zone !== 'table' &&
      opts.stripDecorativeHorizontalRules
    ) {
      if (isDecorativeHorizontalRule(transformed)) {
        // Mark for removal: push a sentinel. The blank-line collapse step
        // will merge surrounding blanks.
        transformed = '__PEAKS_HR_REMOVED__';
      }
    }
    out.push(transformed);
  }

  // 4. Drop the sentinel lines (decorative `---` after classification).
  let collapsed = out.filter((line) => line !== '__PEAKS_HR_REMOVED__');

  // 5. Collapse 3+ consecutive blank lines into 1. Two blank lines
  //    between two non-blank lines are also collapsed to 1 (matches PRD
  //    R2's "decorative `---` is redundant" rule — the original visual
  //    gap that surrounded the `---` collapses with it).
  if (opts.collapseBlankLines) {
    collapsed = collapseMultiBlanks(collapsed);
  }

  return collapsed.join('\n');
}

function stripDescriptionRepeat(body: string, description: string | null): string {
  if (description === null || description.length === 0) return body;

  // Find the first ATX heading line. If it equals the frontmatter
  // description text, drop it. Also drop a description-matching paragraph
  // that immediately follows the heading (PRD's "frontmatter description
  // already in body header" case). All other content is preserved.
  const lines = body.split('\n');
  if (lines.length === 0) return body;

  let firstHeadingIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.trim() === '') continue;
    if (ATX_HEADING_RE.test(line)) {
      firstHeadingIndex = index;
    }
    break;
  }
  if (firstHeadingIndex < 0) return body;

  const headingText = (lines[firstHeadingIndex] ?? '').replace(/^#{1,6}\s+/, '').trim();
  if (headingText !== description) return body;

  // Walk past the heading, then past any blank lines, then past the
  // matching description paragraph (if present). Anything after the
  // description paragraph is the body we want to keep.
  const tail = lines.slice(firstHeadingIndex + 1);
  let cursor = 0;
  // Skip blanks.
  while (cursor < tail.length && (tail[cursor] ?? '') === '') {
    cursor += 1;
  }
  // Read the first non-blank paragraph.
  const paragraphStart = cursor;
  while (cursor < tail.length && (tail[cursor] ?? '') !== '') {
    cursor += 1;
  }
  const paragraph = tail.slice(paragraphStart, cursor);
  if (paragraph.join(' ').trim() !== description) {
    // The paragraph doesn't match the description — don't drop it.
    cursor = paragraphStart;
  }

  const kept = tail.slice(cursor);
  if (kept.length === 0) return '';
  return kept.join('\n');
}
