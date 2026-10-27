// tests/unit/services/observability/session-metric-rows-fixture.ts
//
// The shared fixture for the session-metric-row suite: a REAL temp tree, a
// REAL metrics file, and the event shapes the emitter writes.
//
// WHY A SEPARATE FIXTURE MODULE. The suite covers two subjects — the row the
// module builds, and the row the module builds WHEN THE REQUEST TYPES ARE
// SUPPLIED — and the two live in two test files. Duplicating the fixture would
// put the same thirty lines in both, and a copy that drifts is a copy that
// lies. It also keeps each test file under the 500-line cap for `tests/`.
//
// THE TREE IS REAL. The session directory, the metrics file and the artifacts
// are written under a temp root and read back through the repository's own
// reader, so the shapes under test are the shapes on disk.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  readObservabilityEvents,
  type ObservabilityEvent
} from '~/src/services/observability/observability-service.js';

/** The session the fixture writes under. */
export const SESSION_ID = '2026-10-27-session-metric-rows';

/** The slice whose compliance is judged. */
export const SLICE_RID = '2026-10-27-observability-rows';

/** The temp roots this fixture created, so the caller can clean them up. */
const roots: string[] = [];

/** A fresh temp project root. */
export function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-session-rows-'));
  roots.push(root);
  return root;
}

/** Remove every temp tree this fixture created. */
export function cleanupRoots(): void {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
}

/** One slice-transition event, in the shape the emitter writes. */
export function transition(
  rid: string,
  to: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    category: 'slice-transition',
    sliceRid: rid,
    detail: { artifactRole: 'rd', to, ...extra }
  };
}

/** One gate decision event, in the shape the gate emitter writes. */
export function gate(
  rid: string,
  gateId: string,
  outcome: 'pass' | 'bypass'
): Record<string, unknown> {
  return {
    category: 'gate',
    sliceRid: rid,
    detail: { phase: 'implemented', outcome, gateId, declaredType: 'feature' }
  };
}

/**
 * Write the session's metrics file, then read the events back through the
 * repository's own reader — so the shapes under test are the shapes on disk.
 */
export function seedEvents(
  root: string,
  events: readonly Record<string, unknown>[]
): readonly ObservabilityEvent[] {
  const dir = join(root, '.peaks', '_runtime', SESSION_ID, 'metrics');
  mkdirSync(dir, { recursive: true });
  const lines = events.map((event, index) =>
    JSON.stringify({
      schemaVersion: 1,
      ts: new Date(Date.UTC(2026, 9, 27, 0, 0, index)).toISOString(),
      sessionId: SESSION_ID,
      ...event
    })
  );
  writeFileSync(join(dir, 'slices.jsonl'), `${lines.join('\n')}\n`, 'utf8');
  return readObservabilityEvents(root, SESSION_ID);
}

/** Write one session-relative artifact under the session directory. */
export function seedArtifact(root: string, relativePath: string): void {
  const path = join(root, '.peaks', '_runtime', SESSION_ID, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, '# artifact\n', 'utf8');
}

/**
 * The artifacts a compliant RD slice leaves behind, at the names they really
 * have on disk — including the numbered prefix the request writer stamps on
 * the per-request artifact.
 */
export function seedCompliantArtifacts(root: string): void {
  seedArtifact(root, `rd/requests/001-${SLICE_RID}.md`);
  seedArtifact(root, `prd/handoff-${SLICE_RID}.md`);
  seedArtifact(root, `rd/code-review-${SLICE_RID}.md`);
  seedArtifact(root, `rd/karpathy-review-${SLICE_RID}.md`);
  seedArtifact(root, `audit/security-${SLICE_RID}.md`);
  seedArtifact(root, `audit/perf-${SLICE_RID}.md`);
}

/**
 * A session whose stream holds two slices: one that passed with every live
 * gate evaluated, and one that passed after a gate was bypassed.
 */
export function seedTwoSliceSession(root: string): readonly ObservabilityEvent[] {
  return seedEvents(root, [
    transition('slice-clean', 'implemented', { prereqOk: true, missingCount: 0 }),
    transition('slice-clean', 'qa-handoff', { prereqOk: true, missingCount: 0 }),
    transition('slice-clean', 'verdict-issued', { prereqOk: true, missingCount: 0 }),
    gate('slice-clean', 'file-size-ratchet', 'pass'),
    transition(SLICE_RID, 'implemented', { prereqOk: true, missingCount: 0 }),
    transition(SLICE_RID, 'qa-handoff', {
      prereqOk: false,
      missingCount: 1,
      missing: [
        {
          path: `rd/code-review-${SLICE_RID}.md`,
          kind: 'absent',
          ownerSkill: 'peaks-rd',
          description: 'free text that must not reach the tracked row'
        }
      ]
    }),
    transition(SLICE_RID, 'verdict-issued', { prereqOk: true, missingCount: 0 }),
    gate(SLICE_RID, 'file-size-ratchet', 'bypass')
  ]);
}
