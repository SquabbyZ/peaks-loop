/**
 * Data-state detector (S7 Task 5, dimension `states`, hard).
 *
 * A page that renders a data list or table and declares neither an empty-state
 * nor an error-state branch is a half-finished page — the user's own "用起来像
 * 没做完" complaint. The finding is hard because it is a usability defect, and
 * it names the evidence that made it fire as data-bearing, so the reader can
 * see why the page was judged at all.
 *
 * THE IMPORT CLOSURE IS THE POINT. The spike measured 101 component modules the
 * single-file scan never opens; a page whose empty state lives in an imported
 * child would otherwise be a false positive. So the detector searches the
 * page's own source AND the markup modules its import closure pulled in (the
 * project reader supplies them, bounded and with its gaps reported). A static
 * marketing page renders no data evidence and never fires.
 *
 * Task 6c narrowed the EVIDENCE, not the search: `.map(` alone is not data
 * (static config arrays matched). The page is data-bearing through a fetch /
 * query / loader call in the page OR its closure, a plural array prop, or a
 * `<table>` / `<tbody>` with a real body. The empty/error search still covers
 * the page and its closure.
 */

import type { AuditFinding, AuditInput, AuditSource } from './audit-finding.js';
import { markupSources } from './markup-scan.js';
import {
  dataEvidence,
  fetchEvidence,
  stateEvidence,
  type DataEvidence,
  type Evidence
} from './states-measure.js';

export {
  dataEvidence,
  fetchEvidence,
  stateEvidence,
  type DataEvidence,
  type Evidence
} from './states-measure.js';

function dedupe(sources: readonly AuditSource[]): AuditSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (seen.has(source.file)) return false;
    seen.add(source.file);
    return true;
  });
}

function missingStatesFinding(evidence: readonly Evidence[]): AuditFinding {
  const first = evidence[0];
  const file = first?.file ?? '';
  const line = first?.line ?? 1;
  const text = first?.text ?? 'data';
  return {
    dimension: 'states',
    severity: 'hard',
    file,
    line,
    value: text,
    expected: 'empty/error branch',
    humanText: `本页渲染了数据（${text}，第 ${line} 行），但没有空状态或错误状态分支；数据为空或加载失败时，页面会显得没做完。`,
    techText: `${file}:${line} data-bearing (${text}) missing empty/error branch`
  };
}

/** The states verdict plus whether any page was data-bearing enough to judge. */
export type StatesDimensionAudit = { findings: AuditFinding[]; judged: boolean };

/**
 * Every data-state finding for a page. Data evidence is read from the page
 * itself, plus a fetch/query/loader call anywhere in its closure (the hook that
 * fills the list often lives in the child). The empty/error search covers the
 * page and its imported markup modules.
 *
 * `judged` is false when no page in the set is data-bearing: the rule then has
 * no verdict at all, which the report must show as "not judged", never 100.
 */
export function auditStatesDimension(input: AuditInput): StatesDimensionAudit {
  const page = markupSources(input.sources);
  if (page.length === 0) return { findings: [], judged: false };
  const closure = markupSources(input.imports ?? []);
  const evidence: DataEvidence[] = [
    ...page.flatMap((source) => dataEvidence(source)),
    ...closure.flatMap((source) => {
      const fetch = fetchEvidence(source);
      return fetch === null ? [] : [{ ...fetch, kind: 'fetch' as const }];
    })
  ];
  if (evidence.length === 0) return { findings: [], judged: false };
  const context = dedupe([...page, ...closure]);
  const branches = stateEvidence(context);
  if (branches.empty.length > 0 || branches.error.length > 0) {
    return { findings: [], judged: true };
  }
  return { findings: [missingStatesFinding(evidence)], judged: true };
}

/** Every data-state finding for a page (the array shape the detectors share). */
export function auditStates(input: AuditInput): AuditFinding[] {
  return auditStatesDimension(input).findings;
}
