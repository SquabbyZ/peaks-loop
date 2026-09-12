/**
 * S1 / rid=api-diff-report — `peaks scan api-diff <doc>` (design
 * `docs/superpowers/specs/2026-09-12-frontend-acl-contract-design.md` §2.1/§2.3).
 *
 * Read-only. Parses an OpenAPI 3.x document (JSON or YAML — `yaml` is already a
 * runtime dependency) and diffs it against the three sources a consumer project
 * already produces: `mock-plan.md`, the recorded `*-api.types.ts` interfaces,
 * and the TXT handoff's `## API Migration` endpoint list.
 *
 * TWO RULES GOVERN EVERY LINE BELOW (QA repair, rid=api-diff-report):
 *
 *   1. Each document LOCATION is diffed against the recorded interface that
 *      actually describes it. An operation has independent locations (path /
 *      query / requestBody / per-status response) and a `...Request` interface
 *      must never be compared against a response. No shared consumption across
 *      locations.
 *   2. Exactness requires BOTH sides to be fully known. Any uncertainty on the
 *      recorded side SUPPRESSES the exact claim and says so — it is never
 *      merely annotated. A half-readable interface silently invents
 *      `added-in-document` / `removed-from-document` lines.
 *
 * This is the public entrypoint; parsing (`api-diff-openapi`), the recorded
 * sources (`api-diff-recorded`) and the shared types (`api-diff-types`) live in
 * sibling modules and are re-exported here.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadApiDocument, normalizeType } from './api-diff-openapi.js';
import {
  MAX_CANDIDATE_NAMES,
  findHandoffWithApiMigration,
  findMockPlan,
  findRecordedInterfaceFiles,
  grepCandidateMentions,
  locationsForRole,
  normalizeEndpointPath,
  operationKey,
  pairingKey,
  parseHandoffEndpoints,
  parseRecordedInterfaces,
  roleOf
} from './api-diff-recorded.js';
import {
  ABSENT,
  NOT_DETECTABLE,
  toDisplayPath,
  type ApiDiffReport,
  type DocOperation,
  type EndpointEntry,
  type FieldEntry,
  type InterfaceRole,
  type RecordedEndpoint,
  type RecordedInterface
} from './api-diff-types.js';

// The public surface of the whole api-diff feature, so callers (and the CLI)
// need only ever import this one module.
export * from './api-diff-openapi.js';
export * from './api-diff-recorded.js';
export * from './api-diff-types.js';

const MAX_LISTED = 20;

/** Bounded comma list for a note. Notes are read by humans, so they must not be unbounded. */
function summarizeList(items: readonly string[]): string {
  if (items.length === 0) return '(none)';
  if (items.length <= MAX_LISTED) return items.join(', ');
  return `${items.slice(0, MAX_LISTED).join(', ')}, +${items.length - MAX_LISTED} more`;
}

/** `GET /api/users/{id} response.200`, the unit a note has to be able to name. */
function locationLabel(operation: DocOperation, location: string): string {
  return `${operation.method.toUpperCase()} ${operation.path} ${location}`;
}

// ---------------------------------------------------------------------------
// The diff
// ---------------------------------------------------------------------------

/**
 * Diffs ONE document location against ONE recorded interface.
 *
 * No state is shared between calls: an interface is only ever compared against
 * locations of its own role, so a member consumed at a response location can no
 * longer hide a request field (or vice versa).
 */
