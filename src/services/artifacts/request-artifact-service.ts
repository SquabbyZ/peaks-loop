import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isDirectory, listDirectories, pathExists } from '../../shared/fs.js';
import { checkPrerequisites, DEFAULT_REQUEST_TYPE, isRequestType, VALID_REQUEST_TYPES, type PrerequisiteCheckResult, type RequestType } from './artifact-prerequisites.js';
import { ensureSession } from '../session/session-manager.js';
import { getNextNumber, buildNumberedFilename } from '../../shared/incrementing-number.js';
import { lintRequestArtifact } from './artifact-lint-service.js';
import { checkTypeSanity } from '../scan/type-sanity-service.js';
import { requireUserConfirmation } from '../mode/mode-enforcement.js';
import { scanFileSize } from '../scan/file-size-scan.js';

export { VALID_REQUEST_TYPES, DEFAULT_REQUEST_TYPE, isRequestType, type RequestType };

export type RequestArtifactRole = 'prd' | 'ui' | 'rd' | 'qa' | 'sc';

export type CreateRequestArtifactOptions = {
  role: RequestArtifactRole;
  requestId: string;
  projectRoot: string;
  sessionId?: string;
  apply?: boolean;
  requestType?: RequestType;
  clock?: () => string;
};

export type CreateRequestArtifactResult = {
  role: RequestArtifactRole;
  requestId: string;
  sessionId: string;
  path: string;
  content: string;
  applied: boolean;
};

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const VALID_ROLES: ReadonlySet<RequestArtifactRole> = new Set(['prd', 'ui', 'rd', 'qa', 'sc']);

function defaultClock(): string {
  return new Date().toISOString();
}

function dateSlugFromIso(iso: string): string {
  return iso.slice(0, 10);
}

function defaultSessionId(iso: string): string {
  return `${dateSlugFromIso(iso)}-session`;
}

function renderPrdTemplate(requestId: string, sessionId: string, timestamp: string, requestType: RequestType): string {
  return `# PRD Request ${requestId}

- session: ${sessionId}
- type: ${requestType}
- source: <ticket, message URL, or "verbal" with a short sanitized quote>
- raw input (sanitized): <one-paragraph restatement of what the user actually asked for>

## Goals

- ...

## Non-goals

- ...

## Preserved behavior

- ...

## Acceptance criteria

- ... (browser-verifiable when frontend is in scope)

## Frontend delta (only when target is frontend)

- pages / routes / components / states / permissions / data deps / edge cases
- 待联调态: ...
- API contracts pending: ...

## Risks and open questions

- ...

## Handoff

- to peaks-rd: .peaks/${sessionId}/rd/requests/${requestId}.md
- to peaks-qa: .peaks/${sessionId}/qa/requests/${requestId}.md
- to peaks-ui: .peaks/${sessionId}/ui/requests/${requestId}.md  (when UI involved)

## Status

- created: ${timestamp}
- last update: ${timestamp}
- state: draft
`;
}

function renderUiTemplate(requestId: string, sessionId: string, timestamp: string, requestType: RequestType): string {
  return `# UI Request ${requestId}

- session: ${sessionId}
- linked-prd: .peaks/${sessionId}/prd/requests/${requestId}.md
- type: ${requestType}
- scope: full new surface | iteration on existing surface | regression fix | visual refresh
- design direction: editorial | bento | Swiss | luxury | retro-futurist | glass | product-system | other-explicit-name

## Affected surfaces

- pages / routes / components / modals / states (loading, empty, error, hover, focus, active, responsive)
- explicit out-of-scope surfaces (do not modify)

## UX flow and page states

- entry points, primary flow, secondary flows, exit points
- state machine per surface when state transitions matter

## Visual constraints

- typography pair: ...
- palette: ...
- density and motion intensity dials: ...
- rejected generic patterns

## Interaction constraints

- keyboard, focus order, ARIA roles, gesture support, accessibility minima

## UI regression seeds

- list of visible regressions QA must check against the prior state

## Browser evidence

- sanitized observations only — no login URLs, cookies, headers, tokens, storage state, browser traces, or screenshots/logs with PII / SSO / MFA material

## Handoff

- to peaks-rd: .peaks/${sessionId}/rd/requests/${requestId}.md
- to peaks-qa: .peaks/${sessionId}/qa/requests/${requestId}.md

## Status

- created: ${timestamp}
- last update: ${timestamp}
- state: draft
`;
}

