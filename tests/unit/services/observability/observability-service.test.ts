/**
 * Tests for `observability-service.ts` — schema validation, emit,
 * and schema-aware read.
 *
 * Slice A of v2.11.1 (slice topology observability). Real-fs tests in
 * per-test temp dirs (no global fs mocking). Negative paths for the
 * `write-failed` branch use chmod on POSIX only; on Windows the test
 * is skipped (matching the jsonl-store pattern).
 */

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  OBSERVABILITY_CATEGORIES,
  OBSERVABILITY_SCHEMA_VERSION,
  ObservabilityEventSchema,
  emitObservabilityEvent,
  isCurrentSchemaVersion,
  readObservabilityEvents
} from '../../../../src/services/observability/observability-service.js';
import { metricsFilePath } from '../../../../src/services/observability/jsonl-store.js';

let projectRoot: string;
const TEST_SID = '2026-06-26-session-obs-test';
const FIXED_TS = '2026-06-26T09:30:00.000Z';

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'peaks-obs-svc-'));
});

afterEach(() => {
  if (existsSync(projectRoot)) {
    // Restore perms in case a negative test chmod'd a path.
    try { chmodSync(metricsFilePath(projectRoot, TEST_SID), 0o644); } catch { /* ignore */ }
    try { chmodSync(join(projectRoot, '.peaks', '_runtime', TEST_SID, 'metrics'), 0o755); } catch { /* ignore */ }
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

function validEvent(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1 as const,
    ts: FIXED_TS,
    sessionId: TEST_SID,
    category: 'slice-transition' as const,
    detail: { from: 'draft', to: 'spec-locked' },
    ...overrides
  };
}

describe('schema', () => {
  test('all 6 categories are accepted', () => {
    for (const category of OBSERVABILITY_CATEGORIES) {
      const event = validEvent({ category });
      expect(ObservabilityEventSchema.safeParse(event).success).toBe(true);
    }
  });

  test('rejects unknown category', () => {
    const event = validEvent({ category: 'made-up-category' });
    expect(ObservabilityEventSchema.safeParse(event).success).toBe(false);
  });

  test('rejects missing schemaVersion', () => {
    const event = { ts: FIXED_TS, sessionId: TEST_SID, category: 'slice-transition', detail: {} };
    expect(ObservabilityEventSchema.safeParse(event).success).toBe(false);
  });

  test('rejects wrong schemaVersion (forward-compat skip per Q3)', () => {
    const event = validEvent({ schemaVersion: 999 });
    expect(ObservabilityEventSchema.safeParse(event).success).toBe(false);
  });

  test('accepts optional sliceRid + role', () => {
    const event = validEvent({ sliceRid: '001-foo', role: 'rd' });
    expect(ObservabilityEventSchema.safeParse(event).success).toBe(true);
  });

  test('rejects unknown sub-agent role', () => {
    const event = validEvent({ role: 'invented-role' });
    expect(ObservabilityEventSchema.safeParse(event).success).toBe(false);
  });

  test('rejects non-datetime ts', () => {
    const event = validEvent({ ts: 'not-a-date' });
    expect(ObservabilityEventSchema.safeParse(event).success).toBe(false);
  });

  test('accepts datetime with offset', () => {
    const event = validEvent({ ts: '2026-06-26T09:30:00+02:00' });
    expect(ObservabilityEventSchema.safeParse(event).success).toBe(true);
  });

  test('rejects empty sessionId', () => {
    const event = validEvent({ sessionId: '' });
    expect(ObservabilityEventSchema.safeParse(event).success).toBe(false);
  });

  test('accepts empty detail (Record<string, unknown> permits {})', () => {
    const event = validEvent({ detail: {} });
    expect(ObservabilityEventSchema.safeParse(event).success).toBe(true);
  });

  test('exports schemaVersion constant', () => {
    expect(OBSERVABILITY_SCHEMA_VERSION).toBe(1);
  });
});

describe('emitObservabilityEvent', () => {
  test('writes a valid event to the session JSONL file', () => {
    const result = emitObservabilityEvent(validEvent(), { projectRoot });
    expect(result.written).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.path).toBe(metricsFilePath(projectRoot, TEST_SID));

    const fileContent = readFileSync(metricsFilePath(projectRoot, TEST_SID), 'utf8');
    expect(fileContent).toMatch(/^\{"schemaVersion":1,"ts":"2026-06-26T09:30:00\.000Z"/);
    expect(fileContent.endsWith('\n')).toBe(true);

    const parsed = JSON.parse(fileContent.trim());
    expect(parsed.category).toBe('slice-transition');
    expect(parsed.detail).toEqual({ from: 'draft', to: 'spec-locked' });
  });

  test('appends multiple events as separate JSONL lines', () => {
    emitObservabilityEvent(validEvent({ detail: { n: 1 } }), { projectRoot });
    emitObservabilityEvent(validEvent({ detail: { n: 2 } }), { projectRoot });
    const lines = readFileSync(metricsFilePath(projectRoot, TEST_SID), 'utf8').split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).detail.n).toBe(1);
    expect(JSON.parse(lines[1]!).detail.n).toBe(2);
  });

  test('returns { written: false, reason: "invalid-schema" } for unknown category', () => {
    // Cast through `unknown` for the negative case — the schema is what
    // we want to verify rejects this, so the static type cannot widen
    // the literal union.
    const bad = { ...validEvent(), category: 'unknown-category' } as unknown as Parameters<typeof emitObservabilityEvent>[0];
    const result = emitObservabilityEvent(bad, { projectRoot });
    expect(result.written).toBe(false);
    expect(result.reason).toBe('invalid-schema');
    expect(existsSync(metricsFilePath(projectRoot, TEST_SID))).toBe(false);
  });

  test('returns { written: false, reason: "write-failed" } when append fails', () => {
    if (process.platform === 'win32') {
      // Skip on Windows (chmod is a no-op for non-executable files).
      expect(true).toBe(true);
      return;
    }
    mkdirSync(join(projectRoot, '.peaks', '_runtime', TEST_SID, 'metrics'), { recursive: true });
    const path = metricsFilePath(projectRoot, TEST_SID);
    writeFileSync(path, '', 'utf8');
    chmodSync(path, 0o444);
    chmodSync(join(projectRoot, '.peaks', '_runtime', TEST_SID, 'metrics'), 0o555);

    const result = emitObservabilityEvent(validEvent(), { projectRoot });
    expect(result.written).toBe(false);
    expect(result.reason).toBe('write-failed');

    chmodSync(join(projectRoot, '.peaks', '_runtime', TEST_SID, 'metrics'), 0o755);
    chmodSync(path, 0o644);
  });
});

