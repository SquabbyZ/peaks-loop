/**
 * The S7 audit's dimension vocabulary and ONE severity table.
 *
 * Split from `audit-scoring.ts` so the table (the contract every report cites)
 * is readable on its own. `DIMENSION_RULES` classifies every `AuditDimension`
 * as `hard` (usability / accessibility), `soft` (aesthetic) or `unmeasured`
 * (not judgeable from source), says whether its score is a value ratio or a
 * per-finding cost, and documents the cost.
 *
 * Exhaustiveness is enforced twice: `AUDIT_DIMENSIONS_EXHAUSTIVE` fails to
 * compile when a new union member has no row, and `audit-scoring.test.ts` walks
 * the table at runtime.
 */

import type { AuditDimension, AuditSeverity } from './audit-finding.js';

/**
 * The dimension union written down once. `AUDIT_DIMENSIONS_EXHAUSTIVE` below
 * is the compile-time half of the exhaustiveness rule; the exported constant is
 * the runtime half a test can walk.
 */
export const AUDIT_DIMENSIONS = [
  'spacing',
  'type',
  'color',
  'contrast',
  'surface',
  'hierarchy',
  'a11y',
  'states',
  'palette',
  'overflow'
] as const;

type ListedDimension = (typeof AUDIT_DIMENSIONS)[number];

/**
 * Assigned `true` only while every `AuditDimension` has a listed name. Adding a
 * union member without adding it here makes the conditional type `false`, and
 * this assignment then fails to compile — the first of the two exhaustiveness
 * rails. The second is the runtime test over `DIMENSION_RULES`.
 */
export const AUDIT_DIMENSIONS_EXHAUSTIVE: [Exclude<AuditDimension, ListedDimension>] extends [never]
  ? true
  : false = true;

/** The full score a page or dimension starts from. */
export const BASE_SCORE = 100;

/** One dimension's documented class, score shape and per-finding cost. */
export type DimensionRule = {
  /** The dimension's own class; `unmeasured` is legal for source-blind dimensions. */
  severity: AuditSeverity;
  /** `ratio` = on-contract share; `cost` = 100 minus a documented cost per finding. */
  kind: 'ratio' | 'cost';
  /** Points lost per hard/soft finding. `0` for a ratio dimension (it has no cost). */
  cost: number;
};

/**
 * THE severity table. A dimension whose class is `hard` is an accessibility /
 * usability dimension even when an individual finding is aesthetic (colour also
 * emits the soft family rule); the table pins the dimension's headline class so
 * an inversion (hard downgraded, soft escalated) is a visible edit here.
 *
 * Ratio dimensions carry `cost: 0` because their score is the measured share,
 * not a decrement; the boolean rows keep the documented cost one hit pays.
 */
export const DIMENSION_RULES: Record<AuditDimension, DimensionRule> = {
  spacing: { severity: 'soft', kind: 'ratio', cost: 0 },
  type: { severity: 'soft', kind: 'ratio', cost: 0 },
  color: { severity: 'hard', kind: 'ratio', cost: 0 },
  contrast: { severity: 'hard', kind: 'cost', cost: 25 },
  surface: { severity: 'soft', kind: 'cost', cost: 5 },
  hierarchy: { severity: 'soft', kind: 'cost', cost: 5 },
  a11y: { severity: 'hard', kind: 'cost', cost: 25 },
  states: { severity: 'hard', kind: 'cost', cost: 25 },
  // S8 render dimensions. `palette` is aesthetic and finding-based; a rendered
  // frame with no finding is a judged 100. `overflow` is source-blind today:
  // its only row is the fixed `unmeasured` gap (Task 4), so it renders "not
  // judged" and its cost never fires.
  palette: { severity: 'soft', kind: 'cost', cost: 5 },
  overflow: { severity: 'unmeasured', kind: 'cost', cost: 0 }
};

/**
 * Value-based vs cost-based dimensions, DERIVED from the one table (S7 review
 * K4). Two hand-written lists would let a future `kind` edit drift from the
 * exported partition; deriving them makes the table the only authority.
 */
export const AUDIT_RATIO_DIMENSIONS: AuditDimension[] = AUDIT_DIMENSIONS.filter(
  (dimension) => DIMENSION_RULES[dimension].kind === 'ratio'
);

/** Boolean dimensions, derived from `DIMENSION_RULES.kind`. */
export const AUDIT_COST_DIMENSIONS: AuditDimension[] = AUDIT_DIMENSIONS.filter(
  (dimension) => DIMENSION_RULES[dimension].kind === 'cost'
);
