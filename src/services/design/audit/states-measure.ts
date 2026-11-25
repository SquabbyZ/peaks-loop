/**
 * Data/state measurement for the S7 audit (Task 5, tightened by Task 6c, and by
 * the S7 review's M2/M3).
 *
 * Data-bearing evidence is deliberately narrow, because the pilot proved that
 * `.map(` alone is not data: 14 of its 32 findings were a `.map` over a static
 * config array and 14 over a props array, none of them a route page fetching a
 * collection. A page is data-bearing only with one of:
 *   - a fetch / query / loader call (`useQuery`, `fetch(`, `axios`, `loader`,
 *     `useLoaderData`, `trpc`, `$fetch`) in the page or its closure;
 *   - a plural prop typed as a REAL array (`rows: Row[]`, `items: Array<Item>`,
 *     or a named type the same file declares as an array). A generic such as
 *     `options: Record<string, string>` is NOT an array (review M2);
 *   - a `<table>` / `<tbody>` that actually has a body.
 *
 * State evidence is an empty OR error branch. The vocabulary is matched as a
 * WHOLE WORD in a branch or JSX position (review M3): `if (error)`, `error &&`,
 * `isEmpty ? …`, `<EmptyState>`, `errorMessage`. A `catch (error)`, a
 * `notEmpty` variable and an `ErrorBoundary` import are not empty/error UI and
 * no longer silence the rule. The other signals stay as before — a length
 * conditional, a two-value comparison followed by a human message, and a
 * `length < N` early return in a module that renders readable text.
 *
 * Only markup sources are read. CSS files are skipped because `:empty` is a
 * pseudo-class, not an empty state.
 */

import { lineAt, type AuditSource } from './audit-finding.js';
import { hasRenderedText, isMarkupFile, scanElements } from './markup-scan.js';
import { memoBySource, sourceView } from './source-view.js';

/** One piece of evidence, anchored at the line that carried it. */
export type Evidence = {
  file: string;
  line: number;
  /** The matched text (`useQuery`, `<tbody>`, `rows: array`, `empty`, `error`). */
  text: string;
};

/** Which of the three data-bearing signals an evidence row proves. */
export type DataEvidence = Evidence & { kind: 'fetch' | 'table' | 'prop' };

/** Tag names that render a data set. */
const DATA_TAGS = new Set(['table', 'tbody']);

/** A fetch / query / loader call: the data source that fills a list. */
const FETCH_CALL =
  /\b(?:useQuery|useQueries|useSuspenseQuery|useInfiniteQuery|useLoaderData)\b|\bfetch\s*\(|\baxios\b|\btrpc\b|\$fetch\b|\bloader\b/;

/** A plural prop declared as `Array<T>` / `ReadonlyArray<T>`. */
const ARRAY_GENERIC = /\b([A-Za-z_$][\w$]*s)\s*:\s*(?:readonly\s+)?(?:Readonly)?Array\s*</g;

/** A plural prop declared as `T[]` / `readonly T[]`. */
const ARRAY_LITERAL = /\b([A-Za-z_$][\w$]*s)\s*:\s*(?:readonly\s+)?[A-Za-z_$][\w$.]*\[\]/g;

/** A named type alias whose body is an array (`type Rows = Row[]`). */
const ARRAY_ALIAS = /\btype\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]+);/g;

/** A plural prop whose declared type is one of the file's array aliases. */
const NAMED_PROP = /\b([A-Za-z_$][\w$]*s)\s*:\s*([A-Za-z_$][\w$]*)\b/g;

/** JSX components named for the empty state (`<EmptyState>`, `<NoDataList>`). */
const EMPTY_COMPONENT = /<\s*(?:Empty|NoData|NoResults|NotFound|NoItems)[\w$]*\b/g;

/** JSX components named for the error state — not a bare `ErrorBoundary`. */
const ERROR_COMPONENT = /<\s*Error(?:State|Message|Alert|Fallback|Notice|Banner|Panel)[\w$]*\b/g;

/** Camel-case state names that carry the concept wherever they appear. */
const EMPTY_NAME = /\b(?:isEmpty|hasNoData|noData|noResults|emptyMessage|emptyText|emptyState)\b/g;
const ERROR_NAME = /\b(?:isError|hasError|hasErrors|errorMessage|errorText|errorState)\b/g;

