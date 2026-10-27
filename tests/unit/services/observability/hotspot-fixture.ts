// tests/unit/services/observability/hotspot-fixture.ts
//
// The shared fixture for the hotspot tests: a session's metrics file written
// to a REAL temp tree and read back through the repository's own reader, so
// the shapes under test are the shapes on disk.
//
// WHY A SEPARATE FIXTURE MODULE. The hotspot suite covers two subjects — the
// ranking itself and the grouping by what each row's count counts — and the two
// live in two test files. Duplicating the fixture would put the same lines in
// both, and a copy that drifts is a copy that lies.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  getPrerequisitesFor,
  type RequestType
} from '~/src/services/artifacts/artifact-prerequisites.js';
import type { RequestArtifactRole } from '~/src/services/artifacts/artifact-templates.js';
import type { RequestArtifactState } from '~/src/services/artifacts/request-artifact-state-helpers.js';
import type { RequestTypeReading } from '~/src/services/observability/hotspot-shared.js';
import {
  readObservabilityEvents,
  type ObservabilityEvent
} from '~/src/services/observability/observability-service.js';

export const SESSION_A = '2026-10-27-session-hotspots-a';
export const SESSION_B = '2026-10-27-session-hotspots-b';

/** The temp roots this fixture created, so the caller can clean them up. */
const roots: string[] = [];

/** Remove every temp tree the fixture created. */
export function cleanupRoots(): void {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Write a session's metrics file with the given events, then read them back
 * through the real reader — so the shapes under test are the shapes on disk.
 */
export function seedSession(
  sessionId: string,
  events: ReadonlyArray<Record<string, unknown>>
): readonly ObservabilityEvent[] {
  const root = mkdtempSync(join(tmpdir(), 'peaks-hotspots-'));
  roots.push(root);
  const dir = join(root, '.peaks', '_runtime', sessionId, 'metrics');
  mkdirSync(dir, { recursive: true });
  const lines = events.map((event, index) =>
    JSON.stringify({
      schemaVersion: 1,
      ts: new Date(Date.UTC(2026, 9, 27, 0, 0, index)).toISOString(),
      sessionId,
      ...event
    })
  );
  writeFileSync(join(dir, 'slices.jsonl'), `${lines.join('\n')}\n`, 'utf8');
  return readObservabilityEvents(root, sessionId);
}

/** A forward event whose missing list was measured when it was recorded. */
export function forwardMissing(
  sliceRid: string,
  missing: ReadonlyArray<{ path: string; kind: 'absent' | 'body'; ownerSkill: string | null }>
): Record<string, unknown> {
  return {
    category: 'slice-transition',
    sliceRid,
    detail: {
      artifactRole: 'rd',
      to: 'qa-handoff',
      prereqOk: false,
      missingCount: missing.length,
      missing: missing.map((entry) => ({ ...entry, description: 'missing' }))
    }
  };
}

/** A historical event that recorded only a count. */
export function historicalFailure(
  sliceRid: string,
  missingCount: number,
  role: RequestArtifactRole = 'rd',
  to: RequestArtifactState = 'qa-handoff'
): Record<string, unknown> {
  return {
    category: 'slice-transition',
    sliceRid,
    detail: { artifactRole: role, to, prereqOk: false, missingCount }
  };
}

/** The prerequisite list of one transition, read from the real table. */
export function prereqPaths(
  role: RequestArtifactRole,
  to: RequestArtifactState,
  type: RequestType
): readonly string[] {
  return getPrerequisitesFor(role, to, type).map((prereq) => prereq.relativePath);
}

/**
 * A request type a human WROTE DOWN.
 *
 * The retro-attribution now carries the type's PROVENANCE beside the type,
 * because a declared type and a defaulted one produce the same candidates
 * but are different facts. Most cases here are about the candidates, so the
 * declared reading is the one that reads naturally.
 */
export function declaredType(type: RequestType): RequestTypeReading {
  return { requestType: type, source: 'declared' };
}

/**
 * A request type NOBODY WROTE DOWN — the effective type is the default.
 *
 * The candidates are the same as the declared reading's; only the
 * provenance differs, and that is exactly what a case about provenance
 * needs to set up.
 */
export function defaultedType(type: RequestType): RequestTypeReading {
  return { requestType: type, source: 'default' };
}
