// src/services/batch/batch-diagnosis-finding.ts
//
// What a diagnosis report SAYS, read out of the report itself.
//
// WHY THIS IS A SEPARATE MODULE. The diagnosis report has two forms: the
// full report the diagnostician produced, and the bounded summary the
// orchestrator's window may hold (see `batch-diagnosis-summary.ts`). The
// summary is BUILT from this module's answer, and the answer is read from
// the report — never typed by hand. The file set is a MEASUREMENT, and a
// hand-typed copy of a measurement is a guess; a guess here is a wave
// that puts two agents on one file.
//
// WHY THE PARSER IS TOLERANT BUT NOT GUESSY. A heading must be a
// heading: the label, optionally followed by the prompt's bilingual
// parenthetical and/or a colon. Free prose that merely contains the word
// "sketch" is not a heading, and a report with no heading at all parses
// to `null` — "this report is not in the expected shape", which is a
// different answer from "this report says nothing".
//
// THE REPORT SHAPE. The diagnosis prompt (`buildDiagnosisPrompt`) asks for
// four things in this order: root cause, expected files, risk surface hit,
// fix sketch. Each is introduced by a labelled heading, and the parser
// accepts that heading with or without markdown decoration and with or
// without the bilingual parenthetical (`Root cause (根因)`). The risk
// section is recognised so that it ENDS the section before it — the file
// set must not swallow the risk number.

import { normalizeFileSet } from './batch-progress-store.js';

/** What the summary is built from: the three things the orchestrator needs. */
export interface BatchDiagnosisFinding {
  /** Why the symptom happens, in the diagnostician's own words. */
  readonly rootCause: string;
  /** The repo-relative paths a fix would touch, POSIX-normalized. */
  readonly files: readonly string[];
  /** The sketch of the fix, one line. */
  readonly sketch: string;
}

/** The sections the diagnosis prompt asks for. `risk` is read to end the previous section. */
type SectionKey = 'rootCause' | 'files' | 'risk' | 'sketch';

/**
 * The section headings the parser recognises.
 *
 * Order matters: the longer label is tried first, so `Expected files` is
 * not read as `files` and `Fix sketch` is not read as `sketch`.
 */
const MARKERS: readonly { readonly key: SectionKey; readonly marker: string }[] = [
  { key: 'rootCause', marker: 'root cause' },
  { key: 'rootCause', marker: '根因' },
  { key: 'files', marker: 'expected files' },
  { key: 'files', marker: '预计文件集' },
  { key: 'files', marker: '文件集' },
  { key: 'risk', marker: 'risk surface hit' },
  { key: 'risk', marker: 'risk surface' },
  { key: 'risk', marker: '风险面' },
  { key: 'sketch', marker: 'fix sketch' },
  { key: 'sketch', marker: '修复草图' },
  { key: 'sketch', marker: 'sketch' }
];

/**
 * Strip the decoration a heading may carry: markdown heading marks, list
 * numbering, a bullet, and emphasis.
 *
 * Only the DOUBLE emphasis is removed everywhere: a single underscore is
 * part of an identifier (`session_manager`), and a file set that lost its
 * underscores would name files that do not exist.
 */
