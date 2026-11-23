/**
 * The rule vocabulary the G1 source scanner reports.
 *
 * The codes and their default severities are owned by `design-rules.ts`;
 * this module is the scanner's single import point for them, so the scan
 * modules never reach across a subsystem boundary for a rule name.
 */

import {
  DEFAULT_DESIGN_RULES,
  type DesignRuleCode,
  type DesignRuleSeverity
} from '../design-rules.js';

export { DEFAULT_DESIGN_RULES };
export type { DesignRuleCode, DesignRuleSeverity };