describe('readObservabilityEvents', () => {
  test('returns [] when the metrics file does not exist', () => {
    expect(readObservabilityEvents(projectRoot, 'no-such-session')).toEqual([]);
  });

  test('parses and returns valid events', () => {
    emitObservabilityEvent(validEvent({ detail: { n: 1 } }), { projectRoot });
    emitObservabilityEvent(validEvent({ detail: { n: 2 } }), { projectRoot });
    const events = readObservabilityEvents(projectRoot, TEST_SID);
    expect(events).toHaveLength(2);
    expect(events[0]?.detail).toEqual({ n: 1 });
    expect(events[1]?.detail).toEqual({ n: 2 });
    expect(events.every((e) => e.schemaVersion === 1)).toBe(true);
  });

  test('skips malformed JSON lines (forward-compat per Q3)', () => {
    mkdirSync(join(projectRoot, '.peaks', '_runtime', TEST_SID, 'metrics'), { recursive: true });
    writeFileSync(metricsFilePath(projectRoot, TEST_SID), '{"schemaVersion":1,"ts":"2026-06-26T09:30:00.000Z","sessionId":"' + TEST_SID + '","category":"slice-transition","detail":{}}\nNOT_JSON\n', 'utf8');
    const events = readObservabilityEvents(projectRoot, TEST_SID);
    expect(events).toHaveLength(1);
  });

  test('skips records with wrong schemaVersion (forward-compat per Q3)', () => {
    mkdirSync(join(projectRoot, '.peaks', '_runtime', TEST_SID, 'metrics'), { recursive: true });
    writeFileSync(
      metricsFilePath(projectRoot, TEST_SID),
      '{"schemaVersion":1,"ts":"2026-06-26T09:30:00.000Z","sessionId":"' + TEST_SID + '","category":"slice-transition","detail":{}}\n' +
      '{"schemaVersion":999,"ts":"2026-06-26T09:30:00.000Z","sessionId":"' + TEST_SID + '","category":"slice-transition","detail":{"future":true}}\n',
      'utf8'
    );
    const events = readObservabilityEvents(projectRoot, TEST_SID);
    expect(events).toHaveLength(1);
    expect(events[0]?.detail).toEqual({});
  });

  test('skips records that fail schema validation (e.g. unknown category)', () => {
    mkdirSync(join(projectRoot, '.peaks', '_runtime', TEST_SID, 'metrics'), { recursive: true });
    writeFileSync(
      metricsFilePath(projectRoot, TEST_SID),
      '{"schemaVersion":1,"ts":"2026-06-26T09:30:00.000Z","sessionId":"' + TEST_SID + '","category":"made-up","detail":{}}\n' +
      '{"schemaVersion":1,"ts":"2026-06-26T09:30:00.000Z","sessionId":"' + TEST_SID + '","category":"slice-transition","detail":{}}\n',
      'utf8'
    );
    const events = readObservabilityEvents(projectRoot, TEST_SID);
    expect(events).toHaveLength(1);
  });
});

describe('isCurrentSchemaVersion', () => {
  test('returns true for a valid event', () => {
    expect(isCurrentSchemaVersion(validEvent())).toBe(true);
  });

  test('returns false for an invalid event', () => {
    expect(isCurrentSchemaVersion({})).toBe(false);
    expect(isCurrentSchemaVersion(null)).toBe(false);
    expect(isCurrentSchemaVersion('a string')).toBe(false);
  });
});