function renderRdTemplate(requestId: string, sessionId: string, timestamp: string, requestType: RequestType): string {
  return `# RD Request ${requestId}

- session: ${sessionId}
- linked-prd: .peaks/${sessionId}/prd/requests/${requestId}.md
- linked-ui:  .peaks/${sessionId}/ui/requests/${requestId}.md  (when UI involved)
- type: ${requestType}

## Red-line scope

- in-scope files / routes / API paths / data models
- explicit out-of-scope surfaces (do not modify, mock, delete, or replace)

## Standards preflight

- peaks standards init/update --project <path> --dry-run output paths and status
- planned application: apply | review-only | blocked

## OpenSpec linkage (when openspec/ exists)

- change-id: <openspec change id>
- entry validate: peaks openspec validate <change-id> data.valid status
- to-rd projection: peaks openspec to-rd <change-id> artifact path
- exit validate (after implementation): status

## Coverage status

- current total UT coverage: <percent>
- new/changed code coverage: <percent>
- gate verdict: pass | legacy-accepted | blocked

## Slice contract

- slice id, functional boundary, pre-refactor behavior, target structure, unit-test requirements, acceptance checks, rollback plan, commit boundary

## Implementation evidence

- diff paths, test commands + outputs, code review findings + fixes, security review findings + fixes, dry-run output

## MCP usage (when external docs lookup was used)

- capabilityId / tool / sanitized args
- artifact path of stored result
- no secrets, no full network bodies

## Handoff

- to peaks-qa: .peaks/${sessionId}/qa/requests/${requestId}.md
- to peaks-sc: .peaks/${sessionId}/sc/commit-boundaries/${requestId}.md

## Status

- created: ${timestamp}
- last update: ${timestamp}
- state: draft
`;
}

function renderQaTemplate(requestId: string, sessionId: string, timestamp: string, requestType: RequestType): string {
  return `# QA Request ${requestId}

- session: ${sessionId}
- linked-prd: .peaks/${sessionId}/prd/requests/${requestId}.md
- linked-rd:  .peaks/${sessionId}/rd/requests/${requestId}.md
- linked-ui:  .peaks/${sessionId}/ui/requests/${requestId}.md  (when UI involved)
- type: ${requestType}

## Red-line boundary check

- in-scope changes seen in the diff (match PRD + RD scope)
- out-of-scope changes flagged (any extra file, route, mock, fixture, behavior)
- verdict: clean | boundary-violation

## OpenSpec exit gate (when openspec/ exists)

- change-id: <id>
- peaks openspec validate <id> data.valid: true | false
- issues: ...

## Acceptance checks

- per-criterion: check method, result (pass | fail | blocked), evidence path

## Mandatory validation gates

- unit tests: command + pass/fail + coverage delta
- API validation (when applicable): request paths exercised, evidence
- browser E2E (when frontend): headed gstack/browse/dist/browse visible-browser confirmation, sanitized route/actions, console/network observations
- browser-error feedback loop: page errors, console exceptions, broken network, hydration failures → return-to-RD evidence
- security check: tool used, findings, fixes, unresolved risks
- performance check: tool used, baseline vs after numbers when available
- validation report path

## Regression matrix

- list of surfaces / API paths / browser flows checked
- pass/fail per row

## Browser evidence

- sanitized observations only — no login URLs, cookies, headers, tokens, storage state, browser traces, or screenshots/logs with PII / SSO / MFA material

## Verdict

- overall: pass | return-to-rd | blocked

## Status

- created: ${timestamp}
- last update: ${timestamp}
- state: draft
`;
}