function compareLocation(
  operation: DocOperation,
  location: string,
  members: Map<string, string>,
  out: FieldEntry[]
): void {
  const docFields = operation.locations.get(location)!;
  const recordedNormalized = new Map<string, string>();
  for (const [name, type] of members) recordedNormalized.set(name, normalizeType(type));

  const docOnly: string[] = [];
  const recordedOnly: string[] = [];
  const consumedDoc = new Set<string>();
  const consumedRecorded = new Set<string>();

  // Pass 1 — same name on both sides.
  for (const [name, type] of docFields) {
    const before = recordedNormalized.get(name);
    if (before === undefined) {
      docOnly.push(name);
      continue;
    }
    consumedDoc.add(name);
    consumedRecorded.add(name);
    const after = normalizeType(type);
    if (before !== after) {
      out.push({
        confidence: 'exact', kind: 'changed', via: 'type-changed', method: operation.method,
        path: operation.path, location, before: { field: name, type: before }, after: { field: name, type: after }
      });
    }
  }
  for (const name of recordedNormalized.keys()) {
    if (!docFields.has(name)) recordedOnly.push(name);
  }

  // Pass 2 — rename pairing for the leftovers, and ONLY when the type is
  // identical and each side offers exactly one such candidate. Ambiguity is
  // left alone: a guessed pairing is invisible, an unpaired field is not.
  for (const docName of docOnly) {
    const docType = normalizeType(docFields.get(docName)!);
    const docCandidates = docOnly.filter((other) => normalizeType(docFields.get(other)!) === docType);
    const recordedCandidates = recordedOnly.filter((other) => recordedNormalized.get(other) === docType);
    if (docCandidates.length !== 1 || recordedCandidates.length !== 1) continue;
    const recordedName = recordedCandidates[0]!;
    consumedDoc.add(docName);
    consumedRecorded.add(recordedName);
    out.push({
      confidence: 'exact', kind: 'changed', via: 'renamed', method: operation.method,
      path: operation.path, location, before: { field: recordedName, type: docType },
      after: { field: docName, type: docType }
    });
  }

  // Pass 3 — genuine one-sided fields are change sites, not silence.
  for (const docName of docOnly) {
    if (consumedDoc.has(docName)) continue;
    consumedDoc.add(docName);
    out.push({
      confidence: 'exact', kind: 'changed', via: 'added-in-document', method: operation.method,
      path: operation.path, location, before: { field: docName, type: ABSENT },
      after: { field: docName, type: normalizeType(docFields.get(docName)!) }
    });
  }
  for (const recordedName of recordedOnly) {
    if (consumedRecorded.has(recordedName)) continue;
    consumedRecorded.add(recordedName);
    out.push({
      confidence: 'exact', kind: 'changed', via: 'removed-from-document', method: operation.method,
      path: operation.path, location, before: { field: recordedName, type: recordedNormalized.get(recordedName)! },
      after: { field: recordedName, type: ABSENT }
    });
  }
}

/** Endpoint-level diff. Both sides parsed; `{id}` and `:id` are normalised to one spelling first. */
function diffEndpoints(operations: readonly DocOperation[], recorded: readonly RecordedEndpoint[]): EndpointEntry[] {
  const endpoints: EndpointEntry[] = [];
  if (recorded.length === 0) return endpoints;
  const key = (method: string, path: string): string => `${method} ${normalizeEndpointPath(path)}`;
  const recordedKeys = new Set(recorded.map((entry) => key(entry.method, entry.path)));
  const documentKeys = new Set<string>();
  for (const operation of operations) {
    const current = key(operation.method, operation.path);
    documentKeys.add(current);
    if (!recordedKeys.has(current)) {
      endpoints.push({ confidence: 'exact', kind: 'added', method: operation.method, path: operation.path });
    }
  }
  for (const entry of recorded) {
    if (!documentKeys.has(key(entry.method, entry.path))) {
      endpoints.push({ confidence: 'exact', kind: 'removed', method: entry.method, path: entry.path });
    }
  }
  return endpoints;
}

/**
 * Why nothing paired, what the convention actually is, and which link is
 * missing — said with THIS document's own names so the fix is mechanical.
 * Deliberately no path-based or fuzzy fallback: a confident wrong pairing is
 * worse than an honest non-pairing, and the Exact label rests on that.
 */
function unpairedNote(operations: readonly DocOperation[], interfaces: readonly RecordedInterface[]): string {
  const operationIds = [
    ...new Set(operations.map((operation) => operation.operationId).filter((id): id is string => id !== undefined))
  ];
  const exampleId = operationIds[0];
  const convention = exampleId === undefined
    ? 'this document declares no `operationId`, so the pairing key falls back to `<method><path>`'
    : `operationId \`${exampleId}\` would pair with an interface named \`${exampleId.charAt(0).toUpperCase()}${exampleId.slice(1)}Response\``;
  return `0 of ${interfaces.length} recorded interface(s) paired with a document operation, so no field-level exact diff was produced. `
    + `Pairing is name-only — lowercased, punctuation stripped, one trailing Response/Request/Dto/Payload/Body removed — so ${convention}. `
    + `Document operationIds: ${summarizeList(operationIds)}. `
    + `Unpaired interfaces: ${summarizeList(interfaces.map((iface) => iface.name))}. `
    + 'Rename one side so the two names match; this command will not guess a pairing.';
}

