// The artifact contract block a dispatched sub-agent receives: for its own role
// and the request's type, every artifact the prerequisite gate will demand and
// the literal body markers each one must carry.
//
// Generated from the table the gate reads (`getPrerequisitesFor`), never from a
// second hand-written list: the markers are matched as case-insensitive
// substrings of the artifact body, so a list kept in prose drifts the moment a
// marker changes and the gate then refuses a producer it never told.
import {
  DEFAULT_REQUEST_TYPE,
  getPrerequisitesFor,
  type ArtifactPrerequisite,
  type RequestType
} from './artifact-prerequisites.js';
import {
  ALLOWED_STATES_PER_ROLE,
  type RequestArtifactState
} from './request-artifact-state-helpers.js';
import { extractMetadata, type RequestTypeSource } from './request-artifact-metadata.js';
import { REQUEST_ID_PATTERN, showRequestArtifact } from './request-artifact-service.js';
import { isUnsafePathInput } from '../../shared/path-safety.js';
import type { RequestArtifactRole } from './artifact-templates.js';

/** Roles whose request artifact may carry a `- type:` line, in search order. */
const TYPE_SOURCE_ROLES: readonly RequestArtifactRole[] = ['rd', 'prd', 'qa', 'ui', 'sc'];

/** True for the five roles the state table is keyed on. */
function isRequestArtifactRole(role: string): role is RequestArtifactRole {
  return Object.prototype.hasOwnProperty.call(ALLOWED_STATES_PER_ROLE, role);
}

/**
 * The prerequisite's path with the request id substituted for its `<rid>`.
 *
 * Deliberately NOT exported. A test that called this would no longer be
 * independent of the renderer it checks, and that independence is the whole
 * value of the pinning case.
 */
function resolveContractPath(prerequisite: ArtifactPrerequisite, requestId: string): string {
  return prerequisite.relativePath.replace('<rid>', requestId);
}

function quoteAll(markers: readonly string[]): string {
  return markers.map((marker) => `\`${marker}\``).join(', ');
}

/**
 * The marker fields, in the order the block renders them. A table rather than a
 * chain of `if`s: the three fields are independent and uniform, so listing them
 * keeps the renderer's complexity flat as the vocabulary grows.
 */
const MARKER_CLAUSES: ReadonlyArray<{
  markers: (prerequisite: ArtifactPrerequisite) => ReadonlyArray<string> | undefined;
  label: string;
}> = [
  { markers: (candidate) => candidate.mustContain, label: 'must contain' },
  { markers: (candidate) => candidate.mustContainAny, label: 'must contain at least one of' },
  {
    markers: (candidate) => candidate.headingMustContain,
    label: 'must appear as markdown headings'
  }
];

/**
 * One line's worth of "what this file must carry", or the explicit statement
 * that there is nothing to carry. `mustContainAny` is rendered as an
 * alternative set rather than as three requirements — the gate passes on one.
 */
function describePrerequisite(prerequisite: ArtifactPrerequisite): string {
  const clauses = MARKER_CLAUSES.flatMap(({ markers, label }) => {
    const list = markers(prerequisite) ?? [];
    return list.length === 0 ? [] : [`${label}: ${quoteAll(list)}`];
  });
  if (prerequisite.backCompat === true) {
    const until = prerequisite.backCompatUntil ?? 'the window closes';
    clauses.push(`a missing file only warns until ${until}`);
  }
  return clauses.length === 0 ? 'the file must exist; it has no body markers' : clauses.join('; ');
}

/**
 * The command that reaches a state, spelled with every option
 * `src/cli/commands/request-transition-command.ts` registers as MANDATORY.
 * `--project` is one of them, and an earlier revision of this line omitted it —
 * the prompt therefore handed the producer a command the CLI refuses for a
 * missing option, which is this block's own defect class turned on itself. The
 * pinning test now compares the emitted options against the command's own
 * `mandatory` set, so a newly required flag fails the suite rather than reaching
 * a prompt. `.` because a dispatched sub-agent's working directory is the
 * project root.
 */
function transitionCommand(
  role: RequestArtifactRole,
  state: RequestArtifactState,
  requestId: string
): string {
  return `peaks request transition ${requestId} --role ${role} --state ${state} --project .`;
}

type StateRow = { state: RequestArtifactState; text: string };

function renderStateRow(
  role: RequestArtifactRole,
  state: RequestArtifactState,
  prerequisites: ReadonlyArray<ArtifactPrerequisite>,
  requestId: string
): StateRow {
  const lines = prerequisites.map(
    (entry) => `- \`${resolveContractPath(entry, requestId)}\` — ${describePrerequisite(entry)}`
  );
  const reached = transitionCommand(role, state, requestId);
  return {
    state,
    text: `\nAt \`${role}:${state}\` (reached with \`${reached}\`):\n${lines.join('\n')}\n`
  };
}

/**
 * One row per state of `role` that demands at least one artifact under
 * `requestType`. A state with an empty row (`rd:implemented` for a feature, for
 * instance) is left out rather than rendered as "nothing required" — the block
 * is a list of obligations, and a state with none is not an obligation.
 */
function stateRows(role: string, requestType: RequestType, requestId: string): StateRow[] {
  if (!isRequestArtifactRole(role)) return [];
  const rows: StateRow[] = [];
  for (const state of ALLOWED_STATES_PER_ROLE[role]) {
    const prerequisites = getPrerequisitesFor(role, state, requestType);
    if (prerequisites.length === 0) continue;
    rows.push(renderStateRow(role, state, prerequisites, requestId));
  }
  return rows;
}