function renderScTemplate(requestId: string, sessionId: string, timestamp: string, requestType: RequestType): string {
  return `# SC Request ${requestId}

- session: ${sessionId}
- linked-prd: .peaks/${sessionId}/prd/requests/${requestId}.md
- linked-rd:  .peaks/${sessionId}/rd/requests/${requestId}.md
- linked-qa:  .peaks/${sessionId}/qa/requests/${requestId}.md
- linked-ui:  .peaks/${sessionId}/ui/requests/${requestId}.md  (when UI involved)
- type: ${requestType}

## Change impact

- modules / files / routes / data models touched
- blast radius: local | cross-cutting | release-critical
- rollback strategy

## Commit boundaries

- one commit per OpenSpec heading (when openspec/ exists)
- otherwise: list of slice ids → commit message + scope

## Artifact retention

- prd artifact: ...
- rd artifact: ...
- qa artifact: ...
- ui artifact: ... (when UI involved)
- coverage evidence: ...
- code review evidence: ...

## Sync / authorization

- artifact workspace path: .peaks/${sessionId}/
- memory sync authorized: yes | no
- artifact sync authorized: yes | no
- rationale if not authorized: keep local

## Rollback points

- commits / tags / branches that can revert each boundary

## Handoff

- to peaks-txt: .peaks/${sessionId}/txt/skill-usage-lessons.md (when reusable lesson exists)

## Status

- created: ${timestamp}
- last update: ${timestamp}
- state: draft
`;
}

function renderTemplate(role: RequestArtifactRole, requestId: string, sessionId: string, timestamp: string, requestType: RequestType): string {
  switch (role) {
    case 'prd':
      return renderPrdTemplate(requestId, sessionId, timestamp, requestType);
    case 'ui':
      return renderUiTemplate(requestId, sessionId, timestamp, requestType);
    case 'rd':
      return renderRdTemplate(requestId, sessionId, timestamp, requestType);
    case 'qa':
      return renderQaTemplate(requestId, sessionId, timestamp, requestType);
    case 'sc':
      return renderScTemplate(requestId, sessionId, timestamp, requestType);
  }
}

export async function createRequestArtifact(options: CreateRequestArtifactOptions): Promise<CreateRequestArtifactResult> {
  if (!VALID_ROLES.has(options.role)) {
    throw new Error(`Invalid role: ${String(options.role)} (expected prd, ui, rd, qa, or sc)`);
  }
  if (!REQUEST_ID_PATTERN.test(options.requestId)) {
    throw new Error(`Invalid request id: ${options.requestId} (expected letters, digits, dots, underscores, or dashes)`);
  }
  const requestType = options.requestType ?? DEFAULT_REQUEST_TYPE;

  const clock = options.clock ?? defaultClock;
  const timestamp = clock();

  // Use provided session ID or get/create current session
  const sessionId = options.sessionId ?? await ensureSession(options.projectRoot);

  // Build numbered path in session directory
  const requestsDir = join(options.projectRoot, '.peaks', sessionId, options.role, 'requests');

  // Check if a file with this requestId already exists (regardless of number prefix)
  if (await isDirectory(requestsDir)) {
    const existingFiles = await listMarkdownFiles(requestsDir);
    const alreadyExists = existingFiles.some((file) => {
      if (file === `${options.requestId}.md`) return true;
      if (/^\d+-/.test(file) && file.endsWith(`-${options.requestId}.md`)) return true;
      return false;
    });
    if (alreadyExists) {
      throw new Error(`A request artifact with id "${options.requestId}" already exists in ${requestsDir}. Remove it before re-running peaks request init.`);
    }
  }

  const number = getNextNumber(requestsDir);
  const filename = buildNumberedFilename(number, options.requestId);
  const path = join(requestsDir, filename);

  const content = renderTemplate(options.role, options.requestId, sessionId, timestamp, requestType);

  if (options.apply !== true) {
    return { role: options.role, requestId: options.requestId, sessionId, path, content, applied: false };
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');

  // Create QA initiated marker so rd:qa-handoff gate can verify QA was invoked
  if (options.role === 'qa') {
    const qaDir = join(options.projectRoot, '.peaks', sessionId, 'qa');
    const initiatedPath = join(qaDir, '.initiated');
    if (!existsSync(initiatedPath)) {
      await mkdir(qaDir, { recursive: true });
      await writeFile(initiatedPath, '', 'utf8');
    }
  }

  return { role: options.role, requestId: options.requestId, sessionId, path, content, applied: true };
}

export type RequestArtifactSummary = {
  role: RequestArtifactRole;
  sessionId: string;
  requestId: string;
  path: string;
  state: string;
  requestType: RequestType;
  createdAt?: string;
};

export type ListRequestArtifactsOptions = {
  projectRoot: string;
  sessionId?: string;
  role?: RequestArtifactRole;
};

export type ShowRequestArtifactOptions = {
  projectRoot: string;
  role: RequestArtifactRole;
  requestId: string;
  sessionId?: string;
};

export type ShowRequestArtifactResult = RequestArtifactSummary & {
  content: string;
};

function extractMetadata(markdown: string): { state: string; requestType: RequestType; createdAt?: string } {
  let state = 'unknown';
  let createdAt: string | undefined;
  let requestType: RequestType = DEFAULT_REQUEST_TYPE;
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    const stateMatch = /^-\s*state:\s*(.+?)\s*$/.exec(line);
    if (stateMatch !== null && stateMatch[1] !== undefined) {
      state = stateMatch[1];
      continue;
    }
    const createdMatch = /^-\s*created:\s*(.+?)\s*$/.exec(line);
    if (createdMatch !== null && createdMatch[1] !== undefined) {
      createdAt = createdMatch[1];
      continue;
    }
    const typeMatch = /^-\s*type:\s*(.+?)\s*$/.exec(line);
    if (typeMatch !== null && typeMatch[1] !== undefined) {
      const candidate = typeMatch[1];
      if (isRequestType(candidate)) {
        requestType = candidate;
      }
      // Placeholder values (e.g. "feature | bug | refactor | clarification") fall back to default.
    }
  }
  const base: { state: string; requestType: RequestType; createdAt?: string } = { state, requestType };
  if (createdAt !== undefined) base.createdAt = createdAt;
  return base;
}