function stripDecoration(line: string): string {
  let text = line.trim();
  text = text.replace(/^#{1,6}\s*/, '');
  text = text.replace(/^\(?\d+[.)]\s*/, '');
  text = text.replace(/^[-*+]\s+/, '');
  text = text.replace(/\*\*|__/g, '');
  text = text.replace(/^(?:\*|_)+/, '');
  text = text.replace(/(?:\*|_)+$/, '');
  return text.trim();
}

/** One recognised heading and the text that followed the label on that line. */
interface SectionHead {
  readonly key: SectionKey;
  readonly inline: string;
}

/** The closing bracket of a parenthetical, in either width. */
function findParenEnd(text: string): number {
  const half = text.indexOf(')');
  const full = text.indexOf('）');
  if (half === -1) return full;
  if (full === -1) return half;
  return Math.min(half, full);
}

/** Whether the text after a label opens the answer rather than continuing prose. */
function isLabelSeparator(text: string): boolean {
  return text.startsWith(':') || text.startsWith('：') || text.startsWith('—');
}

/**
 * The text that follows a label, and whether the line is a heading at all.
 *
 * With the prompt's bilingual parenthetical the line IS a heading, and
 * whatever follows is the answer or the prompt's own description. Without
 * it, the text after the label must be a separator — a label followed by
 * prose is a sentence that mentions the label, not a heading.
 */
function readLabelTail(rest: string): { readonly tail: string; readonly isHeading: boolean } {
  let text = rest;
  if (text.startsWith('(') || text.startsWith('（')) {
    const end = findParenEnd(text);
    if (end === -1) return { tail: '', isHeading: false };
    text = text.slice(end + 1).trim();
  } else if (text !== '' && !isLabelSeparator(text)) {
    return { tail: '', isHeading: false };
  }
  if (text.startsWith(':') || text.startsWith('：')) text = text.slice(1).trim();
  if (text.startsWith('—')) text = text.slice(1).trim();
  return { tail: text, isHeading: true };
}

/**
 * Recognise a section heading.
 *
 * The heading must be the label itself: the label, then optionally the
 * prompt's bilingual parenthetical, then optionally a colon and the
 * answer. The text that follows the label on the heading line is kept as
 * a FALLBACK, because the prompt prints a DESCRIPTION after every label
 * and a report that answers on the following lines must not be read as
 * the description.
 */
function matchHeading(line: string): SectionHead | null {
  const text = stripDecoration(line);
  if (text === '') return null;
  const lower = text.toLowerCase();
  for (const { key, marker } of MARKERS) {
    if (!lower.startsWith(marker.toLowerCase())) continue;
    const { tail, isHeading } = readLabelTail(text.slice(marker.length).trim());
    if (!isHeading) continue;
    return { key, inline: tail };
  }
  return null;
}

/** A token that could be a path: no whitespace, and either a separator or an extension. */
const PATH_TOKEN = /^[A-Za-z0-9_@.\-+/\\]+$/;

function looksLikePath(token: string): boolean {
  if (!PATH_TOKEN.test(token)) return false;
  if (token.includes('/') || token.includes('\\')) return true;
  return /\.[A-Za-z0-9]+$/.test(token);
}

/**
 * Pull the file set out of the files section.
 *
 * The section is free text: the paths may be one per line, bulleted, in
 * backticks, or comma-separated on one line. Tokens that cannot be paths
 * (an English word, a stray parenthesis) are dropped, because a guessed
 * file is a wave-planning input that sends two agents to one file.
 */
function readFiles(body: readonly string[]): readonly string[] {
  const found: string[] = [];
  for (const line of body) {
    const cleaned = line
      .trim()
      .replace(/^[-*+]\s+/, '')
      .replace(/`/g, '');
    if (cleaned === '') continue;
    for (const token of cleaned.split(/[\s,]+/)) {
      const candidate = token.replace(/[.,;:]+$/, '');
      if (candidate === '' || !looksLikePath(candidate)) continue;
      found.push(candidate);
    }
  }
  return normalizeFileSet(found);
}

/**
 * Collapse a paragraph to one line.
 *
 * Exported because the summary renders the same fields, and two modules
 * that shape the same text must shape it the same way.
 */
export function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The first non-empty line of a section, collapsed. */
function firstLine(text: string): string {
  for (const line of text.split('\n')) {
    const collapsed = collapse(line);
    if (collapsed !== '') return collapsed;
  }
  return '';
}

/**
 * Read the finding out of a diagnosis report.
 *
 * @param report - The report the diagnostician produced, verbatim.
 * @returns The finding, or `null` when the report carries no recognised
 *   section at all — a report in another shape, which the caller must
 *   read rather than summarise.
 */
export function parseBatchDiagnosisFinding(report: string): BatchDiagnosisFinding | null {
  const lines = report.split('\n');
  const bodies = new Map<SectionKey, string[]>();
  const inlines = new Map<SectionKey, string>();
  let current: SectionKey | null = null;
  let sawHeading = false;
  for (const line of lines) {
    const head = matchHeading(line);
    if (head !== null) {
      current = head.key;
      sawHeading = true;
      if (!bodies.has(current)) bodies.set(current, []);
      if (head.inline !== '') inlines.set(current, head.inline);
      continue;
    }
    if (current === null) continue;
    (bodies.get(current) as string[]).push(line);
  }
  if (!sawHeading) return null;
  // The body wins over the heading line's own text: the prompt prints a
  // DESCRIPTION after every label, and a report that answers on the
  // following lines must not be read as the description.
  const textOf = (key: SectionKey): string => {
    const body = (bodies.get(key) ?? []).join('\n').trim();
    if (body !== '') return body;
    return inlines.get(key) ?? '';
  };
  return {
    rootCause: collapse(textOf('rootCause')),
    files: readFiles(textOf('files').split('\n')),
    sketch: firstLine(textOf('sketch'))
  };
}
