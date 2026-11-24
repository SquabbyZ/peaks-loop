/**
 * What counts as real evidence, per designlang tool.
 *
 * The S5 spike (designlang 13.4.1) measured that `drift`, `verify-ui` and
 * `slop` emit NO `generatedAt` and NO `pages` — only `slop` emits a real
 * timestamp (`readAt`). The old `generatedAt`/`pages` stamp therefore refused
 * every payload the engine really prints, including a `pass: true` verify-ui,
 * which made the positive-evidence rule a gate that could never fire. Each
 * tool now gets the shape it really emits; `drift` additionally has to echo
 * the URL and tokens file the adapter passed, which no timestamp can fake.
 * `grade` keeps the written-report stamp it really carries. Nothing here ever
 * synthesises a timestamp.
 */
import { resolve } from 'node:path';

import { pathsEqual } from '../../shared/path-utils.js';
import type { DesignlangCheckKind } from './designlang.js';

/** The values the caller passed to the spawn; drift must echo both back. */
export type EvidenceExpectation = {
  url?: string;
  tokensFile?: string;
};

/** The four verdicts `designlang drift` really emits (spike §1). */
const DRIFT_VERDICTS: readonly string[] = [
  'in-sync',
  'minor-drift',
  'notable-drift',
  'major-drift'
];

const GRADE_STAMP_MESSAGE = 'stdout carried no generatedAt timestamp or pages list.';

/** A non-empty, non-array object — the only shape that counts as evidence. */
export function isEvidenceObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0
  );
}

/** A finite number, or null for anything else (including `NaN`/`Infinity`). */
function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A non-negative integer count, or null. */
function countOf(value: unknown): number | null {
  const count = finiteNumber(value);
  return count !== null && Number.isInteger(count) && count >= 0 ? count : null;
}

/** Spec §7.3 Q5 for `grade`: a timestamp or a NON-EMPTY rendered page list. */
function hasRunStamp(value: Record<string, unknown>): boolean {
  const generatedAt = value.generatedAt;
  if (typeof generatedAt === 'string' && generatedAt.trim() !== '') return true;
  return Array.isArray(value.pages) && value.pages.length > 0;
}

/** Drift's verdict and its ratio: the two fields a real report always carries. */
function driftVerdictRefusal(payload: Record<string, unknown>): string | null {
  const verdict = payload.verdict;
  if (typeof verdict !== 'string' || !DRIFT_VERDICTS.includes(verdict)) {
    return `drift verdict ${String(verdict)} was not one of ${DRIFT_VERDICTS.join(', ')}.`;
  }
  const ratio = finiteNumber(payload.driftRatio);
  if (ratio === null || ratio < 0 || ratio > 1) {
    return 'drift driftRatio was not a finite number in 0..1.';
  }
  return null;
}

/** A count from the top-level array, or from the summary when the array is absent. */
function listCount(
  payload: Record<string, unknown>,
  summary: Record<string, unknown>,
  key: string
): number | null {
  const list = payload[key];
  return Array.isArray(list) ? list.length : countOf(summary[key]);
}

/** Drift's own arithmetic: it compared at least one token, and its counts add up. */
function driftSummaryRefusal(payload: Record<string, unknown>): string | null {
  const summary = payload.summary;
  if (!isEvidenceObject(summary)) return 'drift summary was not an object.';
  const total = countOf(summary.total);
  if (total === null || total < 1) return 'drift summary.total was not an integer >= 1.';
  const drifted = listCount(payload, summary, 'drifted');
  const matched = listCount(payload, summary, 'matched');
  if (drifted === null || matched === null) {
    return 'drift payload carried no drifted/matched counts.';
  }
  if (total !== drifted + matched) {
    return `drift summary.total ${String(total)} did not equal drifted ${String(drifted)} + matched ${String(matched)}.`;
  }
  return null;
}