async function readSummary(
  projectRoot: string,
  sessionId: string,
  role: RequestArtifactRole,
  fileName: string
): Promise<RequestArtifactSummary> {
  const path = join(projectRoot, '.peaks', sessionId, role, 'requests', fileName);
  const body = await readFile(path, 'utf8');
  const { state, createdAt, requestType } = extractMetadata(body);
  // Strip numbered prefix (e.g., "001-requestId.md" -> "requestId")
  // Only strip 3-digit zero-padded prefixes (our incrementing number format)
  const requestId = fileName.replace(/^0\d{2}-/, '').replace(/\.md$/, '');
  const summary: RequestArtifactSummary = { role, sessionId, requestId, path, state, requestType };
  if (createdAt !== undefined) {
    summary.createdAt = createdAt;
  }
  return summary;
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  if (!(await isDirectory(dir))) {
    return [];
  }
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort();
}

export async function listRequestArtifacts(options: ListRequestArtifactsOptions): Promise<RequestArtifactSummary[]> {
  const peaksRoot = join(options.projectRoot, '.peaks');
  if (!(await isDirectory(peaksRoot))) {
    return [];
  }
  const sessions = options.sessionId !== undefined ? [options.sessionId] : await listDirectories(peaksRoot);
  const roles = options.role !== undefined ? [options.role] : Array.from(VALID_ROLES);
  const summaries: RequestArtifactSummary[] = [];
  for (const sessionId of sessions) {
    for (const role of roles) {
      const dir = join(peaksRoot, sessionId, role, 'requests');
      const fileNames = await listMarkdownFiles(dir);
      for (const fileName of fileNames) {
        summaries.push(await readSummary(options.projectRoot, sessionId, role, fileName));
      }
    }
  }
  return summaries;
}

