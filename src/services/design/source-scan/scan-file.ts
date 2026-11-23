/**
 * Per-file G1 scan.
 *
 * Every check runs against a comment-stripped view, so a symptom quoted in a
 * comment cannot fail a file. Checks that must read attribute values or import
 * specifiers use the view that keeps string bodies. Checks that judge code
 * shapes use the view that blanks string bodies while keeping their quotes: a
 * real `style="..."` attribute still shows its opening quote, and the same text
 * inside a literal does not.
 */

import type { PavedRoadFile } from '../paved-road.js';
import type { DesignTokensFile } from '../token-contract.js';
import {
  DEFAULT_DESIGN_RULES,
  type DesignRuleCode,
  type DesignRuleSeverity
} from '../design-rules.js';
import { stripViews } from './strip-comments.js';
import { measureTokenCoverage, type TokenCoverage } from './token-coverage.js';

export type DesignFinding = {
  code: DesignRuleCode;
  file: string;
  line: number;
  severity: DesignRuleSeverity;
  message: string;
};

export type FileScanResult = {
  findings: DesignFinding[];
  coverage: TokenCoverage;
};

export type ScanFileInput = {
  /** Repo-relative path, reported verbatim on each finding. */
  file: string;
  source: string;
  pavedRoad: PavedRoadFile;
  tokens: DesignTokensFile;
};

/** What every check needs to turn a match index into a finding. */
type ReportContext = {
  /** Line-start offsets of the original source, built once per file. */
  lines: readonly number[];
  file: string;
  pavedRoad: PavedRoadFile;
};

