import type { PrerequisiteCheckResult, RequestType } from './artifact-prerequisites.js';
import type { RequestArtifactRole } from './artifact-templates.js';

export type RequestArtifactState =
  | 'draft'
  | 'confirmed-by-user'
  | 'direction-locked'
  | 'spec-locked'
  | 'implemented'
  | 'qa-handoff'
  | 'running'
  | 'verdict-issued'
  | 'impact-recorded'
  | 'boundary-recorded'
  | 'handed-off'
  | 'blocked';

export const ALLOWED_STATES_PER_ROLE: Record<RequestArtifactRole, ReadonlyArray<RequestArtifactState>> = {
  prd: ['draft', 'confirmed-by-user', 'handed-off', 'blocked'],
  ui:  ['draft', 'direction-locked', 'handed-off', 'blocked'],
  rd:  ['draft', 'spec-locked', 'implemented', 'qa-handoff', 'handed-off', 'blocked'],
  qa:  ['draft', 'running', 'verdict-issued', 'blocked'],
  sc:  ['draft', 'impact-recorded', 'boundary-recorded', 'handed-off', 'blocked']
};

export function allowedStatesForRole(role: RequestArtifactRole): ReadonlyArray<RequestArtifactState> {
  return ALLOWED_STATES_PER_ROLE[role];
}

export class PrerequisitesNotSatisfiedError extends Error {
  readonly code = 'PREREQUISITES_MISSING';
  readonly role: RequestArtifactRole;
  readonly newState: RequestArtifactState;
  readonly sessionId: string;
  readonly missing: PrerequisiteCheckResult['missing'];
  /**
   * v2.13.3 AC-3 — soft-block warnings carried alongside the missing
   * entries. Surfaced in the CLI error response under `data.warnings`
   * so the operator can see which prereqs were soft-blocked under
   * the 1-minor-release back-compat window (e.g. MUT_REPORT). Always
   * present (possibly empty array) to keep the response shape stable.
   */
  readonly warnings: PrerequisiteCheckResult['warnings'];
  constructor(
    role: RequestArtifactRole,
    newState: RequestArtifactState,
    sessionId: string,
    missing: PrerequisiteCheckResult['missing'],
    warnings: PrerequisiteCheckResult['warnings'] = []
  ) {
    super(
      `Cannot transition ${role} to ${newState}: ${missing.length} required artifact${missing.length === 1 ? '' : 's'} missing under .peaks/_runtime/${sessionId}/`
    );
    this.name = 'PrerequisitesNotSatisfiedError';
    this.role = role;
    this.newState = newState;
    this.sessionId = sessionId;
    this.missing = missing;
    this.warnings = warnings;
  }
}

export class LintGateError extends Error {
  readonly code = 'LINT_GATE_FAILED';
  readonly role: RequestArtifactRole;
  readonly newState: RequestArtifactState;
  readonly errorCount: number;
  constructor(role: RequestArtifactRole, newState: RequestArtifactState, errorCount: number) {
    super(
      `Cannot transition ${role} to ${newState}: ${errorCount} lint error(s) found in artifact. ` +
      'Fix lint errors or use --allow-incomplete to bypass.'
    );
    this.name = 'LintGateError';
    this.role = role;
    this.newState = newState;
    this.errorCount = errorCount;
  }
}

export class TypeSanityViolationError extends Error {
  readonly code = 'TYPE_SANITY_VIOLATION';
  readonly declaredType: RequestType;
  readonly suggestedTypes: ReadonlyArray<RequestType>;
  readonly rationale: string;
  constructor(declaredType: RequestType, suggestedTypes: ReadonlyArray<RequestType>, rationale: string) {
    super(
      `Type sanity violation: declared --type=${declaredType} disagrees with changed files. ` +
      `Suggested types: ${suggestedTypes.join(' | ')}. ` +
      `Rationale: ${rationale}`
    );
    this.name = 'TypeSanityViolationError';
    this.declaredType = declaredType;
    this.suggestedTypes = suggestedTypes;
    this.rationale = rationale;
  }
}

export class FileSizeViolationError extends Error {
  readonly code = 'FILE_SIZE_VIOLATION';
  readonly violations: Array<{ file: string; lines: number }>;
  readonly threshold: number;
  constructor(violations: Array<{ file: string; lines: number }>, threshold: number) {
    const summary = violations.map((v) => `${v.file} (${v.lines} lines)`).join(', ');
    super(
      `File size violation: ${violations.length} file(s) exceed ${threshold} lines: ${summary}. ` +
      'Split into smaller modules, or consider reusing existing components / existing API data ' +
      '(karpathy-guidelines §2 Simplicity First), or use --allow-incomplete to bypass.'
    );
    this.name = 'FileSizeViolationError';
    this.violations = violations;
    this.threshold = threshold;
  }
}

export function updateStatusBlock(markdown: string, newState: RequestArtifactState, timestamp: string, reason?: string): { updated: string; previousState: string } {
  const lines = markdown.split(/\r?\n/);
  let previousState = 'unknown';
  let stateLineIndex = -1;
  let lastUpdateLineIndex = -1;

  for (const [index, raw] of lines.entries()) {
    const trimmed = raw.trim();
    const stateMatch = /^-\s*state:\s*(.+?)\s*$/.exec(trimmed);
    if (stateMatch !== null && stateMatch[1] !== undefined) {
      previousState = stateMatch[1];
      stateLineIndex = index;
      continue;
    }
    if (/^-\s*last update:\s*/.test(trimmed)) {
      lastUpdateLineIndex = index;
    }
  }

  if (stateLineIndex >= 0) {
    lines[stateLineIndex] = `- state: ${newState}`;
  } else {
    lines.push('', '## Status', '', `- state: ${newState}`);
  }

  if (lastUpdateLineIndex >= 0) {
    lines[lastUpdateLineIndex] = `- last update: ${timestamp}`;
  } else if (stateLineIndex >= 0) {
    lines.splice(stateLineIndex, 0, `- last update: ${timestamp}`);
  } else {
    lines.push(`- last update: ${timestamp}`);
  }

  if (reason !== undefined && reason.length > 0) {
    lines.push(`- transition note (${timestamp}): ${reason}`);
  }

  return { updated: lines.join('\n'), previousState };
}