/** Chinese static copy that renders as an empty state. */
const EMPTY_COPY = /(?:暂无数据|没有数据)/g;

/** A bare `empty` / `error` variable, matched only in a branch position. */
const EMPTY_VARIABLE = /\bempty\b/g;
const ERROR_VARIABLE = /\berrors?\b/g;

/**
 * A length conditional that means "nothing to render". Only the equality forms
 * qualify: `.length > 0` and `.length !== 0` mean the OPPOSITE (there are rows),
 * and treating them as an empty branch let a "has data" guard silence the rule.
 */
const EMPTY_CONDITION = /\.length\s*===?\s*0|!\s*[\w.$?]+\s*\.\s*length/;

/** A `length < N` guard: the component renders nothing when too few items. */
const EMPTY_GUARD = /\.length\s*<=?\s*\d/;

/** A two-value comparison (`before === after`) — the equality empty branch. */
const VALUE_COMPARISON = /\b([\w.$]+)\s*===?\s*([\w.$]+)/g;

/** A human-readable message: a quoted sentence, or a `t('…')` call. */
const HUMAN_MESSAGE = /["'`][^"'`\n]*[A-Za-z一-鿿]{3,}[^"'`\n]*["'`]/;

/** How far after a comparison its human message may sit. */
const MESSAGE_WINDOW = 400;