export async function showRequestArtifact(options: ShowRequestArtifactOptions): Promise<ShowRequestArtifactResult | null> {
  if (!VALID_ROLES.has(options.role)) {
    throw new Error(`Invalid role: ${String(options.role)} (expected prd, ui, rd, qa, or sc)`);
  }
  if (!REQUEST_ID_PATTERN.test(options.requestId)) {
    throw new Error(`Invalid request id: ${options.requestId} (expected letters, digits, dots, underscores, or dashes)`);
  }

  // Search for files matching the requestId (supports both legacy and numbered formats)
  const findFileInDir = async (dir: string): Promise<{ fileName: string; path: string } | null> => {
    const files = await listMarkdownFiles(dir);
    for (const file of files) {
      // Match legacy format: ${requestId}.md
      if (file === `${options.requestId}.md`) {
        return { fileName: file, path: join(dir, file) };
      }
      // Match numbered format: ${number}-${requestId}.md
      if (/^\d+-/.test(file) && file.endsWith(`-${options.requestId}.md`)) {
        return { fileName: file, path: join(dir, file) };
      }
    }
    return null;
  };

  if (options.sessionId !== undefined) {
    const dir = join(options.projectRoot, '.peaks', options.sessionId, options.role, 'requests');
    const found = await findFileInDir(dir);
    if (found === null) {
      return null;
    }
    const summary = await readSummary(options.projectRoot, options.sessionId, options.role, found.fileName);
    const content = await readFile(found.path, 'utf8');
    return { ...summary, content };
  }

  const peaksRoot = join(options.projectRoot, '.peaks');
  if (!(await isDirectory(peaksRoot))) {
    return null;
  }
  const sessions = await listDirectories(peaksRoot);
  for (const sessionId of sessions) {
    const dir = join(peaksRoot, sessionId, options.role, 'requests');
    const found = await findFileInDir(dir);
    if (found !== null) {
      const summary = await readSummary(options.projectRoot, sessionId, options.role, found.fileName);
      const content = await readFile(found.path, 'utf8');
      return { ...summary, content };
    }
  }
  return null;
}

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

const ALLOWED_STATES_PER_ROLE: Record<RequestArtifactRole, ReadonlyArray<RequestArtifactState>> = {
  prd: ['draft', 'confirmed-by-user', 'handed-off', 'blocked'],
  ui:  ['draft', 'direction-locked', 'handed-off', 'blocked'],
  rd:  ['draft', 'spec-locked', 'implemented', 'qa-handoff', 'handed-off', 'blocked'],
  qa:  ['draft', 'running', 'verdict-issued', 'blocked'],
  sc:  ['draft', 'impact-recorded', 'boundary-recorded', 'handed-off', 'blocked']
};

export function allowedStatesForRole(role: RequestArtifactRole): ReadonlyArray<RequestArtifactState> {
  return ALLOWED_STATES_PER_ROLE[role];
}

export type TransitionRequestArtifactOptions = {
  role: RequestArtifactRole;
  requestId: string;
  projectRoot: string;
  newState: RequestArtifactState;
  sessionId?: string;
  reason?: string;
  allowIncomplete?: boolean;
  confirmed?: boolean;
  forceConfirm?: boolean;
  typeSanityCheck?: { projectRoot: string; declaredType: RequestType };
  clock?: () => string;
};

export type TransitionRequestArtifactResult = RequestArtifactSummary & {
  previousState: string;
  content: string;
  bypassedPrerequisites?: PrerequisiteCheckResult;
};

export class PrerequisitesNotSatisfiedError extends Error {
  readonly code = 'PREREQUISITES_MISSING';
  readonly role: RequestArtifactRole;
  readonly newState: RequestArtifactState;
  readonly sessionId: string;
  readonly missing: PrerequisiteCheckResult['missing'];
  constructor(role: RequestArtifactRole, newState: RequestArtifactState, sessionId: string, missing: PrerequisiteCheckResult['missing']) {
    super(
      `Cannot transition ${role} to ${newState}: ${missing.length} required artifact${missing.length === 1 ? '' : 's'} missing under .peaks/${sessionId}/`
    );
    this.name = 'PrerequisitesNotSatisfiedError';
    this.role = role;
    this.newState = newState;
    this.sessionId = sessionId;
    this.missing = missing;
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
      'Split into smaller modules or use --allow-incomplete to bypass.'
    );
    this.name = 'FileSizeViolationError';
    this.violations = violations;
    this.threshold = threshold;
  }
}

