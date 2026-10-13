import {
  checkPrerequisites,
  getPrerequisitesFor,
  type RequestType
} from './artifact-prerequisites.js';
import {
  ALLOWED_STATES_PER_ROLE,
  type RequestArtifactState
} from './request-artifact-state-helpers.js';
import type { RequestArtifactRole } from './artifact-templates.js';

const ROLES = Object.keys(ALLOWED_STATES_PER_ROLE) as RequestArtifactRole[];

export type DemandRow = {
  role: RequestArtifactRole;
  state: RequestArtifactState;
  /** The table's own `relativePath` values, `<rid>` still unsubstituted. */
  paths: ReadonlyArray<string>;
};

/**
 * Every row of `requestType`'s table that demands at least one artifact, in role
 * then state declaration order. This is the answer to "which prerequisite table
 * is being applied" that does not require opening `artifact-prerequisites.ts`.
 */
export function demandRows(requestType: RequestType): DemandRow[] {
  const rows: DemandRow[] = [];
  for (const role of ROLES) {
    for (const state of ALLOWED_STATES_PER_ROLE[role]) {
      const paths = getPrerequisitesFor(role, state, requestType).map(
        (entry) => entry.relativePath
      );
      if (paths.length > 0) rows.push({ role, state, paths });
    }
  }
  return rows;
}

function demandPaths(requestType: RequestType): Set<string> {
  const paths = new Set<string>();
  for (const row of demandRows(requestType)) {
    for (const path of row.paths) paths.add(path);
  }
  return paths;
}

export type DemandDelta = {
  /** Demanded by `to` and not by `from`. */
  added: string[];
  /** Demanded by `from` and not by `to`. */
  removed: string[];
};

/** The artifacts a type change starts demanding, and stops demanding. */
export function demandDelta(from: RequestType, to: RequestType): DemandDelta {
  const before = demandPaths(from);
  const after = demandPaths(to);
  return {
    added: [...after].filter((path) => !before.has(path)),
    removed: [...before].filter((path) => !after.has(path))
  };
}

/**
 * The artifacts `requestType` demands that are not on disk right now.
 *
 * Deliberately NOT restricted to the paths a retag just added. A request that
 * recorded no type and is retagged to the effective type it already had — the
 * commonest retag there is — changes nothing in the demand set, so a delta-only
 * answer would be empty on exactly the input this check exists for.
 *
 * Answered with `checkPrerequisites` — the same resolver the transition gate
 * runs — rather than a second path probe, so a retag cannot report a file
 * present that the next transition would refuse. The rows also carry a
 * declaration check against the PRD capsule; the result is filtered to the
 * table's own paths, because that failure is not the type's. `emitEvents: false`
 * because nothing transitions here.
 */
export async function unsatisfiedDemand(options: {
  projectRoot: string;
  sessionId: string;
  requestId: string;
  requestType: RequestType;
}): Promise<string[]> {
  const wanted = new Set(
    [...demandPaths(options.requestType)].map((path) => path.replace('<rid>', options.requestId))
  );
  const missing = new Set<string>();
  for (const row of demandRows(options.requestType)) {
    const result = await checkPrerequisites({
      projectRoot: options.projectRoot,
      sessionId: options.sessionId,
      role: row.role,
      newState: row.state,
      requestId: options.requestId,
      requestType: options.requestType,
      emitEvents: false
    });
    for (const entry of result.missing) {
      if (wanted.has(entry.path)) missing.add(entry.path);
    }
  }
  return [...missing];
}
