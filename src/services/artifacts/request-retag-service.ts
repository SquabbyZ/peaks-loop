import { writeFile } from 'node:fs/promises';

import type { RequestType } from './artifact-prerequisites.js';
import { extractMetadata, type RequestTypeSource } from './request-artifact-metadata.js';
import { demandDelta, unsatisfiedDemand } from './request-type-demand.js';
import { showRequestArtifact, type RequestArtifactRole } from './request-artifact-service.js';

const TYPE_LINE_RE = /^-\s*type:\s*(.+?)\s*$/;
const SESSION_LINE_RE = /^-\s*session:\s*/;
const HEADING_RE = /^#\s/;

export type RequestTypeChange = {
  readonly from: RequestType;
  readonly fromSource: RequestTypeSource;
  readonly to: RequestType;
};

export type RetagImpact = {
  /** Paths the new type demands and the old one did not. */
  readonly added: ReadonlyArray<string>;
  /** Paths the old type demanded and the new one does not. */
  readonly removed: ReadonlyArray<string>;
  /** Everything the new type's table demands that is not on disk, added or not. */
  readonly missing: ReadonlyArray<string>;
};

export type RetagRequestArtifactOptions = {
  projectRoot: string;
  role: RequestArtifactRole;
  requestId: string;
  requestType: RequestType;
  /**
   * Required. Omitting it made `showRequestArtifact` resolve the first session
   * holding a matching rid, so a WRITE verb could mutate an artifact nobody
   * named. A write has to say which one.
   */
  sessionId: string;
  clock?: () => string;
};

export type RetagRequestArtifactResult = {
  role: RequestArtifactRole;
  requestId: string;
  sessionId: string;
  path: string;
  change: RequestTypeChange;
  impact: RetagImpact;
  /** The durable line appended to the artifact body; see `appendRetagNote`. */
  note: string;
  content: string;
};

function defaultClock(): string {
  return new Date().toISOString();
}

/**
 * Rewrite the artifact's type, changing the line the READER would take.
 * `extractMetadata` scans every top-level `- type:` line and keeps the last
 * usable one, so the writer targets the last line regardless of validity: if the
 * last is a placeholder and an earlier one is real, the rewrite lands on the
 * placeholder, which then becomes the usable one — the same line the reader
 * picks up either way. With no such line at all (the shape a hand-written
 * carrier has) one is inserted into the metadata block.
 *
 * The one other change it makes: lines are split on `\r?\n` and rejoined with
 * `\n`, so a CRLF body comes back LF-terminated. Reproduced by an independent
 * reviewer; named rather than implied.
 */
export function setRequestTypeInBody(markdown: string, requestType: RequestType): string {
  const lines = markdown.split(/\r?\n/);
  let target = -1;
  for (const [index, raw] of lines.entries()) {
    if (TYPE_LINE_RE.test(raw.trim())) target = index;
  }
  if (target >= 0) {
    lines[target] = `- type: ${requestType}`;
    return lines.join('\n');
  }
  lines.splice(insertionIndex(lines), 0, `- type: ${requestType}`);
  return lines.join('\n');
}

/** After the `- session:` line the templates write, else below the title, else first. */
function insertionIndex(lines: ReadonlyArray<string>): number {
  const sessionIndex = lines.findIndex((raw) => SESSION_LINE_RE.test(raw.trim()));
  if (sessionIndex >= 0) return sessionIndex + 1;
  const headingIndex = lines.findIndex((raw) => HEADING_RE.test(raw));
  if (headingIndex < 0) return 0;
  let index = headingIndex + 1;
  while (index < lines.length && lines[index]?.trim() === '') index += 1;
  return index;
}

/**
 * The durable record of a retag, appended rather than rewritten so a later retag
 * — or a transition's own `- transition note` — leaves every earlier one intact.
 *
 * It exists because the type line itself is overwritten and the difference it
 * makes is not cosmetic: retagging down (`feature` → `chore`) stops nine
 * artifacts being demanded. Without a line like this the only visible trace of
 * that would be the envelope of the run that did it, and the artifact tree lives
 * under a gitignored directory. Same idiom as `updateStatusBlock`'s note.
 */
export function appendRetagNote(
  markdown: string,
  change: RequestTypeChange,
  timestamp: string
): string {
  const body = markdown.replace(/\n+$/, '');
  return `${body}\n- retag note (${timestamp}): ${change.from} (${change.fromSource}) -> ${change.to}\n`;
}

export async function retagRequestArtifact(
  options: RetagRequestArtifactOptions
): Promise<RetagRequestArtifactResult | null> {
  const existing = await showRequestArtifact({
    projectRoot: options.projectRoot,
    role: options.role,
    requestId: options.requestId,
    sessionId: options.sessionId
  });
  if (existing === null) return null;

  const from = extractMetadata(existing.content).requestType;
  const change: RequestTypeChange = {
    from,
    fromSource: existing.requestTypeSource,
    to: options.requestType
  };
  const delta = demandDelta(from, options.requestType);
  // Measured before the write: a probe that throws must leave the type as it was.
  const missing = await unsatisfiedDemand({
    projectRoot: options.projectRoot,
    sessionId: existing.sessionId,
    requestId: options.requestId,
    requestType: options.requestType
  });

  const timestamp = (options.clock ?? defaultClock)();
  const note = `- retag note (${timestamp}): ${change.from} (${change.fromSource}) -> ${change.to}`;
  const content = appendRetagNote(
    setRequestTypeInBody(existing.content, options.requestType),
    change,
    timestamp
  );
  await writeFile(existing.path, content, 'utf8');

  return {
    role: options.role,
    requestId: options.requestId,
    sessionId: existing.sessionId,
    path: existing.path,
    change,
    impact: {
      added: delta.added.map((path) => path.replace('<rid>', options.requestId)),
      removed: delta.removed.map((path) => path.replace('<rid>', options.requestId)),
      missing
    },
    note,
    content
  };
}

/** The envelope lines a retag reports, so the change is not silent. */
export function describeRetag(result: RetagRequestArtifactResult): string[] {
  const { change, impact } = result;
  const lines = [
    change.fromSource === 'default'
      ? `request type was the default '${change.from}' (the artifact recorded no type); it is now '${change.to}'.`
      : `request type '${change.from}' is now '${change.to}'.`
  ];
  if (impact.added.length > 0) {
    lines.push(`now demanded (${impact.added.length}): ${impact.added.join(', ')}.`);
  }
  if (impact.removed.length > 0) {
    lines.push(`no longer demanded (${impact.removed.length}): ${impact.removed.join(', ')}.`);
  }
  if (impact.missing.length > 0) {
    lines.push(
      `unsatisfied at '${change.to}' (${impact.missing.length} not on disk): ${impact.missing.join(', ')} — the next gate reads the new table and will refuse until they exist.`
    );
  }
  return lines;
}
