/**
 * The markdown / JSON renderers for the S7 design audit.
 *
 * Split from `audit-report.ts` when the Task 6a score shape added the
 * `measured` / `on-contract` columns and the scope line. Both renderers read
 * one `AuditReport`; neither recomputes a score.
 *
 * `schemaVersion` history: 2 = null ratio scores + `measured`/`onContract`
 * columns; 3 = optional `lowSample`; 4 = closure-counted `measured` + scope
 * `valueFiles`; 5 = `judged` (never a silent 100), `distinctSites`, closure
 * truncation and `knownGaps`; 6 = render dimensions `palette`/`overflow`
 * (overflow is one fixed `unmeasured` row with a measured reason); 7 (S8
 * close-out) = `render` evidence (each capture file, its measured non-app
 * share and the page it bound to), the uncaptured-page count and the
 * `--render` read gap, plus the same sanitiser on every JSON `file` field.
 */

import { plainText, safeField } from '../evidence-text.js';
import type { AuditRuntimeState } from './audit-project.js';
import type { AuditScope } from './audit-scope.js';
import type { TopFix, UnmeasuredItem } from './audit-fixes.js';
import type { AuditReport, AuditReportMeta, AuditVerdict, KnownGap } from './audit-report.js';
import type { DimensionScore } from './audit-scoring.js';

export const AUDIT_JSON_SCHEMA_VERSION = 7;

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

/**
 * Which captures were used, what was measured from each, and how many pages had
 * none. A page with no capture has NO render row — the section states that
 * absence so it can never be read as a zero.
 */
function renderLines(render: AuditReport['data']['render']): string[] {
  if (render.captures.length === 0) {
    return ['- no capture was supplied: every render dimension is absent, not 0.'];
  }
  const lines = render.captures.map((usage) => {
    const measured = usage.decoded
      ? `non-app mask ${usage.maskShare}%`
      : 'refused (see the unmeasured gap)';
    const bound =
      usage.boundTo === null ? 'bound to no page' : `bound to ${safeField(usage.boundTo)}`;
    return `- ${safeField(usage.capture)} — ${measured} — ${bound}`;
  });
  lines.push(
    `- page units without a capture: ${render.pagesWithoutCapture} of ${render.pageUnits} (their render dimensions are absent, not 0)`
  );
  if (render.gap !== null) lines.push(`- capture read gap: ${safeField(render.gap)}`);
  return lines;
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
    '## Render evidence',
    '',
    ...renderLines(report.data.render),
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
  render: AuditReport['data']['render'];
  dimensions: DimensionScore[];
  pages: AuditReport['pages'];
  topFixes: TopFix[];
  unmeasured: UnmeasuredItem[];
  knownGaps: KnownGap[];
};

export function renderAuditJson(report: AuditReport, meta: AuditReportMeta): AuditJsonDocument {
  // Every FILE field is sanitised as the markdown sanitises it, so the JSON
  // sibling cannot carry control bytes a markdown reader never sees.
  const pages = report.pages.map((page) => ({
    ...page,
    path: safeField(page.path),
    findings: page.findings.map((finding) => ({ ...finding, file: safeField(finding.file) }))
  }));
  const unmeasured = report.data.unmeasured.map((item) => ({
    ...item,
    file: safeField(item.file)
  }));
  const render = {
    ...report.data.render,
    captures: report.data.render.captures.map((usage) => ({
      ...usage,
      capture: safeField(usage.capture),
      slug: usage.slug === null ? null : safeField(usage.slug),
      boundTo: usage.boundTo === null ? null : safeField(usage.boundTo)
    })),
    gap: report.data.render.gap === null ? null : safeField(report.data.render.gap)
  };
  const state = { ...report.data.state, readGaps: report.data.state.readGaps.map(safeField) };
  return {
    schemaVersion: AUDIT_JSON_SCHEMA_VERSION,
    rid: meta.rid ?? null,
    generatedAt: meta.generatedAt,
    verdict: report.data.verdict,
    overall: report.overall,
    contract: report.data.contract,
    scope: report.data.scope,
    state,
    render,
    dimensions: report.dimensions,
    pages,
    topFixes: report.data.topFixes,
    unmeasured,
    knownGaps: report.data.knownGaps
  };
}
