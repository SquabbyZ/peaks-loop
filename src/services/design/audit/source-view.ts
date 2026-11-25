/**
 * The per-run stripped-view cache for the S7 audit (Task 6e).
 *
 * Four value detectors each call `stripViews(...).comments` and `lineStarts(...)`
 * on the SAME source: on the pilot that was roughly five full-text passes per
 * source per page. Since `source-cache.ts` hands every page the same
 * `AuditSource` object for a real file, a `WeakMap` keyed on that object makes
 * the two computations happen once per distinct file for the whole run.
 *
 * A `WeakMap` is deliberate: the cache follows the source object's lifetime, so
 * a test that builds a fresh object with the same `file` name never reads a
 * previous body, and nothing is retained after the report is written.
 */

import { stripViews } from '../source-scan/strip-comments.js';
import { lineStarts, type AuditSource } from './audit-finding.js';

/** One source's comment-stripped view and its 1-based line starts. */
export type SourceView = {
  /** Comments blanked; string literals intact — what every detector reads. */
  comments: string;
  /** Comments and string bodies blanked — kept for callers that need it. */
  code: string;
  starts: readonly number[];
};

const views = new WeakMap<AuditSource, SourceView>();

/** The cached view of one source; the first call computes it, the rest reuse it. */
export function sourceView(source: AuditSource): SourceView {
  const cached = views.get(source);
  if (cached !== undefined) return cached;
  const stripped = stripViews(source.source);
  const view: SourceView = {
    comments: stripped.comments,
    code: stripped.code,
    starts: lineStarts(source.source)
  };
  views.set(source, view);
  return view;
}

/**
 * Per-source memo for a detector's MEASUREMENT (not just its stripped view).
 *
 * A shared component is handed to every page that imports it, and each value
 * detector used to re-scan its text once per page. The text is identical, so the
 * samples are identical: computing them once per source object is what turns
 * work from O(pages × closure) into O(distinct files). Keyed on the source
 * object, so two different bodies with the same `file` name never share.
 */
const memos = new WeakMap<AuditSource, Map<string, unknown>>();

export function memoBySource<T>(source: AuditSource, key: string, compute: () => T): T {
  let store = memos.get(source);
  if (store === undefined) {
    store = new Map<string, unknown>();
    memos.set(source, store);
  }
  if (store.has(key)) return store.get(key) as T;
  const value = compute();
  store.set(key, value);
  return value;
}
