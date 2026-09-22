// tests/unit/services/dispatch/detached-record-fields.test.ts
//
// Phase A Task 8: extend DispatchRecord schema for detached sub-agent mode.
// Verifies the 4 new fields (mode, vendor, autoCompactEvents, tokenUsage)
// are persisted on new records and that readRecord transparently
// upgrades legacy v3.2 records to the v4.1.0 schema with safe defaults.

import { describe, it, expect } from 'vitest';
import {
  writeInitialDispatchRecord,
  readRecord
} from '../../../../src/services/dispatch/dispatch-record-writer.js';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { parseJson } from '../../../../src/shared/json-parse.js';

/**
 * The persisted record fields these cases read back.
 *
 * They read the RAW file on purpose, and that is the point of the suite:
 * `readRecord` UPGRADES a record, supplying `mode: 'in-process'` and
 * `vendor: null` when the file does not carry them — so a case that proved a
 * field was written by going through `readRecord` would pass even if the write
 * were dropped. That is why the fields under test cannot simply be read with
 * the typed accessor. They can, however, be read with a named shape: this
 * schema is what turns `rec.mode` / `rec.vendor` from `any` reads into checked
 * ones, and a record that does not match fails here instead of silently
 * yielding `undefined` at the assertion.
 *
 * Every field is optional-and-nullable because the two "not provided" cases
 * exist to assert absence, and the writer records that absence as an explicit
 * `null` (measured here: `tokenUsage` is `null`, not missing). Requiring a
 * value here would replace the assertion's failure with a schema error, which
 * would make the suite pass for the wrong reason.
 */
const persistedRecordFields = z.looseObject({
  mode: z.string().optional(),
  vendor: z.string().nullable().optional(),
  autoCompactEvents: z
    .array(z.looseObject({ threshold: z.string() }))
    .nullable()
    .optional(),
  tokenUsage: z
    .looseObject({ promptTokens: z.number(), completionTokens: z.number() })
    .nullable()
    .optional()
});

/** Read the record file as written — no upgrade, no defaults. */
function readPersistedRecord(path: string) {
  return parseJson(readFileSync(path, 'utf8'), persistedRecordFields);
}

describe('DispatchRecord mode/vendor/autoCompact fields', () => {
  const stubToolCall = {
    name: 'Task',
    args: { subagent_type: 'general-purpose', description: 'test', prompt: 'x' },
    toolCallVersion: '2.0.0' as const
  };

  it('persists detached mode + claude vendor on new record', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dr-'));
    try {
      const out = writeInitialDispatchRecord({
        projectRoot: tmp,
        sessionId: 's1',
        requestId: 'r1',
        role: 'rd',
        prompt: 'do X',
        toolCall: stubToolCall,
        batchId: 'b1',
        mode: 'detached',
        vendor: 'claude'
      });
      const rec = readPersistedRecord(out.path);
      expect(rec.mode).toBe('detached');
      expect(rec.vendor).toBe('claude');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('defaults mode to in-process when not provided', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dr-'));
    try {
      const out = writeInitialDispatchRecord({
        projectRoot: tmp,
        sessionId: 's1',
        requestId: 'r1',
        role: 'rd',
        prompt: 'do X',
        toolCall: stubToolCall,
        batchId: 'b1'
      });
      const rec = readPersistedRecord(out.path);
      expect(rec.mode).toBe('in-process');
      expect(rec.vendor ?? null).toBe(null);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('persists autoCompactEvents + tokenUsage arrays', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dr-'));
    try {
      const out = writeInitialDispatchRecord({
        projectRoot: tmp,
        sessionId: 's1',
        requestId: 'r1',
        role: 'rd',
        prompt: 'do X',
        toolCall: stubToolCall,
        batchId: 'b1',
        mode: 'detached',
        vendor: 'claude',
        autoCompactEvents: [
          { at: 1, threshold: '0.85' as const, tokensBefore: 100, tokensAfter: 30 }
        ],
        tokenUsage: { promptTokens: 50, completionTokens: 20 }
      });
      const rec = readPersistedRecord(out.path);
      expect(rec.autoCompactEvents).toHaveLength(1);
      expect(rec.autoCompactEvents?.[0]).toMatchObject({ threshold: '0.85' });
      expect(rec.tokenUsage).toMatchObject({ promptTokens: 50, completionTokens: 20 });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('readRecord upgrades legacy record missing mode field (default in-process)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dr-'));
    try {
      const sub = join(tmp, '.peaks', '_sub_agents', 's1');
      mkdirSync(sub, { recursive: true });
      const file = join(sub, 'rec.json');
      // Minimal v3.2 record (no mode / vendor / autoCompact / tokenUsage)
      writeFileSync(
        file,
        JSON.stringify({
          version: '3.2',
          createdAt: '2026-08-10T15:00:00.000Z',
          completedAt: null,
          outcome: 'no-execution',
          artifactPaths: [],
          disposed: false,
          disposedAt: null,
          role: 'rd',
          requestId: 'r-legacy',
          sessionId: 's1',
          prompt: 'legacy',
          toolCall: stubToolCall,
          batchId: 'b-legacy',
          heartbeats: [],
          lastBeatAt: null,
          status: 'done',
          stage: null,
          leaseId: null,
          isolationStartedAt: null,
          serviceKill: [],
          mergeBackAttempts: 0,
          workflowId: null,
          graphNodeId: null,
          graphRef: null
        })
      );
      const rec = readRecord(file);
      expect(rec.mode).toBe('in-process');
      expect(rec.vendor ?? null).toBe(null);
      expect(rec.autoCompactEvents ?? []).toEqual([]);
      expect(rec.tokenUsage ?? null).toBe(null);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
