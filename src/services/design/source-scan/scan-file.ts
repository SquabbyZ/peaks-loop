/**
 * Per-file G1 scan.
 *
 * Every check runs against a comment-stripped view, so a symptom quoted in a
 * comment cannot fail a file. Checks that judge code shapes use the view that
 * also blanks string bodies; checks that must read attribute values or import
 * specifiers use the comment-only view.
 */

import type { PavedRoadFile } from '../paved-road.js';
import type { DesignTokensFile } from '../token-contract.js';
import { DEFAULT_DESIGN_RULES, type DesignRuleCode, type DesignRuleSeverity } from './rules.js';
import { stripComments } from './strip-comments.js';
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
  source: string;
  file: string;
  pavedRoad: PavedRoadFile;
};

const INLINE_STYLE = /\bstyle\s*=\s*[{"']/g;
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab)\([^)]*\)/g;
const RAW_PRIMITIVE = /<\s*(?:button|input|select|table)\b/g;
const CLASS_NAME = /\bclassName\s*=\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`|\{([^}]*)\})/g;
const ARBITRARY_VALUE = /\b[\w-]+-\[[^\]\s]+\]/g;
const STATIC_IMPORT = /\bimport\s+(?:type\s+)?(?:[^'"]*?\bfrom\s*)?['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function severityFor(pavedRoad: PavedRoadFile, code: DesignRuleCode): DesignRuleSeverity {
  return pavedRoad.rules[code] ?? DEFAULT_DESIGN_RULES[code];
}

function lineAt(source: string, index: number): number {
  let line = 1;
  for (let cursor = 0; cursor < index && cursor < source.length; cursor += 1) {
    if (source[cursor] === '\n') line += 1;
  }
  return line;
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
    line: lineAt(context.source, index),
    severity: severityFor(context.pavedRoad, code),
    message
  };
}

function inlineStyleFindings(view: string, context: ReportContext): DesignFinding[] {
  return [...view.matchAll(INLINE_STYLE)].map((match) =>
    findingFor(context, 'DESIGN_INLINE_STYLE', match.index ?? 0, 'inline style attribute')
  );
}

function rawColorFindings(view: string, context: ReportContext): DesignFinding[] {
  return [...view.matchAll(RAW_COLOR)].map((match) =>
    findingFor(context, 'DESIGN_RAW_COLOR', match.index ?? 0, `raw colour literal ${match[0]}`)
  );
}

function arbitraryValueFindings(view: string, context: ReportContext): DesignFinding[] {
  const findings: DesignFinding[] = [];
  for (const match of view.matchAll(CLASS_NAME)) {
    const value = match[1] ?? match[2] ?? match[3] ?? match[4];
    if (value === undefined) continue;
    for (const arbitrary of value.matchAll(ARBITRARY_VALUE)) {
      findings.push(
        findingFor(
          context,
          'DESIGN_ARBITRARY_VALUE',
          match.index ?? 0,
          `arbitrary Tailwind value ${arbitrary[0]} in className`
        )
      );
    }
  }
  return findings;
}

function rawPrimitiveFindings(view: string, context: ReportContext): DesignFinding[] {
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
  const commentsStripped = stripComments(input.source);
  const codeOnly = stripComments(input.source, { blankStrings: true });
  const context: ReportContext = {
    source: input.source,
    file: input.file,
    pavedRoad: input.pavedRoad
  };

  return {
    findings: [
      ...inlineStyleFindings(codeOnly, context),
      ...rawColorFindings(commentsStripped, context),
      ...arbitraryValueFindings(commentsStripped, context),
      ...rawPrimitiveFindings(codeOnly, context),
      ...libraryBypassFindings(commentsStripped, context, input.pavedRoad.bannedImportSpecifiers)
    ],
    coverage: measureTokenCoverage(commentsStripped, input.tokens)
  };
}
