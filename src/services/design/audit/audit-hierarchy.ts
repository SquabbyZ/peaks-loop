/**
 * Visual-hierarchy detector (S7 Task 5, dimension `hierarchy`, soft).
 *
 * The "第一眼知道重点吗" question, as far as source text can carry it:
 *   - a page that renders text with no `h1` gives the eye no entry point (soft);
 *   - more than one element styled as the primary action makes the page ask for
 *     two decisions at once (soft, and the finding names them);
 *   - fewer than three distinguishable type levels (size + weight + colour)
 *     leaves title, body and secondary text looking alike (soft).
 *
 * It never scores beauty, and it never fires on a page with no static rendered
 * text: expression-only children (`{title}`) are not guessed at. A page whose
 * text is styled by names the audit cannot read measures ZERO levels, which is
 * reported as `unmeasured` — never as "too few".
 *
 * THE HEADING AND THE LEVELS ARE JUDGED THROUGH THE CLOSURE (Task 6c). The
 * pilot's titles came from `@/components/layout`, so 12 of 871 files held an
 * `h1` and a per-file rule fired on every fragment. An `h1` in the page OR in a
 * module it imports satisfies the rule; the type levels are measured over the
 * same set. The primary-action count stays page-local: a shared layout's
 * buttons are not this page's decision.
 */

import type { AuditFinding, AuditInput } from './audit-finding.js';
import {
  describeLevel,
  firstMarkupFile,
  hasHeading,
  markupTypeLevels,
  type TypeLevel
} from './hierarchy-measure.js';
import { hasRenderedText, markupSources } from './markup-scan.js';
import { primaryActions, type PrimaryAction } from './primary-measure.js';
import { sourceView, memoBySource } from './source-view.js';

export { hasHeading, markupTypeLevels } from './hierarchy-measure.js';
export { primaryActions } from './primary-measure.js';

/** Fewer than three distinguishable text levels is the flat-hierarchy rule. */
export const MIN_TYPE_LEVELS = 3;

/** Names in the human sentence stay short; the technical line lists the rest. */
const MAX_NAMES = 3;

function h1Finding(file: string): AuditFinding {
  return {
    dimension: 'hierarchy',
    severity: 'soft',
    file,
    line: 1,
    value: 'none',
    expected: 'h1',
    humanText: '本页没有 h1 标题，第一眼看不出页面的重点。',
    techText: `${file}:1 heading:h1 missing`
  };
}

function primaryFinding(actions: readonly PrimaryAction[]): AuditFinding {
  const names = actions
    .slice(0, MAX_NAMES)
    .map((action) => `<${action.tag}>@${action.file}:${action.line} [${action.evidence}]`);
  const first = actions[0];
  return {
    dimension: 'hierarchy',
    severity: 'soft',
    file: first?.file ?? '',
    line: first?.line ?? 1,
    value: String(actions.length),
    expected: '1',
    humanText: `本页有 ${actions.length} 个元素被写成主要操作（${names.join('、')}），用户不知道哪一个才是主操作。`,
    techText: `${first?.file ?? ''}:${first?.line ?? 1} primary-actions:${actions.length} (${names.join('; ')})`
  };
}

function levelFinding(levels: readonly TypeLevel[], file: string): AuditFinding {
  const listing = levels
    .slice(0, MAX_NAMES)
    .map((level) => describeLevel(level))
    .join('、');
  return {
    dimension: 'hierarchy',
    severity: 'soft',
    file,
    line: 1,
    value: String(levels.length),
    expected: `>=${MIN_TYPE_LEVELS}`,
    humanText: `本页只有 ${levels.length} 种可区分的文字层级（${listing}），少于 ${MIN_TYPE_LEVELS} 种，标题、正文和辅助文字几乎分不开。`,
    techText: `${file}:1 type-levels:${levels.length} < ${MIN_TYPE_LEVELS} (${levels.map((level) => level.key).join('; ')})`
  };
}

function levelUnmeasured(file: string): AuditFinding {
  return {
    dimension: 'hierarchy',
    severity: 'unmeasured',
    file,
    line: 1,
    value: '0',
    expected: `>=${MIN_TYPE_LEVELS}`,
    humanText: `本页没有可读的字号、字重或颜色声明，源码里无法判断文字层级是否足够。`,
    techText: `${file}:1 type-levels unmeasured (no readable type declarations)`
  };
}

/** Every hierarchy finding for a page (soft), or the unmeasured gap it leaves. */
export function auditHierarchy(input: AuditInput): AuditFinding[] {
  return auditHierarchyDimension(input).findings;
}

/** The hierarchy verdict plus whether the rule judged anything at all. */
export type HierarchyDimensionAudit = { findings: AuditFinding[]; judged: boolean };

/** Every hierarchy finding, and whether a page with rendered text was judged. */
export function auditHierarchyDimension(input: AuditInput): HierarchyDimensionAudit {
  const markup = markupSources(input.sources);
  const closure = markupSources(input.imports ?? []);
  const visible = [...markup, ...closure];
  const file = firstMarkupFile(markup)?.file ?? '';
  if (markup.length === 0) return { findings: [], judged: false };
  const rendered = markup.some((source) =>
    memoBySource(source, 'rendered-text', () => hasRenderedText(sourceView(source).comments))
  );
  if (!rendered) {
    return { findings: [], judged: false };
  }
  const findings: AuditFinding[] = [];
  if (!hasHeading(visible)) findings.push(h1Finding(file));
  const actions = primaryActions(markup);
  if (actions.length > 1) findings.push(primaryFinding(actions));
  const levels = markupTypeLevels(visible);
  if (levels.length === 0) findings.push(levelUnmeasured(file));
  else if (levels.length < MIN_TYPE_LEVELS) findings.push(levelFinding(levels, file));
  return { findings, judged: true };
}