/** The echo the adapter can check because IT supplied both values. */
function driftProvenanceRefusal(
  payload: Record<string, unknown>,
  expect: EvidenceExpectation | undefined
): string | null {
  if (expect?.url === undefined || expect.tokensFile === undefined) {
    return 'the drift check needs the requested url and tokens file to verify the payload echo.';
  }
  if (payload.url !== expect.url) {
    return `drift url ${String(payload.url)} did not echo the requested page ${expect.url}.`;
  }
  const echoed = payload.tokensFile;
  if (typeof echoed !== 'string' || !pathsEqual(resolve(echoed), resolve(expect.tokensFile))) {
    return `drift tokensFile ${String(echoed)} did not echo the tokens file passed to it.`;
  }
  return null;
}

/**
 * `drift` evidence: shape, arithmetic, then provenance.
 *
 * `summary.total === drifted + matched` with `total >= 1` is drift's own
 * arithmetic, so a payload that compared nothing (`total: 0`) is refused. The
 * echoed `url`/`tokensFile` are the forgery-resistant part: the adapter passed
 * them, and a report about a different page is not evidence about this one.
 */
function driftRefusal(
  payload: Record<string, unknown>,
  expect: EvidenceExpectation | undefined
): string | null {
  return (
    driftVerdictRefusal(payload) ??
    driftSummaryRefusal(payload) ??
    driftProvenanceRefusal(payload, expect)
  );
}

/** `verify-ui` evidence: a boolean verdict and a finite on-brand score. */
function verifyUiRefusal(payload: Record<string, unknown>): string | null {
  if (typeof payload.pass !== 'boolean') return 'verify-ui payload had no boolean pass.';
  if (finiteNumber(payload.onBrand) === null) {
    return 'verify-ui payload had no finite onBrand score.';
  }
  return null;
}

/** `slop` evidence: its real `readAt` timestamp plus a finite score. */
function slopRefusal(payload: Record<string, unknown>): string | null {
  const generic = payload.generic;
  const score = isEvidenceObject(generic) ? generic.score : payload.score;
  if (finiteNumber(score) === null) return 'slop payload had no finite score.';
  const readAt = payload.readAt;
  if (typeof readAt !== 'string' || readAt.trim() === '') {
    return 'slop payload had no readAt timestamp.';
  }
  return null;
}

/**
 * Why `payload` is not this tool's evidence, or null when it is.
 *
 * `expect` carries the spawn's own URL and tokens path; drift refuses without
 * it rather than accepting a payload whose provenance was never checked.
 */
export function evidenceRefusal(
  kind: DesignlangCheckKind,
  payload: Record<string, unknown>,
  expect?: EvidenceExpectation
): string | null {
  switch (kind) {
    case 'drift':
      return driftRefusal(payload, expect);
    case 'verify-ui':
      return verifyUiRefusal(payload);
    case 'slop':
      return slopRefusal(payload);
    case 'grade':
      return hasRunStamp(payload) ? null : GRADE_STAMP_MESSAGE;
    case 'stats':
      return 'designlang stats is a usability probe, not a verdict document.';
  }
}

/** Advance past a JSON string starting at `index` (a `"`); return its end. */
function skipString(text: string, index: number): number {
  let escaped = false;
  for (let cursor = index + 1; cursor < text.length; cursor += 1) {
    const char = text[cursor];
    if (escaped) escaped = false;
    else if (char === '\\') escaped = true;
    else if (char === '"') return cursor;
  }
  return text.length;
}

/** Every top-level balanced `{...}` block, in stream order. */
function balancedBlocks(text: string): string[] {
  const blocks: string[] = [];
  let start = -1;
  let depth = 0;
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '"') {
      index = skipString(text, index) + 1;
      continue;
    }
    if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        blocks.push(text.slice(start, index + 1));
        start = -1;
      }
    }
    index += 1;
  }
  return blocks;
}

function parseObject(text: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  return isEvidenceObject(parsed) ? parsed : null;
}

/** The last balanced top-level `{...}` block that parses to a non-empty object. */
function lastBalancedObject(text: string): Record<string, unknown> | null {
  const blocks = balancedBlocks(text);
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block === undefined) continue;
    const parsed = parseObject(block);
    if (parsed !== null) return parsed;
  }
  return null;
}

/**
 * The tool's JSON object: the whole stream when it is one document, else the
 * last balanced block (a browser log line may surround it). `null` for empty,
 * non-JSON, or a JSON scalar/array.
 */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  return parseObject(trimmed) ?? lastBalancedObject(trimmed);
}
