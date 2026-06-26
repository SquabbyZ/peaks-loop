/**
 * Hook integration test — `peaks request transition` emits a
 * `slice-transition` event (Slice A hook #1/7 of v2.11.1).
 *
 * Verifies the wiring between `request-artifact-service.ts` and the
 * new observability service. The other 6 hooks land in Slice B/C.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { createRequestArtifact, transitionRequestArtifact } from '../../../../src/services/artifacts/request-artifact-service.js';
import { readObservabilityEvents } from '../../../../src/services/observability/observability-service.js';
import { metricsFilePath } from '../../../../src/services/observability/jsonl-store.js';

let projectRoot: string;
const TEST_SID = '2026-06-26-session-hook-test';

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'peaks-obs-hook-'));
  // Pre-create the canonical session dir + the binding file so the
  // artifact service's F21 fail-fast check passes.
  const sessionDir = join(projectRoot, '.peaks', '_runtime', TEST_SID);
  const { mkdirSync, writeFileSync } = require('node:fs') as typeof import('node:fs');
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(
    join(projectRoot, '.peaks', '_runtime', 'session.json'),
    JSON.stringify({ sessionId: TEST_SID, projectRoot, createdAt: new Date().toISOString() }, null, 2),
    'utf8'
  );
});

afterEach(() => {
  if (existsSync(projectRoot)) {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

describe('peaks request transition → observability hook', () => {
  test('emits a slice-transition event on successful transition', async () => {
    const created = await createRequestArtifact({
      role: 'rd',
      requestId: '001-test-slice',
      projectRoot,
      sessionId: TEST_SID,
      apply: true
    });
    expect(created.applied).toBe(true);

    const result = await transitionRequestArtifact({
      role: 'rd',
      requestId: '001-test-slice',
      projectRoot,
      sessionId: TEST_SID,
      newState: 'spec-locked',
      reason: 'tests confirm slice-transition emit',
      // The default RD artifact template intentionally fails the lint gate
      // until populated with real content; bypass it here so the test
      // exercises the hook, not the template.
      allowIncomplete: true,
      forceConfirm: true
    });

    expect(result).not.toBeNull();
    expect(result?.state).toBe('spec-locked');

    const events = readObservabilityEvents(projectRoot, TEST_SID);
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.schemaVersion).toBe(1);
    expect(event.category).toBe('slice-transition');
    expect(event.sliceRid).toBe('001-test-slice');
    expect(event.detail).toEqual({
      from: 'draft',
      to: 'spec-locked',
      artifactRole: 'rd',
      reason: 'tests confirm slice-transition emit'
    });
  });

  test('does NOT emit when the transition fails (artifact does not exist)', async () => {
    const result = await transitionRequestArtifact({
      role: 'rd',
      requestId: '001-does-not-exist',
      projectRoot,
      sessionId: TEST_SID,
      newState: 'spec-locked'
    });

    expect(result).toBeNull();
    // No metrics file should be created on a null-return.
    expect(existsSync(metricsFilePath(projectRoot, TEST_SID))).toBe(false);
  });

  test('emits one event per transition (multi-step)', async () => {
    await createRequestArtifact({
      role: 'rd',
      requestId: '001-multi-step',
      projectRoot,
      sessionId: TEST_SID,
      apply: true
    });

    await transitionRequestArtifact({
      role: 'rd', requestId: '001-multi-step', projectRoot, sessionId: TEST_SID,
      newState: 'spec-locked',
      allowIncomplete: true, forceConfirm: true
    });
    await transitionRequestArtifact({
      role: 'rd', requestId: '001-multi-step', projectRoot, sessionId: TEST_SID,
      newState: 'implemented',
      allowIncomplete: true, forceConfirm: true
    });

    const events = readObservabilityEvents(projectRoot, TEST_SID);
    expect(events).toHaveLength(2);
    expect(events[0]?.detail).toMatchObject({ from: 'draft', to: 'spec-locked' });
    expect(events[1]?.detail).toMatchObject({ from: 'spec-locked', to: 'implemented' });
    expect(events.every((e) => e.category === 'slice-transition')).toBe(true);
  });

  test('JSONL line format is one-line-per-event with trailing newline', async () => {
    await createRequestArtifact({
      role: 'rd',
      requestId: '001-line-format',
      projectRoot,
      sessionId: TEST_SID,
      apply: true
    });
    await transitionRequestArtifact({
      role: 'rd', requestId: '001-line-format', projectRoot, sessionId: TEST_SID,
      newState: 'spec-locked',
      allowIncomplete: true, forceConfirm: true
    });

    const raw = readFileSync(metricsFilePath(projectRoot, TEST_SID), 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw.split('\n').filter((l) => l.length > 0)).toHaveLength(1);
    expect(raw).not.toContain('\n\n');
  });
});