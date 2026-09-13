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

/**
 * The `- state:` line the artifact templates and `request transition` write.
 * Anchored on both ends so a prose mention (`state: qa-block`, without the
 * leading dash) is not read as the field, and anchored at column 0 because
 * every writer of this field (`updateStatusBlock`, `request init`) emits it
 * as a top-level line — an indented match is a nested list item, not the
 * field. `locateArtifactState` applies it only outside fenced code regions.
 */
const STATE_LINE_RE = /^-\s*state:\s*(.+?)\s*$/;

/** A fenced-code delimiter line: three or more backticks or tildes. */
const FENCE_LINE_RE = /^(`{3,}|~{3,})/;

export interface ArtifactStateLocation {
  /** Index of the authoritative `- state:` line, or -1 when the document has none. */
  stateLineIndex: number;
  /** The authoritative state, or null when `stateLineIndex` is -1. */
  state: string | null;
}

/**
 * The ONE rule for "which `state:` line is this artifact's state": the LAST
 * one. A request artifact is an append-only log — each QA round appends a
 * section ending in its own `## Status`, and `request transition` rewrites the
 * newest state line in place — so the last line is the current round and the
 * earlier ones are history.
 *
 * Every reader (`verify-pipeline`, `request show`, the resume detector) and the
 * writer (`updateStatusBlock`) MUST go through this. The 2026-09-14 defect was
 * three readers disagreeing about one file: `verify-pipeline` and the resume
 * detector took the first match, `request show` took the last, so an artifact
 * appended to more than once read as its first round to the checker and the
 * resume detector while reading as its last round to the viewer and the writer.
 *
 * Scoping the search to the last `## Status` block was evaluated as an
 * alternative and rejected — as a SECOND locator, not as a broken rule. It is
 * well defined on the specimen that motivated this slice (four blocks) and
 * returns `verdict-issued`, the right answer; and a trailing appended
 * `- state:` line does not defeat it the way it defeats this rule — on that
 * input the two rules disagree, and the one the block rule then disagrees with
 * is the writer. `updateStatusBlock` rewrites the last `- state:` line wherever
 * it sits and never moves it into the newest block, so a block-scoped reader
 * parts company with the writer as soon as those two positions differ: the
 * writer writes the appended line while the block reader keeps reporting the
 * block's own line. That is this slice's reader-vs-writer divergence on a new
 * axis. Sharing the writer's locator makes the agreement structural, not
 * accidental.
 *
 * Known boundary of this rule, pinned in
 * `request-artifact-state-authority.test.ts` rather than hidden: a process that
 * appends a bare `- state:` line takes over the field — consistent with the
 * writer being its only sanctioned producer.
 *
 * Two narrowings keep that boundary to lines the writer could have produced.
 * A line inside a fenced code region is skipped, and the line must start at
 * column 0. Neither is defensive decoration: a document that *describes* the
 * state machine quotes `- state: qa-block` inside a fence, and this job's own
 * `qa/requests/*.md` artifacts do exactly that — under the unfenced rule the
 * quoted example was an input to the transition checker, and it survived only
 * because the quoted copies happened not to be last. Both narrowings were
 * measured against every `*.md` under `.peaks/` (833 files) and change no
 * artifact's answer, and the writer already satisfies both by construction
 * (`updateStatusBlock` writes `- state: <state>` at column 0), so reader and
 * writer stay the same locator.
 *
 * Fuller record: the slice-3 section of this session's `rd/tech-doc.md` and
 * the repair-round section of `rd/repair2-meta-integrity-fixes.md`.
 */
export function locateArtifactState(lines: ReadonlyArray<string>): ArtifactStateLocation {
  let stateLineIndex = -1;
  let state: string | null = null;
  let fence: string | null = null;
  for (const [index, raw] of lines.entries()) {
    const fenceMatch = FENCE_LINE_RE.exec(raw.trim());
    if (fence === null) {
      if (fenceMatch !== null) {
        fence = fenceMatch[1]![0]!;
        continue;
      }
    } else {
      if (fenceMatch !== null && fenceMatch[1]![0] === fence) fence = null;
      continue;
    }
    const match = STATE_LINE_RE.exec(raw);
    if (match?.[1] !== undefined) {
      stateLineIndex = index;
      state = match[1];
    }
  }
  return { stateLineIndex, state };
}

/** `locateArtifactState` over a whole document. Null when there is no `- state:` line. */
export function readArtifactState(markdown: string): string | null {
  return locateArtifactState(markdown.split(/\r?\n/)).state;
}

export function updateStatusBlock(markdown: string, newState: RequestArtifactState, timestamp: string, reason?: string): { updated: string; previousState: string } {
  const lines = markdown.split(/\r?\n/);
  const { stateLineIndex, state } = locateArtifactState(lines);
  const previousState = state ?? 'unknown';
  let lastUpdateLineIndex = -1;

  for (const [index, raw] of lines.entries()) {
    if (/^-\s*last update:\s*/.test(raw.trim())) {
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