/** The branch operators a bare variable must sit beside to be a branch. */
const BRANCH_BEFORE = /(?:if\s*\(\s*|!\s*)$/;
const BRANCH_AFTER = /^\s*(?:\?|&&|\|\||===|!==|==|!=)/;

/** How much text around a variable the branch test reads. */
const BRANCH_WINDOW = 8;

/** Evidence text stays one short line in the technical finding. */
const MAX_EVIDENCE_TEXT = 40;

/** The names a file declares as array types. */
function arrayAliases(view: string): Set<string> {
  const names = new Set<string>();
  for (const match of view.matchAll(ARRAY_ALIAS)) {
    const body = match[2] ?? '';
    if (body.includes('[]') || /\b(?:Readonly)?Array\s*</.test(body)) names.add(match[1] ?? '');
  }
  return names;
}

/** Every array-typed prop a source declares, with its line. */
function arrayPropMatches(view: string): RegExpMatchArray[] {
  const aliases = arrayAliases(view);
  const matches = [...view.matchAll(ARRAY_GENERIC), ...view.matchAll(ARRAY_LITERAL)];
  for (const match of view.matchAll(NAMED_PROP)) {
    if (aliases.has(match[2] ?? '')) matches.push(match);
  }
  return matches;
}

/** The first match of `pattern`, anchored at its line. */
function matchEvidence(
  source: AuditSource,
  view: string,
  starts: readonly number[],
  pattern: RegExp
): Evidence | null {
  const match = pattern.exec(view);
  if (match === null) return null;
  const text = (match[1] ?? match[0]).slice(0, MAX_EVIDENCE_TEXT);
  return { file: source.file, line: lineAt(starts, match.index), text };
}

/** A component or camel-case name: the vocabulary itself is the evidence. */
function namedEvidence(
  source: AuditSource,
  view: string,
  starts: readonly number[],
  patterns: readonly RegExp[]
): Evidence | null {
  for (const pattern of patterns) {
    const found = matchEvidence(source, view, starts, pattern);
    if (found !== null) return found;
  }
  return null;
}

/** A bare `empty` / `error` variable, only when a branch operator sits beside it. */
function branchEvidence(
  source: AuditSource,
  view: string,
  starts: readonly number[],
  pattern: RegExp
): Evidence | null {
  for (const match of view.matchAll(pattern)) {
    const at = match.index ?? 0;
    const before = view.slice(Math.max(0, at - BRANCH_WINDOW), at);
    const after = view.slice(at + match[0].length, at + match[0].length + BRANCH_WINDOW);
    if (!BRANCH_BEFORE.test(before) && !BRANCH_AFTER.test(after)) continue;
    return {
      file: source.file,
      line: lineAt(starts, at),
      text: match[0].slice(0, MAX_EVIDENCE_TEXT)
    };
  }
  return null;
}

/** The fetch/query/loader call one source declares, if any. */
export function fetchEvidence(source: AuditSource): Evidence | null {
  if (!isMarkupFile(source.file)) return null;
  const view = sourceView(source);
  return matchEvidence(source, view.comments, view.starts, FETCH_CALL);
}

/** Table-like elements with a rendered body: a data set in element form. */
function tableEvidence(
  source: AuditSource,
  view: string,
  starts: readonly number[]
): DataEvidence[] {
  const evidence: DataEvidence[] = [];
  const lower = view.toLowerCase();
  for (const element of scanElements(view, starts)) {
    if (!DATA_TAGS.has(element.lowerTag)) continue;
    if (view.slice(element.start, element.end).trimEnd().endsWith('/>')) continue;
    if (lower.indexOf(`</${element.lowerTag}`, element.end) === -1) continue;
    evidence.push({
      file: source.file,
      line: element.line,
      text: `<${element.tag}>`,
      kind: 'table'
    });
  }
  return evidence;
}

/** Plural props typed as real arrays: a collection handed to the page. */
function propEvidence(
  source: AuditSource,
  view: string,
  starts: readonly number[]
): DataEvidence[] {
  return arrayPropMatches(view).map((match) => ({
    file: source.file,
    line: lineAt(starts, match.index ?? 0),
    text: `${match[1]}: array`.slice(0, MAX_EVIDENCE_TEXT),
    kind: 'prop' as const
  }));
}

/** Every data-bearing signal one markup source renders. */
export function dataEvidence(source: AuditSource): DataEvidence[] {
  if (!isMarkupFile(source.file)) return [];
  const view = sourceView(source);
  const fetch = fetchEvidence(source);
  return [
    ...(fetch === null ? [] : [{ ...fetch, kind: 'fetch' as const }]),
    ...tableEvidence(source, view.comments, view.starts),
    ...propEvidence(source, view.comments, view.starts)
  ];
}

/** A two-value comparison whose branch renders a human message. */
function comparisonEvidence(
  source: AuditSource,
  view: string,
  starts: readonly number[]
): Evidence | null {
  for (const match of view.matchAll(VALUE_COMPARISON)) {
    const at = match.index ?? 0;
    if (!HUMAN_MESSAGE.test(view.slice(at, at + MESSAGE_WINDOW))) continue;
    return {
      file: source.file,
      line: lineAt(starts, at),
      text: `${match[1]} === ${match[2]}`.slice(0, MAX_EVIDENCE_TEXT)
    };
  }
  return null;
}

/** Every empty / error branch one markup source declares. */
function sourceEvidence(source: AuditSource): { empty: Evidence[]; error: Evidence[] } {
  if (!isMarkupFile(source.file)) return { empty: [], error: [] };
  const view = sourceView(source);
  const text = view.comments;
  const starts = view.starts;
  const found = [
    namedEvidence(source, text, starts, [EMPTY_COMPONENT, EMPTY_NAME, EMPTY_COPY]),
    branchEvidence(source, text, starts, EMPTY_VARIABLE),
    matchEvidence(source, text, starts, EMPTY_CONDITION),
    comparisonEvidence(source, text, starts)
  ].filter((entry): entry is Evidence => entry !== null);
  // A `length < N → null` guard renders nothing on purpose. It counts only in
  // a module that renders readable text, so a pure logic module's guard can
  // never manufacture a clean verdict for a page that declares none.
  if (hasRenderedText(text)) {
    const guard = matchEvidence(source, text, starts, EMPTY_GUARD);
    if (guard !== null) found.push(guard);
  }
  const error = [
    namedEvidence(source, text, starts, [ERROR_COMPONENT, ERROR_NAME]),
    branchEvidence(source, text, starts, ERROR_VARIABLE)
  ].filter((entry): entry is Evidence => entry !== null);
  return { empty: found, error };
}

/** Every empty / error branch across a set of markup sources. */
export function stateEvidence(sources: readonly AuditSource[]): {
  empty: Evidence[];
  error: Evidence[];
} {
  const empty: Evidence[] = [];
  const error: Evidence[] = [];
  for (const source of sources) {
    const found = memoBySource(source, 'state-evidence', () => sourceEvidence(source));
    empty.push(...found.empty);
    error.push(...found.error);
  }
  return { empty, error };
}
