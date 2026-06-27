/**
 * Red-line classifier — turns raw markdown lines into RedLineEntry.
 *
 * Algorithm: for each MarkdownLine, check whether the line text contains one
 * of the four red-line markers (MANDATORY / BLOCKING / MUST NOT / RED LINE).
 * On a hit, extract the surrounding ±2 lines as context, look up the red
 * line in the catalog, and emit a RedLineEntry. Lines that contain a marker
 * but match no catalog entry still produce a RedLineEntry (with backing =
 * prose-only and enforcerRef = null) — those are the "discovered but not yet
 * enforced" red lines the L2 redesign is working to eliminate.
 */

import { findCatalogEntry } from './red-line-catalog.js';
import type {
  MarkdownLine,
  RedLineEntry,
  RedLineMarker,
  RedLineSource,
} from './types.js';

const MARKER_PATTERN = /\b(MANDATORY|BLOCKING|MUST NOT|RED LINE)\b/;

const CONTEXT_LINES_BEFORE = 2;
const CONTEXT_LINES_AFTER = 2;

function isMarker(s: string): s is RedLineMarker {
  return s === 'MANDATORY' || s === 'BLOCKING' || s === 'MUST NOT' || s === 'RED LINE';
}

function extractContext(allLines: readonly string[], hitLine: number): string {
  const start = Math.max(0, hitLine - CONTEXT_LINES_BEFORE);
  const end = Math.min(allLines.length, hitLine + 1 + CONTEXT_LINES_AFTER);
  return allLines.slice(start, end).join('\n');
}

/**
 * Detect markers in a single line of markdown. Returns the marker text found
 * (uppercased), or null when no marker is present.
 */
/**
 * Case-insensitive marker pattern (used only by detectMarker so callers can
 * write `MANDATORY` / `mandatory` / `Mandatory` interchangeably in prose).
 * deriveRuleName uses the all-caps MARKER_PATTERN so it doesn't strip a
 * mid-sentence "Red Line" reference.
 */
const MARKER_PATTERN_CI = /\b(MANDATORY|BLOCKING|MUST NOT|RED LINE)\b/i;

export function detectMarker(lineText: string): RedLineMarker | null {
  const match = MARKER_PATTERN_CI.exec(lineText);
  if (!match) return null;
  const raw = (match[1] ?? '').toUpperCase();
  if (raw === 'MUST') {
    // "MUST NOT" is two tokens in the regex; the match group only captures
    // "MUST". Re-verify by checking the next character.
    const after = lineText[match.index + match[0].length];
    if (after === undefined || /\s/.test(after)) {
      return 'MUST NOT';
    }
    return isMarker(raw) ? raw : null;
  }
  return isMarker(raw) ? raw : null;
}

/**
 * Derive a human-readable rule name from the marker line. Heuristic: take
 * the first 8 words of the line, lowercase, trimmed. Catalog matching is
 * the source of truth for the canonical rule name; this is the fallback
 * when no catalog entry matches.
 */
export function deriveRuleName(lineText: string): string {
  const cleaned = lineText
    .replace(MARKER_PATTERN, '')
    .replace(/^[*_`#>:]+/, '')
    .replace(/[*_`#>]/g, '')
    .trim();
  const words = cleaned.split(/\s+/).filter(Boolean).slice(0, 8);
  return words.length > 0 ? words.join(' ').toLowerCase() : 'unspecified red line';
}

export interface ClassifyFileInput {
  readonly file: string;
  readonly lines: readonly string[];
}

export interface ClassifyResult {
  readonly entries: readonly RedLineEntry[];
  readonly warnings: readonly string[];
}

/**
 * Classify a single markdown file. Returns 0+ RedLineEntry; one entry per
 * marker hit. Marker hits that appear multiple times on the same line are
 * counted once.
 */
export function classifyFile(input: ClassifyFileInput): ClassifyResult {
  const entries: RedLineEntry[] = [];
  const warnings: string[] = [];
  const seen = new Set<number>();

  for (let idx = 0; idx < input.lines.length; idx++) {
    const lineText = input.lines[idx] ?? '';
    if (seen.has(idx + 1)) continue;
    const marker = detectMarker(lineText);
    if (marker === null) continue;

    seen.add(idx + 1);
    const context = extractContext(input.lines, idx);
    const ruleName = deriveRuleName(lineText);
    const markers: RedLineMarker[] = [marker];
    const catalog = findCatalogEntry(ruleName, markers);

    const source: RedLineSource = {
      file: input.file,
      line: idx + 1,
      marker,
      context,
    };

    if (catalog) {
      entries.push({
        id: catalog.id,
        rule: catalog.rule,
        source,
        backing: catalog.enforcerRef === null ? 'prose-only' : 'cli-backed',
        enforcerRef: catalog.enforcerRef,
      });
    } else {
      // Marker hit but no catalog match: discovered, not yet enforced.
      // v2.12.1 catalog governance: mark these `informational: true`
      // so the prose-only ratio (per spec §10.2 ≤ 5%) excludes them.
      // The pre-v2.12.1 ratio was 60.1% because every advisory phrase
      // in SKILL.md was counted; the new ratio only counts entries
      // with a real catalog template (those that COULD be promoted
      // to cli-backed via the enforcer-pipeline).
      entries.push({
        id: `rl-discovered-${input.file.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${idx + 1}`,
        rule: ruleName,
        source,
        backing: 'prose-only',
        enforcerRef: null,
        informational: true,
      });
    }
  }

  return { entries, warnings };
}

/**
 * Batch wrapper — classify each input file and flatten the entries.
 */
export function classifyFiles(inputs: readonly ClassifyFileInput[]): ClassifyResult {
  const allEntries: RedLineEntry[] = [];
  const allWarnings: string[] = [];
  for (const input of inputs) {
    const result = classifyFile(input);
    allEntries.push(...result.entries);
    allWarnings.push(...result.warnings);
  }
  return { entries: allEntries, warnings: allWarnings };
}