export function diffApiDocument(input: { projectRoot: string; docPath: string }): ApiDiffReport {
  // The doc path is the user's own argument, so a relative one resolves against
  // the process CWD — the shell convention. `--project` scopes the analysis; it
  // must NOT re-root the argument, which produced doubled paths such as
  // `<project>/<project>/docs/api.json`.
  const projectRoot = resolve(input.projectRoot);
  const docPath = resolve(input.docPath);
  const document = loadApiDocument(docPath);

  const notes: string[] = [];
  const mockPlan = findMockPlan(projectRoot);
  if (mockPlan === null) {
    notes.push('no mock-plan.md found under .peaks/_runtime/*/rd/ — mock file paths are unknown.');
  }

  const interfaceFiles = findRecordedInterfaceFiles(projectRoot, mockPlan);
  const interfaces: RecordedInterface[] = [];
  for (const file of interfaceFiles) {
    try {
      interfaces.push(...parseRecordedInterfaces(readFileSync(file, 'utf8'), file));
    } catch (error) {
      notes.push(`could not read recorded interface file ${toDisplayPath(projectRoot, file)}: ${(error as Error).message}`);
    }
  }
  if (interfaces.length === 0) {
    notes.push('no recorded interfaces found — exact field diff limited to document-internal changes.');
  }

  const handoff = findHandoffWithApiMigration(projectRoot);
  const recordedEndpoints = handoff === null ? [] : parseHandoffEndpoints(readFileSync(handoff, 'utf8'));
  if (handoff === null) {
    notes.push('no TXT handoff with an `## API Migration` section found under .peaks/_runtime/*/txt/ — no recorded endpoint list to diff endpoints against.');
  } else if (recordedEndpoints.length === 0) {
    notes.push(`the \`## API Migration\` section in ${toDisplayPath(projectRoot, handoff)} lists no \`METHOD /path\` endpoint — no recorded endpoint list to diff endpoints against.`);
  }

  // Pairing is by name AND by role. An operation may legitimately pair with two
  // interfaces — one `...Request` and one `...Response` — so a name collision is
  // only ambiguous within a single role.
  const byKey = new Map<string, RecordedInterface[]>();
  for (const iface of interfaces) {
    const key = pairingKey(iface.name);
    byKey.set(key, [...(byKey.get(key) ?? []), iface]);
  }

  const fields: FieldEntry[] = [];
  const matchedInterfaces = new Set<RecordedInterface>();
  const coveredLocations = new Set<string>();
  const suppressedInterfaces = new Map<RecordedInterface, string>();
  const operationsWithRecords = new Set<DocOperation>();
  const pairedWithoutLocation: string[] = [];
  const incompleteLocations: string[] = [];
  const unpairedOperations: string[] = [];

  for (const operation of document.operations) {
    const candidates = byKey.get(operationKey(operation)) ?? [];
    if (candidates.length === 0) {
      unpairedOperations.push(`${operation.method.toUpperCase()} ${operation.path}`);
      continue;
    }
    for (const candidate of candidates) matchedInterfaces.add(candidate);

    const byRole = new Map<InterfaceRole, RecordedInterface[]>();
    for (const candidate of candidates) {
      const role = roleOf(candidate.name);
      byRole.set(role, [...(byRole.get(role) ?? []), candidate]);
    }

    const where = `${operation.method.toUpperCase()} ${operation.path}`;
    for (const [role, list] of byRole) {
      if (role === 'unknown') {
        notes.push(`${where}: recorded interface(s) ${list.map((iface) => `\`${iface.name}\``).join(', ')} name neither a request nor a response, so this command cannot tell which part of the operation they describe — pairing refused rather than guessed; their fields are not in the exact diff.`);
        continue;
      }
      if (list.length > 1) {
        notes.push(`${where}: ${list.length} recorded ${role} interfaces match (${list.map((iface) => `\`${iface.name}\``).join(', ')}) — pairing refused rather than guessed; their fields are not in the exact diff.`);
        continue;
      }
      const iface = list[0]!;
      if (iface.incompleteReason !== null) {
        suppressedInterfaces.set(iface, iface.incompleteReason);
        continue;
      }
      const roleLocations = locationsForRole(operation, role);
      // A response interface's name carries no status, so with more than one
      // JSON response body there is no way to know which one it describes.
      if (role === 'response' && roleLocations.length > 1) {
        notes.push(`${where}: ${roleLocations.length} response statuses have JSON bodies (${roleLocations.map((location) => location.slice('response.'.length)).join(', ')}) and \`${iface.name}\` names no status, so this command cannot tell which one it describes — pairing refused rather than guessed; its fields are not in the exact diff.`);
        continue;
      }
      operationsWithRecords.add(operation);
      if (roleLocations.length === 0) {
        // A pairing that yields no location must still be named, or it is a
        // silent hole: the interface looks consumed and nothing was diffed.
        pairedWithoutLocation.push(`${where} (recorded \`${iface.name}\` describes the ${role === 'request' ? 'requestBody' : 'responses'})`);
        continue;
      }
      for (const location of roleLocations) {
        const label = locationLabel(operation, location);
        coveredLocations.add(label);
        // The doc-side half of the inverted rule: a location the DOC reader
        // could not fully account for is suppressed, because a partial field set
        // is indistinguishable from a complete one.
        const issue = operation.locationIssues.get(location);
        if (issue !== undefined) {
          incompleteLocations.push(`${label} (${issue})`);
          continue;
        }
        compareLocation(operation, location, iface.members, fields);
      }
    }
  }

  if (interfaces.length > 0) {
    if (matchedInterfaces.size === 0) {
      notes.push(unpairedNote(document.operations, interfaces));
    } else if (unpairedOperations.length > 0) {
      // A MIX must never be silent: one paired operation used to be enough for
      // the document to report "(no exact differences)" with no note at all.
      notes.push(`${unpairedOperations.length} document operation(s) matched no recorded interface, so their fields are not in the exact diff: ${summarizeList(unpairedOperations)}. Interfaces pair by name: operationId \`getUser\` pairs with an interface named \`GetUserResponse\`.`);
    }
  }
  if (incompleteLocations.length > 0) {
    notes.push(`${incompleteLocations.length} document location(s) could not be fully read, so every exact line for them is suppressed rather than guessed: ${summarizeList(incompleteLocations)}.`);
  }
  if (suppressedInterfaces.size > 0) {
    // The file is named too: a whole-file structural failure otherwise reads as
    // one stray interface, and the reader has no idea where to look.
    const listed = [...suppressedInterfaces]
      .map(([iface, reason]) => `\`${iface.name}\` in ${toDisplayPath(projectRoot, iface.file)} (${reason})`)
      .join('; ');
    notes.push(`${suppressedInterfaces.size} recorded interface(s) are not fully readable even though the file parsed, so every exact line they would have produced is suppressed rather than guessed: ${summarizeList([listed])}.`);
  }
  if (pairedWithoutLocation.length > 0) {
    notes.push(`${pairedWithoutLocation.length} recorded interface(s) paired with an operation that declares no matching location, so no exact line was produced for them: ${summarizeList(pairedWithoutLocation)}.`);
  }
  if (operationsWithRecords.size > 0) {
    const uncovered: string[] = [];
    for (const operation of operationsWithRecords) {
      for (const location of operation.locations.keys()) {
        // Only locations a body interface can actually describe. Path/query
        // params are structurally never recorded, so flagging them would fire
        // on nearly every operation and teach the reader to skip notes.
        if (location !== 'request' && !location.startsWith('response.')) continue;
        if (!coveredLocations.has(locationLabel(operation, location))) {
          uncovered.push(locationLabel(operation, location));
        }
      }
    }
    if (uncovered.length > 0) {
      notes.push(`${uncovered.length} document location(s) have no recorded interface of the matching role, so no exact line was produced for them: ${summarizeList(uncovered)}.`);
    }
  }

  // Candidate names come from the DIFF, never from "everything not verified
  // unchanged": grepping a field that did not change is pure noise, and a
  // section whose every line is noise trains the reader to ignore the section —
  // the exact failure this feature exists to prevent. A changed field
  // contributes BOTH spellings, because the old name is what the current code
  // still says; a one-sided field contributes only the side that exists.
  const candidateNames = new Set<string>();
  for (const entry of fields) {
    if (entry.before.type !== ABSENT) candidateNames.add(entry.before.field);
    if (entry.after.type !== ABSENT) candidateNames.add(entry.after.field);
  }
  const { mentions, truncated, hitsTruncated } = grepCandidateMentions(projectRoot, [...candidateNames], [docPath]);
  if (truncated) {
    notes.push(`candidate names capped at ${MAX_CANDIDATE_NAMES}; some changed fields were not name-grepped.`);
  }
  if (hitsTruncated) {
    notes.push('candidate hits are capped per name; some change-site lines were not listed, so treat those lists as examples rather than the full set.');
  }
  if (fields.length === 0) {
    // Only claim "nothing was parsed" when that is actually the case — after a
    // suppression the interface WAS parsed, and saying otherwise misdirects.
    notes.push(interfaces.length === 0
      ? 'no candidate change-sites: change-site lookup needs a parsed recorded interface to know what changed.'
      : 'no candidate change-sites: no exact field change was produced (see the notes above), so there is nothing to search for.');
  } else if (mentions.length === 0) {
    notes.push('name-grep found no mentions of the changed names in this project.');
  }

  return {
    document: {
      file: toDisplayPath(projectRoot, docPath),
      openapi: document.openapi,
      title: document.title ?? null,
      operationCount: document.operations.length
    },
    exact: { endpoints: diffEndpoints(document.operations, recordedEndpoints), fields },
    candidates: mentions,
    sources: {
      mockPlan: mockPlan === null ? null : toDisplayPath(projectRoot, mockPlan),
      interfaceFiles: interfaceFiles.map((file) => toDisplayPath(projectRoot, file)),
      handoff: handoff === null ? null : toDisplayPath(projectRoot, handoff),
      recordedEndpoints: recordedEndpoints.length
    },
    notes,
    notDetectable: NOT_DETECTABLE
  };
}

