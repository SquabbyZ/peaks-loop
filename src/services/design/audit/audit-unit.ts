/**
 * The per-unit detector fan-out for the S7 audit (Task 4, extended by Task 5,
 * split by Task 6d).
 *
 * One audited unit (a markup page or one stylesheet) goes through every
 * dimension's detector and comes back as one finding list. The fan-out lives
 * here, apart from the project reader, so adding a dimension touches one file
 * and `audit-project.ts` keeps one responsibility: deciding which units exist
 * and what the contract declared.
 *
 * TWO SOURCE SETS (Task 6d). A page-scope rule judges the page module: the
 * `h1` / levels rule, the data-state rule and the primary-action count. A VALUE
 * dimension — `spacing`, `type`, `color`, and `surface`'s radius/shadow rules —
 * judges the page PLUS its import closure, because the values users see live in
 * the components the page renders. Task 6c's route-entry scope alone measured
 * only the 24 spacing values written in the entry module and missed the 4,500
 * in its components. The `surface` primary-string rule stays page-scope: it is
 * about what the page itself asks the user to click first.
 *
 * The contract as read travels with the input: the colour group is the colour
 * oracle and its declared pairs are the contrast oracle. A missing colour group
 * is passed as `undefined`, never as an empty one — the colour detector must be
 * able to tell "no token declared" from "a token declared with no value".
 */

import type { DesignTokenScale } from '../paved-road.js';
import type {
  AuditDimension,
  AuditFinding,
  AuditSource,
  DimensionJudgement
} from './audit-finding.js';
import { auditA11yDimension } from './audit-a11y.js';
import { auditColorDimension, type ColorTokenGroup } from './audit-color.js';
import type { DeclaredColorPair } from './audit-contrast.js';
import { sanitizeFindings } from './audit-echo.js';
import { auditHierarchyDimension } from './audit-hierarchy.js';
import { auditSpacingDimension } from './audit-spacing.js';
import { auditStatesDimension } from './audit-states.js';
import { auditSurfaceDimension } from './audit-surface.js';
import { auditTypeDimension } from './audit-type.js';
import type { CssVariableTable } from './css-variables.js';

/** The contract as read: the colour oracle and its declared contrast pairs. */
export type AuditContract = {
  color: ColorTokenGroup | undefined;
  pairs: readonly DeclaredColorPair[];
};

/** One audited unit and everything the detectors may judge it against. */
export type AuditUnitInput = {
  source: AuditSource;
  /** The declared scale — never the built-in default by accident. */
  tokenScale: DesignTokenScale;
  contract: AuditContract;
  variables: CssVariableTable;
  /** Markup modules this page imports (Task 5 closure). */
  imports: readonly AuditSource[];
  /** Every stylesheet the project reader read, consulted for focus styles. */
  styles: readonly AuditSource[];
};

/** One unit's findings, plus the judged value counts the ratio score needs. */
export type UnitAudit = {
  findings: AuditFinding[];
  judgements: Partial<Record<AuditDimension, DimensionJudgement>>;
  /** Which cost dimensions had real input; a false one is "not judged". */
  judged: Partial<Record<AuditDimension, boolean>>;
};

/** One file contributes its values once, however many pages import it. */
function dedupeSources(sources: readonly AuditSource[]): AuditSource[] {
  const seen = new Set<string>();
  const unique: AuditSource[] = [];
  for (const source of sources) {
    if (seen.has(source.file)) continue;
    seen.add(source.file);
    unique.push(source);
  }
  return unique;
}

/** Every detector's findings for one unit, in dimension order. */
export function auditUnit(input: AuditUnitInput): UnitAudit {
  const pageSources = dedupeSources([input.source]);
  const valueSources = dedupeSources([input.source, ...input.imports]);
  const shared = {
    tokenScale: input.tokenScale,
    variables: input.variables,
    styles: input.styles
  };
  const pageScope = { ...shared, sources: pageSources, imports: input.imports };
  const valueScope = { ...shared, sources: valueSources, pageSources };
  const tokens = input.contract.color === undefined ? null : { color: input.contract.color };
  const spacing = auditSpacingDimension(valueScope);
  const type = auditTypeDimension(valueScope);
  const color = auditColorDimension({ ...valueScope, tokens });
  const surface = auditSurfaceDimension(valueScope);
  const hierarchy = auditHierarchyDimension(pageScope);
  const a11y = auditA11yDimension(pageScope);
  const states = auditStatesDimension(pageScope);
  return {
    // Every detector's finding passes the one echo sanitiser here, so a NEW
    // detector cannot reach the report, the files or the terminal unmasked.
    findings: sanitizeFindings([
      ...spacing.findings,
      ...type.findings,
      ...color.findings,
      ...surface.findings,
      ...hierarchy.findings,
      ...a11y.findings,
      ...states.findings
    ]),
    judgements: {
      spacing: spacing.judgement,
      type: type.judgement,
      color: color.judgement
    },
    judged: {
      surface: surface.judged,
      hierarchy: hierarchy.judged,
      a11y: a11y.judged,
      states: states.judged
    }
  };
}
