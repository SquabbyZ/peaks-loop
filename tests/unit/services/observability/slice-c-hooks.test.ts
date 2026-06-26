/**
 * Slice C hook integration tests — verifies the 6 new observability
 * emit sites land JSONL records with the correct category.
 *
 * Slice A already covered `peaks request transition` (#1/7). This
 * file covers hooks #2–#7:
 *   #2 dispatch   (peaks sub-agent dispatch — dispatch-commands.ts)
 *   #3 checkpoint (peaks session checkpoint — session-checkpoint-service.ts)
 *   #4 mode-gate  (D5 — solo-commands.ts: should-pause)
 *   #5 context    (D6 — context-commands.ts: check)
 *   #6 post-compact (D7 — post-compact-detector.ts: detectPostCompactResume)
 *   #7 prereq     (RD→QA — artifact-prerequisites.ts: checkPrerequisites)
 *
 * Each test exercises the existing public API and asserts the JSONL
 * metric landed under the canonical
 * `.peaks/_runtime/<sessionId>/metrics/slices.jsonl` path. The
 * observability-service is the SUT; hook sites are integration
 * surfaces.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { writeCheckpoint } from '../../../../src/services/session/session-checkpoint-service.js';
import { detectPostCompactResume } from '../../../../src/services/solo/post-compact-detector.js';
import { checkPrerequisites } from '../../../../src/services/artifacts/artifact-prerequisites.js';
import { readObservabilityEvents } from '../../../../src/services/observability/observability-service.js';
import { metricsDirPath, metricsFilePath } from '../../../../src/services/observability/jsonl-store.js';

let projectRoot: string;
const TEST_SID = '2026-06-26-session-slice-c';

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'peaks-obs-slice-c-'));
  // Pre-create the canonical session dir + binding so the F21 fail-fast
  // guard in request-artifact-service.ts passes (we don't hit it here,
  // but other hook sites may resolve the session id via getSessionIdCanonical).
  mkdirSync(join(projectRoot, '.peaks', '_runtime', TEST_SID), { recursive: true });
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

function jsonlLines(): Array<Record<string, unknown>> {
  const path = metricsFilePath(projectRoot, TEST_SID);
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, 'utf8');
  return raw.split(/\r?\n/).filter((l) => l.length > 0).map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe('hook #3: peaks session checkpoint', () => {
  test('writeCheckpoint appends a checkpoint-category event', () => {
    writeCheckpoint(projectRoot, {
      sessionId: TEST_SID,
      reason: 'periodic',
      currentPlan: 'slice-c test plan'
    });
    const events = jsonlLines();
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev['category']).toBe('checkpoint');
    expect(ev['sessionId']).toBe(TEST_SID);
    expect(ev['schemaVersion']).toBe(1);
    const detail = ev['detail'] as Record<string, unknown>;
    expect(detail['reason']).toBe('periodic');
    expect(typeof detail['checkpointPath']).toBe('string');
    expect(detail['currentPlanLength']).toBe('slice-c test plan'.length);
  });

  test('writes the checkpoint file alongside the metric', () => {
    writeCheckpoint(projectRoot, {
      sessionId: TEST_SID,
      reason: 'artifact-written'
    });
    expect(existsSync(metricsFilePath(projectRoot, TEST_SID))).toBe(true);
  });
});

describe('hook #6: D7 post-compact detector', () => {
  test('shouldAutoResume=true on match emits a post-compact event', async () => {
    // Pre-create a today's checkpoint that satisfies D7.a
    const ckptDir = metricsDirPath(projectRoot, TEST_SID); // NOT metrics — need checkpoints dir
    const checkpointsDir = join(projectRoot, '.peaks', '_runtime', TEST_SID, 'checkpoints');
    mkdirSync(checkpointsDir, { recursive: true });
    const nowIso = new Date().toISOString();
    writeFileSync(
      join(checkpointsDir, '2026-06-26T09-00-00-000Z-test.json'),
      JSON.stringify({
        sessionId: TEST_SID,
        lastActivity: nowIso,
        currentPlan: 'plan',
        openQuestions: [],
        recentDecisions: [],
        recentArtifactPaths: [],
        gitStatus: '',
        skillsActive: [],
        todoState: [],
        reason: 'periodic',
        mode: 'assisted',
        createdAt: nowIso
      }, null, 2),
      'utf8'
    );

    const probe = await detectPostCompactResume({
      sessionId: TEST_SID,
      projectRoot,
      activeSkill: 'peaks-solo'
    });

    expect(probe.shouldAutoResume).toBe(true);
    const events = jsonlLines();
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev['category']).toBe('post-compact');
    const detail = ev['detail'] as Record<string, unknown>;
    expect(detail['shouldAutoResume']).toBe(true);
    expect(detail['reason']).toBe('post-compact-match');
    expect(detail['mode']).toBe('assisted');
  });

  test('shouldAutoResume=false on miss emits NOTHING (only success path emits)', async () => {
    const probe = await detectPostCompactResume({
      sessionId: TEST_SID,
      projectRoot,
      activeSkill: 'peaks-solo'
    });
    expect(probe.shouldAutoResume).toBe(false);
    // The current Slice C scope emits only on the success path
    // (post-compact-match); skip paths are observed via the existing
    // formatPostCompactResumeLogLine channel.
    expect(jsonlLines()).toEqual([]);
  });
});

describe('hook #7: artifact-prerequisites (RD→QA)', () => {
  test('checkPrerequisites emits a slice-transition event with prereqOk detail', async () => {
    // Set up a fake qa-initiated marker (required for rd:qa-handoff gate)
    const qaDir = join(projectRoot, '.peaks', '_runtime', TEST_SID, 'qa');
    mkdirSync(qaDir, { recursive: true });
    writeFileSync(join(qaDir, '.initiated'), '', 'utf8');

    const result = await checkPrerequisites({
      projectRoot,
      changeId: '001-test',
      sessionId: TEST_SID,
      role: 'rd',
      newState: 'qa-handoff',
      requestId: '001-test',
      requestType: 'feature'
    });

    // Result is probably `ok: false` (no prereqs met) — the emit must
    // still happen with prereqOk=false.
    expect(result.ok).toBe(false);

    const events = jsonlLines();
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev['category']).toBe('slice-transition');
    expect(ev['sliceRid']).toBe('001-test');
    const detail = ev['detail'] as Record<string, unknown>;
    expect(detail['artifactRole']).toBe('rd');
    expect(detail['to']).toBe('qa-handoff');
    expect(detail['prereqOk']).toBe(false);
    expect(typeof detail['missingCount']).toBe('number');
  });

  test('readObservabilityEvents returns the emitted record', async () => {
    const qaDir = join(projectRoot, '.peaks', '_runtime', TEST_SID, 'qa');
    mkdirSync(qaDir, { recursive: true });
    writeFileSync(join(qaDir, '.initiated'), '', 'utf8');
    await checkPrerequisites({
      projectRoot,
      changeId: '002-test',
      sessionId: TEST_SID,
      role: 'rd',
      newState: 'qa-handoff',
      requestId: '002-test',
      requestType: 'feature'
    });
    const events = readObservabilityEvents(projectRoot, TEST_SID);
    expect(events).toHaveLength(1);
    expect(events[0]?.category).toBe('slice-transition');
  });
});

describe('hook #2: dispatch (manual emit via observability-service)', () => {
  // The dispatch CLI handler exercises the same emit shape. We test
  // the observability-service schema validation here — the dispatch
  // CLI path is exercised via integration tests in dispatch-commands.
  test('dispatch event with known role passes schema', async () => {
    const { emitObservabilityEvent } = await import('../../../../src/services/observability/observability-service.js');
    const result = emitObservabilityEvent({
      schemaVersion: 1,
      ts: new Date().toISOString(),
      sessionId: TEST_SID,
      category: 'dispatch',
      role: 'rd',
      detail: { requestId: '003-test', ide: 'claude-code', promptBytes: 100, headroomCompressed: false }
    }, { projectRoot });
    expect(result.written).toBe(true);
    const events = jsonlLines();
    expect(events).toHaveLength(1);
    expect(events[0]?.['category']).toBe('dispatch');
    expect(events[0]?.['role']).toBe('rd');
  });
});

describe('hook #4 + #5: mode-gate + context-trigger (manual emit)', () => {
  test('mode-gate event passes schema', async () => {
    const { emitObservabilityEvent } = await import('../../../../src/services/observability/observability-service.js');
    const result = emitObservabilityEvent({
      schemaVersion: 1,
      ts: new Date().toISOString(),
      sessionId: TEST_SID,
      category: 'mode-gate',
      detail: { mode: 'full-auto', step: 'phase-6-qa-gate-d', shouldPause: false, reason: 'auto-proceed' }
    }, { projectRoot });
    expect(result.written).toBe(true);
    expect(jsonlLines()[0]?.['category']).toBe('mode-gate');
  });

  test('context-trigger event passes schema', async () => {
    const { emitObservabilityEvent } = await import('../../../../src/services/observability/observability-service.js');
    const result = emitObservabilityEvent({
      schemaVersion: 1,
      ts: new Date().toISOString(),
      sessionId: TEST_SID,
      category: 'context-trigger',
      detail: { kind: 'soft-warn', promptSize: 150_000, ratio: 0.58 }
    }, { projectRoot });
    expect(result.written).toBe(true);
    expect(jsonlLines()[0]?.['category']).toBe('context-trigger');
  });
});