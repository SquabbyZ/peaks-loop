/**
 * The six design rule codes and their out-of-the-box severities.
 *
 * `DESIGN_ARBITRARY_VALUE` and `DESIGN_RAW_PRIMITIVE` are symptoms of
 * "the UI library is at hand but the code hardcodes anyway", so they default
 * to `fail` and are not softened by a downgrade. `DESIGN_TOKEN_COVERAGE` is a
 * ratio, so it warns until a project chooses to gate it.
 */

/** Every rule the G1 source scanner can report. */
export type DesignRuleCode =
  | 'DESIGN_INLINE_STYLE'
  | 'DESIGN_RAW_COLOR'
  | 'DESIGN_LIBRARY_BYPASS'
  | 'DESIGN_ARBITRARY_VALUE'
  | 'DESIGN_RAW_PRIMITIVE'
  | 'DESIGN_TOKEN_COVERAGE';

/** How a rule scores a finding. `fail` blocks; `warn` is recorded only. */
export type DesignRuleSeverity = 'fail' | 'warn';

/** The default severity of every rule. */
export const DEFAULT_DESIGN_RULES: Readonly<Record<DesignRuleCode, DesignRuleSeverity>> = {
  DESIGN_INLINE_STYLE: 'fail',
  DESIGN_RAW_COLOR: 'fail',
  DESIGN_LIBRARY_BYPASS: 'fail',
  DESIGN_ARBITRARY_VALUE: 'fail',
  DESIGN_RAW_PRIMITIVE: 'fail',
  DESIGN_TOKEN_COVERAGE: 'warn'
};
