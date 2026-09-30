/**
 * Internal, finding-free building blocks for `format-md-compact.ts`.
 *
 * Split verbatim from the main module for the file-size cap campaign; the
 * public surface (`formatMdCompact` / `FormatMdCompactOptions`) is re-exported
 * from `format-md-compact.ts`, so importers keep pointing at the same path.
 * This module is imported by both `src/` and `packages/` through that path.
 */

export const FENCE_MARKER_RE = /^(```+|~~~+)/;
export const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
export const TABLE_ALIGN_ROW_RE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/;
export const ATX_HEADING_RE = /^#{1,6}\s/;
export const HEADING_LINE_RE = /^\S/;
export const SETEXT_UNDERLINE_RE = /^=+\s*$|^-{2,}\s*$/;

export interface ParsedFrontmatter {
  raw: string;
  description: string | null;
  body: string;
}

export function splitFrontmatter(input: string): ParsedFrontmatter {
  // Normalize line endings so Windows \r\n doesn't confuse the leading-marker check.
  const normalized = input.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (lines[0] !== '---') {
    return { raw: '', description: null, body: normalized };
  }
  let closeIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === '---') {
      closeIndex = index;
      break;
    }
  }
  if (closeIndex < 0) {
    return { raw: '', description: null, body: normalized };
  }
  const raw = lines.slice(0, closeIndex + 1).join('\n');
  // Body = everything after the closing `---` (preserving one optional blank line).
  const bodyLines = lines.slice(closeIndex + 1);
  while (bodyLines.length > 0 && bodyLines[0] === '') {
    bodyLines.shift();
  }
  const body = bodyLines.join('\n');

  // Extract the `description:` field. Walk the YAML block; pull the value
  // as a single-line string. Multi-line (`|`) or folded (`>`) scalars are
  // joined with a single space — the description is a short summary, the
  // exact whitespace inside the block scalar is not preserved.
  const frontmatterLines = lines.slice(1, closeIndex);
  const description = extractFrontmatterDescription(frontmatterLines);

  return { raw, description, body };
}

function extractFrontmatterDescription(frontmatterLines: string[]): string | null {
  for (let index = 0; index < frontmatterLines.length; index += 1) {
    const line = frontmatterLines[index] ?? '';
    const match = line.match(/^description:\s*(.*)$/);
    if (match === null) continue;
    const inline = (match[1] ?? '').trim();
    if (inline === '|' || inline === '>') {
      const collected: string[] = [];
      for (let inner = index + 1; inner < frontmatterLines.length; inner += 1) {
        const innerLine = frontmatterLines[inner] ?? '';
        if (/^[A-Za-z0-9_-]+:/.test(innerLine)) break;
        collected.push(innerLine.replace(/^\s{2}/, ''));
      }
      return collected.join(' ').trim();
    }
    // Strip surrounding quotes if the value is a quoted scalar.
    return inline.replace(/^['"]|['"]$/g, '');
  }
  return null;
}

export function isFenceOpenLine(line: string): boolean {
  return FENCE_MARKER_RE.test(line);
}

export function isFenceCloseLine(line: string, insideFence: boolean): boolean {
  // The `isFenceOpenLine` already returned true for this line, so it
  // starts with ``` or ~~~. A "close" line is one that opens a new fence
  // of the *same* length. We approximate by treating any opener as a close
  // when we are currently inside a fence.
  return insideFence;
}

export function isTableLine(line: string): boolean {
  return TABLE_ROW_RE.test(line) || TABLE_ALIGN_ROW_RE.test(line);
}

export function computeSetextUnderlines(lines: string[]): Set<number> {
  // A `===` or `---` line is a setext heading underline ONLY when it sits
  // directly under a non-blank, non-ATX text line (no blank line between
  // them). The presence of a blank line between the text and the rule
  // disqualifies it (a blank-separated `---` is decoration, not setext).
  const result = new Set<number>();
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!SETEXT_UNDERLINE_RE.test(line)) continue;
    const prev = lines[index - 1] ?? '';
    if (prev === '') continue;
    if (ATX_HEADING_RE.test(prev)) continue;
    if (!HEADING_LINE_RE.test(prev)) continue;
    result.add(index);
  }
  return result;
}

export function isDecorativeHorizontalRule(line: string): boolean {
  // A line that is exactly `---` (or any number of `-` chars) is a
  // candidate horizontal rule. The caller has already excluded setext
  // and table contexts via the `protection` array.
  return /^-+$/.test(line);
}

export function collapseMultiBlanks(lines: string[]): string[] {
  const result: string[] = [];
  let blankRun = 0;
  for (const line of lines) {
    if (line === '') {
      blankRun += 1;
      // 1 blank line is the cap. Drop the rest.
      if (blankRun <= 1) {
        result.push(line);
      }
      continue;
    }
    blankRun = 0;
    result.push(line);
  }
  return result;
}
