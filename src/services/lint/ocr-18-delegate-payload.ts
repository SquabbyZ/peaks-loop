/**
 * OCR 1.x delegation — the pinned CLI's payloads, parsed at their boundary.
 *
 * `ocr delegate preview` returns the file selection; `ocr delegate rule` returns
 * the resolved rule text per pattern. Neither calls an LLM and neither reads a
 * key. These parsers are strict on purpose: a `comments[]` review payload is NOT
 * a delegation spec, and reading one as the other is the defect this slice fixes.
 */
import {
  invokeOcr,
  OCR_18_PACKAGE,
  rangeArgs,
  type Ocr18Range,
  type Ocr18State
} from './ocr-multilang-adapter.js';

export type DelegateFile = {
  readonly path: string;
  readonly status: string;
  readonly insertions: number;
  readonly deletions: number;
  readonly exclude_reason?: string;
};

export type DelegatePreview = {
  readonly schema_version: string;
  readonly mode: string;
  readonly repository: string;
  readonly from?: string;
  readonly to?: string;
  readonly merge_base?: string;
  readonly total_files: number;
  readonly reviewable_count: number;
  readonly excluded_count: number;
  readonly total_insertions: number;
  readonly total_deletions: number;
  readonly reviewable_files: readonly DelegateFile[];
  readonly excluded_files: readonly DelegateFile[];
};

export type DelegateRuleGroup = {
  readonly group_id: number;
  readonly source: string;
  readonly pattern: string;
  readonly files: readonly string[];
  readonly rule: string;
};

export function buildDelegatePreviewArgs(range: Ocr18Range): string[] {
  return [
    '--package',
    OCR_18_PACKAGE,
    '--',
    'ocr',
    'delegate',
    'preview',
    ...rangeArgs(range),
    '--format',
    'json'
  ];
}

export function buildDelegateRuleArgs(paths: readonly string[], range: Ocr18Range): string[] {
  return [
    '--package',
    OCR_18_PACKAGE,
    '--',
    'ocr',
    'delegate',
    'rule',
    ...paths,
    ...rangeArgs(range),
    '--format',
    'json'
  ];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function parseFile(value: unknown): DelegateFile | null {
  const record = asRecord(value);
  if (record === null) return null;
  const path = asText(record['path']);
  const status = asText(record['status']);
  const insertions = asCount(record['insertions']);
  const deletions = asCount(record['deletions']);
  if (path === null || status === null || insertions === null || deletions === null) return null;
  const reason = asText(record['exclude_reason']);
  return {
    path,
    status,
    insertions,
    deletions,
    ...(reason !== null ? { exclude_reason: reason } : {})
  };
}

function parseFiles(value: unknown, field: string): readonly DelegateFile[] | string {
  if (!Array.isArray(value)) return `${field} is not an array`;
  const files: DelegateFile[] = [];
  for (const [index, entry] of value.entries()) {
    const file = parseFile(entry);
    if (file === null) return `${field}[${String(index)}] is not a file entry`;
    files.push(file);
  }
  return files;
}

function optionalText(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

export type PreviewResult =
  | { readonly ok: true; readonly preview: DelegatePreview }
  | { readonly ok: false; readonly reason: string };

type PreviewCost = {
  readonly total_files: number;
  readonly reviewable_count: number;
  readonly excluded_count: number;
  readonly total_insertions: number;
  readonly total_deletions: number;
};

function previewCost(record: Record<string, unknown>): PreviewCost | null {
  const totalFiles = asCount(record['total_files']);
  const reviewableCount = asCount(record['reviewable_count']);
  const excludedCount = asCount(record['excluded_count']);
  const insertions = asCount(record['total_insertions']);
  const deletions = asCount(record['total_deletions']);
  if (
    totalFiles === null ||
    reviewableCount === null ||
    excludedCount === null ||
    insertions === null ||
    deletions === null
  ) {
    return null;
  }
  return {
    total_files: totalFiles,
    reviewable_count: reviewableCount,
    excluded_count: excludedCount,
    total_insertions: insertions,
    total_deletions: deletions
  };
}

/** The parsed preview, or the reason a file list is malformed. */
function previewFrom(record: Record<string, unknown>, cost: PreviewCost): DelegatePreview | string {
  const reviewable = parseFiles(record['reviewable_files'], 'reviewable_files');
  if (typeof reviewable === 'string') return reviewable;
  const excluded = parseFiles(record['excluded_files'], 'excluded_files');
  if (typeof excluded === 'string') return excluded;
  const from = optionalText(record, 'from');
  const to = optionalText(record, 'to');
  const mergeBase = optionalText(record, 'merge_base');
  return {
    schema_version: optionalText(record, 'schema_version') ?? '1',
    mode: optionalText(record, 'mode') ?? 'range',
    repository: optionalText(record, 'repository') ?? '',
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
    ...(mergeBase !== undefined ? { merge_base: mergeBase } : {}),
    ...cost,
    reviewable_files: reviewable,
    excluded_files: excluded
  };
}

export function parseDelegatePreview(stdout: string): PreviewResult {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout) as unknown;
  } catch {
    return { ok: false, reason: 'stdout is not JSON' };
  }
  const record = asRecord(raw);
  if (record === null) return { ok: false, reason: 'stdout is not a JSON object' };
  if (!Array.isArray(record['reviewable_files'])) {
    return {
      ok: false,
      reason: 'no reviewable_files[] — a review payload is not a delegate preview'
    };
  }
  const cost = previewCost(record);
  if (cost === null) return { ok: false, reason: 'preview cost fields are missing' };
  const preview = previewFrom(record, cost);
  if (typeof preview === 'string') return { ok: false, reason: preview };
  return { ok: true, preview };
}