// ---------------------------------------------------------------------------
// Text rendering
// ---------------------------------------------------------------------------

function renderFieldLine(entry: FieldEntry): string {
  const beforeRef = entry.before.field === entry.after.field
    ? `${entry.location}.${entry.before.field}`
    : `${entry.location}.${entry.before.field} -> ${entry.location}.${entry.after.field}`;
  return `  ${'CHANGED'.padEnd(9)} ${entry.method.toUpperCase()} ${entry.path}   ${beforeRef}   ${entry.before.type} -> ${entry.after.type}`;
}

export function formatApiDiffText(report: ApiDiffReport): string {
  const lines: string[] = [];
  // The header names the two parsed sides; the parenthetical fixes the direction
  // of every `before -> after` line, which is otherwise ambiguous.
  lines.push('Exact — document parsed vs recorded interfaces parsed (CHANGED reads recorded -> document)');
  if (report.exact.endpoints.length === 0 && report.exact.fields.length === 0) {
    lines.push('  (no exact differences)');
  }
  for (const entry of report.exact.endpoints) {
    lines.push(`  ${(entry.kind === 'added' ? 'ADDED' : 'REMOVED').padEnd(9)} ${entry.method.toUpperCase()} ${entry.path}`);
  }
  for (const entry of report.exact.fields) lines.push(renderFieldLine(entry));
  for (const note of report.notes) lines.push(`  note: ${note}`);

  lines.push('');
  lines.push('Candidate mentions — name-grep, may OVER- and UNDER-report');
  if (report.candidates.length === 0) {
    lines.push('  (none)');
  }
  for (const mention of report.candidates) {
    const where = mention.hits.map((hit) => `${hit.file}:${hit.line}`).join('   ');
    lines.push(`  ${mention.name}   ${where}`);
  }

  lines.push('');
  lines.push('Not detectable by this command');
  for (const item of report.notDetectable) lines.push(`  - ${item}`);
  return lines.join('\n');
}
