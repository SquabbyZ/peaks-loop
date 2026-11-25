/**
 * The markdown / JSON renderers for the S7 design audit.
 *
 * Split from `audit-report.ts` when the Task 6a score shape added the
 * `measured` / `on-contract` columns and the scope line. Both renderers read
 * one `AuditReport`; neither recomputes a score.
 *
 * `schemaVersion: 2` recorded the Task 6a change: a ratio dimension's score may
 * be `null` (all its values were unmeasured), and every dimension row now
 * carries `measured` / `onContract`. `schemaVersion: 3` (Task 6b) adds the
 * optional `lowSample: true` flag: the ratio is still reported, but a value
 * denominator under five cannot set a page or the overall score.
 * `schemaVersion: 4` (Task 6d) records that a value dimension's `measured`
 * counts the page PLUS its import closure, and that the scope carries
 * `valueFiles`.
 * `schemaVersion: 5` (Task 6e / S7 review) adds `judged` ("not judged" is never
 * a silent 100), `distinctSites` (a finding row is a page view, not a distinct
 * defect), the per-page closure-truncation flag and the fixed `knownGaps`.
 */

import { capDetail, plainText } from '../evidence-text.js';
import type { AuditRuntimeState } from './audit-project.js';
import type { AuditScope } from './audit-scope.js';
import type { TopFix, UnmeasuredItem } from './audit-fixes.js';
import type { AuditReport, AuditReportMeta, AuditVerdict, KnownGap } from './audit-report.js';
import type { DimensionScore } from './audit-scoring.js';

export const AUDIT_JSON_SCHEMA_VERSION = 5;

/** How many package names one summary line may cite. */
// eslint-disable-next-line no-magic-numbers -- one short, readable line.
const TOP_PACKAGE_NAMES = 5;

/** The package a gap line names: `@scope/pkg` for a scoped import, else the head. */
function packageNameOf(gap: string): string {
  const specifier = / -> ([^ ]+) \(not followed\)$/.exec(gap)?.[1] ?? '';
  const segments = specifier.split('/');
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : (segments[0] ?? '');
}

/** The most frequent package names in a gap set, descending. */
function topPackageNames(packages: readonly string[]): string[] {
  const names = new Map<string, number>();
  for (const gap of packages) {
    const name = packageNameOf(gap);
    if (name === '') continue;
    names.set(name, (names.get(name) ?? 0) + 1);
  }
  return [...names.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, TOP_PACKAGE_NAMES)
    .map(([name]) => name);
}

/** Collapse the read-gap list into ONE line, keeping detail in the JSON file. */
function summarizeReadGaps(gaps: readonly string[]): string {
  if (gaps.length === 0) return 'none';
  const packages = gaps.filter(
    (gap) => !gap.startsWith('alias ') && gap.endsWith('(not followed)')
  );
  const top = topPackageNames(packages);
  const other = gaps.length - packages.length;
  const parts: string[] = [];
  if (packages.length > 0) {
    const named = top.length === 0 ? '' : ` (${top.join(', ')})`;
    parts.push(`${packages.length} package imports${named}`);
  }
  if (other > 0) parts.push(`${other} other`);
  return `${gaps.length} gaps: ${parts.join('; ')}`;
}

/**
 * One untrusted report FIELD — a scored/skipped state list, a read-gap summary,
 * a declared root list: control bytes and whole ANSI/OSC sequences are stripped
 * and the field is bounded to the evidence cap. Each field is bounded rather
 * than the assembled line, so a hostile value can neither repaint a terminal
 * nor lengthen the report without limit, while the line's own structure (and
 * the facts a Task 6d note must state) survives.
 */
function safeField(value: string): string {
  return capDetail(plainText(value));
}

function stateLine(state: AuditRuntimeState): string {
  const scored = state.scored.length > 0 ? safeField(state.scored.join(', ')) : 'default';
  const skipped = state.skipped.length > 0 ? safeField(state.skipped.join(', ')) : 'none';
  const gaps = safeField(summarizeReadGaps(state.readGaps));
  return `- runtime state scored: ${scored}; skipped: ${skipped} | read gaps: ${gaps} | truncated: ${state.truncated ? 'yes' : 'no'}`;
}

function scopeLine(scope: AuditScope): string {
  // The note's one variable field (the declared roots) is sanitised and capped
  // where the note is built; the line is stripped once more as a backstop.
  return `- scope: ${plainText(scope.note)}`;
}

/** One score cell: a not-judged cost row is a label, never a silent 100. */
function scoreCell(row: DimensionScore): string {
  if (row.judged === false) return 'not judged';
  const score = row.score === null ? 'null' : String(row.score);
  return row.lowSample === true ? `${score} (low sample)` : score;
}

function dimensionTable(rows: readonly DimensionScore[]): string[] {
  if (rows.length === 0) {
    return [
      'No dimension was scored: the app root has no UI source, so this is neither 0 nor a pass.'
    ];
  }
  return [
    '| dimension | score | measured | on-contract | distinct | hard | soft | unmeasured |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((row) =>
      [
        '|',
        row.dimension,
        '|',
        scoreCell(row),
        '|',
        row.measured,
        '|',
        row.onContract,
        '|',
        row.distinctSites,
        '|',
        row.hard,
        '|',
        row.soft,
        '|',
        row.unmeasured,
        '|'
      ].join(' ')
    )
  ];
}