const INLINE_STYLE = /\bstyle\s*=\s*[{"']/g;
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab)\([^)]*\)/g;
const RAW_PRIMITIVE = /<\s*(?:button|input|select|table)\b/g;
const CLASS_NAME = /\bclassName\s*=\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`|\{([^}]*)\})/g;
const CLASS_HELPER_START = /\b(?:cn|clsx|cva)\s*\(/g;
const ARBITRARY_VALUE = /\b[\w-]+-\[[^\]\s]+\]/g;
const STATIC_IMPORT = /\bimport\s+(?:type\s+)?(?:[^'"]*?\bfrom\s*)?['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
/** An anchor target (`href="#a"`) or an id reference is a fragment, not a colour. */
const ANCHOR_ATTRIBUTE = /\b(?:href|id)\s*=\s*["']$/;
const ANCHOR_WINDOW = 12;

function severityFor(pavedRoad: PavedRoadFile, code: DesignRuleCode): DesignRuleSeverity {
  return pavedRoad.rules[code] ?? DEFAULT_DESIGN_RULES[code];
}

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') starts.push(index + 1);
  }
  return starts;
}

/** Binary search over the precomputed line starts — never a rescan per finding. */
function lineAt(starts: readonly number[], index: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if ((starts[mid] ?? 0) <= index) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

function findingFor(
  context: ReportContext,
  code: DesignRuleCode,
  index: number,
  message: string
): DesignFinding {
  return {
    code,
    file: context.file,
    line: lineAt(context.lines, index),
    severity: severityFor(context.pavedRoad, code),
    message
  };
}

function inlineStyleFindings(view: string, context: ReportContext): DesignFinding[] {
  return [...view.matchAll(INLINE_STYLE)].map((match) =>
    findingFor(context, 'DESIGN_INLINE_STYLE', match.index ?? 0, 'inline style attribute')
  );
}

function isAnchorTarget(view: string, index: number): boolean {
  return ANCHOR_ATTRIBUTE.test(view.slice(Math.max(0, index - ANCHOR_WINDOW), index));
}

function rawColorFindings(view: string, context: ReportContext): DesignFinding[] {
  const findings: DesignFinding[] = [];
  for (const match of view.matchAll(RAW_COLOR)) {
    const index = match.index ?? 0;
    if (isAnchorTarget(view, index)) continue;
    findings.push(findingFor(context, 'DESIGN_RAW_COLOR', index, `raw colour literal ${match[0]}`));
  }
  return findings;
}

function arbitraryIn(
  context: ReportContext,
  at: number,
  value: string,
  label: string
): DesignFinding[] {
  return [...value.matchAll(ARBITRARY_VALUE)].map((arbitrary) =>
    findingFor(
      context,
      'DESIGN_ARBITRARY_VALUE',
      at,
      `arbitrary Tailwind value ${arbitrary[0]} in ${label}`
    )
  );
}

/**
 * `className` values, plus the string arguments of the class helpers shadcn
 * projects use (`cn('w-[123px]')`). A helper nested inside a `className`
 * attribute is already covered by that attribute and is not reported twice.
 */
function classAttributeFindings(
  view: string,
  context: ReportContext,
  classSpans: Array<readonly [number, number]>
): DesignFinding[] {
  const findings: DesignFinding[] = [];
  for (const match of view.matchAll(CLASS_NAME)) {
    const start = match.index ?? 0;
    classSpans.push([start, start + match[0].length]);
    const value = match[1] ?? match[2] ?? match[3] ?? match[4];
    if (value !== undefined) findings.push(...arbitraryIn(context, start, value, 'className'));
  }
  return findings;
}

/** The arguments of a helper call, following balanced parentheses to its close. */
function helperArguments(view: string, openIndex: number): string {
  let depth = 0;
  for (let index = openIndex; index < view.length; index += 1) {
    if (view[index] === '(') depth += 1;
    else if (view[index] === ')') {
      depth -= 1;
      if (depth === 0) return view.slice(openIndex + 1, index);
    }
  }
  return view.slice(openIndex + 1);
}

function classHelperFindings(
  view: string,
  context: ReportContext,
  classSpans: readonly (readonly [number, number])[]
): DesignFinding[] {
  const findings: DesignFinding[] = [];
  for (const match of view.matchAll(CLASS_HELPER_START)) {
    const start = match.index ?? 0;
    if (classSpans.some(([from, to]) => start >= from && start < to)) continue;
    const open = start + match[0].length - 1;
    findings.push(...arbitraryIn(context, start, helperArguments(view, open), 'class helper'));
  }
  return findings;
}

function arbitraryValueFindings(view: string, context: ReportContext): DesignFinding[] {
  const classSpans: Array<readonly [number, number]> = [];
  // Populate every className span before the helper pass skips the nested ones.
  const fromClassNames = classAttributeFindings(view, context, classSpans);
  return [...fromClassNames, ...classHelperFindings(view, context, classSpans)];
}

function rawPrimitiveFindings(view: string, context: ReportContext): DesignFinding[] {
  // A raw element only bypasses a design system the project actually has at
  // hand: with no component entrypoint there is nothing to bypass.
  if (context.pavedRoad.componentEntrypoints.length === 0) return [];
  return [...view.matchAll(RAW_PRIMITIVE)].map((match) =>
    findingFor(
      context,
      'DESIGN_RAW_PRIMITIVE',
      match.index ?? 0,
      `raw primitive ${match[0].trim()}`
    )
  );
}

function isBannedSpecifier(specifier: string, banned: readonly string[]): boolean {
  return banned.some((entry) => specifier === entry || specifier.startsWith(`${entry}/`));
}

function libraryBypassFindings(
  view: string,
  context: ReportContext,
  banned: readonly string[]
): DesignFinding[] {
  const findings: DesignFinding[] = [];
  for (const pattern of [STATIC_IMPORT, DYNAMIC_IMPORT]) {
    for (const match of view.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier === undefined) continue;
      if (!isBannedSpecifier(specifier, banned)) continue;
      findings.push(
        findingFor(
          context,
          'DESIGN_LIBRARY_BYPASS',
          match.index ?? 0,
          `direct library import ${specifier}`
        )
      );
    }
  }
  return findings;
}

export function scanFile(input: ScanFileInput): FileScanResult {
  const views = stripViews(input.source);
  const context: ReportContext = {
    lines: lineStarts(input.source),
    file: input.file,
    pavedRoad: input.pavedRoad
  };

  return {
    findings: [
      ...inlineStyleFindings(views.code, context),
      ...rawColorFindings(views.comments, context),
      ...arbitraryValueFindings(views.comments, context),
      ...rawPrimitiveFindings(views.code, context),
      ...libraryBypassFindings(views.comments, context, input.pavedRoad.bannedImportSpecifiers)
    ],
    coverage: measureTokenCoverage(views.comments, input.tokens)
  };
}
