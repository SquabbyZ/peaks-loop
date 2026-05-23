import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathExists } from '../../shared/fs.js';

export type RequestArtifactRole = 'prd' | 'ui' | 'rd' | 'qa';

export type CreateRequestArtifactOptions = {
  role: RequestArtifactRole;
  requestId: string;
  projectRoot: string;
  sessionId?: string;
  apply?: boolean;
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
const VALID_ROLES: ReadonlySet<RequestArtifactRole> = new Set(['prd', 'ui', 'rd', 'qa']);

function defaultClock(): string {
  return new Date().toISOString();
}

function dateSlugFromIso(iso: string): string {
  return iso.slice(0, 10);
}

function defaultSessionId(iso: string): string {
  return `${dateSlugFromIso(iso)}-session`;
}

function renderPrdTemplate(requestId: string, sessionId: string, timestamp: string): string {
  return `# PRD Request ${requestId}

- session: ${sessionId}
- type: feature | bug | refactor | clarification
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

function renderUiTemplate(requestId: string, sessionId: string, timestamp: string): string {
  return `# UI Request ${requestId}

- session: ${sessionId}
- linked-prd: .peaks/${sessionId}/prd/requests/${requestId}.md
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

function renderRdTemplate(requestId: string, sessionId: string, timestamp: string): string {
  return `# RD Request ${requestId}

- session: ${sessionId}
- linked-prd: .peaks/${sessionId}/prd/requests/${requestId}.md
- linked-ui:  .peaks/${sessionId}/ui/requests/${requestId}.md  (when UI involved)
- type: feature | bug | refactor | clarification

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

function renderQaTemplate(requestId: string, sessionId: string, timestamp: string): string {
  return `# QA Request ${requestId}

- session: ${sessionId}
- linked-prd: .peaks/${sessionId}/prd/requests/${requestId}.md
- linked-rd:  .peaks/${sessionId}/rd/requests/${requestId}.md
- linked-ui:  .peaks/${sessionId}/ui/requests/${requestId}.md  (when UI involved)
- type: feature | bug | refactor | clarification

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

function renderTemplate(role: RequestArtifactRole, requestId: string, sessionId: string, timestamp: string): string {
  switch (role) {
    case 'prd':
      return renderPrdTemplate(requestId, sessionId, timestamp);
    case 'ui':
      return renderUiTemplate(requestId, sessionId, timestamp);
    case 'rd':
      return renderRdTemplate(requestId, sessionId, timestamp);
    case 'qa':
      return renderQaTemplate(requestId, sessionId, timestamp);
  }
}

export async function createRequestArtifact(options: CreateRequestArtifactOptions): Promise<CreateRequestArtifactResult> {
  if (!VALID_ROLES.has(options.role)) {
    throw new Error(`Invalid role: ${String(options.role)} (expected prd, ui, rd, or qa)`);
  }
  if (!REQUEST_ID_PATTERN.test(options.requestId)) {
    throw new Error(`Invalid request id: ${options.requestId} (expected letters, digits, dots, underscores, or dashes)`);
  }

  const clock = options.clock ?? defaultClock;
  const timestamp = clock();
  const sessionId = options.sessionId ?? defaultSessionId(timestamp);
  const path = join(
    options.projectRoot,
    '.peaks',
    sessionId,
    options.role,
    'requests',
    `${options.requestId}.md`
  );
  const content = renderTemplate(options.role, options.requestId, sessionId, timestamp);

  if (options.apply !== true) {
    return { role: options.role, requestId: options.requestId, sessionId, path, content, applied: false };
  }

  if (await pathExists(path)) {
    throw new Error(`Refusing to write: ${path} already exists. Update it in place or remove it before re-running peaks request init.`);
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
  return { role: options.role, requestId: options.requestId, sessionId, path, content, applied: true };
}