function updateStatusBlock(markdown: string, newState: RequestArtifactState, timestamp: string, reason?: string): { updated: string; previousState: string } {
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

export async function transitionRequestArtifact(options: TransitionRequestArtifactOptions): Promise<TransitionRequestArtifactResult | null> {
  if (!VALID_ROLES.has(options.role)) {
    throw new Error(`Invalid role: ${String(options.role)} (expected prd, ui, rd, qa, or sc)`);
  }
  if (!REQUEST_ID_PATTERN.test(options.requestId)) {
    throw new Error(`Invalid request id: ${options.requestId} (expected letters, digits, dots, underscores, or dashes)`);
  }
  const allowed = ALLOWED_STATES_PER_ROLE[options.role];
  if (!allowed.includes(options.newState)) {
    throw new Error(`Invalid state for role ${options.role}: ${options.newState} (expected one of ${allowed.join(', ')})`);
  }

  const showOptions: ShowRequestArtifactOptions = {
    projectRoot: options.projectRoot,
    role: options.role,
    requestId: options.requestId
  };
  if (options.sessionId !== undefined) {
    showOptions.sessionId = options.sessionId;
  }
  const existing = await showRequestArtifact(showOptions);
  if (existing === null) {
    return null;
  }

  // Mode enforcement: require user confirmation in assisted/strict modes
  const transitionKey = `${options.role}:${options.newState}` as `${RequestArtifactRole}:${RequestArtifactState}`;
  await requireUserConfirmation({
    projectRoot: options.projectRoot,
    transitionKey,
    confirmed: options.confirmed,
    forceConfirm: options.forceConfirm
  });

  const prerequisiteResult = await checkPrerequisites({
    projectRoot: options.projectRoot,
    sessionId: existing.sessionId,
    role: options.role,
    newState: options.newState,
    requestId: options.requestId,
    requestType: existing.requestType
  });

  if (!prerequisiteResult.ok && options.allowIncomplete !== true) {
    throw new PrerequisitesNotSatisfiedError(options.role, options.newState, existing.sessionId, prerequisiteResult.missing);
  }

  // Type sanity check for PRD handoff
  if (options.typeSanityCheck !== undefined && options.role === 'prd' && options.newState === 'handed-off') {
    const sanityReport = checkTypeSanity({
      projectRoot: options.typeSanityCheck.projectRoot,
      declaredType: options.typeSanityCheck.declaredType
    });
    if (!sanityReport.consistent) {
      throw new TypeSanityViolationError(
        options.typeSanityCheck.declaredType,
        sanityReport.suggestedTypes,
        sanityReport.rationale
      );
    }
  }

  // Lint gate: when transitioning OUT of draft, lint must pass (unless --allow-incomplete)
  if (existing.state === 'draft' && options.allowIncomplete !== true) {
    const lintReport = await lintRequestArtifact({
      projectRoot: options.projectRoot,
      role: options.role,
      requestId: options.requestId,
      sessionId: existing.sessionId
    });
    if (lintReport !== null && !lintReport.ok) {
      const errorCount = lintReport.findings.filter((f) => f.severity === 'error').length;
      if (errorCount > 0) {
        throw new LintGateError(options.role, options.newState, errorCount);
      }
    }
  }

  // File size gate: when RD declares implemented, scan for oversized files (karpathy-skills "Simplicity First")
  if (options.role === 'rd' && options.newState === 'implemented' && options.allowIncomplete !== true) {
    const sizeResult = scanFileSize({ projectRoot: options.projectRoot });
    if (!sizeResult.ok) {
      throw new FileSizeViolationError(sizeResult.violations, sizeResult.threshold);
    }
  }

  const clock = options.clock ?? defaultClock;
  const timestamp = clock();
  const bypassNote = !prerequisiteResult.ok && options.allowIncomplete === true
    ? `bypassed prerequisites (${prerequisiteResult.missing.map((entry) => entry.path).join(', ')})`
    : undefined;
  const combinedReason = [options.reason, bypassNote].filter((part): part is string => part !== undefined && part.length > 0).join(' | ');
  const reasonForNote = combinedReason.length > 0 ? combinedReason : undefined;
  const { updated, previousState } = updateStatusBlock(existing.content, options.newState, timestamp, reasonForNote);
  await writeFile(existing.path, updated, 'utf8');

  const result: TransitionRequestArtifactResult = {
    role: options.role,
    sessionId: existing.sessionId,
    requestId: options.requestId,
    path: existing.path,
    state: options.newState,
    requestType: existing.requestType,
    previousState,
    content: updated
  };
  if (existing.createdAt !== undefined) {
    result.createdAt = existing.createdAt;
  }
  if (!prerequisiteResult.ok && options.allowIncomplete === true) {
    result.bypassedPrerequisites = prerequisiteResult;
  }
  return result;
}