function parseRuleGroup(value: unknown): DelegateRuleGroup | null {
  const record = asRecord(value);
  if (record === null) return null;
  const groupId = asCount(record['group_id']);
  const source = asText(record['source']);
  const pattern = asText(record['pattern']);
  const rule = typeof record['rule'] === 'string' ? record['rule'] : null;
  if (groupId === null || source === null || pattern === null || rule === null) return null;
  if (!Array.isArray(record['files'])) return null;
  const files = record['files'].map(asText);
  if (files.some((file) => file === null)) return null;
  return { group_id: groupId, source, pattern, files: files as string[], rule };
}

export type RulesResult =
  | { readonly ok: true; readonly groups: readonly DelegateRuleGroup[] }
  | { readonly ok: false; readonly state: Ocr18State; readonly rawOutput: string };

export function parseDelegateRules(stdout: string): RulesResult {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout) as unknown;
  } catch {
    return { ok: false, state: 'execution-failed', rawOutput: 'delegate rule output is not JSON' };
  }
  const record = asRecord(raw);
  if (record === null || !Array.isArray(record['groups'])) {
    return {
      ok: false,
      state: 'execution-failed',
      rawOutput: 'delegate rule output has no groups[]'
    };
  }
  const groups: DelegateRuleGroup[] = [];
  for (const [index, entry] of record['groups'].entries()) {
    const group = parseRuleGroup(entry);
    if (group === null) {
      return {
        ok: false,
        state: 'execution-failed',
        rawOutput: `groups[${String(index)}] is not a rule group`
      };
    }
    groups.push(group);
  }
  return { ok: true, groups };
}

export type DelegatePreviewResult =
  | { readonly ok: true; readonly preview: DelegatePreview }
  | { readonly ok: false; readonly state: Ocr18State; readonly rawOutput: string };

/** One `delegate preview` invocation — the selection only. No review runs. */
export function runDelegatePreview(
  cwd: string,
  range: Ocr18Range = {},
  timeoutMs?: number
): DelegatePreviewResult {
  const invoked = invokeOcr(buildDelegatePreviewArgs(range), cwd, timeoutMs);
  if (!invoked.ok) return { ok: false, state: invoked.state, rawOutput: invoked.rawOutput };
  const parsed = parseDelegatePreview(invoked.stdout);
  if (!parsed.ok) return { ok: false, state: 'execution-failed', rawOutput: parsed.reason };
  return { ok: true, preview: parsed.preview };
}