function pageLines(page: AuditReport['pages'][number]): string[] {
  const truncated = page.truncated === true ? ' (import closure truncated)' : '';
  // The page path is a repository file name, not a trusted label: a POSIX name
  // can carry ESC[2J and a newline, which would repaint a terminal and forge a
  // `## heading` in the durable record (S7 security review, same class as S3).
  const lines = [`### ${safeField(page.path)} — ${page.score}${truncated}`, ''];
  const judged = page.findings.filter((finding) => finding.severity !== 'unmeasured');
  if (judged.length === 0) lines.push('- no hard or soft findings');
  for (const finding of judged) {
    lines.push(`- (${finding.severity}) ${finding.humanText}`);
    lines.push(`  \`${finding.techText}\``);
  }
  return [...lines, ''];
}

function fixLines(fixes: readonly TopFix[]): string[] {
  if (fixes.length === 0) return ['- (none)'];
  return fixes.flatMap((fix, index) => {
    const views = `${fix.count} view${fix.count === 1 ? '' : 's'}`;
    const sites = `${fix.sites} ${fix.sites === 1 ? 'site' : 'sites'}`;
    return [
      `${index + 1}. ${fix.severity} × ${views} — ${fix.dimension} (${sites})`,
      `   ${fix.humanText}`,
      `   \`${fix.techText}\``
    ];
  });
}

function unmeasuredLines(
  items: readonly UnmeasuredItem[],
  knownGaps: readonly KnownGap[]
): string[] {
  const known = knownGaps.map(
    (gap) => `- ${gap.text} (known gap: ${gap.reason ?? 'no source-readable signal'})`
  );
  if (items.length === 0) return [...known, '- (none)'];
  return [
    ...known,
    ...items.flatMap((item) => [
      // `file` is the same untrusted path shape the page heading now sanitises.
      `- ${item.dimension} ${safeField(item.file)}:${item.line} — ${item.humanText}`,
      `  \`${item.techText}\``
    ])
  ];
}

/** The durable markdown record. Caller-controlled strings are stripped and bounded. */
export function renderAuditMarkdown(report: AuditReport, meta: AuditReportMeta): string {
  const lines = [
    `schemaVersion: ${AUDIT_JSON_SCHEMA_VERSION}`,
    `rid: ${meta.rid ?? '(none)'}`,
    `generatedAt: ${meta.generatedAt}`,
    `audit-verdict: ${report.data.verdict}`,
    '',
    '## Design audit',
    '',
    `- app root: ${meta.appRoot}`,
    report.overall === null
      ? '- verdict: not a UI project — no dimension is scored; this is neither 0 nor a pass.'
      : `- overall score: ${report.overall} (the worst page, never an average)`,
    scopeLine(report.data.scope),
    stateLine(report.data.state),
    '',
    '## Dimensions',
    '',
    '- ratio dimensions score the on-contract share of the values they judged; a null score means every value was unmeasured.',
    '- a ratio marked "low sample" judged fewer than 5 values: its ratio is reported, but only a hard finding in it can set a page or the overall score.',
    '- a cost dimension the audit had nothing to judge renders "not judged", never 100.',
    '- finding rows count page views: a shared component\'s defect appears once per page that imports it; "distinct" (and a fix\'s "sites") counts the distinct file:line defects.',
    '- cost dimensions lose their documented cost per hard/soft finding.',
    '',
    ...dimensionTable(report.dimensions),
    '',
    '## Pages',
    '',
    ...(report.pages.length === 0
      ? ['- (none)', '']
      : report.pages.flatMap((page) => pageLines(page))),
    '## Top 3 fixes',
    '',
    ...fixLines(report.data.topFixes),
    '',
    '## Unmeasured',
    '',
    ...unmeasuredLines(report.data.unmeasured, report.data.knownGaps),
    ''
  ];
  return lines.join('\n');
}

/** The `.json` sibling's stable document shape. */
export type AuditJsonDocument = {
  schemaVersion: typeof AUDIT_JSON_SCHEMA_VERSION;
  rid: string | null;
  generatedAt: string;
  verdict: AuditVerdict;
  overall: number | null;
  contract: AuditReport['data']['contract'];
  scope: AuditScope;
  state: AuditRuntimeState;
  dimensions: DimensionScore[];
  pages: AuditReport['pages'];
  topFixes: TopFix[];
  unmeasured: UnmeasuredItem[];
  knownGaps: KnownGap[];
};

export function renderAuditJson(report: AuditReport, meta: AuditReportMeta): AuditJsonDocument {
  return {
    schemaVersion: AUDIT_JSON_SCHEMA_VERSION,
    rid: meta.rid ?? null,
    generatedAt: meta.generatedAt,
    verdict: report.data.verdict,
    overall: report.overall,
    contract: report.data.contract,
    scope: report.data.scope,
    state: report.data.state,
    dimensions: report.dimensions,
    pages: report.pages,
    topFixes: report.data.topFixes,
    unmeasured: report.data.unmeasured,
    knownGaps: report.data.knownGaps
  };
}