const BODY_RULE =
  'The gate matches each marker below as a case-insensitive substring of the artifact body, and a ' +
  'heading marker must be a real markdown heading. Content under a different spelling is refused, ' +
  'so write the marker literally. Paths are relative to `.peaks/_runtime/<session-id>/`.';

/**
 * The scope bound, always true of the block regardless of what the gate does:
 * it says what the rows ARE (necessary) and not what they are not (sufficient).
 */
const SCOPE_BASE =
  'This block is generated from the prerequisite table alone, so the rows below are necessary and are ' +
  'not a complete contract.';

/**
 * The addendum for a state the gate really does guard with more than the table.
 * Measured on a probe project and again on this slice's own rid: an artifact set
 * satisfying every `rd:qa-handoff` row was still refused once, on a declaration
 * outside the table. The earlier wording said a gate "may also check something
 * the table does not carry", which under-claims a systematic gap at exactly the
 * state this block guides a producer to.
 */
const SCOPE_HANDOFF =
  ' At `rd:qa-handoff` the gate also runs checks that are not rows of this table, so satisfying every ' +
  'row below does not by itself open that transition.';

const ARTIFACT_CONTRACT_HEADING = '## Artifact contract (generated from the prerequisite table)';

/**
 * The block, or `''` when this role has nothing gated to say under this type.
 * The empty string is the whole byte-identity contract: callers concatenate it,
 * and a role with no gated artifacts must add zero bytes to the prompt.
 */
export function buildArtifactContractBlock(input: {
  role: string;
  requestType: RequestType;
  requestTypeSource: RequestTypeSource;
  requestId: string;
}): string {
  const rows = stateRows(input.role, input.requestType, input.requestId);
  if (rows.length === 0) return '';
  const typeLine =
    input.requestTypeSource === 'declared'
      ? `request type \`${input.requestType}\` (recorded by a \`- type:\` line)`
      : `request type \`${input.requestType}\` — the DEFAULT, not a recorded choice: this request ` +
        'records no `- type:` line, so the gate applies the default table. If the work is really a ' +
        'different type, the demand set below is the wrong one';
  // Conditional on the ROWS, not on a hand-written type list: whichever types
  // render an `rd:qa-handoff` row are exactly the ones the extra checks run for.
  const guardedHandoff = input.role === 'rd' && rows.some((row) => row.state === 'qa-handoff');
  return (
    `\n${ARTIFACT_CONTRACT_HEADING}\n` +
    `Role \`${input.role}\`, ${typeLine}.\n` +
    `${BODY_RULE}\n` +
    `${SCOPE_BASE}${guardedHandoff ? SCOPE_HANDOFF : ''}\n` +
    rows.map((row) => row.text).join('') +
    '\n'
  );
}

/**
 * Append the block unless the text already carries one.
 *
 * Idempotent for the same reason `ensureKarpathyBlock` is: a caller prompt can
 * already hold a copy — a re-dispatch, or a resume from a stored prompt — and
 * two sections can DISAGREE (the type may have been declared between the two
 * runs), so a reader cannot tell which contract is authoritative. The presence
 * test is the block's own heading, which nothing else emits.
 *
 * An empty block adds zero bytes even when the text already carries one, so an
 * unaffected dispatch stays byte-identical.
 */
export function ensureArtifactContractBlock(text: string, block: string): string {
  if (block.length === 0 || text.includes(ARTIFACT_CONTRACT_HEADING)) return text;
  return `${text}${block}`;
}

export type ArtifactTypeReading = {
  requestType: RequestType;
  requestTypeSource: RequestTypeSource;
};

/**
 * The type recorded for `requestId`, read through the same reader the rest of
 * the CLI uses. Every request artifact of the id is a candidate because the
 * dispatched role's own file frequently does not exist yet at dispatch time —
 * a dated snapshot over the dispatch records of the 2026-10-12 session (77 of
 * them at the time of writing, a count the session is still growing): 18 had any
 * request artifact for the id on disk before the dispatch and 10 had one that
 * declared a type — while a sibling role may have recorded the type already. A
 * `default` result is a real answer — nothing declared it.
 */
export async function readArtifactType(input: {
  projectRoot: string;
  sessionId: string;
  requestId: string;
  role: string;
}): Promise<ArtifactTypeReading> {
  const fallback: ArtifactTypeReading = {
    requestType: DEFAULT_REQUEST_TYPE,
    requestTypeSource: 'default'
  };
  if (isUnsafePathInput(input.sessionId) || !REQUEST_ID_PATTERN.test(input.requestId)) {
    return fallback;
  }
  const candidates: RequestArtifactRole[] = [];
  for (const candidate of [input.role, ...TYPE_SOURCE_ROLES]) {
    if (isRequestArtifactRole(candidate) && !candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  }
  for (const role of candidates) {
    const found = await showRequestArtifact({
      projectRoot: input.projectRoot,
      sessionId: input.sessionId,
      role,
      requestId: input.requestId
    });
    if (found === null) continue;
    const metadata = extractMetadata(found.content);
    if (metadata.requestTypeSource === 'declared') {
      return { requestType: metadata.requestType, requestTypeSource: 'declared' };
    }
  }
  return fallback;
}

/** The composed block for a dispatch, reading the type from disk first. */
export async function readArtifactContractBlock(input: {
  projectRoot: string;
  sessionId: string;
  requestId: string;
  role: string;
}): Promise<string> {
  const reading = await readArtifactType(input);
  return buildArtifactContractBlock({
    role: input.role,
    requestId: input.requestId,
    requestType: reading.requestType,
    requestTypeSource: reading.requestTypeSource
  });
}
